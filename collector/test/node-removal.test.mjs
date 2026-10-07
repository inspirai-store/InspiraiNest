import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../src/server.mjs';
import { secret } from '../src/common.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';

async function fixture(t, mysql) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'node-removal-'));
  const key = secret(); let at = Date.now();
  const store = mysql ? await mysqlFixture() : undefined;
  const app = createService({ dataDir: root, masterKey: key, clock: () => at, ...(store ? { store } : {}) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const server = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (token, route, body, base = server) => {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, value: await response.json() };
  };
  const pair = async (type = 'worker') => (await request(null, '/api/pair', { key, name: type, clientType: type })).value;
  const owner = await pair('ios');
  const heartbeat = (node, base) => request(node.token, '/api/heartbeat', { capabilities: ['article'], agents: ['codex'],
    skillRuntime: { schemaVersion: 1, mode: 'running', idle: true } }, base);
  const remove = node => request(owner.token, `/api/devices/${node.device.id}/remove-node`, {});
  const replicaStore = new Proxy(app.store, { get(object, key) {
    if (key === 'close') return async () => {};
    const value = Reflect.get(object, key); return typeof value === 'function' ? value.bind(object) : value;
  } });
  const replica = createService({ dataDir: path.join(root, 'replica'), masterKey: key, store: replicaStore, clock: () => at });
  await new Promise(resolve => replica.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await replica.close(); await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { store: app.store, owner, pair, heartbeat, remove, request,
    replica: `http://127.0.0.1:${replica.server.address().port}`, advance: ms => { at += ms; } };
}

for (const mysql of [false, true]) {
  const options = { skip: mysql && !process.env.MYSQL_URL, timeout: 30000 };
  const engine = mysql ? 'MySQL' : 'SQLite';
  test(`${engine}: only offline remote workers can be removed; history and authorization remain correct`, options, async t => {
    const f = await fixture(t, mysql), node = await f.pair('desktop');
    assert.equal((await f.heartbeat(node)).status, 200);
    assert.equal((await f.request(null, `/api/devices/${node.device.id}/remove-node`, {})).status, 401);
    assert.equal((await f.request(node.token, `/api/devices/${node.device.id}/remove-node`, {})).status, 403);
    assert.equal((await f.remove(node)).status, 409);
    assert.equal((await f.remove(f.owner)).status, 409);
    f.advance(44999); assert.equal((await f.remove(node)).status, 409);
    f.advance(2);
    assert.equal((await f.request(node.ownerToken, `/api/devices/${node.device.id}/remove-node`, {})).status, 409);
    const task = { id: crypto.randomUUID(), state: 'completed', deviceId: node.device.id, createdAt: new Date().toISOString(), content: '保留原文', events: [{ state: 'completed', message: '完成' }] };
    const archive = { id: 'a'.repeat(64), entryId: 'articles/history', meta: { title: '历史资料' }, deviceId: node.device.id, createdAt: new Date().toISOString() };
    await f.store.put('task', task); await f.store.put('archive', archive);
    assert.equal((await f.remove(node)).status, 200);
    assert.equal((await f.remove(node)).status, 200, 'same deletion is idempotent');
    const state = (await f.request(f.owner.token, '/api/state')).value;
    assert.equal(state.devices.some(d => d.id === node.device.id), false);
    assert.deepEqual(await f.store.get('task', task.id), task);
    assert.deepEqual(await f.store.get('archive', archive.id), archive);
    assert.ok((await f.store.get('device', node.device.id)).nodeRemovedAt);
    assert.equal((await f.heartbeat(node)).status, 401);
    assert.equal((await f.request(node.ownerToken, '/api/state')).status, 401);
    assert.equal((await f.request(f.owner.token, '/api/devices/missing/remove-node', {})).status, 404);
    const mobile = await f.pair('android'); assert.equal((await f.remove(mobile)).status, 409);
  });
  test(`${engine}: unfinished work and explicitly queued work must be resolved before deletion`, options, async t => {
    const f = await fixture(t, mysql), node = await f.pair();
    for (const state of ['queued', 'assigned', 'running', 'uploading', 'waiting_action', 'failed']) {
      const task = { id: crypto.randomUUID(), state, deviceId: state === 'queued' ? null : node.device.id,
        preferredDeviceId: state === 'queued' ? node.device.id : null, createdAt: new Date().toISOString() };
      await f.store.put('task', task);
      const result = await f.remove(node); assert.equal(result.status, 409); assert.match(result.value.error, /未结束/);
      assert.equal((await f.request(f.owner.token, `/api/tasks/${task.id}/cancel`, {})).status, 200);
    }
    await f.store.put('task', { id: crypto.randomUUID(), state: 'awaiting_review', deviceId: node.device.id, createdAt: new Date().toISOString() });
    assert.equal((await f.remove(node)).status, 200, 'an uploaded review no longer needs the Worker');
  });
  test(`${engine}: reconnecting after the deletion request starts prevents removal`, options, async t => {
    const f = await fixture(t, mysql), node = await f.pair();
    await f.heartbeat(node); f.advance(45001);
    let release, entered; const ready = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const transaction = f.store.transaction.bind(f.store); let armed = true;
    f.store.transaction = async work => { if (armed) { armed = false; entered(); await held; } return transaction(work); };
    const deleting = f.remove(node); await ready;
    try { assert.equal((await f.heartbeat(node, f.replica)).status, 200); } finally { release(); }
    const result = await deleting; assert.equal(result.status, 409); assert.match(result.value.error, /已上线/);
    assert.equal((await f.store.get('device', node.device.id)).revokedAt, null);
  });
  test(`${engine}: an in-flight claim cannot assign work to a removed node`, options, async t => {
    const f = await fixture(t, mysql), node = await f.pair(); await f.heartbeat(node);
    const submitted = await f.request(f.owner.token, '/api/tasks', { content: 'https://example.com/article 原文不变', submissionId: crypto.randomUUID() });
    assert.equal(submitted.status, 201);
    let release, entered; const ready = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const get = f.store.get; let armed = true;
    f.store.get = async function (kind, id) {
      if (armed && kind === 'skill-environment' && id === node.device.id) { armed = false; entered(); await held; }
      return get.call(this, kind, id);
    };
    const claiming = f.request(node.token, '/api/claim', {}, f.replica); await ready; f.advance(45001);
    try { assert.equal((await f.remove(node)).status, 200); } finally { release(); }
    assert.equal((await claiming).status, 401);
    const task = await f.store.get('task', submitted.value.id);
    assert.equal(task.state, 'queued'); assert.equal(task.deviceId, null); assert.equal(task.content, submitted.value.content);
  });
}
