import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../src/server.mjs';
import { api, runWorker } from '../src/worker.mjs';
import { atomicJson, secret } from '../src/common.mjs';
import { workerSnapshot, sendControl, redact, createWorkerControl } from '../src/worker-control.mjs';
import { WorkerManager } from '../desktop/manager.mjs';

export async function until(fn, timeout = 12000) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('Timed out waiting for fixture');
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-control-'));
  const masterKey = secret();
  const service = createService({ dataDir: path.join(root, 'server'), masterKey });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  const server = `http://127.0.0.1:${service.server.address().port}`;
  const owner = { server, ...await api({ server }, '/api/pair', 'POST', { key: masterKey, name: 'fixture-owner' }) };
  const pairing = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
  const paired = await api({ server }, '/api/pair', 'POST', { key: pairing.key, name: 'fixture-worker' });
  const agent = fileURLToPath(new URL('./fixtures/slow-agent.mjs', import.meta.url));
  const config = { server, token: paired.token, dataDir: path.join(root, 'worker'), pollMs: 250, capabilities: ['article'],
    agents: { codex: { command: process.execPath, args: [agent], versionArgs: [agent, '--version'] }, codebuddy: { enabled: false } } };
  const file = path.join(root, 'worker.json'); atomicJson(file, config);
  const submit = () => api(owner, '/api/tasks', 'POST', { content: '合成控制测试，不访问外部队列', submissionId: crypto.randomUUID() });
  return { root, config, file, owner, submit };
}

test('pause/resume/drain acknowledge commands; in-flight task completes and queued task stays untouched', async t => {
  const { config, file, owner, submit } = await fixture(t);
  const first = await submit();
  const abort = new AbortController();
  const running = runWorker(config, { signal: abort.signal, paused: true });
  t.after(async () => { abort.abort(); await running; });
  await until(() => workerSnapshot(config.dataDir).phase === 'paused');
  const second = await submit();
  assert.equal((await api(owner, '/api/state')).tasks.find(x => x.id === first.id).state, 'queued');
  const manager = new WorkerManager(file, process.execPath);
  await assert.rejects(manager.start(), /已在运行/);
  await assert.rejects(runWorker(config, { once: true }), /Another worker/);
  await manager.control('resume');
  await until(() => workerSnapshot(config.dataDir).current?.state === 'running');
  await manager.control('pause');
  assert.equal(workerSnapshot(config.dataDir).mode, 'paused');
  await until(() => workerSnapshot(config.dataDir).lastTask?.state === 'completed');
  assert.equal((await api(owner, '/api/state')).tasks.find(x => x.id === second.id).state, 'queued');
  await manager.control('resume');
  await until(() => workerSnapshot(config.dataDir).current?.id === second.id);
  const third = await submit();
  await manager.control('drain');
  await running;
  const state = await api(owner, '/api/state');
  assert.equal(state.tasks.find(x => x.id === second.id).state, 'completed');
  assert.equal(state.tasks.find(x => x.id === third.id).state, 'queued');
  assert.equal(workerSnapshot(config.dataDir).running, false);
  assert.equal(fs.existsSync(path.join(config.dataDir, 'tasks', second.id, 'library', 'articles', 'fixture', 'video.mp4')), true);
  assert.equal(JSON.stringify(manager.snapshot()).includes(config.token), false);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(config.dataDir, 'worker-status.json')))).includes(config.token), false);
  await assert.rejects(manager.control('resume'), /未发送操作/);
});

test('desktop pairs an unconfigured computer without exposing its token', async t => {
  const { root, owner } = await fixture(t);
  const file = path.join(root, 'fresh-worker.json');
  atomicJson(file, { dataDir: path.join(root, 'fresh-worker'), capabilities: ['article'], agents: { codex: { command: 'codex' } } });
  const pairing = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
  const manager = new WorkerManager(file, process.execPath);
  const state = await manager.pair({ server: owner.server, key: pairing.key, name: '下载版 Worker' });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(state.paired, true);
  assert.equal(saved.server, owner.server);
  assert.equal(saved.name, '下载版 Worker');
  assert.equal(saved.agents.codex.command, 'codex');
  assert.ok(saved.token);
  assert.ok(!JSON.stringify(state).includes(saved.token));
  await assert.rejects(manager.pair({ server: owner.server, key: pairing.key, name: '重复配对' }), /Invalid or expired/);
});

