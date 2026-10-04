import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkerSession } from '../desktop/worker-session.mjs';

function fixture() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-session-')), 'session.json');
  const manager = { state: { running: false, paired: true, mode: 'stopped' }, starts: 0,
    snapshot() { return { ...this.state }; },
    async start({ paused = false } = {}) { this.starts++; await new Promise(r => setImmediate(r)); this.state = { ...this.state, running: true, mode: paused ? 'paused' : 'running' }; return this.snapshot(); },
    async control(action) { this.state.mode = { pause: 'paused', resume: 'running', drain: 'draining' }[action]; return this.snapshot(); },
    async stop() { if (this.state.running) await this.control('drain'); return this.snapshot(); } };
  return { file, manager, session: new WorkerSession({ file, manager }) };
}
test('reopening attaches an existing Worker and restores a missing process only once', async () => {
  const { file, manager, session } = fixture(); await session.start();
  await new WorkerSession({ file, manager }).restore(); assert.equal(manager.starts, 1);
  manager.state.running = false;
  const next = new WorkerSession({ file, manager }); await Promise.all([next.restore(), next.restore()]);
  assert.equal(manager.starts, 2); assert.equal(manager.state.mode, 'running');
});
test('pause survives process loss but explicit drain survives reopening as stopped', async () => {
  const { file, manager, session } = fixture(); await session.start(); await session.control('pause'); manager.state.running = false;
  const next = new WorkerSession({ file, manager }); await next.restore(); assert.equal(manager.state.mode, 'paused');
  await next.stop(); manager.state.running = false;
  await new WorkerSession({ file, manager }).restore(); assert.equal(manager.starts, 2);
  assert.equal(JSON.parse(fs.readFileSync(file)).mode, 'stopped');
});
test('updater drain preserves paused intent, while an explicit user stop overrides it', async () => {
  const { file, manager, session } = fixture(); await session.start({ paused: true }); await session.drainForUpdate(); session.observe();
  assert.equal(JSON.parse(fs.readFileSync(file)).mode, 'paused'); manager.state.running = false;
  const next = new WorkerSession({ file, manager }); await next.restore(); assert.equal(manager.state.mode, 'paused');
  await next.drainForUpdate(); await next.stop(); manager.state.running = false;
  await new WorkerSession({ file, manager }).restore(); assert.equal(manager.starts, 2);
});
test('missing authorization prevents recovery and a manual successful start clears the error', async () => {
  const { file, manager, session } = fixture(); await session.start(); manager.state.running = false; manager.state.paired = false;
  const next = new WorkerSession({ file, manager }); await next.restore(); assert.equal(manager.starts, 1); assert.match(next.error, /尚未配对/);
  manager.state.paired = true; await next.start(); assert.equal(next.error, null);
});
test('legacy running/paused snapshots migrate without assuming a stopped drain was running', async () => {
  const { file, manager } = fixture(); fs.unlinkSync(file); manager.state.mode = 'paused'; manager.state.running = true;
  const next = new WorkerSession({ file, manager }); assert.equal(next.mode, 'paused'); await next.restore(); assert.equal(manager.starts, 0);
  fs.unlinkSync(file); manager.state.running = false; manager.state.mode = 'draining';
  await new WorkerSession({ file, manager }).restore(); assert.equal(manager.starts, 0);
});
