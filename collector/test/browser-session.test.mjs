import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { secret, hash } from '../src/common.mjs';
import { browserLifetime, browserCookie } from '../src/browser-session.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-sessions-'));
  const store = process.env.BROWSER_SESSION_MYSQL_TEST === '1' ? await mysqlFixture() : new Store(path.join(root, 'state.sqlite'));
  const key = secret(); let at = Date.now();
  const app = createService({ dataDir: root, masterKey: key, store, clock: () => at });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  async function request(route, { method = 'GET', token, cookie, origin, body } = {}) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, value: await response.json() };
  }
  async function pair(clientType = 'web', input = {}) {
    const r = await request('/api/pair', { method: 'POST', body: { key, name: clientType, clientType, ...input } });
    assert.equal(r.status, 201); return r.value;
  }
  const browser = await pair();
  return { app, store, key, base, browser, request, pair, tick: ms => at += ms, now: () => at,
    cookie: browserCookie + '=' + browser.token };
}

test('browser cookies persist seven days, are private and never expose stored credential hashes', async t => {
  const f = await fixture(t);
  const r = await f.request('/api/pair', { method: 'POST', origin: f.base, body: { key: f.key, name: 'Browser', clientType: 'web' } });
  assert.match(r.headers.get('set-cookie'), /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800/);
  assert.equal(r.value.device.category, 'browser'); assert.equal(r.value.device.online, false);
  assert.equal(r.value.device.tokenHash, undefined);
  assert.equal(Date.parse(r.value.device.browserExpiresAt), f.now() + browserLifetime * 1000);
  const state = await f.request('/api/state', { cookie: f.cookie }); assert.equal(state.status, 200);
  assert.equal(state.value.me.id, f.browser.device.id);
});

test('only actual activity slides expiry; polls and metadata updates do not; expiration is enforced server-side', async t => {
  const f = await fixture(t); const initial = (await f.store.get('device', f.browser.device.id)).browserExpiresAt;
  f.tick(86400000);
  assert.equal((await f.request('/api/state', { cookie: f.cookie })).status, 200);
  assert.equal((await f.request('/api/devices/me/info', { method: 'POST', cookie: f.cookie, origin: f.base, body: {} })).status, 200);
  assert.equal((await f.store.get('device', f.browser.device.id)).browserExpiresAt, initial);
  const renewed = await f.request('/api/browser-session/activity', { method: 'POST', cookie: f.cookie, origin: f.base });
  assert.equal(renewed.status, 200); assert.equal(Date.parse(renewed.value.browserExpiresAt), f.now() + browserLifetime * 1000);
  f.tick(browserLifetime * 1000 + 1);
  for (const route of ['/api/state', '/api/security', '/library/data', '/api/browser-session']) assert.equal((await f.request(route, { cookie: f.cookie })).status, 401);
  assert.equal((await f.request('/api/browser-session/activity', { method: 'POST', token: f.browser.token })).status, 401);
  assert.ok(await f.store.get('device', f.browser.device.id));
});

test('cookie writes require same origin and explicit bearer failures never fall back to browser authority', async t => {
  const f = await fixture(t);
  for (const origin of [undefined, 'https://attacker.example']) assert.equal((await f.request('/api/pairings', { method: 'POST', origin, cookie: f.cookie, body: {} })).status, 403);
  assert.equal((await f.request('/api/pairings', { method: 'POST', origin: f.base, cookie: f.cookie, body: {} })).status, 201);
  assert.equal((await f.request('/api/state', { token: 'invalid', cookie: f.cookie })).status, 401);
  const worker = await f.pair('worker');
  assert.equal((await f.request('/api/state', { token: worker.token, cookie: f.cookie })).status, 403);
  const badLogin = await f.request('/api/pair', { method: 'POST', origin: 'https://attacker.example', body: { key: f.key, name: 'CSRF', clientType: 'web' } });
  assert.equal(badLogin.status, 403);
});

test('browser logout invalidates its token without deleting the authorization, task or approved CLI grant', async t => {
  const f = await fixture(t);
  const task = { id: 'preserved', deviceId: f.browser.device.id, state: 'running' }; await f.store.put('task', task);
  const grant = (await f.request('/oauth/device_authorization', { method: 'POST', body: { client_id: 'lingnest-cli', scope: 'library:read' } })).value;
  assert.equal((await f.request('/api/reader-authorizations/decision', { method: 'POST', cookie: f.cookie, origin: f.base, body: { code: grant.user_code, decision: 'allow' } })).status, 200);
  const out = await f.request('/api/browser-session/logout', { method: 'POST', cookie: f.cookie, origin: f.base }); assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.request('/api/state', { token: f.browser.token })).status, 401);
  assert.equal((await f.request('/api/state', { cookie: f.cookie })).status, 401);
  assert.ok((await f.store.get('device', f.browser.device.id)).loggedOutAt);
  assert.deepEqual(await f.store.get('task', task.id), task);
  const reader = await f.request('/oauth/token', { method: 'POST', body: { client_id: 'lingnest-cli', grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: grant.device_code } });
  assert.equal(reader.status, 200);
  assert.equal((await f.request('/api/read/v1/me', { token: reader.value.access_token })).status, 200);
  assert.equal((await f.request('/api/state', { token: reader.value.access_token, cookie: f.cookie })).status, 403);
});

