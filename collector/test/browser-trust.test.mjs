import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import { createService } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { secret, hash } from '../src/common.mjs';
import { browserCookie, browserLifetime } from '../src/browser-session.mjs';
import { trustCookie, trustLifetime } from '../src/browser-trust.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';

const profile = { installationId: '9be8f91e-f5bd-4a46-829e-4761ca9934df', clientType: 'web',
  deviceInfo: { os: { family: 'Windows', version: '11' }, client: { type: 'web', name: 'Chrome' } } };
const pairCookie = value => `${browserCookie}=${value.token}`;
function remembered(response) {
  return response.headers.getSetCookie().find(value => value.startsWith(trustCookie + '='))?.split(';')[0];
}
async function fixture(t, { totp = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-trust-'));
  const store = process.env.BROWSER_TRUST_MYSQL_TEST === '1' ? await mysqlFixture() : new Store(path.join(root, 'state.sqlite'));
  const key = secret(); let at = Date.now();
  const app = createService({ dataDir: root, masterKey: key, store, clock: () => at });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  async function request(route, { method = 'GET', cookie, token, origin = base, body } = {}) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, value: await response.json() };
  }
  const login = (input = {}, options = {}) => request('/api/pair', { method: 'POST', body: { key, name: 'Preserved note', ...profile, ...input }, ...options });
  const admin = (await login({ clientType: 'android', installationId: undefined, deviceInfo: undefined })).value;
  const browser = (await login()).value;
  let authenticator, codes;
  if (totp) {
    const setup = await request('/api/security/totp/setup', { method: 'POST', token: admin.token, body: {} });
    authenticator = new OTPAuth.TOTP({ secret: setup.value.secret });
    const confirmed = await request('/api/security/totp/confirm', { method: 'POST', token: admin.token, body: { otp: authenticator.generate({ timestamp: at }) } });
    assert.equal(confirmed.status, 200); codes = confirmed.value.recoveryCodes; at += 30000;
  }
  const otp = () => authenticator.generate({ timestamp: at });
  return { root, app, store, base, key, browser, admin, codes, login, request, otp, tick: ms => at += ms, now: () => at,
    confirm: () => login({ otp: otp() }) };
}

test('unfamiliar browsers validate key before MFA; missing factor is not a failure; proofs stay private', async t => {
  const f = await fixture(t);
  assert.equal((await f.login({ key: 'wrong' })).value.code, 'credential_invalid');
  const challenge = await f.login(); assert.equal(challenge.value.code, 'mfa_required');
  assert.equal((await f.store.get('setting', 'account-security-v1')).failures.count, 1);
  const invalid = await f.login({ otp: 'invalid' }); assert.equal(invalid.value.code, 'mfa_invalid');
  assert.equal((await f.store.get('setting', 'account-security-v1')).failures.count, 2);
  const r = await f.confirm(); assert.equal(r.status, 201);
  const cookie = remembered(r); assert.ok(cookie);
  assert.match(r.headers.getSetCookie().find(v => v.startsWith(trustCookie)), /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/);
  assert.equal(r.headers.getSetCookie().length, 2);
  const proof = (await f.store.list('browser-trust'))[0];
  assert.equal(proof.id, hash(cookie.split('=')[1])); assert.ok(!JSON.stringify(proof).includes(cookie.split('=')[1]));
  const status = await f.request('/api/browser-trust', { cookie: pairCookie(r.value) + '; ' + cookie });
  assert.deepEqual(Object.keys(status.value).sort(), ['confirmed', 'expiresAt', 'lastUsedAt']); assert.equal(status.value.confirmed, true);
  assert.equal((await f.request('/api/state', { cookie })).status, 401);
  assert.equal((await f.login({ key: 'wrong' }, { cookie })).status, 401);
  assert.equal((await f.login({}, { cookie })).status, 201);
});