test('stale and legacy workers cannot be controlled, and commands from a previous run are ignored', async t => {
  const { config } = await fixture(t);
  fs.mkdirSync(config.dataDir);
  fs.writeFileSync(path.join(config.dataDir, 'worker.lock'), String(process.pid));
  assert.equal(workerSnapshot(config.dataDir).legacy, true);
  assert.throws(() => sendControl(config.dataDir, 'drain'), /未发送操作/);
  atomicJson(path.join(config.dataDir, 'worker-status.json'), { protocol: 1, runId: 'old', pid: process.pid, phase: 'idle', updatedAt: '2000-01-01T00:00:00Z' });
  assert.equal(workerSnapshot(config.dataDir).stale, true);
  assert.throws(() => sendControl(config.dataDir, 'pause'), /未发送操作/);
  fs.unlinkSync(path.join(config.dataDir, 'worker.lock'));
  atomicJson(path.join(config.dataDir, 'worker-control.json'), { runId: 'old', id: 'old-command', action: 'drain' });
  const abort = new AbortController(); const running = runWorker(config, { signal: abort.signal, paused: true });
  t.after(async () => { abort.abort(); await running; });
  await until(() => workerSnapshot(config.dataDir).phase === 'paused');
  assert.equal(workerSnapshot(config.dataDir).mode, 'paused');
  assert.notEqual(workerSnapshot(config.dataDir).runId, 'old');
  sendControl(config.dataDir, 'drain'); await running;
});

test('manager starts a detached synthetic worker, survives a new manager, and drains it without deleting credentials', async t => {
  const { config, file } = await fixture(t);
  const original = fs.readFileSync(file);
  const first = new WorkerManager(file, process.execPath);
  await first.start({ paused: true });
  t.after(async () => { if (workerSnapshot(config.dataDir).managed) { sendControl(config.dataDir, 'drain'); await until(() => !workerSnapshot(config.dataDir).running); } });
  const second = new WorkerManager(file, process.execPath);
  await until(() => second.snapshot().phase === 'paused');
  assert.equal(second.snapshot().pid, first.snapshot().pid);
  await second.stop();
  await until(() => !second.snapshot().running);
  await second.stop(); // Stopping an already stopped Worker never sends a new command.
  assert.deepEqual(fs.readFileSync(file), original);
});

test('log view is bounded, credential-redacted and rejects traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-logs-'));
  const file = path.join(root, 'worker.json'); atomicJson(file, { dataDir: root, token: 'private-device-token' });
  fs.writeFileSync(path.join(root, 'worker.stdout.log'), 'x'.repeat(50000) + '\nBearer private-device-token\n{"token":"another-secret"}');
  const manager = new WorkerManager(file);
  const logs = manager.logs();
  assert.ok(logs.length < 25000);
  assert.ok(!logs.includes('private-device-token') && !logs.includes('another-secret'));
  assert.throws(() => manager.logs('../'), /没有可打开/);
  assert.equal(redact('Bearer abc123'), 'Bearer [已隐藏]');
});

test('waiting-action reason survives paused restart; explicit drain leaves the next task queued', async t => {
  const { config, owner, submit } = await fixture(t);
  const script = fileURLToPath(new URL('./fixtures/waiting-agent.mjs', import.meta.url));
  config.agents.codex.args = [script];
  const first = await submit();
  const abort = new AbortController();
  let running = runWorker(config, { signal: abort.signal });
  t.after(async () => { abort.abort(); await running; });
  await until(() => workerSnapshot(config.dataDir).lastTask?.state === 'waiting_action');
  sendControl(config.dataDir, 'pause');
  await until(() => workerSnapshot(config.dataDir).mode === 'paused');
  // Submit only after the first task is retained, avoiding same-millisecond FIFO ties.
  const second = await submit();
  assert.match(workerSnapshot(config.dataDir).lastTask.message, /补齐本机测试工具/);
  sendControl(config.dataDir, 'drain'); await running;
  running = runWorker(config, { signal: abort.signal, paused: true });
  await until(() => workerSnapshot(config.dataDir).phase === 'paused');
  assert.equal(workerSnapshot(config.dataDir).lastTask.id, first.id);
  assert.match(workerSnapshot(config.dataDir).lastTask.message, /补齐本机测试工具/);
  assert.equal((await api(owner, '/api/state')).tasks.find(x => x.id === second.id).state, 'queued');
  sendControl(config.dataDir, 'drain'); await running;
});

test('a Windows status-file rename failure cannot abort work and recovers on the next update', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-status-retry-'));
  const control = createWorkerControl(root);
  const rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => { if (to === path.join(root, 'worker-status.json')) throw Object.assign(new Error('fixture sharing violation'), { code: 'EPERM' }); return rename(from, to); };
    assert.doesNotThrow(() => control.update({ phase: 'working' }));
    assert.equal(control.state.phase, 'working');
    assert.equal(fs.readdirSync(root).filter(file => file.endsWith('.tmp')).length, 0);
    fs.renameSync = rename;
    control.update({ phase: 'idle' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'worker-status.json'))).phase, 'idle');
  } finally { fs.renameSync = rename; control.close(); }
});