test('metadata cannot upgrade execution authority and all non-worker credentials are denied worker endpoints', async t => {
  const f = await fixture(t); const desktop = await f.pair('desktop'); const phone = await f.pair('android');
  for (const token of [f.browser.token, phone.token, desktop.ownerToken]) {
    for (const route of ['/api/heartbeat', '/api/claim', '/api/tasks/task/progress', '/api/tasks/task/result']) {
      assert.equal((await f.request(route, { method: 'POST', token, body: { capabilities: ['video'], agents: ['codex'] } })).status, 403);
    }
  }
  const forged = await f.request('/api/devices/me/info', { method: 'POST', token: f.browser.token, body: { category: 'desktop', role: 'worker', clientType: 'worker', deviceInfo: { os: { family: 'Windows' }, client: { type: 'worker' } } } });
  assert.equal(forged.status, 409);
  const unchanged = await f.request('/api/devices/me/info', { method: 'POST', token: f.browser.token, body: { category: 'desktop', role: 'worker' } });
  assert.equal(unchanged.value.category, 'browser'); assert.equal(unchanged.value.role, 'owner');
});

test('desktop reading never refreshes worker heartbeat; offline targeting waits then resumes on the same worker', async t => {
  const f = await fixture(t); const desktop = await f.pair('desktop');
  const heartbeat = () => f.request('/api/heartbeat', { method: 'POST', token: desktop.token, body: { capabilities: ['video'], agents: ['codex'] } });
  await heartbeat();
  let state = (await f.request('/api/state', { token: desktop.ownerToken })).value;
  assert.equal(state.devices.find(d => d.id === desktop.device.id).readyForDispatch, true);
  f.tick(46000);
  await f.request('/api/devices/me/info', { method: 'POST', token: desktop.ownerToken, body: {} });
  state = (await f.request('/api/state', { token: desktop.ownerToken })).value;
  assert.equal(state.devices.find(d => d.id === desktop.device.id).online, false);
  assert.equal((await f.request('/api/claim', { method: 'POST', token: desktop.token, body: {} })).status, 409);
  const queued = await f.request('/api/tasks', { method: 'POST', token: f.browser.token, body: { content: 'Fixture video', submissionId: 'offline', deviceId: desktop.device.id } }); assert.equal(queued.status, 201);
  await heartbeat(); const claimed = await f.request('/api/claim', { method: 'POST', token: desktop.token, body: {} });
  assert.equal(claimed.value.task.id, queued.value.id); assert.equal(claimed.value.task.deviceId, desktop.device.id);
});

test('legacy authorizations migrate in place; web-labelled native clients and unknown records do not receive browser expiry', async t => {
  const f = await fixture(t);
  const records = [
    { id: 'legacy-web', role: 'owner', clientType: 'web', system: '浏览器' },
    { id: 'legacy-native', role: 'owner', clientType: 'web', platform: 'darwin', system: 'Darwin 25.0.0' },
    { id: 'legacy-phone', role: 'owner', clientType: 'ios' },
    { id: 'legacy-unknown', role: 'owner' },
    { id: 'legacy-ambiguous-web', role: 'owner', clientType: 'web' },
  ];
  for (const record of records) await f.store.put('device', { ...record, name: 'Keep note', tokenHash: hash(record.id), revokedAt: null });
  const state = await f.request('/api/state', { token: f.browser.token }); assert.equal(state.status, 200);
  for (const record of records) {
    const stored = await f.store.get('device', record.id); assert.equal(stored.tokenHash, hash(record.id)); assert.equal(stored.name, 'Keep note');
    assert.equal(Boolean(stored.browserExpiresAt), record.id === 'legacy-web');
    assert.equal((await f.request('/api/state', { token: record.id })).status, 200);
  }
  assert.equal((await f.store.get('device', 'legacy-native')).category, 'desktop');
  assert.equal((await f.store.get('device', 'legacy-unknown')).category, 'unknown');
  assert.equal((await f.store.get('device', 'legacy-ambiguous-web')).category, 'unknown');
  const legacyUpdate = await f.request('/api/devices/me/info', { method: 'POST', token: 'legacy-native', body: { deviceInfo: { os: { family: 'macOS' }, client: { type: 'web', name: 'InspiraiNest' } } } });
  assert.equal(legacyUpdate.status, 200); assert.equal(legacyUpdate.value.category, 'desktop');
  assert.equal(legacyUpdate.value.browserExpiresAt, undefined);
  const identified = await f.request('/api/devices/me/info', { method: 'POST', token: 'legacy-ambiguous-web', body: { deviceInfo: { os: { family: 'Windows' }, client: { type: 'web', name: 'Chrome' } } } });
  assert.equal(identified.status, 200); assert.equal(identified.value.category, 'browser');
  assert.equal(identified.value.workerAuthorized, false);
  assert.equal((await f.store.get('device', 'legacy-ambiguous-web')).tokenHash, hash('legacy-ambiguous-web'));
});

test('browser re-login keeps its profile authorization ID and revocation invalidates cookies immediately', async t => {
  const f = await fixture(t); const installationId = '93734af7-4bdc-42ab-b784-f9d2f03db170';
  const first = await f.pair('web', { installationId }); const again = await f.pair('web', { installationId });
  assert.equal(first.device.id, again.device.id); assert.notEqual(first.token, again.token);
  assert.equal((await f.request('/api/state', { token: first.token })).status, 401);
  assert.equal((await f.request('/api/devices/' + again.device.id + '/revoke', { method: 'POST', token: f.browser.token, body: {} })).status, 200);
  assert.equal((await f.request('/api/state', { cookie: browserCookie + '=' + again.token })).status, 401);
});
