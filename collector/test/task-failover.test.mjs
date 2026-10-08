import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../src/server.mjs';
import { api, processTask, runWorker } from '../src/worker.mjs';
import { secret, hash } from '../src/common.mjs';
import { LocalStorage } from '../src/storage.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';

async function fixture(t, mysql = false, storage) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-failover-')), key = secret(); let at = Date.now();
  const store = mysql ? await mysqlFixture() : undefined;
  const app = createService({ dataDir: root, masterKey: key, clock: () => at, ...(store ? { store } : {}), ...(storage ? { storage } : {}) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const server = `http://127.0.0.1:${app.server.address().port}`;
  const owner = { server, ...await api({ server }, '/api/pair', 'POST', { key, name: 'owner' }) };
  const heartbeat = (node, extra = {}) => api(node, '/api/heartbeat', 'POST', { capabilities: ['article'], agents: ['codex'], ...extra });
  const node = async (name, extra) => {
    const pairing = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
    const result = { server, ...await api({ server }, '/api/pair', 'POST', { key: pairing.key, name, platform: process.platform }) };
    await heartbeat(result, extra); return result;
  };
  const claim = async node => (await api(node, '/api/claim', 'POST', { assignmentProtocol: 1 })).task;
  const submit = extra => api(owner, '/api/tasks', 'POST', { content: '隔离采集 https://example.com/fixture', type: 'article', submissionId: crypto.randomUUID(), ...extra });
  const progress = (node, task, state, failureCode) => api(node, `/api/tasks/${task.id}/progress`, 'POST', { state, message: failureCode || '来源需要用户操作', ...(failureCode ? { failureCode } : {}) }, task.assignmentId);
  const replicas = [];
  t.after(async () => { for (const replica of replicas) await replica.close(); await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, app, owner, server, heartbeat, node, claim, submit, progress, replicas, advance: ms => { at += ms; } };
}

for (const mysql of [false, true]) {
  const engine = mysql ? 'MySQL' : 'SQLite', options = { skip: mysql && !process.env.MYSQL_URL };
  test(`${engine}: independent API instances cannot assign one task twice or two execution slots to one node`, options, async t => {
    const f = await fixture(t, mysql), a = await f.node('A'), b = await f.node('B');
    const store = new Proxy(f.app.store, { get(object, key) { if (key === 'close') return async () => {}; const value = Reflect.get(object, key); return typeof value === 'function' ? value.bind(object) : value; } });
    const replica = createService({ dataDir: path.join(f.root, 'replica'), masterKey: secret(), store });
    await new Promise(r => replica.server.listen(0, '127.0.0.1', r)); f.replicas.push(replica);
    const alternate = node => ({ ...node, server: `http://127.0.0.1:${replica.server.address().port}` });
    const first = await f.submit();
    const simultaneous = await Promise.all([f.claim(a), f.claim(alternate(b))]);
    assert.equal(simultaneous.filter(Boolean).length, 1);
    await api(f.owner, `/api/tasks/${first.id}/cancel`, 'POST', {});
    await f.submit(); await f.submit();
    await Promise.all([f.claim(a), f.claim(alternate(a))]);
    assert.equal((await api(f.owner, '/api/state')).tasks.filter(t => t.deviceId === a.device.id && t.state === 'assigned').length, 1);
  });
  test(`${engine}: preferred node failure transfers the same submission once and rejects stale writes`, options, async t => {
    const f = await fixture(t, mysql), a = await f.node('A'), b = await f.node('B'), c = await f.node('C');
    const wrongType = await f.node('wrong type', { capabilities: ['video'] });
    const wrongAgent = await f.node('wrong agent', { agents: ['codebuddy'] });
    const submitted = await f.submit({ deviceId: a.device.id, agent: 'codex' });
    assert.equal(await f.claim(b), null);
    const first = await f.claim(a);
    const moved = await f.progress(a, first, 'waiting_action', 'AGENT_ENVIRONMENT');
    assert.equal(moved.state, 'queued'); assert.equal(moved.deviceId, null);
    assert.equal(moved.preferredDeviceId, a.device.id); assert.equal(moved.submissionId, submitted.submissionId);
    assert.ok(moved.events.some(e => e.message === 'AGENT_ENVIRONMENT'));
    assert.deepEqual(moved.selectedSkills, []); assert.equal(moved.agent, null);
    assert.equal(await f.claim(a), null); assert.equal(await f.claim(wrongType), null); assert.equal(await f.claim(wrongAgent), null);
    const claims = await Promise.all([f.claim(b), f.claim(c)]);
    assert.equal(claims.filter(Boolean).length, 1);
    const second = claims.find(Boolean), winner = second.deviceId === b.device.id ? b : c;
    assert.equal(second.id, submitted.id); assert.notEqual(second.assignmentId, first.assignmentId);
    await assert.rejects(f.progress(a, first, 'running'), { status: 403 });
    await assert.rejects(api(winner, `/api/tasks/${second.id}/progress`, 'POST', { state: 'running', message: 'stale attempt' }, first.assignmentId), { status: 409 });
    assert.equal((await f.progress(winner, second, 'running')).state, 'running');
    const duplicate = await api(f.owner, '/api/tasks', 'POST', { content: submitted.content, type: 'article', submissionId: submitted.submissionId, deviceId: a.device.id, agent: 'codex' });
    assert.equal(duplicate.id, submitted.id);
  });
  test(`${engine}: exhaustion stops rerouting; explicit retry keeps workspace and rotates assignment`, options, async t => {
    const f = await fixture(t, mysql), a = await f.node('A'), b = await f.node('B');
    await f.submit(); const first = await f.claim(a);
    await f.progress(a, first, 'failed'); const second = await f.claim(b);
    const exhausted = await f.progress(b, second, 'waiting_action', 'AGENT_PERMISSION');
    assert.equal(exhausted.state, 'waiting_action'); assert.equal(exhausted.deviceId, b.device.id);
    assert.equal(exhausted.failover.exhausted, true); assert.equal(await f.claim(a), null); assert.equal(await f.claim(b), null);
    const retried = await api(f.owner, `/api/tasks/${first.id}/retry`, 'POST', {});
    assert.equal(retried.deviceId, b.device.id); assert.deepEqual(retried.failedDeviceIds, []);
    const resumed = await f.claim(b);
    await assert.rejects(f.progress(b, second, 'running'), { status: 409 });
    await f.progress(b, resumed, 'running');
  });
}

test('source and upload validation barriers stay local; owner can switch while worker cannot', async t => {
  const f = await fixture(t), a = await f.node('A'), b = await f.node('B');
  await f.submit(); const task = await f.claim(a);
  const waiting = await f.progress(a, task, 'waiting_action');
  assert.equal(waiting.deviceId, a.device.id); assert.equal(await f.claim(b), null);
  await assert.rejects(api(a, `/api/tasks/${task.id}/reassign`, 'POST', {}), { status: 403 });
  await api(f.owner, `/api/tasks/${task.id}/reassign`, 'POST', {});
  const next = await f.claim(b); assert.equal(next.id, task.id);
  await assert.rejects(f.progress(b, next, 'waiting_action', 'ARCHIVE_ENCODING'), { status: 400 });
  assert.equal((await f.progress(b, next, 'waiting_action')).deviceId, b.device.id);
  await assert.rejects(api(f.owner, `/api/tasks/${task.id}/reassign`, 'POST', {}), { status: 409 });
});

test('two-minute heartbeat loss transfers fenced work; upload checkpoints and legacy offline clients stay local', async t => {
  const f = await fixture(t), a = await f.node('A'), b = await f.node('B'), legacy = await f.node('legacy'), upload = await f.node('upload');
  await f.submit({ deviceId: a.device.id }); const first = await f.claim(a);
  await f.submit({ deviceId: legacy.device.id }); const old = (await api(legacy, '/api/claim', 'POST', {})).task;
  await f.submit({ deviceId: upload.device.id }); const checkpoint = await f.claim(upload); await f.progress(upload, checkpoint, 'uploading');
  f.advance(119999); await f.heartbeat(b);
  assert.equal(await f.claim(b), null);
  f.advance(1); await f.heartbeat(b);
  const transferred = await f.claim(b); assert.equal(transferred.id, first.id);
  const tasks = (await api(f.owner, '/api/state')).tasks;
  assert.equal(tasks.find(t => t.id === old.id).deviceId, legacy.device.id);
  assert.equal(tasks.find(t => t.id === checkpoint.id).state, 'uploading');
  await assert.rejects(f.progress(a, first, 'running'), { status: 403 });
  await f.heartbeat(a);
  assert.ok(!(await api(a, '/api/heartbeat', 'POST', { capabilities: ['article'], agents: ['codex'] })).tasks.some(t => t.id === first.id));
});

test('a late result cannot publish after the owner switches during storage upload', async t => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'failover-storage-')); t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const storage = new LocalStorage(storageRoot); let release, entered;
  const started = new Promise(r => { entered = r; }), blocked = new Promise(r => { release = r; });
  const put = storage.put.bind(storage);
  storage.put = async (...args) => { entered(); await blocked; return put(...args); };
  const f = await fixture(t, false, storage), a = await f.node('A'), b = await f.node('B');
  await f.submit(); const first = await f.claim(a);
  const bytes = Buffer.from('# 隔离测试报告\n采集已完成。');
  const file = { path: 'summary.md', role: 'summary', bytes: bytes.length, sha256: hash(bytes), body: bytes.toString('base64') };
  const bundle = { version: 1, meta: { schema_version: 1, id: 'article:failover', type: 'article', title: '隔离结果', summary: '隔离采集摘要', coverage_note: '隔离测试', mode: 'general', scenario: null, verification_status: 'source_only', status: 'archived', tags: ['测试'], aliases: [], related: [], source_url: 'https://example.com/fixture', canonical_url: null, published_at: null, organized_at: null, verified_at: null, collected_at: '2026-10-08T10:00:00+08:00', files: [{ path: file.path, role: file.role }] }, files: [file], omitted: [] };
  const publishing = api(a, `/api/tasks/${first.id}/result`, 'POST', bundle, first.assignmentId).then(value => ({ value }), error => ({ error }));
  await Promise.race([started, publishing.then(result => { throw result.error || new Error('Upload did not block'); })]);
  await api(f.owner, `/api/tasks/${first.id}/reassign`, 'POST', {}); const next = await f.claim(b);
  release(); assert.equal((await publishing).error?.status, 403);
  assert.equal((await api(f.owner, '/api/state')).archives.length, 0);
  await api(b, `/api/tasks/${next.id}/result`, 'POST', bundle, next.assignmentId);
  assert.equal((await api(f.owner, '/api/state')).tasks[0].state, 'completed');
});

