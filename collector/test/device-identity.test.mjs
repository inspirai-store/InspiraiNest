import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/server.mjs';
import { api } from '../src/worker.mjs';
import { hash, secret } from '../src/common.mjs';
import { computerMetadata, identityDigest, validHardwareUUID, probeComputer } from '../src/device-identity.mjs';
import { deviceLabel } from '../src/device-metadata.mjs';

const uuid = '12345678-1234-1234-1234-123456789abc';
async function authorizedFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-auth-'));
  const masterKey = secret();
  const service = createService({ dataDir: root, masterKey });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const server = `http://127.0.0.1:${service.server.address().port}`;
  const owner = { server, ...await api({ server }, '/api/pair', 'POST', { key: masterKey, name: 'Owner', clientType: 'web' }) };
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, server, service, owner };
}

test('hardware UUID validation rejects absent, zero and known OEM placeholders', () => {
  for (const value of [null, '', 'host-name', '00000000-0000-0000-0000-000000000000', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', '03000200-0400-0500-0006-000700080009']) assert.equal(validHardwareUUID(value), false);
  assert.ok(validHardwareUUID(uuid.toUpperCase()));
});

test('computer identities survive restart, metadata changes and a temporary hardware probe failure without leaking raw UUIDs', async t => {
  const { root, server } = await authorizedFixture(t);
  let osVersion = '11', available = true, raw = uuid;
  const probe = async () => { if (!available) throw new Error('probe unavailable'); return { source: 'smbios', value: raw, os: { family: 'Windows', version: osVersion }, model: 'Fixture PC' }; };
  const options = { server, dataDir: root, installationId: randomUUID(), clientType: 'desktop', probe };
  const first = await computerMetadata(options);
  osVersion = '12';
  const second = await computerMetadata({ ...options, installationId: randomUUID() });
  assert.deepEqual(second.identity, first.identity);
  assert.equal(second.deviceInfo.os.version, '12');
  available = false;
  assert.deepEqual((await computerMetadata(options)).identity, first.identity);
  assert.ok(!fs.readFileSync(path.join(root, 'device-identity.json'), 'utf8').includes(uuid));
  available = true; raw = 'abcdef12-1234-1234-1234-123456789abc';
  await assert.rejects(computerMetadata(options), { code: 'IDENTITY_CHANGED' });
  assert.notEqual((await computerMetadata({ ...options, allowChange: true })).identity.digest, first.identity.digest);
});

test('local fallback is persisted and cannot silently become hardware-backed after a transient recovery', async t => {
  const { root, server } = await authorizedFixture(t);
  const options = { server, dataDir: root, installationId: randomUUID(), probe: async () => ({ value: null, os: { family: 'Windows' } }) };
  const first = await computerMetadata(options);
  assert.equal(first.identity.source, 'local');
  const next = await computerMetadata({ ...options, installationId: randomUUID(), probe: async () => ({ value: uuid, source: 'smbios', os: { family: 'Windows', version: '11' } }) });
  assert.deepEqual(next.identity, first.identity);
});

test('OS probes use Windows build information and the macOS product version', async () => {
  const win = await probeComputer('win32', async () => JSON.stringify({ uuid, version: '10.0.22631', build: '22631', productType: 1, model: 'PC' }));
  assert.equal(win.os.version, '11');
  const mac = await probeComputer('darwin', async command => command.endsWith('ioreg') ? `"IOPlatformUUID" = "${uuid}"` : command.endsWith('sw_vers') ? '26.0.1' : 'Mac14,12');
  assert.equal(mac.os.version, '26.0.1'); assert.equal(mac.source, 'ioplatform');
});

test('device policy is persisted independently of deployment, domain or master-key rotation', async t => {
  const { service, server, root } = await authorizedFixture(t);
  const first = await api({ server }, '/api/device-policy');
  assert.deepEqual(await api({ server }, '/api/device-policy'), first);
  assert.equal((await service.store.get('setting', 'device-identity-v2')).namespace, first.namespace);
  const secondService = createService({ dataDir: root, masterKey: secret(), publicUrl: 'https://new-domain.example' });
  await new Promise(resolve => secondService.server.listen(0, '127.0.0.1', resolve));
  try { assert.deepEqual(await api({ server: `http://127.0.0.1:${secondService.server.address().port}` }, '/api/device-policy'), first); }
  finally { await secondService.close(); }
});

test('authenticated migration retains credentials and running-task ownership; identities are not authentication', async t => {
  const { owner, service, server } = await authorizedFixture(t);
  const code = await api(owner, '/api/pairings', 'POST', {});
  const installationId = randomUUID();
  const paired = await api({ server }, '/api/pair', 'POST', { key: code.key, name: '家里台式', clientType: 'desktop', installationId });
  const worker = { server, token: paired.token }, manager = { server, token: paired.ownerToken };
  const policy = await api({ server }, '/api/device-policy');
  const identity = { ...policy, source: 'smbios', digest: identityDigest(policy.namespace, 'smbios', uuid) };
  await service.store.put('task', { id: 'running-fixture', state: 'running', deviceId: paired.device.id });
  const before = await service.store.get('device', paired.device.id);
  const update = { installationId, identity, deviceInfo: { os: { family: 'Windows', version: '11' }, client: { type: 'desktop', version: '1.0' }, model: 'PC' } };
  await api(manager, '/api/devices/me/info', 'POST', update);
  await api(worker, '/api/heartbeat', 'POST', { ...update, capabilities: [], agents: [] });
  const after = await service.store.get('device', before.id);
  assert.equal(after.id, before.id); assert.equal(after.tokenHash, before.tokenHash); assert.equal(after.ownerTokenHash, before.ownerTokenHash);
  assert.equal((await service.store.get('task', 'running-fixture')).deviceId, before.id);
  const state = await api(manager, '/api/state');
  const displayed = state.devices.find(d => d.id === before.id);
  assert.equal(displayed.displayName, 'Windows 11 · 客户端登录'); assert.equal(displayed.name, '家里台式');
  assert.equal(displayed.identity.digest, undefined); assert.equal(displayed.identity.namespace, undefined);
  await assert.rejects(api({ server, token: identity.digest }, '/api/state'), { status: 401 });
  await assert.rejects(api(worker, '/api/state'), { status: 403 });
  await assert.rejects(api(manager, '/api/devices/me/info', 'POST', { ...update, identity: { ...identity, digest: hash('changed') } }), { status: 409 });
  await api(owner, `/api/devices/${before.id}/revoke`, 'POST', {});
  await assert.rejects(api(manager, '/api/state'), { status: 401 }); await assert.rejects(api(worker, '/api/claim', 'POST', {}), { status: 401 });
});

test('duplicate device identities fail visibly without merging or deleting other authorizations', async t => {
  const { owner, server, service } = await authorizedFixture(t);
  const policy = await api({ server }, '/api/device-policy');
  const payload = { identity: { ...policy, source: 'browser-profile', digest: hash('browser-profile') }, deviceInfo: { os: { family: 'Windows' }, client: { type: 'web' } }, clientType: 'web' };
  const firstCode = await api(owner, '/api/pairings', 'POST', {});
  const first = await api({ server }, '/api/pair', 'POST', { ...payload, key: firstCode.key, name: 'First', installationId: randomUUID() });
  const secondCode = await api(owner, '/api/pairings', 'POST', {});
  await assert.rejects(api({ server }, '/api/pair', 'POST', { ...payload, key: secondCode.key, name: 'Duplicate', installationId: randomUUID() }), { status: 409 });
  assert.equal((await service.store.get('pairing', hash(secondCode.key))).usedAt, null);
  assert.ok(await service.store.get('device', first.device.id));
});

test('unknown browser OS versions remain unknown and legacy native labels are normalized', () => {
  assert.equal(deviceLabel({ platform: 'Windows', system: '浏览器', role: 'owner' }), 'Windows · 浏览器登录');
  assert.equal(deviceLabel({ platform: 'win32', system: 'Windows_NT 10.0.22631 · x64', role: 'worker' }), 'Windows 11 · 客户端登录');
  assert.equal(deviceLabel({ platform: 'darwin', system: 'Darwin 25.5.0', role: 'worker' }), 'macOS · 客户端登录');
});

test('website login is available alongside downloads, specialized authorization and client resources', async t => {
  const { server } = await authorizedFixture(t);
  const home = await (await fetch(server)).text();
  assert.match(home, /id="login-form"/); assert.match(home, /\/device-identity.js/);
  for (const route of ['/login', '/login/']) assert.equal(await (await fetch(server + route)).text(), home);
  const download = await (await fetch(server + '/download')).text();
  assert.match(download, /android-download/); assert.match(download, /href="\/login"/);
  assert.match(await (await fetch(server + '/authorize')).text(), /auth-login/);
  assert.equal((await fetch(server + '/device-identity.js')).status, 200);
  assert.equal((await fetch(server + '/library/')).status, 200);
});
