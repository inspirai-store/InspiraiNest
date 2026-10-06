process.env.COLLECTOR_DESKTOP_TEST = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createService } from '../src/server.mjs';
import { secret, atomicJson } from '../src/common.mjs';
import { clientOrigin, loginFailure } from '../src/client-login.mjs';
import { WorkerManager } from '../desktop/manager.mjs';
import { OwnerClient } from '../desktop/owner-client.mjs';
import * as OTPAuth from 'otpauth';
import { mysqlFixture } from './mysql-fixture.mjs';

const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('encrypted:' + value), decryptString: value => value.toString().slice(10) };
async function service(t, password) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-login-'));
  const key = secret(); let at = Date.now();
  const store = process.env.CLIENT_LOGIN_MYSQL_TEST === '1' ? await mysqlFixture() : undefined;
  const app = createService({ dataDir: root, masterKey: key, store, clock: () => at });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const server = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  async function post(route, body, token) {
    const response = await fetch(server + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const owner = (await post('/api/pair', { key, name: 'Fixture owner', clientType: 'android' })).body;
  assert.equal((await post('/api/security/credential', { newKey: password, confirmKey: password }, owner.token)).status, 200);
  return { server, owner, post, app, advance: ms => { at += ms; }, now: () => at };
}

test('native login canonicalizes only root origins and sanitizes errors', () => {
  const mode = process.env.COLLECTOR_DESKTOP_TEST; delete process.env.COLLECTOR_DESKTOP_TEST;
  assert.throws(() => clientOrigin('http://127.0.0.1:1234'));
  process.env.COLLECTOR_DESKTOP_TEST = mode;
  assert.equal(clientOrigin(' HTTPS://LIBRARY.EXAMPLE:443/ '), 'https://library.example');
  assert.equal(clientOrigin('https://library.example:8443/'), 'https://library.example:8443');
  for (const value of ['http://library.example', 'https://u:p@library.example', 'https://library.example/login', 'https://library.example?secret=1', 'https://library.example/#code', 'https://library.example\\other']) assert.throws(() => clientOrigin(value));
  assert.equal(loginFailure(401, { code: 'mfa_required', error: 'secret body' }).code, 'mfa_required');
  assert.ok(!loginFailure(401, { error: 'secret body' }).message.includes('secret body'));
});

test('two deployments preserve raw passwords, permissions, old connection on failed switch, and origin-scoped data', async t => {
  const a = await service(t, '  owner A password  '), b = await service(t, 'owner B password');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'native-client-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const manager = new WorkerManager(path.join(folder, 'worker.json'));
  atomicJson(manager.file, { dataDir: path.join(folder, 'data') });
  const owner = new OwnerClient({ file: path.join(folder, 'owner.json'), workerServer: () => manager.snapshot().paired ? manager.snapshot().server : '', encryption });
  const pair = (server, key, options = {}) => manager.pair({ server, key }, { clientType: 'desktop', onPaired: ({ server, installationId, result }) => owner.saveCredential({ server, installationId, deviceId: result.device.id, token: result.ownerToken }, { allowServerChange: true }), ...options });
  await pair(a.server, '  owner A password  ');
  const old = manager.configuration(), original = owner.status();
  await assert.rejects(pair(b.server, '  owner A password  '), { code: 'credential_invalid' });
  assert.deepEqual(manager.configuration(), old); assert.deepEqual(owner.status(), original);
  await assert.rejects(pair(b.server, 'owner B password', { current: () => false }), /取消/);
  assert.deepEqual(manager.configuration(), old);
  const previousFile = owner.file; owner.file = folder;
  await assert.rejects(pair(b.server, 'owner B password'));
  owner.file = previousFile;
  assert.deepEqual(manager.configuration(), old); assert.deepEqual(owner.status(), original);
  assert.equal((await owner.state()).me.id, original.deviceId);
  await pair(b.server, 'owner B password');
  assert.equal(owner.status().server, b.server); assert.equal(manager.configuration().server, b.server);
  assert.notEqual(manager.dataDir, old.dataDir);
  assert.equal((await owner.state()).me.role, 'owner');
  const response = await fetch(b.server + '/api/state', { headers: { Authorization: 'Bearer ' + manager.configuration().token } }); assert.equal(response.status, 403);
  assert.ok(!fs.readFileSync(manager.file, 'utf8').includes('password'));
  owner.logout(); assert.equal(owner.status().server, b.server);
});

test('all GUI client types require MFA and reject replay without weakening delegated pairing', async t => {
  const f = await service(t, 'fixture password');
  const setup = await f.post('/api/security/totp/setup', {}, f.owner.token);
  const otp = new OTPAuth.TOTP({ secret: setup.body.secret }).generate();
  const confirmed = await f.post('/api/security/totp/confirm', { otp }, f.owner.token);
  assert.equal(confirmed.status, 200);
  for (const clientType of ['desktop', 'ios', 'android']) {
    const input = { key: 'fixture password', name: clientType, clientType };
    assert.equal((await f.post('/api/pair', input)).body.code, 'mfa_required');
    assert.equal((await f.post('/api/pair', { ...input, otp: 'bad' })).body.code, 'mfa_invalid');
  }
  const recoveryCode = confirmed.body.recoveryCodes[0];
  assert.equal((await f.post('/api/pair', { key: 'fixture password', name: 'Phone', clientType: 'ios', recoveryCode })).status, 201);
  assert.equal((await f.post('/api/pair', { key: 'fixture password', name: 'Other', clientType: 'android', recoveryCode })).body.code, 'mfa_invalid');
  const code = (await f.post('/api/pairings', {}, f.owner.token)).body.key;
  assert.equal((await f.post('/api/pair', { key: code, name: 'QR', clientType: 'android' })).status, 201);
  f.advance(61000);
  const nextOTP = new OTPAuth.TOTP({ secret: setup.body.secret }).generate({ timestamp: f.now() });
  assert.equal((await f.post('/api/pair', { key: 'fixture password', name: 'OTP desktop', clientType: 'desktop', otp: nextOTP })).status, 201);
  assert.equal((await f.post('/api/pair', { key: 'fixture password', name: 'OTP replay', clientType: 'ios', otp: nextOTP })).body.code, 'mfa_invalid');
});


test('native login keeps verification throttling and resumes after the window', async t => {
  const f = await service(t, 'fixture password');
  for (let n = 0; n < 9; n++) assert.equal((await f.post('/api/pair', { key: 'wrong', name: 'Phone', clientType: 'ios' })).body.code, 'credential_invalid');
  assert.equal((await f.post('/api/pair', { key: 'fixture password', name: 'Phone', clientType: 'ios' })).status, 429);
  f.advance(61000);
  assert.equal((await f.post('/api/pair', { key: 'fixture password', name: 'Phone', clientType: 'ios' })).status, 201);
});
