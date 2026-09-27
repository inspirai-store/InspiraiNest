import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../src/server.mjs';
import { secret, hash } from '../src/common.mjs';
import { readerAuthorization } from '../src/reader-auth.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingnest-auth-'));
  const masterKey = secret();
  const store = process.env.LINGNEST_TEST_MYSQL === '1' ? await mysqlFixture() : undefined;
  const app = createService({ dataDir: root, masterKey, store, publicUrl: null });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  async function request(route, method = 'GET', data, token, form = false) {
    const response = await fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, body: data === undefined ? undefined : form ? new URLSearchParams(data) : JSON.stringify(data) });
    const value = await response.json();
    return { status: response.status, value };
  }
  const owner = (await request('/api/pair', 'POST', { key: masterKey, name: 'Fixture owner' })).value;
  const begin = async () => (await request('/oauth/device_authorization', 'POST', { client_id: 'lingnest-cli', scope: 'library:read', name: 'Test CLI' }, null, true)).value;
  const poll = grant => request('/oauth/token', 'POST', { client_id: 'lingnest-cli', grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: grant.device_code }, null, true);
  const decide = (grant, decision = 'allow') => request('/api/reader-authorizations/decision', 'POST', { code: grant.user_code, decision }, owner.token);
  async function authorize() { const grant = await begin(); assert.equal((await decide(grant)).status, 200); return (await poll(grant)).value.access_token; }
  return { app, base, request, owner, begin, poll, decide, authorize };
}

test('device grant requires explicit owner consent, hashes secrets and can be redeemed only once', async t => {
  const { app, base, request, owner, begin, poll, decide } = await setup(t);
  const grant = await begin();
  assert.equal(grant.expires_in, 600); assert.equal(grant.interval, 5);
  assert.equal(grant.verification_uri, base + '/authorize');
  assert.ok(!grant.verification_uri_complete.includes(grant.device_code));
  const records = JSON.stringify(await app.store.list('reader_grant'));
  assert.ok(!records.includes(grant.device_code)); assert.ok(!records.includes(grant.user_code));
  assert.equal((await fetch(grant.verification_uri)).status, 200);
  assert.equal((await request('/api/reader-authorizations?code=' + grant.user_code)).status, 401);
  const inspected = await request('/api/reader-authorizations?code=' + grant.user_code, 'GET', undefined, owner.token);
  assert.equal(inspected.value.state, 'pending');
  assert.equal((await poll(grant)).value.error, 'authorization_pending');
  assert.equal((await poll(grant)).value.error, 'slow_down');
  assert.equal((await decide(grant)).status, 200);
  assert.equal((await decide(grant)).status, 409);
  const stored = await app.store.get('reader_grant', hash(grant.device_code));
  await app.store.put('reader_grant', { ...stored, lastPoll: 0 });
  const result = await poll(grant);
  assert.equal(result.status, 200); assert.equal(result.value.scope, 'library:read');
  assert.equal(result.value.expires_in, 30 * 86400);
  assert.equal((await poll(grant)).value.error, 'invalid_grant');
  const me = await request('/api/read/v1/me', 'GET', undefined, result.value.access_token);
  assert.equal(me.value.device.role, 'reader'); assert.equal(me.value.device.tokenHash, undefined);
  assert.ok(!JSON.stringify(await app.store.list('device')).includes(result.value.access_token));
});

test('reader cannot reach any legacy data or management/worker mutations; owner/worker still work', async t => {
  const { request, owner, authorize } = await setup(t);
  const token = await authorize();
  for (const [route, method] of [
    ['/api/state', 'GET'], ['/api/trash', 'GET'], ['/api/devices/me/info', 'POST'], ['/api/pairings', 'POST'],
    ['/api/tasks', 'POST'], ['/api/archives', 'POST'], ['/api/claim', 'POST'], ['/api/heartbeat', 'POST'],
    ['/api/tasks/fake/draft', 'GET'], ['/api/tasks/fake/approve', 'POST'], ['/api/tasks/fake/retry', 'POST'],
    ['/api/tasks/fake/cancel', 'POST'], ['/api/tasks/fake/result', 'POST'], ['/api/tasks/fake/progress', 'POST'],
    ['/api/devices/fake/revoke', 'POST'], ['/api/archives/' + '0'.repeat(64), 'GET'],
    ['/api/archives/' + '0'.repeat(64), 'DELETE'], ['/api/archives/' + '0'.repeat(64) + '/restore', 'POST'],
    ['/api/library-session', 'POST'], ['/library/data', 'GET'],
    ['/api/reader-authorizations?code=AAAA-BBBB', 'GET'], ['/api/reader-authorizations/decision', 'POST'],
  ]) assert.equal((await request(route, method, method === 'GET' ? undefined : {}, token)).status, 403, `${method} ${route}`);
  assert.equal((await request('/api/state', 'GET', undefined, owner.token)).status, 200);
  const pair = await request('/api/pairings', 'POST', { role: 'worker' }, owner.token);
  const worker = (await request('/api/pair', 'POST', { name: 'Worker', key: pair.value.key })).value;
  assert.equal((await request('/api/heartbeat', 'POST', { capabilities: [], agents: [] }, worker.token)).status, 200);
  assert.equal((await request('/api/read/v1/entries', 'GET', undefined, worker.token)).status, 403);
});

