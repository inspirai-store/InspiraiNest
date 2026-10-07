import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeCollectionJson } from '../../scripts/write-collection-json.mjs';
import { createService } from '../src/server.mjs';
import { api, runWorker, prepareWorkspace, taskPrompt } from '../src/worker.mjs';
import { readWorkerEvents } from '../src/worker-events.mjs';
import { agentEnvironment } from '../src/agents.mjs';

const helper = fileURLToPath(new URL('../../scripts/write-collection-json.mjs', import.meta.url));
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
const metadata = () => ({ schema_version: 1, id: 'article:utf8-fixture', type: 'article', platform: 'fixture', title: '中文标题',
  source_url: 'https://example.com/utf8-fixture', canonical_url: null, aliases: [], creator: null, published_at: null,
  collected_at: '2026-10-08T10:00:00+08:00', organized_at: '2026-10-08', mode: 'general', scenario: null,
  summary: '中文摘要保持可读', tags: ['中文'], status: 'archived', verification_status: 'source_only', verified_at: null,
  coverage_note: '仅为隔离测试资料', related: [], files: [{ path: 'summary.md', role: 'summary' }] });

test('ASCII Base64 writer preserves Chinese and rejects damaged metadata before replacing a good file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collection-writer-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeCollectionJson('articles/fixture/source.json', encode(metadata()), root);
  const target = path.join(root, 'articles/fixture/source.json'), before = fs.readFileSync(target);
  assert.equal(JSON.parse(before).summary, metadata().summary);
  assert.throws(() => writeCollectionJson('articles/fixture/source.json', encode({ ...metadata(), summary: '???' }), root), /Unreadable summary/);
  assert.deepEqual(fs.readFileSync(target), before);
  writeCollectionJson('collector-events.jsonl', encode({ stage: 'archiving', message: '中文归档完成' }), root);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'collector-events.jsonl'), 'utf8')).message, '中文归档完成');
  assert.equal(agentEnvironment({}).PYTHONIOENCODING, 'utf-8');
  assert.match(taskPrompt({}), /不同调用不会保留此设置/);
});

test('Windows PowerShell 5.1 ASCII pipe damages Chinese but the workspace writer retains it', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-utf8-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const script = `$OutputEncoding=[System.Text.ASCIIEncoding]::new(); $text=-join([char]0x4e2d,[char]0x6587); $text | & ${quote(process.execPath)} -e "process.stdin.on('data',b=>console.log(b.toString().trim()))"; & ${quote(process.execPath)} ${quote(helper)} 'source.json' '${encode(metadata())}'`;
  const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /\?\?/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'source.json'), 'utf8')), metadata());
});

test('damaged ready checkpoint is blocked locally, then repaired and retried without running the Agent again', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-utf8-')), key = crypto.randomUUID();
  const service = createService({ dataDir: path.join(root, 'service'), masterKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const server = `http://127.0.0.1:${service.server.address().port}`;
  const owner = { server, ...await api({ server }, '/api/pair', 'POST', { key, name: 'encoding-owner' }) };
  const pairing = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
  const worker = { server, ...await api({ server }, '/api/pair', 'POST', { key: pairing.key, name: 'encoding-worker' }) };
  const task = await api(owner, '/api/tasks', 'POST', { content: '隔离编码测试', autoArchive: true, submissionId: crypto.randomUUID() });
  const agent = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url));
  const config = { ...worker, dataDir: path.join(root, 'worker'), capabilities: ['article'], agents: { codex: { command: process.execPath, args: [agent], versionArgs: [agent, '--version'] }, codebuddy: { enabled: false } } };
  const workspace = prepareWorkspace(task, config.dataDir), entry = path.join(workspace, 'articles/fixture'); fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, 'summary.md'), '# 中文正文\n保持可读。\n');
  fs.writeFileSync(path.join(entry, 'source.json'), JSON.stringify({ ...metadata(), summary: '损坏????' }));
  fs.writeFileSync(path.join(workspace, 'collector-result.json'), JSON.stringify({ status: 'ready', entry: 'articles/fixture' }));
  const rebuild = () => { const result = spawnSync(process.execPath, ['scripts/catalog.mjs', 'build'], { cwd: workspace, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
  rebuild();
  let uploads = 0; service.server.on('request', req => { if (req.url.endsWith('/result')) uploads++; });
  await runWorker(config, { once: true });
  assert.equal((await api(owner, '/api/state')).tasks.find(item => item.id === task.id).state, 'waiting_action');
  assert.equal(uploads, 0); assert.equal(readWorkerEvents(config.dataDir, { taskId: task.id }).activeIssues, 1);
  writeCollectionJson('articles/fixture/source.json', encode(metadata()), workspace);
  rebuild();
  await api(owner, `/api/tasks/${task.id}/retry`, 'POST', {});
  await runWorker(config, { once: true });
  const state = await api(owner, '/api/state'); assert.equal(state.tasks.find(item => item.id === task.id).state, 'completed');
  assert.equal(uploads, 1); assert.equal(state.archives[0].meta.summary, metadata().summary);
  assert.equal(readWorkerEvents(config.dataDir, { taskId: task.id }).activeIssues, 0);
  assert.equal(fs.existsSync(path.join(config.dataDir, 'tasks', task.id, 'codex.log')), false, 'ready checkpoint avoids rerunning collection');
});
