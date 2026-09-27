import crypto from 'node:crypto';
import { hash, secret, id, now, requireValue, text, remoteURL } from './common.mjs';

const CLIENT = 'lingnest-cli';
const SCOPE = 'library:read';
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const lifetime = 30 * 86400;
const publicReader = ({ tokenHash, ...device }) => device;

// Opaque grants and tokens are hashed at rest. Browser consent never sees device_code.
export function readerAuthorization({ store, authenticate, serialized, publicUrl, body, send }) {
  const attempts = new Map();
  function limit(req, bucket, maximum) {
    const key = `${bucket}:${req.socket.remoteAddress}`;
    const at = Date.now();
    for (const [key, record] of attempts) if (at - record.at >= 60000) attempts.delete(key);
    const record = attempts.get(key) || { at, count: 0 };
    attempts.set(key, record);
    requireValue(++record.count <= maximum, 'Too many authorization attempts', 429);
  }
  function origin(req) {
    if (publicUrl) return new URL(remoteURL(publicUrl)).origin;
    const url = new URL(`http://${req.headers.host}`);
    requireValue(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Configure COLLECTOR_PUBLIC_URL', 503);
    return url.origin;
  }
  async function owner(req) {
    const device = await authenticate(req);
    requireValue(device.role === 'owner', 'Owner permission required', 403);
    if (req.headers.origin) requireValue(req.headers.origin === origin(req), 'Origin not allowed', 403);
    return device;
  }
  function oauthError(res, error, status = 400) { send(res, status, { error }); }
  async function grantByCode(code) {
    requireValue(typeof code === 'string' && /^[A-F0-9]{4}-?[A-F0-9]{4}$/i.test(code), 'Invalid confirmation code');
    const digest = hash(code.replace('-', '').toUpperCase());
    const grant = (await store.list('reader_grant')).find(g => g.userCodeHash === digest);
    requireValue(grant && Date.parse(grant.expiresAt) > Date.now(), 'Confirmation code expired or not found', 404);
    return grant;
  }
  async function handle(req, res, url) {
    const route = url.pathname;
    if (route === '/oauth/device_authorization' && req.method === 'POST') {
      limit(req, 'start', 10);
      const input = await body(req);
      if (input.client_id !== CLIENT) { oauthError(res, 'invalid_client'); return true; }
      if (input.scope !== SCOPE) { oauthError(res, 'invalid_scope'); return true; }
      const base = origin(req);
      const name = text(input.name || 'InspiraiNest CLI', 'client name', 100);
      const deviceCode = secret();
      const rawCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      const userCode = rawCode.slice(0, 4) + '-' + rawCode.slice(4);
      await store.transaction(async tx => {
        for (const old of await tx.list('reader_grant')) if (Date.parse(old.expiresAt) <= Date.now()) await tx.delete('reader_grant', old.id);
        await tx.put('reader_grant', { id: hash(deviceCode), userCodeHash: hash(rawCode), clientId: CLIENT, name,
          scope: SCOPE, state: 'pending', createdAt: now(), expiresAt: new Date(Date.now() + 600000).toISOString(), interval: 5, lastPoll: 0 });
      });
      send(res, 200, { device_code: deviceCode, user_code: userCode, verification_uri: `${base}/authorize`,
        verification_uri_complete: `${base}/authorize#code=${userCode}`, expires_in: 600, interval: 5 });
      return true;
    }
    if (route === '/oauth/token' && req.method === 'POST') {
      limit(req, 'poll', 120);
      const input = await body(req);
      if (input.client_id !== CLIENT) { oauthError(res, 'invalid_client'); return true; }
      if (input.grant_type !== GRANT) { oauthError(res, 'unsupported_grant_type'); return true; }
      if (typeof input.device_code !== 'string' || input.device_code.length > 200) { oauthError(res, 'invalid_grant'); return true; }
      const key = hash(input.device_code);
      await serialized(`reader-grant:${key}`, async () => {
        const result = await store.transaction(async tx => {
          // Database row locks also serialize redemption across service instances.
          const grant = await tx.getForUpdate('reader_grant', key);
          if (!grant || grant.state === 'consumed') return { error: 'invalid_grant' };
          if (Date.parse(grant.expiresAt) <= Date.now()) return { error: 'expired_token' };
          if (grant.state === 'denied') return { error: 'access_denied' };
          const tooFast = grant.lastPoll && Date.now() - grant.lastPoll < grant.interval * 1000;
          grant.lastPoll = Date.now();
          if (tooFast) grant.interval += 5;
          await tx.put('reader_grant', grant);
          if (tooFast) return { error: 'slow_down' };
          if (grant.state !== 'approved') return { error: 'authorization_pending' };
          const issuer = await tx.getForUpdate('device', grant.ownerId);
          if (!issuer || issuer.revokedAt || issuer.role !== 'owner') return { error: 'access_denied' };
          if (Date.parse(grant.expiresAt) <= Date.now()) return { error: 'expired_token' };
          const token = secret();
          await tx.put('device', { id: id(), name: grant.name, role: 'reader', scope: SCOPE, tokenHash: hash(token),
            createdAt: now(), lastSeen: now(), expiresAt: new Date(Date.now() + lifetime * 1000).toISOString(), revokedAt: null,
            platform: 'cli', system: 'InspiraiNest CLI', capabilities: [], agents: [] });
          await tx.put('reader_grant', { ...grant, state: 'consumed' });
          return { access_token: token, token_type: 'Bearer', expires_in: lifetime, scope: SCOPE };
        });
        send(res, result.error ? 400 : 200, result);
      });
      return true;
    }
    if (route === '/api/reader-authorizations' && req.method === 'GET') {
      await owner(req);
      limit(req, 'confirm', 30);
      const grant = await grantByCode(url.searchParams.get('code'));
      send(res, 200, { name: grant.name, scope: grant.scope, state: grant.state, expiresAt: grant.expiresAt });
      return true;
    }
    if (route === '/api/reader-authorizations/decision' && req.method === 'POST') {
      const issuer = await owner(req);
      limit(req, 'confirm', 30);
      const input = await body(req);
      requireValue(['allow', 'deny'].includes(input.decision), 'Invalid authorization decision');
      const grant = await grantByCode(input.code);
      await serialized(`reader-grant:${grant.id}`, async () => {
        await owner(req);
        await store.transaction(async tx => {
          const latest = await tx.getForUpdate('reader_grant', grant.id);
          const currentIssuer = await tx.getForUpdate('device', issuer.id);
          requireValue(currentIssuer && !currentIssuer.revokedAt && currentIssuer.role === 'owner', 'Device authorization required', 401);
          requireValue(latest && latest.state === 'pending' && Date.parse(latest.expiresAt) > Date.now(), 'Authorization is no longer pending', 409);
          await tx.put('reader_grant', { ...latest, state: input.decision === 'allow' ? 'approved' : 'denied', ownerId: issuer.id });
        });
        send(res, 200, { approved: input.decision === 'allow' });
      });
      return true;
    }
    if (route === '/api/read/v1/me' && req.method === 'GET') {
      const device = await authenticate(req);
      requireValue(device.role === 'reader', 'Reader permission required', 403);
      send(res, 200, { schema_version: 1, device: publicReader(device) });
      return true;
    }
    if (route === '/api/read/v1/logout' && req.method === 'POST') {
      const device = await authenticate(req);
      requireValue(device.role === 'reader', 'Reader permission required', 403);
      await store.transaction(tx => tx.delete('device', device.id));
      send(res, 200, { schema_version: 1, revoked: true });
      return true;
    }
    return false;
  }
  return { handle };
}