test('denial, expiration, issuer revocation, reader expiry and independent revocation', async t => {
  const { app, request, owner, begin, poll, decide, authorize } = await setup(t);
  const denied = await begin(); await decide(denied, 'deny');
  assert.equal((await poll(denied)).value.error, 'access_denied');
  const expired = await begin();
  await app.store.put('reader_grant', { ...(await app.store.get('reader_grant', hash(expired.device_code))), expiresAt: '2000-01-01T00:00:00Z' });
  assert.equal((await poll(expired)).value.error, 'expired_token');
  const first = await authorize(); const second = await authorize();
  const me = (await request('/api/read/v1/me', 'GET', undefined, first)).value.device;
  await request(`/api/devices/${me.id}/revoke`, 'POST', {}, owner.token);
  assert.equal((await request('/api/read/v1/me', 'GET', undefined, first)).status, 401);
  assert.equal((await request('/api/read/v1/me', 'GET', undefined, second)).status, 200);
  await request('/api/read/v1/logout', 'POST', {}, second);
  assert.equal((await request('/api/read/v1/me', 'GET', undefined, second)).status, 401);
  const third = await authorize();
  const device = (await app.store.list('device')).find(d => d.tokenHash === hash(third));
  await app.store.put('device', { ...device, expiresAt: '2000-01-01T00:00:00Z' });
  assert.equal((await request('/api/read/v1/me', 'GET', undefined, third)).status, 401);
  const issuerRevoked = await begin(); await decide(issuerRevoked);
  await app.store.delete('device', owner.device.id);
  assert.equal((await poll(issuerRevoked)).value.error, 'access_denied');
});

test('only explicit scope/client accepted, authorization attempts bounded and cross-origin consent blocked', async t => {
  const { base, request, owner, begin } = await setup(t);
  assert.equal((await request('/oauth/device_authorization', 'POST', { client_id: 'lingnest-cli', scope: 'owner' })).value.error, 'invalid_scope');
  assert.equal((await request('/oauth/device_authorization', 'POST', { client_id: 'other', scope: 'library:read' })).value.error, 'invalid_client');
  const grant = await begin();
  const response = await fetch(base + '/api/reader-authorizations/decision', { method: 'POST', headers: { Origin: 'https://untrusted.example', Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: grant.user_code, decision: 'allow' }) });
  assert.equal(response.status, 403);
  for (let i = 0; i < 7; i++) await begin();
  assert.equal((await request('/oauth/device_authorization', 'POST', { client_id: 'lingnest-cli', scope: 'library:read' })).status, 429);
});

test('token issuance revalidates creator and expiry after entering its transaction', async t => {
  const { app, owner, begin, poll, decide } = await setup(t);
  const grant = await begin(); await decide(grant);
  const transaction = app.store.transaction.bind(app.store);
  app.store.transaction = async work => {
    await app.store.delete('device', owner.device.id);
    return transaction(work);
  };
  assert.equal((await poll(grant)).value.error, 'access_denied');
  assert.equal((await app.store.list('device')).filter(d => d.role === 'reader').length, 0);
  app.store.transaction = transaction;
});

test('database-serialized redemption remains single-use across independent handler locks', async t => {
  const { app, begin, decide } = await setup(t);
  const grant = await begin(); await decide(grant);
  const handlers = [0, 1].map(() => readerAuthorization({ store: app.store, authenticate: async () => { throw new Error('unused'); },
    serialized: async (_, work) => work(), body: async req => req.input, send: (res, status, value) => Object.assign(res, { status, value }) }));
  const results = await Promise.all(handlers.map(async handler => {
    const res = {};
    await handler.handle({ method: 'POST', socket: { remoteAddress: 'fixture' }, input: { client_id: 'lingnest-cli', grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: grant.device_code } }, res, new URL('http://localhost/oauth/token'));
    return res;
  }));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal(results.find(r => r.status === 400).value.error, 'invalid_grant');
  assert.equal((await app.store.list('device')).filter(d => d.role === 'reader').length, 1);
});

test('reader revoked during lastSeen update is not authenticated from a stale snapshot', async t => {
  const { app, request, authorize } = await setup(t);
  const token = await authorize();
  const device = (await app.store.list('device')).find(d => d.role === 'reader');
  await app.store.put('device', { ...device, lastSeen: '2000-01-01T00:00:00Z' });
  const touch = app.store.touchDevice.bind(app.store);
  app.store.touchDevice = async (id, at) => { await app.store.delete('device', id); return touch(id, at); };
  assert.equal((await request('/api/read/v1/me', 'GET', undefined, token)).status, 401);
  assert.equal(await app.store.get('device', device.id), null);
});

test('a rolling-back consent transaction cannot erase a concurrently successful new grant', async t => {
  const { app, begin } = await setup(t);
  let release, entered, creating;
  const barrier = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const creationStarted = new Promise(resolve => { creating = resolve; });
  const rollback = app.store.transaction(async () => { entered(); await barrier; throw new Error('fixture rollback'); });
  const rollbackChecked = assert.rejects(rollback, /fixture rollback/);
  await started;
  const originalTransaction = app.store.transaction.bind(app.store);
  app.store.transaction = work => { creating(); return originalTransaction(work); };
  const pending = begin();
  await creationStarted;
  release(); await rollbackChecked;
  const grant = await pending;
  assert.ok(grant.device_code);
  assert.equal((await app.store.get('reader_grant', hash(grant.device_code))).state, 'pending');
});

test('unrelated SQLite reads and writes do not join or get rolled back with an authorization transaction', async t => {
  const { app } = await setup(t);
  let release, entered;
  const barrier = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const rollback = app.store.transaction(async tx => {
    await tx.put('fixture', { id: 'uncommitted', value: 'private' });
    entered(); await barrier; throw new Error('fixture rollback');
  });
  const rollbackChecked = assert.rejects(rollback, /fixture rollback/);
  await started;
  const read = app.store.get('fixture', 'uncommitted');
  const write = app.store.put('fixture', { id: 'independent', value: 'must survive' });
  release(); await rollbackChecked;
  assert.equal(await read, null);
  await write;
  assert.equal((await app.store.get('fixture', 'independent')).value, 'must survive');
});
