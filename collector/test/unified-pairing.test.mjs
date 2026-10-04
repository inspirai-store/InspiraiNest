import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../src/server.mjs';
import { api } from '../src/worker.mjs';
import { secret, hash, atomicJson } from '../src/common.mjs';
import { WorkerManager } from '../desktop/manager.mjs';
import { OwnerClient } from '../desktop/owner-client.mjs';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-pairing-'));
  const masterKey = secret();
  const service = createService({ dataDir: root, masterKey, publicUrl: 'https://library.example' });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const server = `http://127.0.0.1:${service.server.address().port}`;
  const owner = { server, ...await api({ server }, '/api/pair', 'POST', { key: masterKey, name: 'Fixture browser', clientType: 'web' }) };
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, server, service, owner };
}

test('universal codes select the client at redemption and remain one-use and expiring', async t => {
  const { owner, service, server } = await fixture(t);
  for (const [clientType, role] of [['web', 'owner'], ['android', 'owner'], ['ios', 'owner'], ['worker', 'worker']]) {
    const code = await api(owner, '/api/pairings', 'POST', {});
    assert.match(code.qrDataUrl, /^data:image\/png;base64,/);
    assert.equal((await service.store.get('pairing', hash(code.key))).role, null);
    const device = await api({ server }, '/api/pair', 'POST', { key: code.key, name: clientType, clientType });
    assert.equal(device.device.role, role);
    assert.equal(device.device.clientType, clientType);
    assert.equal(device.ownerToken, undefined);
    if (clientType === 'web') await assert.rejects(api({ server }, '/api/pair', 'POST', { key: code.key, name: 'Again', clientType }), { status: 401 });
  }
  const expired = await api(owner, '/api/pairings', 'POST', {});
  const record = await service.store.get('pairing', hash(expired.key));
  await service.store.put('pairing', { ...record, expiresAt: '2000-01-01T00:00:00Z' });
  await assert.rejects(api({ server }, '/api/pair', 'POST', { key: expired.key, name: 'Expired', clientType: 'desktop' }), { status: 401 });
  const invalid = await api(owner, '/api/pairings', 'POST', {});
  await assert.rejects(api({ server }, '/api/pair', 'POST', { key: invalid.key, name: 'Invalid', clientType: 'administrator' }), { status: 400 });
  assert.equal((await service.store.get('pairing', hash(invalid.key))).usedAt, null);
});

test('installed clients can redeem universal codes without specifying a client type', async t => {
  const { owner, server } = await fixture(t);
  for (const [platform, role] of [['win32', 'worker'], ['darwin', 'worker'], ['android', 'owner'], ['ios', 'owner'], ['Win32', 'owner']]) {
    const code = await api(owner, '/api/pairings', 'POST', {});
    const paired = await api({ server }, '/api/pair', 'POST', { key: code.key, name: 'Legacy ' + platform, platform });
    assert.equal(paired.device.role, role);
  }
});

test('desktop pairing stores one device and separates encrypted management from Worker credentials', async t => {
  const { owner, server, root } = await fixture(t);
  const file = path.join(root, 'worker.json');
  atomicJson(file, { dataDir: path.join(root, 'worker-data') });
  const manager = new WorkerManager(file);
  const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('encrypted:' + value), decryptString: value => value.toString().slice(10) };
  const client = new OwnerClient({ file: path.join(root, 'owner.json'), workerServer: () => manager.snapshot().paired ? server : '', encryption });
  const code = await api(owner, '/api/pairings', 'POST', {});
  let managementToken;
  const snapshot = await manager.pair({ server, key: code.key, name: 'Desktop' }, { clientType: 'desktop', onPaired: ({ server, installationId, result }) => {
    managementToken = result.ownerToken;
    return client.saveCredential({ server, installationId, deviceId: result.device.id, token: result.ownerToken });
  } });
  const config = manager.configuration();
  assert.ok(snapshot.paired && client.status().paired);
  assert.equal(client.status().deviceId, config.deviceId);
  assert.notEqual(config.token, managementToken);
  assert.ok(!JSON.stringify(snapshot).includes(managementToken));
  assert.ok(!fs.readFileSync(file, 'utf8').includes(managementToken));
  assert.ok(!fs.readFileSync(client.file, 'utf8').includes(managementToken));
  const state = await client.state();
  const computer = state.devices.find(d => d.id === config.deviceId);
  assert.equal(computer.clientType, 'desktop');
  assert.equal(state.devices.length, 2);
  assert.equal(computer.ownerTokenHash, undefined);
  assert.equal(computer.tokenHash, undefined);
  assert.equal((await client.entries()).items.length, 0);
  await client.pairing();
  const worker = { server, token: config.token };
  await api(worker, '/api/heartbeat', 'POST', { capabilities: [], agents: [] });
  await assert.rejects(api(worker, '/api/state'), { status: 403 });
  await assert.rejects(api(worker, '/api/pairings', 'POST', {}), { status: 403 });
  await assert.rejects(api({ server, token: managementToken }, '/api/heartbeat', 'POST', { capabilities: [], agents: [] }), { status: 403 });
  await api(owner, `/api/devices/${config.deviceId}/revoke`, 'POST', {});
  await assert.rejects(client.state(), /授权已失效/);
  await assert.rejects(api(worker, '/api/claim', 'POST', {}), { status: 401 });
});

test('legacy restricted codes cannot upgrade a desktop or consume on a mismatched client', async t => {
  const { owner, server, service } = await fixture(t);
  const code = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
  for (const clientType of ['desktop', 'android']) {
    await assert.rejects(api({ server }, '/api/pair', 'POST', { key: code.key, name: clientType, clientType }), { status: 400 });
    assert.equal((await service.store.get('pairing', hash(code.key))).usedAt, null);
  }
});

test('desktop management can approve read-only grants with the shared device identity', async t => {
  const { owner, server, service } = await fixture(t);
  const code = await api(owner, '/api/pairings', 'POST', {});
  const desktop = await api({ server }, '/api/pair', 'POST', { key: code.key, name: 'Desktop', clientType: 'desktop' });
  const request = async (route, body, token) => {
    const response = await fetch(server + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const grant = await request('/oauth/device_authorization', { client_id: 'lingnest-cli', scope: 'library:read' });
  await request('/api/reader-authorizations/decision', { code: grant.user_code, decision: 'allow' }, desktop.ownerToken);
  const reader = await request('/oauth/token', { client_id: 'lingnest-cli', grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: grant.device_code });
  assert.equal(reader.scope, 'library:read');
  assert.equal((await service.store.list('device')).filter(d => d.role === 'reader').length, 1);
});
