import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/server.mjs';
import { hash, secret, atomicJson } from '../src/common.mjs';
import { api } from '../src/worker.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';
import { OwnerClient } from '../desktop/owner-client.mjs';

process.env.COLLECTOR_DESKTOP_TEST = '1';
const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('encrypted:' + value), decryptString: value => value.toString().slice(10) };

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-identity-')), masterKey = secret();
  const releaseDir = path.join(root, 'releases'), filename = 'InspiraiNest-v0.2.0-Windows-x64.exe', bytes = Buffer.from('test installer, not executed');
  fs.mkdirSync(releaseDir); fs.writeFileSync(path.join(releaseDir, filename), bytes);
  atomicJson(path.join(releaseDir, 'worker-release.json'), { windows_x64: { version: '0.2.0', filename, size: bytes.length, sha256: hash(bytes) } });
  const app = createService({ dataDir: root, masterKey, releaseDir, ...(process.env.LINGNEST_TEST_MYSQL === '1' ? { store: await mysqlFixture() } : {}) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const server = `http://127.0.0.1:${app.server.address().port}`;
  const cleanup = [];
  t.after(async () => { for (const close of cleanup) await close(); await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const admin = { server, ...await api({ server }, '/api/pair', 'POST', { key: masterKey, name: 'Phone', clientType: 'android' }) };
  const policy = await api({ server }, '/api/device-policy');
  const identity = { ...policy, source: 'smbios', digest: hash('full-scoped-hardware-identity') };
  const workerInstallation = randomUUID(), ownerInstallation = randomUUID(), workerToken = secret(), ownerToken = secret();
  const info = type => ({ os: { family: 'Windows', version: '11' }, model: 'Test PC', client: { type, version: '0.1.24' } });
  const workerRecord = { id: randomUUID(), name: 'Home', role: 'worker', clientType: 'worker', category: 'desktop',
    installationKey: hash('worker:' + workerInstallation), tokenHash: hash(workerToken), identity, deviceInfo: info('worker'),
    capabilities: ['article'], agents: ['codex'], createdAt: '2026-09-01T00:00:00Z', lastSeen: new Date().toISOString(), lastHeartbeatAt: new Date().toISOString(),
    workerRuntime: { schemaVersion: 1, version: '0.1.24', platform: 'win32', arch: 'x64', remoteUpdate: true },
    clientRuntime: { schemaVersion: 1, version: '0.1.24', platform: 'win32', arch: 'x64', remoteUpdate: true } };
  const ownerRecord = { id: randomUUID(), name: '桌面工作台', role: 'owner', clientType: 'web', category: 'desktop',
    installationKey: hash('owner:' + ownerInstallation), tokenHash: hash(ownerToken), identity, deviceInfo: info('desktop') };
  await app.store.put('device', workerRecord); await app.store.put('device', ownerRecord);
  await app.store.put('task', { id: 'preserved-task', state: 'running', deviceId: workerRecord.id, submissionId: randomUUID(), events: [] });
  const worker = { server, token: workerToken }, owner = { server, token: ownerToken };
  const input = { workerDeviceId: workerRecord.id, workerToken, installationId: workerInstallation, identity, deviceInfo: info('desktop') };
  const unify = (value = input, actor = owner) => api(actor, '/api/devices/me/unify-client', 'POST', value);
  return { root, masterKey, app, server, admin, worker, owner, workerRecord, ownerRecord, workerInstallation, ownerInstallation, identity, info, input, unify, cleanup };
}

test('legacy native credentials become one client, retaining the node, running tasks and credential scopes', async t => {
  const f = await fixture(t), task = await f.app.store.get('task', 'preserved-task');
  const migrated = await f.unify();
  assert.equal(migrated.device.id, f.workerRecord.id);
  const record = await f.app.store.get('device', f.workerRecord.id);
  assert.deepEqual(record, { ...f.workerRecord, clientType: 'desktop', clientIdentityVersion: 1 });
  assert.deepEqual(await f.app.store.get('task', task.id), task);
  const state = await api(f.owner, '/api/state');
  assert.equal(state.me.id, f.workerRecord.id);
  assert.deepEqual(state.devices.filter(d => d.category === 'desktop').map(d => d.id), [f.workerRecord.id]);
  assert.equal(state.devices.find(d => d.id === record.id).managementAuthorized, true);
  for (const field of ['tokenHash', 'ownerTokenHash', 'installationKey', 'credentialId', 'credentialTokenHash', 'canonicalDeviceId']) {
    assert.ok(state.devices.every(d => !(field in d))); assert.ok(!(field in state.me));
  }
  await api(f.owner, '/api/devices/me/info', 'POST', { installationId: f.ownerInstallation, identity: f.identity, deviceInfo: f.info('desktop') });
  assert.equal((await f.app.store.get('device', record.id)).installationKey, f.workerRecord.installationKey);
  await api(f.worker, '/api/heartbeat', 'POST', { installationId: f.workerInstallation, identity: f.identity, deviceInfo: f.info('worker'), capabilities: ['article'], agents: ['codex'] });
  await assert.rejects(api(f.worker, '/api/state'), { status: 403 });
  await assert.rejects(api(f.owner, '/api/heartbeat', 'POST', { capabilities: [], agents: [] }), { status: 403 });
  await assert.rejects(api(f.owner, '/api/devices/me/info', 'POST', { installationId: randomUUID() }), { status: 409 });
  // Old bookmarks also revoke the complete client, never only one capability.
  await api(f.admin, `/api/devices/${f.ownerRecord.id}/revoke`, 'POST', {});
  await assert.rejects(api(f.owner, '/api/state'), { status: 401 });
  await assert.rejects(api(f.worker, '/api/claim', 'POST', {}), { status: 401 });
  assert.equal(await f.app.store.get('device', f.ownerRecord.id), null);
  assert.equal((await f.app.store.get('task', task.id)).deviceId, record.id);
});

test('legacy heartbeats remain compatible before migration and timed-out update retries keep the same operation', async t => {
  const f = await fixture(t);
  await api(f.worker, '/api/heartbeat', 'POST', { installationId: f.workerInstallation, identity: f.identity, deviceInfo: f.info('worker'), capabilities: ['article'], agents: ['codex'] });
  await api(f.owner, '/api/devices/me/info', 'POST', { installationId: f.ownerInstallation, identity: f.identity, deviceInfo: f.info('desktop') });
  const input = { deviceId: f.workerRecord.id, requestId: randomUUID(), targetVersion: '0.2.0' };
  const before = await api(f.owner, '/api/client-updates/operations', 'POST', input);
  await f.unify();
  const after = await api(f.owner, '/api/client-updates/operations', 'POST', input);
  assert.equal(after.id, before.id); assert.equal((await f.app.store.list('client-update')).length, 1);
});

test('migration requires both native credentials, the installation binding and full scoped hardware identity', async t => {
  const f = await fixture(t);
  await assert.rejects(f.unify(f.input, f.worker), { status: 403 });
  await assert.rejects(f.unify(f.input, f.admin), { status: 403 });
  await assert.rejects(f.unify({ ...f.input, workerToken: secret() }), { status: 401 });
  await assert.rejects(f.unify({ ...f.input, installationId: randomUUID() }), { status: 409 });
  await assert.rejects(f.unify({ ...f.input, identity: { ...f.identity, digest: f.identity.digest.slice(0, 12) + 'b'.repeat(52) } }), { status: 409 });
  await assert.rejects(f.unify({ ...f.input, identity: { ...f.identity, namespace: randomUUID() } }), { status: 400 });
  await assert.rejects(f.unify({ ...f.input, identity: { ...f.identity, source: 'local' } }), { status: 409 });
  await assert.rejects(f.unify({ ...f.input, url: 'https://other.invalid' }), { status: 400 });
  assert.deepEqual(await f.app.store.get('device', f.workerRecord.id), f.workerRecord);
  assert.deepEqual(await f.app.store.get('device', f.ownerRecord.id), f.ownerRecord);
});

test('legacy configurations without an installation ID migrate without altering either existing binding', async t => {
  const f = await fixture(t), input = { ...f.input }; delete input.installationId;
  const before = await f.app.store.get('device', f.workerRecord.id);
  await assert.rejects(f.unify({ ...input, workerToken: secret() }), { status: 401 });
  await assert.rejects(f.unify({ ...input, identity: { ...f.identity, digest: hash('another-computer') } }), { status: 409 });
  assert.equal((await f.unify(input)).device.id, f.workerRecord.id);
  assert.equal((await f.app.store.get('device', before.id)).installationKey, before.installationKey);
  assert.equal((await f.app.store.get('device', f.ownerRecord.id)).installationKey, f.ownerRecord.installationKey);
  assert.equal((await api(f.owner, '/api/state')).me.id, before.id);
});

test('migration is idempotent across simultaneous servers and rejects aliases of another client', async t => {
  const f = await fixture(t), sharedStore = new Proxy(f.app.store, { get(object, key) {
    if (key === 'close') return () => {};
    const value = object[key]; return typeof value === 'function' ? value.bind(object) : value;
  } }), second = createService({ dataDir: f.root, masterKey: f.masterKey, store: sharedStore });
  await new Promise(resolve => second.server.listen(0, '127.0.0.1', resolve));
  f.cleanup.push(() => second.close());
  const other = { server: `http://127.0.0.1:${second.server.address().port}`, token: f.owner.token };
  const results = await Promise.all([f.unify(), f.unify(f.input, other), f.unify()]);
  assert.ok(results.every(r => r.device.id === f.workerRecord.id));
  assert.equal((await api(other, '/api/state')).me.id, f.workerRecord.id);
  const different = { ...f.workerRecord, id: randomUUID(), tokenHash: hash('other-worker'), installationKey: hash('worker:' + f.workerInstallation) };
  await f.app.store.put('device', different);
  await assert.rejects(f.unify({ ...f.input, workerDeviceId: different.id, workerToken: 'other-worker' }), { status: 409 });
  await f.app.store.put('device', { ...await f.app.store.get('device', f.workerRecord.id), revokedAt: new Date().toISOString() });
  await assert.rejects(api(f.owner, '/api/state'), { status: 401 });
});

test('native client variants cannot create another node; re-login keeps the original name and node ID', async t => {
  const f = await fixture(t); await f.unify();
  const pair = () => api(f.admin, '/api/pairings', 'POST', {});
  const code = await pair();
  const request = { key: code.key, name: 'Changed login name', clientType: 'desktop', installationId: f.workerInstallation, identity: f.identity, deviceInfo: f.info('desktop') };
  await assert.rejects(api({ server: f.server }, '/api/pair', 'POST', request), { status: 409 });
  await f.app.store.put('task', { ...await f.app.store.get('task', 'preserved-task'), state: 'completed' });
  const result = await api({ server: f.server }, '/api/pair', 'POST', request);
  assert.equal(result.device.id, f.workerRecord.id); assert.equal(result.device.name, 'Home');
  assert.equal((await api({ server: f.server, token: result.ownerToken }, '/api/state')).me.id, f.workerRecord.id);
  await assert.rejects(api(f.worker, '/api/claim', 'POST', {}), { status: 401 });
  const duplicate = await pair();
  await assert.rejects(api({ server: f.server }, '/api/pair', 'POST', { ...request, key: duplicate.key, clientType: 'worker', deviceInfo: f.info('worker'), installationId: randomUUID() }), { status: 409 });
  assert.equal((await f.app.store.get('pairing', hash(duplicate.key))).usedAt, null);
});

test('the desktop migrates encrypted credentials before concurrent reads, without changing Worker configuration', async t => {
  const f = await fixture(t), file = path.join(f.root, 'owner.json');
  const config = { server: f.server, deviceId: f.workerRecord.id, token: f.worker.token, installationId: f.workerInstallation }, before = JSON.stringify(config);
  const client = new OwnerClient({ file, encryption, workerServer: () => f.server, workerConfiguration: () => config,
    metadataProvider: async () => ({ identity: f.identity, installationId: f.ownerInstallation, deviceInfo: f.info('desktop') }) });
  client.saveCredential({ server: f.server, deviceId: f.ownerRecord.id, installationId: f.ownerInstallation, token: f.owner.token });
  const states = await Promise.all([client.state(), client.state()]);
  assert.ok(states.every(state => state.me.id === config.deviceId && !state.identityWarning));
  assert.equal(client.status().deviceId, config.deviceId); assert.equal(JSON.stringify(config), before);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(f.worker.token)); assert.ok(!fs.readFileSync(file, 'utf8').includes(f.owner.token));
  const reopened = new OwnerClient({ file, encryption, workerServer: () => f.server, workerConfiguration: () => config,
    metadataProvider: async () => ({ identity: f.identity, installationId: f.ownerInstallation, deviceInfo: f.info('desktop') }) });
  assert.equal((await reopened.state()).me.id, config.deviceId);
});

test('a cancelled desktop session cannot be restored by a delayed migration response', async t => {
  const f = await fixture(t); let release, ready;
  const started = new Promise(resolve => { ready = resolve; });
  const client = new OwnerClient({ file: path.join(f.root, 'owner.json'), encryption, workerServer: () => f.server,
    workerConfiguration: () => ({ ...f.input, deviceId: f.workerRecord.id, token: f.worker.token, server: f.server }),
    metadataProvider: async () => { ready(); await new Promise(resolve => { release = resolve; }); return { identity: f.identity, deviceInfo: f.info('desktop') }; } });
  client.saveCredential({ server: f.server, deviceId: f.ownerRecord.id, installationId: f.ownerInstallation, token: f.owner.token });
  const reading = client.state(); await started; client.logout(); release();
  await assert.rejects(reading, /请先登录客户端/); assert.equal(client.status().paired, false);
  assert.equal(fs.existsSync(client.file), false); assert.equal((await f.app.store.get('device', f.ownerRecord.id)).canonicalDeviceId, undefined);
});