test('real Agent environment failure is rerouted and the second Worker completes the same task', async t => {
  const f = await fixture(t), a = await f.node('A'), b = await f.node('B'); await f.submit({ deviceId: a.device.id });
  const first = await f.claim(a), dataDir = path.join(f.root, 'node-a');
  const failingAgent = path.join(f.root, 'environment-agent.mjs');
  fs.writeFileSync(failingAgent, `import fs from 'node:fs'; fs.writeFileSync('retained.txt','original node files'); fs.writeFileSync('collector-result.json',JSON.stringify({status:'waiting_action',category:'environment',message:'缺少本机测试工具'}));`);
  await processTask({ ...a, dataDir, agents: { codex: { command: process.execPath, args: [failingAgent] } } }, first, { codex: { available: true } });
  assert.equal(fs.readFileSync(path.join(dataDir, 'tasks', first.id, 'library', 'retained.txt'), 'utf8'), 'original node files');
  const fake = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url));
  await runWorker({ ...b, dataDir: path.join(f.root, 'node-b'), capabilities: ['article'], agents: { codex: { command: process.execPath, args: [fake], versionArgs: [fake, '--version'] }, codebuddy: { enabled: false } } }, { once: true });
  const completed = (await api(f.owner, '/api/state')).tasks[0];
  assert.equal(completed.id, first.id); assert.equal(completed.state, 'completed'); assert.equal(completed.deviceId, b.device.id);
});
