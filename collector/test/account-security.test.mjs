import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import { Store } from '../src/store.mjs';
import { accountSecurity } from '../src/account-security.mjs';
import { createService } from '../src/server.mjs';
import { secret, hash } from '../src/common.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'account-security-'));
  const store = process.env.ACCOUNT_SECURITY_MYSQL_TEST === '1' ? await mysqlFixture() : new Store(path.join(root, 'state.sqlite'));
  const masterKey = secret(); let timestamp = Date.UTC(2026, 9, 3);
  const device = { id: 'owner', role: 'owner', tokenHash: hash('owner-token'), revokedAt: null };
  await store.put('device', device);
  const options = { store, masterKey, serialized: (_key, work) => work(), clock: () => timestamp };
  const security = accountSecurity(options);
  t.after(async () => { await store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const otp = secret => new OTPAuth.TOTP({ secret }).generate({ timestamp });
  async function enable() {
    const setup = await security.operation('totp/setup', {}, device);
    const state = await security.operation('totp/confirm', { otp: otp(setup.secret) }, device);
    return { ...setup, ...state };
  }
  return { store, security, masterKey, device, options, otp, enable, tick: (ms = 30000) => timestamp += ms };
}

test('credential rotation is persisted; bootstrap key never bypasses it; tokens/tasks remain unchanged', async t => {
  const f = await fixture(t); const next = 'nextpass';
  const task = { id: 'unfinished', deviceId: f.device.id, state: 'running' }; await f.store.put('task', task);
  await assert.rejects(f.security.operation('credential', { newKey: next, confirmKey: next }, { ...f.device, role: 'worker' }), { status: 403 });
  await assert.rejects(f.security.operation('credential', { newKey: '1234567', confirmKey: '1234567' }, f.device), { status: 400 });
  await assert.rejects(f.security.operation('credential', { newKey: next, confirmKey: 'different' }, f.device), { status: 400 });
  await f.security.operation('credential', { newKey: next, confirmKey: next }, f.device);
  const restarted = accountSecurity(f.options);
  assert.equal(await restarted.login({ key: f.masterKey }), false);
  assert.equal(await restarted.login({ key: next }), true);
  assert.deepEqual(await f.store.get('device', f.device.id), f.device);
  assert.deepEqual(await f.store.get('task', task.id), task);
  const raw = JSON.stringify(await f.store.get('setting', 'account-security-v1'));
  assert.ok(!raw.includes(next) && !raw.includes(f.masterKey)); assert.match(raw, /scrypt-v1/);
});

test('independent handlers can initialize the shared security row concurrently', async t => {
  const f = await fixture(t); const other = accountSecurity(f.options);
  const states = await Promise.all([f.security.status(), other.status()]);
  assert.deepEqual(states[0], states[1]);
  assert.equal(await other.login({ key: f.masterKey }), true);
});

test('binding is pending until confirmed; TOTP is encrypted and replay protected across instances', async t => {
  const f = await fixture(t);
  const setup = await f.security.operation('totp/setup', {}, f.device);
  assert.equal((await f.security.status()).totpEnabled, false);
  assert.equal(await f.security.login({ key: f.masterKey }), true);
  assert.ok(!JSON.stringify(await f.store.get('setting', 'account-security-v1')).includes(setup.secret));
  const token = f.otp(setup.secret);
  const enabled = await f.security.operation('totp/confirm', { otp: token }, f.device);
  assert.equal(enabled.totpEnabled, true); assert.equal(enabled.recoveryCodesRemaining, 10); assert.equal(enabled.recoveryCodes.length, 10);
  await assert.rejects(f.security.login({ key: f.masterKey }), { status: 401, code: 'mfa_required' });
  await assert.rejects(f.security.login({ key: f.masterKey, otp: token }), { code: 'mfa_invalid' });
  f.tick();
  const other = accountSecurity(f.options);
  const results = await Promise.allSettled([f.security.login({ key: f.masterKey, otp: f.otp(setup.secret) }), other.login({ key: f.masterKey, otp: f.otp(setup.secret) })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'mfa_invalid').length, 1);
  assert.ok(!JSON.stringify(await f.security.status()).includes(setup.secret));
});

test('recovery codes are single-use, hashed and rotation invalidates all old codes', async t => {
  const f = await fixture(t); const enabled = await f.enable(); const other = accountSecurity(f.options);
  const results = await Promise.allSettled([f.security.login({ key: f.masterKey, recoveryCode: enabled.recoveryCodes[0] }), other.login({ key: f.masterKey, recoveryCode: enabled.recoveryCodes[0] })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await f.security.status()).recoveryCodesRemaining, 9);
  assert.ok(!JSON.stringify(await f.store.get('setting', 'account-security-v1')).includes(enabled.recoveryCodes[1]));
  const rotated = await f.security.operation('recovery-codes', { recoveryCode: enabled.recoveryCodes[1] }, f.device);
  assert.equal(rotated.recoveryCodesRemaining, 10);
  await assert.rejects(f.security.login({ key: f.masterKey, recoveryCode: enabled.recoveryCodes[2] }), { code: 'mfa_invalid' });
  await f.security.operation('totp/disable', { recoveryCode: rotated.recoveryCodes[0] }, f.device);
  assert.equal(await f.security.login({ key: f.masterKey }), true);
});

test('pending confirmation failures are throttled for authorized sessions; expired/cancelled requests cannot enable MFA', async t => {
  const f = await fixture(t); await f.security.operation('totp/setup', {}, f.device);
  for (let i = 0; i < 10; i++) await assert.rejects(f.security.operation('totp/confirm', { otp: 'bad' }, f.device), { code: 'mfa_invalid' });
  await assert.rejects(f.security.operation('totp/confirm', { otp: 'bad' }, f.device), { status: 429 });
  f.tick(60000);
  await f.security.operation('totp/cancel', {}, f.device);
  await assert.rejects(f.security.operation('totp/confirm', { otp: '123456' }, f.device), { status: 409 });
  await f.security.operation('totp/setup', {}, f.device); f.tick(10 * 60000);
  await assert.rejects(f.security.operation('totp/confirm', { otp: '123456' }, f.device), { status: 409 });
});

test('credential rotation requires MFA, invalidates pending setup; revoked devices cannot change security', async t => {
  const f = await fixture(t); const enabled = await f.enable(); const next = secret();
  await assert.rejects(f.security.operation('credential', { newKey: next, confirmKey: next }, f.device), { code: 'mfa_required' });
  await f.security.operation('credential', { recoveryCode: enabled.recoveryCodes[0], newKey: next, confirmKey: next }, f.device);
  await assert.rejects(f.security.login({ key: next }), { code: 'mfa_required' });
  assert.equal(await f.security.login({ key: next, recoveryCode: enabled.recoveryCodes[1] }), true);
  await f.store.delete('device', f.device.id);
  await assert.rejects(f.security.operation('totp/disable', { recoveryCode: enabled.recoveryCodes[2] }, f.device), { status: 401 });
});

test('HTTP boundary protects owner settings and allows approved pairing codes without bypassing MFA', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'account-http-')); const masterKey = secret();
  const service = createService({ dataDir: root, masterKey });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${service.server.address().port}`;
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  async function request(route, input, token) {
    const r = await fetch(base + route, { method: input ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: input ? JSON.stringify(input) : undefined });
    return { status: r.status, body: await r.json() };
  }
  const owner = (await request('/api/pair', { key: masterKey, name: 'Owner', clientType: 'web' })).body;
  assert.equal((await request('/api/security')).status, 401);
  assert.equal((await request('/api/security/credential', { newKey: '12345678', confirmKey: '12345678' })).status, 401);
  const setup = (await request('/api/security/totp/setup', {}, owner.token)).body;
  const enabled = await request('/api/security/totp/confirm', { otp: new OTPAuth.TOTP({ secret: setup.secret }).generate() }, owner.token);
  assert.equal(enabled.status, 200);
  for (const clientType of ['web', 'android', 'ios', 'desktop', 'worker']) {
    const login = await request('/api/pair', { key: masterKey, name: clientType, clientType }); assert.equal(login.status, 401); assert.equal(login.body.code, 'mfa_required');
  }
  const pairing = (await request('/api/pairings', {}, owner.token)).body;
  const worker = (await request('/api/pair', { key: pairing.key, name: 'Worker', clientType: 'worker' })).body;
  assert.ok(worker.token);
  assert.equal((await request('/api/security', undefined, worker.token)).status, 403);
  assert.equal((await request('/api/security/credential', { newKey: '12345678', confirmKey: '12345678' }, worker.token)).status, 403);
  const grant = (await request('/oauth/device_authorization', { client_id: 'lingnest-cli', scope: 'library:read' })).body;
  await request('/api/reader-authorizations/decision', { code: grant.user_code, decision: 'allow' }, owner.token);
  const reader = (await request('/oauth/token', { client_id: 'lingnest-cli', grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: grant.device_code })).body;
  assert.equal((await request('/api/security', undefined, reader.access_token)).status, 403);
  assert.equal((await request('/api/security/credential', { newKey: '12345678', confirmKey: '12345678' }, reader.access_token)).status, 403);
  assert.equal((await request('/api/security/totp/disable', {}, owner.token)).status, 401);
  const state = (await request('/api/state', undefined, owner.token)).body; assert.ok(!JSON.stringify(state).includes(setup.secret));
  const page = await fetch(base + '/security'); assert.equal(page.status, 200); assert.match(await page.text(), /账户安全/);
});