test('logout preserves trust; profile changes and client metadata cannot bypass MFA or gain worker rights', async t => {
  const f = await fixture(t); const r = await f.confirm(); const cookie = remembered(r);
  const logout = await f.request('/api/browser-session/logout', { method: 'POST', cookie: pairCookie(r.value) + '; ' + cookie });
  assert.equal(logout.status, 200); assert.ok(!logout.headers.get('set-cookie').includes(trustCookie));
  assert.equal((await f.request('/api/state', { cookie: pairCookie(r.value) })).status, 401);
  assert.equal((await f.login({}, { origin: null, cookie })).value.code, 'mfa_required');
  assert.equal((await f.login({}, { origin: 'https://foreign.example', cookie })).status, 403);
  assert.equal((await f.login({ installationId: '1ed25b66-ff5d-4f4a-a810-181c37dbb2b3' }, { cookie })).value.code, 'mfa_required');
  assert.equal((await f.login({ clientType: 'worker', deviceInfo: undefined }, { cookie })).value.code, 'mfa_required');
  assert.equal((await f.login({ trusted: true, browserConfirmed: true })).value.code, 'mfa_required');
  const explicit = await fetch(f.base + '/api/pair', { method: 'POST', headers: { Origin: f.base, Cookie: cookie, Authorization: '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: f.key, name: 'Invalid explicit credential', ...profile }) });
  assert.equal((await explicit.json()).code, 'mfa_required');
  f.tick(60001);
  const restored = await f.login({}, { cookie }); assert.equal(restored.status, 201);
  assert.equal(restored.value.device.id, f.browser.device.id); assert.equal(restored.value.device.name, 'Preserved note');
  assert.equal((await f.request('/api/heartbeat', { method: 'POST', cookie: pairCookie(restored.value), body: { agents: ['codex'], capabilities: ['video'] } })).status, 403);
  assert.equal((await f.request('/api/browser-trust/bootstrap', { method: 'POST', cookie: pairCookie(restored.value), token: 'invalid', body: profile })).status, 401);
  assert.equal((await f.request('/api/browser-trust/bootstrap', { method: 'POST', token: restored.value.token, body: profile })).status, 403);
});

test('trust and seven-day sessions expire independently; only explicit activity renews trust', async t => {
  const f = await fixture(t); const r = await f.confirm(); const cookie = remembered(r), both = pairCookie(r.value) + '; ' + cookie;
  const initial = (await f.store.list('browser-trust'))[0];
  f.tick(86400000);
  for (const route of ['/api/state', '/api/browser-session', '/api/browser-trust']) assert.equal((await f.request(route, { cookie: both })).status, 200);
  await f.request('/api/devices/me/info', { method: 'POST', cookie: both, body: profile });
  assert.deepEqual((await f.store.list('browser-trust'))[0], initial);
  await f.request('/api/browser-session/activity', { method: 'POST', cookie: both });
  assert.equal(Date.parse((await f.store.list('browser-trust'))[0].expiresAt), f.now() + trustLifetime * 1000);
  f.tick(browserLifetime * 1000 + 1);
  assert.equal((await f.request('/api/state', { cookie: both })).status, 401);
  const renewed = await f.login({}, { cookie }); assert.equal(renewed.status, 201);
  f.tick(trustLifetime * 1000 + 1);
  assert.equal((await f.login({}, { cookie: remembered(renewed) })).value.code, 'mfa_required');
});

test('an active seven-day session can remain valid after its separate confirmation expires', async t => {
  const f = await fixture(t); const r = await f.confirm(); const cookie = remembered(r);
  const proof = (await f.store.list('browser-trust'))[0];
  for (let n = 0; n < 5; n++) {
    f.tick(6 * 86400000);
    const active = await f.request('/api/browser-session/activity', { method: 'POST', cookie: pairCookie(r.value) });
    assert.equal(active.status, 200);
    assert.deepEqual((await f.store.list('browser-trust'))[0], proof);
  }
  f.tick(1);
  assert.equal((await f.request('/api/state', { cookie: pairCookie(r.value) })).status, 200);
  assert.equal((await f.request('/api/browser-trust', { cookie: pairCookie(r.value) + '; ' + cookie })).value.confirmed, false);
  assert.equal((await f.login({}, { cookie })).value.code, 'mfa_required');
});

test('confirmation is persisted across service restarts and metadata cannot create or renew it', async t => {
  const f = await fixture(t); const r = await f.confirm(); const cookie = remembered(r);
  await new Promise(resolve => f.app.server.close(resolve));
  const borrowed = new Proxy(f.store, { get(target, key) {
    if (key === 'close') return async () => {};
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const replica = createService({ dataDir: f.root, masterKey: f.key, store: borrowed, clock: f.now });
  await new Promise(resolve => replica.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${replica.server.address().port}`;
  try {
    const login = await fetch(base + '/api/pair', { method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: f.key, name: 'New metadata only', ...profile, system: 'Windows 12', platform: 'Windows' }) });
    assert.equal(login.status, 201);
    const restored = await login.json(); assert.equal(restored.device.id, f.browser.device.id);
    assert.equal(restored.device.name, f.browser.device.name);
    assert.equal((await f.store.list('browser-trust')).length, 1);
  } finally { await replica.close(); }
});

test('master and delegated pairing logins for the same browser cannot deadlock or duplicate its authorization', { timeout: 15000 }, async t => {
  const f = await fixture(t); const r = await f.confirm(); const cookie = remembered(r);
  const pairing = await f.request('/api/pairings', { method: 'POST', token: f.admin.token, body: {} });
  const results = await Promise.all([f.login({}, { cookie }), f.login({ key: pairing.value.key })]);
  for (const result of results) { assert.equal(result.status, 201); assert.equal(result.value.device.id, f.browser.device.id); }
  assert.equal((await f.store.list('device')).filter(d => d.category === 'browser').length, 1);
});

test('legacy live browser bootstrap is one-time; forget keeps login and cannot be undone by automatic bootstrap', async t => {
  const f = await fixture(t);
  const security = await f.store.get('setting', 'account-security-v1'); delete security.trustEpoch; await f.store.put('setting', security);
  const legacy = await f.store.get('device', f.browser.device.id); delete legacy.browserTrustMigrated; await f.store.put('device', legacy);
  assert.equal((await f.request('/api/browser-trust/bootstrap', { method: 'POST', cookie: pairCookie(f.browser), body: { ...profile, installationId: '1ed25b66-ff5d-4f4a-a810-181c37dbb2b3' } })).status, 409);
  const r = await f.request('/api/browser-trust/bootstrap', { method: 'POST', cookie: pairCookie(f.browser), body: profile });
  assert.equal(r.value.confirmed, true); const cookie = remembered(r);
  assert.equal((await f.store.get('device', legacy.id)).tokenHash, legacy.tokenHash);
  assert.equal((await f.request('/api/browser-trust/forget', { method: 'POST', cookie: pairCookie(f.browser) + '; ' + cookie, origin: null })).status, 403);
  const forget = await f.request('/api/browser-trust/forget', { method: 'POST', cookie: pairCookie(f.browser) + '; ' + cookie });
  assert.equal(forget.value.confirmed, false); assert.match(remembered(forget), new RegExp('^' + trustCookie + '=$'));
  assert.equal((await f.request('/api/state', { cookie: pairCookie(f.browser) })).status, 200);
  const retry = await f.request('/api/browser-trust/bootstrap', { method: 'POST', cookie: pairCookie(f.browser), body: profile });
  assert.equal(retry.value.confirmed, false); assert.equal(remembered(retry), undefined);
  assert.equal((await f.login({}, { cookie })).value.code, 'mfa_required');
  const expired = { ...legacy, id: 'expired', installationKey: hash('owner:1ed25b66-ff5d-4f4a-a810-181c37dbb2b3'), tokenHash: hash('expired-token'), category: 'browser', browserExpiresAt: new Date(f.now() - 1).toISOString() };
  await f.store.put('device', expired);
  assert.equal((await f.request('/api/browser-trust/bootstrap', { method: 'POST', cookie: browserCookie + '=expired-token', body: profile })).status, 401);
  assert.equal((await f.request('/api/browser-trust/bootstrap', { method: 'POST', cookie: browserCookie + '=history-only-token', body: profile })).status, 401);
});

test('security changes invalidate all old proofs but keep sessions, tasks and separate CLI grants; trust cannot bypass security MFA', async t => {
  const f = await fixture(t); const r = await f.confirm(), cookie = remembered(r), both = pairCookie(r.value) + '; ' + cookie;
  const task = { id: 'preserved-task', deviceId: r.value.device.id, state: 'running' }; await f.store.put('task', task);
  const cli = { id: 'cli-fixture', category: 'integration', role: 'reader', scope: 'library:read', tokenHash: hash(secret()), expiresAt: new Date(f.now() + 86400000).toISOString() }; await f.store.put('device', cli);
  for (const action of ['credential', 'totp/disable', 'recovery-codes']) {
    const body = action === 'credential' ? { newKey: 'UpdatedKey2026', confirmKey: 'UpdatedKey2026' } : {};
    assert.equal((await f.request('/api/security/' + action, { method: 'POST', cookie: both, body })).value.code, 'mfa_required');
  }
  const changed = await f.request('/api/security/credential', { method: 'POST', cookie: both, body: { newKey: 'UpdatedKey2026', confirmKey: 'UpdatedKey2026', recoveryCode: f.codes[0] } });
  assert.equal(changed.status, 200); assert.equal((await f.request('/api/browser-trust', { cookie: both })).value.confirmed, false);
  assert.equal((await f.request('/api/state', { cookie: both })).status, 200);
  assert.deepEqual(await f.store.get('task', task.id), task); assert.deepEqual(await f.store.get('device', cli.id), cli);
  assert.equal((await f.login({}, { cookie })).status, 401);
  assert.equal((await f.login({ key: 'UpdatedKey2026' }, { cookie })).value.code, 'mfa_required');
  const recovery = await f.login({ key: 'UpdatedKey2026', recoveryCode: f.codes[1] }); assert.equal(recovery.status, 201);
  const disabled = await f.request('/api/security/totp/disable', { method: 'POST', cookie: pairCookie(recovery.value), body: { recoveryCode: f.codes[2] } });
  assert.equal(disabled.status, 200);
  assert.equal((await f.request('/api/browser-trust', { cookie: pairCookie(recovery.value) + '; ' + remembered(recovery) })).value.confirmed, false);
  assert.equal((await f.request('/api/state', { cookie: pairCookie(recovery.value) })).status, 200);
});

test('revocation rejects trust; a new browser or pairing code cannot bootstrap unearned confirmation; binding invalidates legacy trust', async t => {
  const f = await fixture(t, { totp: false });
  const fresh = await f.request('/api/browser-trust/bootstrap', { method: 'POST', cookie: pairCookie(f.browser), body: profile });
  assert.equal(fresh.value.confirmed, false);
  const legacy = await f.store.get('device', f.browser.device.id); delete legacy.browserTrustMigrated; await f.store.put('device', legacy);
  const bootstrap = await f.request('/api/browser-trust/bootstrap', { method: 'POST', cookie: pairCookie(f.browser), body: profile }); const oldCookie = remembered(bootstrap);
  const setup = await f.request('/api/security/totp/setup', { method: 'POST', token: f.admin.token, body: {} });
  const totp = new OTPAuth.TOTP({ secret: setup.value.secret });
  const enabled = await f.request('/api/security/totp/confirm', { method: 'POST', token: f.admin.token, body: { otp: totp.generate({ timestamp: f.now() }) } }); assert.equal(enabled.status, 200);
  assert.equal((await f.login({}, { cookie: oldCookie })).value.code, 'mfa_required');
  assert.equal((await f.request('/api/browser-trust/bootstrap', { method: 'POST', cookie: pairCookie(f.browser), body: profile })).value.confirmed, false);
  const pairing = await f.request('/api/pairings', { method: 'POST', token: f.admin.token, body: {} });
  const paired = await f.login({ key: pairing.value.key }); assert.equal(paired.status, 201); assert.equal(remembered(paired), undefined);
  assert.equal((await f.request('/api/browser-trust/bootstrap', { method: 'POST', cookie: pairCookie(paired.value), body: profile })).value.confirmed, false);
  const trusted = await f.login({ recoveryCode: enabled.value.recoveryCodes[0] }); const cookie = remembered(trusted);
  const revoked = await f.request('/api/devices/' + trusted.value.device.id + '/revoke', { method: 'POST', token: f.admin.token, body: {} }); assert.equal(revoked.status, 200);
  assert.equal((await f.store.list('browser-trust')).length, 0);
  assert.equal((await f.login({}, { cookie })).value.code, 'mfa_required');
});
