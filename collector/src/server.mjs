import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { MySqlStore } from './mysql-store.mjs';
import { LocalStorage, OssStorage } from './storage.mjs';
import { validateArchive, requireReadableMetadata } from './archive.mjs';
import { libraryBrowser } from './library-browser.mjs';
import { clientDownload } from './client-download.mjs';
import { readerAuthorization } from './reader-auth.mjs';
import { createReadApi } from './read-api.mjs';
import { deviceMetadata, publicDeviceMetadata, deviceCategory, workerAuthorized, workerOnline } from './device-metadata.mjs';
import { browserSessions, browserCookie, browserValid } from './browser-session.mjs';
import { accountSecurity } from './account-security.mjs';
import { browserTrust, trustCookie, cookieValue } from './browser-trust.mjs';
import QRCode from 'qrcode';
import { hash, id, secret, now, text, types, requireValue, fail, sourceURL } from './common.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const active = ['assigned', 'running', 'uploading'];
function pairingClient(input) {
  const client = input.clientType || (['win32', 'darwin', 'linux'].includes(input.platform) ? 'worker' : 'web');
  requireValue(['web', 'android', 'ios', 'worker', 'desktop'].includes(client), 'Invalid device client');
  return client;
}
function installationKey(input, role) {
  const value = input.installationId || null;
  requireValue(!value || (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)), 'Invalid installation ID');
  return value ? hash(`${role}:${value.toLowerCase()}`) : null;
}

export function createService({ dataDir, masterKey, storage = new LocalStorage(path.join(dataDir, 'objects')), store = new Store(path.join(dataDir, 'state.sqlite')), releaseDir = process.env.COLLECTOR_RELEASE_DIR || path.join(project, 'mobile/dist'), publicUrl = process.env.COLLECTOR_PUBLIC_URL, reviewExpiresAt = process.env.COLLECTOR_REVIEW_EXPIRES_AT, clock = Date.now }) {
  requireValue(masterKey?.length >= 32, 'Master key must contain at least 32 characters');
  requireValue(!reviewExpiresAt || Number.isFinite(Date.parse(reviewExpiresAt)), 'Invalid review expiry');
  const attempts = new Map();
  const locks = new Map();
  async function serialized(key, work) {
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    locks.set(key, current);
    await previous;
    try { return await work(); }
    finally { release(); if (locks.get(key) === current) locks.delete(key); }
  }
  const browser = libraryBrowser({ dataDir, storage });
  const sessions = browserSessions({ store, serialized, clock });
  const publicDevice = device => publicDeviceMetadata(device, clock());
  const security = accountSecurity({ store, masterKey, serialized, clock });
  const trust = browserTrust({ clock });
  const download = clientDownload({ releaseDir, publicUrl });
  const readApi = createReadApi({ dataDir, store, browser, publicUrl, authenticate, send });
  const readerAuth = readerAuthorization({ store, authenticate, serialized, publicUrl, body, send });
  const deleted = async archive => Boolean((await store.get('trash', archive.entryId))?.deletedAt);
  async function identityPolicy() {
    return serialized('device-policy', () => store.transaction(async tx => {
      const current = await tx.getForUpdate('setting', 'device-identity-v2');
      if (current) return { version: 2, namespace: current.namespace };
      const value = await tx.put('setting', { id: 'device-identity-v2', namespace: id(), createdAt: now() });
      return { version: 2, namespace: value.namespace };
    }));
  }
  async function metadata(input) {
    return deviceMetadata(input, input.identity ? (await identityPolicy()).namespace : undefined);
  }
  async function identityConflict(tx, data, deviceId, clientType) {
    if (!data.identity) return;
    const duplicate = (await tx.list('device')).some(d => d.id !== deviceId && !d.revokedAt
      && d.identity?.digest === data.identity.digest && d.identity?.namespace === data.identity.namespace
      && (d.deviceInfo?.client.type || d.clientType) === (data.deviceInfo?.client.type || clientType));
    requireValue(!duplicate, 'This device identity is already authorized; review the existing authorization before pairing again', 409);
  }
  async function updateDevice(device, input, changes = {}) {
    const role = device.deviceRole || device.role;
    const key = installationKey(input, role);
    const data = await metadata(input);
    return serialized(`device:${device.id}`, () => store.transaction(async tx => {
      if (data.identity) await tx.getForUpdate('setting', 'device-identity-v2');
      const record = await tx.getForUpdate('device', device.id);
      requireValue(record && !record.revokedAt && record.tokenHash === device.tokenHash, 'Device authorization required', 401);
      const category = deviceCategory(record);
      if (data.deviceInfo) requireValue(category === 'unknown' || (category === 'desktop' ? ['desktop', 'worker', ...(record.clientType === 'web' ? ['web'] : [])].includes(data.deviceInfo.client.type)
        : category === 'mobile' ? ['android', 'ios'].includes(data.deviceInfo.client.type) : data.deviceInfo.client.type === 'web'), 'Client category cannot be changed', 409);
      requireValue(!record.installationKey || !key || key === record.installationKey, 'Installation ID does not match this authorization', 409);
      if (key) requireValue(!(await tx.list('device')).some(d => d.id !== record.id && d.installationKey === key), 'Installation already paired; use the current authorization', 409);
      requireValue(!record.identity || !data.identity || record.identity.digest === data.identity.digest
        && record.identity.namespace === data.identity.namespace && record.identity.source === data.identity.source,
      'Device identity changed; confirm a new pairing', 409);
      await identityConflict(tx, data, record.id, record.clientType);
      const updated = { ...record, ...changes, ...data, installationKey: key || record.installationKey || null,
        platform: input.platform ? text(input.platform, 'platform', 40) : record.platform || null,
        system: input.system ? text(input.system, 'system', 100) : record.system || null };
      if (category === 'unknown') { delete updated.category; Object.assign(updated, sessions.fields(updated)); }
      return tx.put('device', updated);
    }));
  }
  async function readable(archive) { requireValue(archive && !(await deleted(archive)), 'Archive not found', 404); }
  async function saveTask(task, state, message, target = store) {
    task.state = state;
    task.updatedAt = now();
    task.events = [...(task.events || []), { at: task.updatedAt, state, message }].slice(-100);
    return target.put('task', task);
  }
  async function authenticate(req) {
    const explicit = req.headers.authorization;
    const cookie = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${browserCookie}=([^;]+)`))?.[1];
    const token = explicit !== undefined ? explicit.match(/^Bearer (\S+)$/)?.[1] : cookie
      || (req.method === 'GET' && req.url.startsWith('/library/') && req.headers.cookie?.match(/(?:^|;\s*)library_session=([^;]+)/)?.[1]);
    let device = token && (await store.list('device')).find(d => (d.tokenHash === hash(token) || d.ownerTokenHash === hash(token)) && !d.revokedAt
      && (d.role !== 'reader' || (d.scope === 'library:read' && Date.parse(d.expiresAt) > Date.now())));
    if (device) device = await sessions.ensure(device);
    requireValue(device && browserValid(device, clock()), 'Device authorization required', 401);
    if (explicit === undefined && cookie) {
      requireValue(deviceCategory(device) === 'browser', 'Browser session required', 401);
      if (!['GET', 'HEAD'].includes(req.method)) sameOrigin(req);
    }
    req.authToken = token;
    requireValue(device, 'Device authorization required', 401);
    if (device.role === 'reader' && Date.now() - Date.parse(device.lastSeen) > 60000) {
      await store.touchDevice(device.id, now());
      device = await store.get('device', device.id);
      requireValue(device && !device.revokedAt && device.role === 'reader' && device.scope === 'library:read'
        && Date.parse(device.expiresAt) > Date.now() && device.tokenHash === hash(token), 'Device authorization required', 401);
    }
    return device.ownerTokenHash === hash(token) ? { ...device, deviceRole: device.role, role: 'owner' } : device;
  }
  function owner(device) { requireValue(device.role === 'owner', 'Owner permission required', 403); }
  function worker(device) { requireValue(workerAuthorized(device), 'Worker permission required', 403); }
  function sameOrigin(req) {
    const origin = publicUrl ? new URL(publicUrl).origin : `${req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
    requireValue(req.headers.origin === origin, 'Origin not allowed', 403);
  }
  async function assigned(device, taskId) {
    worker(device);
    const task = await store.get('task', taskId);
    requireValue(task && task.deviceId === device.id, 'Task not assigned to this device', 403);
    return task;
  }
  async function enroll(name, role, input = {}, transaction, prepared) {
    const token = secret();
    // Keep management credentials outside the Agent Worker configuration.
    const ownerToken = input.clientType === 'desktop' ? secret() : null;
    const key = installationKey(input, role);
    const platform = input.platform ? text(input.platform, 'platform', 40) : null;
    const system = input.system ? text(input.system, 'system', 100) : null;
    const data = prepared || await metadata(input);
    const inferred = deviceCategory({ role, ...input });
    const category = inferred === 'unknown' && input.clientType === 'web' ? 'browser' : inferred;
    const write = async tx => {
      if (data.identity) await tx.getForUpdate('setting', 'device-identity-v2');
      let previousBrowser;
      if (key) for (const old of await tx.list('device')) {
        if (old.installationKey !== key) continue;
        if (deviceCategory(old) === 'browser' && category === 'browser') { previousBrowser = old; continue; }
        const busy = (await tx.list('task')).some(task => task.deviceId === old.id && [...active, 'waiting_action'].includes(task.state));
        requireValue(!busy, 'This computer has an unfinished task; resume or cancel it before pairing again', 409);
        await tx.delete('device', old.id);
      }
      await identityConflict(tx, data, previousBrowser?.id, input.clientType);
      const record = { id: previousBrowser?.id || id(), name: previousBrowser?.name || text(name, 'device name', 100), role, clientType: input.clientType || (role === 'worker' ? 'worker' : 'web'), tokenHash: hash(token), ...(ownerToken ? { ownerTokenHash: hash(ownerToken) } : {}), installationKey: key, platform, system, ...data, createdAt: previousBrowser?.createdAt || now(), lastSeen: now(), lastHeartbeatAt: null, revokedAt: null, capabilities: [], agents: [],
        ...(category === 'browser' ? { browserTrustMigrated: previousBrowser ? previousBrowser.browserTrustMigrated === true : true } : {}) };
      const device = await tx.put('device', { ...record, ...sessions.fields({ ...record, category }) });
      return { device: publicDevice(device), token, ...(ownerToken ? { ownerToken } : {}) };
    };
    return transaction ? write(transaction) : serialized(`installation:${key || token}`, () => store.transaction(write));
  }
  function send(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }
  async function body(req) {
    let size = 0;
    const chunks = [];
    const limit = /\/(result|archives)$/.test(new URL(req.url, 'http://localhost').pathname) ? 58 * 1024 * 1024 : 96 * 1024;
    for await (const chunk of req) {
      size += chunk.length;
      requireValue(size <= limit, 'Request too large', 413);
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (req.url.startsWith('/oauth/') && req.headers['content-type']?.split(';')[0] === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(raw));
    try { return JSON.parse(raw); } catch { fail('Invalid JSON'); }
  }
  async function publish(bundle, device, req, taskId) {
    const taskRecord = taskId ? await assigned(device, taskId) : null;
    if (taskRecord?.tags?.length) bundle = { ...bundle, meta: { ...bundle.meta, tags: [...new Set([...(bundle.meta?.tags || []), ...taskRecord.tags])] } };
    validateArchive(bundle);
    requireReadableMetadata(bundle.meta);
    const buffer = Buffer.from(JSON.stringify(bundle));
    const digest = hash(buffer);
    if (taskId) {
      const task = await assigned(device, taskId);
      if (task.state === 'completed' && task.archiveId === digest) return store.get('archive', digest);
      if (task.state === 'awaiting_review' && task.draftId === digest) return store.get('draft', digest);
      requireValue(active.includes(task.state), 'Task is not running', 409);
    }
    const key = `archives/${digest}.json`;
    await storage.put(key, buffer);
    // A revoked worker or cancelled task cannot commit a result after an in-flight upload.
    await authenticate(req);
    if (taskId) requireValue(active.includes((await assigned(device, taskId)).state), 'Task is no longer running', 409);
    const record = { id: digest, entryId: bundle.meta.id, meta: bundle.meta, key, deviceId: device.id, createdAt: now(), omittedCount: bundle.omitted?.length || 0 };
    if (taskRecord?.autoArchive === false) {
      const draft = await store.put('draft', record);
      await saveTask({ ...(await assigned(device, taskId)), draftId: digest }, 'awaiting_review', '分析结果已上传，等待确认归档');
      return draft;
    }
    const archive = (await store.get('archive', digest)) || await store.put('archive', record);
    void readApi.refresh().catch(() => {});
    if (taskId) await saveTask({ ...(await assigned(device, taskId)), archiveId: digest }, 'completed', '归档校验完成，资料已上传');
    return archive;
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      if (await download(req, res, route)) return;
      if (req.method === 'GET' && route === '/healthz') return send(res, 200, { status: 'ok' });
      if (reviewExpiresAt && clock() >= Date.parse(reviewExpiresAt)) fail('Review demo has expired', 410);
      if (req.method === 'GET' && route === '/api/device-policy') return send(res, 200, await identityPolicy());
      if (await readerAuth.handle(req, res, url)) return;
      if (route === '/api/library-session' && req.method === 'POST') {
        owner(await authenticate(req));
        const token = req.authToken;
        res.setHeader('Set-Cookie', `library_session=${token}; Path=/library/; HttpOnly; Secure; SameSite=Strict`);
        return send(res, 200, { ok: true });
      }
      if (route === '/api/library-logout' && req.method === 'POST') {
        if (req.headers.cookie?.includes(browserCookie + '=')) {
          try { await sessions.logout(await authenticate(req)); } catch (error) { if (error.status !== 401) throw error; }
        }
        sessions.clear(res);
        return send(res, 200, { ok: true });
      }
      if (route.startsWith('/library/')) {
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
        requireValue(req.method === 'GET', 'Not found', 404);
        if (route === '/library/') {
          let html = fs.readFileSync(path.join(project, '../index.html'), 'utf8');
          html = html.replace('<script defer src="assets/library-data.js"></script>', '').replace('<script defer src="assets/library.js"></script>', '<script defer src="/library/bootstrap.js"></script>').replace('href="index.html"', 'href="/" target="_top"').replace('本地资料<span', 'Dev 资料<span');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.end(html);
        }
        const assets = { '/library/bootstrap.js': 'collector/public/library-bootstrap.js', ...Object.fromEntries(['library.js', 'library.css', 'library-time.js', 'client-prompt.js', 'client-prompt.css', 'brand-icon.png', 'brand.css', 'vendor/lucide.js', 'vendor/marked.js', 'vendor/purify.js'].map(f => ['/library/assets/' + f, 'assets/' + f])) };
        if (assets[route]) {
          res.setHeader('Content-Type', route.endsWith('.css') ? 'text/css' : route.endsWith('.png') ? 'image/png' : 'text/javascript');
          return res.end(fs.readFileSync(path.join(project, '..', assets[route])));
        }
        owner(await authenticate(req));
        if (route === '/library/data') {
          const latest = new Map();
          for (const a of (await store.list('archive')).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
            if (!(await deleted(a))) latest.set(a.entryId, a);
          }
          const data = { entries: [], documents: {} };
          const archives = [...latest.values()];
          const prepared = new Array(archives.length);
          let next = 0;
          await Promise.all(Array.from({ length: Math.min(4, archives.length) }, async () => {
            while (next < archives.length) {
              const index = next++;
              prepared[index] = await browser.prepare(archives[index]);
            }
          }));
          for (const item of prepared) {
            data.entries.push(item.entry); Object.assign(data.documents, item.documents);
          }
          await authenticate(req);
          data.entries = (await Promise.all(data.entries.map(async entry => ({ entry, hidden: Boolean((await store.get('trash', entry.id))?.deletedAt) })))).filter(item => !item.hidden).map(item => item.entry);
          const visiblePaths = new Set(data.entries.flatMap(entry => entry.files.map(file => file.path)));
          data.documents = Object.fromEntries(Object.entries(data.documents).filter(([key]) => visiblePaths.has(key)));
          return send(res, 200, data);
        }
        const asset = route.match(/^\/library\/files\/([a-f0-9]{64})\/(.+)$/);
        const download = route.match(/^\/library\/bundle\/([a-f0-9]{64})$/);
        requireValue(asset || download, 'Not found', 404);
        const archive = await store.get('archive', asset?.[1] || download?.[1]);
        await readable(archive);
        if (download) {
          const bytes = await storage.get(archive.key);
          await authenticate(req);
          await readable(archive);
          requireValue(hash(bytes) === archive.id, 'Archive checksum mismatch', 500);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', 'attachment; filename="archive.json"');
          return res.end(bytes);
        }
        const relative = decodeURIComponent(asset[2]);
        const bytes = await browser.file(archive, relative);
        await authenticate(req);
        await readable(archive);
        const ext = path.extname(relative).toLowerCase();
        res.setHeader('Content-Type', ({ '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.avif':'image/avif', '.pdf':'application/pdf' })[ext] || 'text/plain; charset=utf-8');
        return res.end(bytes);
      }
      if (!route.startsWith('/api/')) {
        const files = {
          '/': ['public/index.html', 'text/html; charset=utf-8'],
          '/login': ['public/index.html', 'text/html; charset=utf-8'],
          '/login/': ['public/index.html', 'text/html; charset=utf-8'],
          '/download': ['public/download.html', 'text/html; charset=utf-8'],
          '/download/': ['public/download.html', 'text/html; charset=utf-8'],
          '/download.css': ['public/download.css', 'text/css; charset=utf-8'],
          '/worker-download.css': ['public/worker-download.css', 'text/css; charset=utf-8'],
          '/download.js': ['public/download.js', 'text/javascript; charset=utf-8'],
          '/brand-icon.png': ['public/brand-icon.png', 'image/png'],
          '/brand.css': ['public/brand.css', 'text/css; charset=utf-8'],
          '/client-prompt.js': ['../assets/client-prompt.js', 'text/javascript; charset=utf-8'],
          '/client-prompt.css': ['../assets/client-prompt.css', 'text/css; charset=utf-8'],
          '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
          '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
          '/pairing-dialog.css': ['public/pairing-dialog.css', 'text/css; charset=utf-8'],
          '/library-frame.css': ['public/library-frame.css', 'text/css; charset=utf-8'],
          '/authorize': ['public/authorize.html', 'text/html; charset=utf-8'],
          '/authorize.js': ['public/authorize.js', 'text/javascript; charset=utf-8'],
          '/device-identity.js': ['public/device-identity.js', 'text/javascript; charset=utf-8'],
          '/browser-session.js': ['public/browser-session.js', 'text/javascript; charset=utf-8'],
          '/web-login.js': ['public/web-login.js', 'text/javascript; charset=utf-8'],
          '/device-view.js': ['public/device-view.js', 'text/javascript; charset=utf-8'],
          '/authorize.css': ['public/authorize.css', 'text/css; charset=utf-8'],
          '/security': ['public/security.html', 'text/html; charset=utf-8'],
          '/security.js': ['public/security.js', 'text/javascript; charset=utf-8'],
          '/security.css': ['public/security.css', 'text/css; charset=utf-8'],
          '/vendor/lucide.js': ['../assets/vendor/lucide.js', 'text/javascript'],
          '/vendor/marked.js': ['../assets/vendor/marked.js', 'text/javascript'],
          '/vendor/purify.js': ['../assets/vendor/purify.js', 'text/javascript'],
        };
        requireValue(req.method === 'GET' && files[route], 'Not found', 404);
        res.setHeader('Content-Type', files[route][1]);
        return res.end(fs.readFileSync(path.join(project, files[route][0])));
      }
      if (req.method === 'POST' && route === '/api/pair') {
        if (req.headers.origin) sameOrigin(req);
        const ip = req.socket.remoteAddress;
        if (attempts.size > 10000) attempts.clear();
        const attempt = attempts.get(ip);
        const record = attempt && clock() - attempt.at < 60000 ? attempt : { at: clock(), count: 0 };
        attempts.set(ip, record);
        requireValue(++record.count <= 10, 'Too many pairing attempts; retry in a minute', 429);
        const input = await body(req);
        text(input.key, 'pairing key', 200);
        text(input.name, 'device name', 100);
        const clientType = pairingClient(input);
        const clientRole = ['worker', 'desktop'].includes(clientType) ? 'worker' : 'owner';
        return await serialized(`pair:${hash(input.key)}`, async () => {
          const pairing = await store.get('pairing', hash(input.key));
          if (!pairing) {
            const prepared = await metadata(input);
            const browserLogin = clientType === 'web' && clientRole === 'owner' && req.headers.origin && req.headers.authorization === undefined
              && (!prepared.deviceInfo || prepared.deviceInfo.client.type === 'web')
              && (!prepared.identity || prepared.identity.source === 'browser-profile')
              && !['desktop', 'mobile'].includes(deviceCategory({ role: 'owner', ...input, clientType }));
            const profile = installationKey(input, clientRole);
            const result = await serialized(`installation:${profile || secret()}`, () => security.login(input, {
              trusted: async (state, tx) => {
                // Metadata updates lock the policy before the device; use the same order.
                if (prepared.identity) await tx.getForUpdate('setting', 'device-identity-v2');
                return browserLogin && trust.find(tx, state, cookieValue(req, trustCookie), profile);
              },
              complete: async (state, tx) => {
                const enrolled = await enroll(input.name, input.clientType ? clientRole : 'owner', { ...input, clientType }, tx, prepared);
                if (state.totp && browserLogin && profile && enrolled.device.category === 'browser') {
                  await trust.issue(tx, state, await tx.get('device', enrolled.device.id), res);
                }
                return enrolled;
              },
            }));
            if (!result) throw Object.assign(new Error('Invalid or expired pairing key'), { status: 401, code: 'credential_invalid' });
            if (result.device.category === 'browser') sessions.cookie(res, result.token);
            return send(res, 201, result);
          }
          requireValue(pairing && !pairing.usedAt && Date.parse(pairing.expiresAt) > Date.now(), 'Invalid or expired pairing key', 401);
          const creator = await store.get('device', pairing.creatorId);
          requireValue(creator && !creator.revokedAt, 'Pairing issuer revoked', 401);
          requireValue(!pairing.role || clientType !== 'desktop', 'Generate a new universal pairing code for the desktop', 400);
          requireValue(!pairing.role || !input.clientType || pairing.role === clientRole, 'Pairing code does not match this client; generate a universal code', 400);
          const enrolled = await enroll(input.name, pairing.role || clientRole, { ...input, clientType: pairing.role === 'worker' && !input.clientType ? 'worker' : clientType });
          pairing.usedAt = now();
          await store.put('pairing', pairing);
          if (enrolled.device.category === 'browser') sessions.cookie(res, enrolled.token);
          return send(res, 201, enrolled);
        });
      }
      if (route === '/api/browser-session/logout' && req.method === 'POST') {
        if (req.headers.cookie?.includes(browserCookie + '=')) sameOrigin(req);
        try { await sessions.logout(await authenticate(req)); } catch (error) { if (error.status !== 401) throw error; }
        sessions.clear(res); return send(res, 200, { loggedOut: true });
      }
      const device = await authenticate(req);
      if (route.startsWith('/api/browser-trust')) {
        owner(device);
        requireValue(deviceCategory(device) === 'browser' && req.headers.authorization === undefined && cookieValue(req, browserCookie), 'Browser cookie session required', 403);
        if (route === '/api/browser-trust' && req.method === 'GET') return send(res, 200,
          await security.transaction(async (state, tx) => trust.status(await trust.find(tx, state, cookieValue(req, trustCookie), device.installationKey, device.id))));
        sameOrigin(req);
        if (route === '/api/browser-trust/bootstrap' && req.method === 'POST') {
          const input = await body(req);
          installationKey(input, 'owner'); await metadata(input);
          return send(res, 200, await security.transaction((state, tx) => trust.bootstrap(tx, state, device, input, cookieValue(req, trustCookie), res)));
        }
        if (route === '/api/browser-trust/forget' && req.method === 'POST') return send(res, 200,
          await security.transaction((state, tx) => trust.forget(tx, device, res)));
        fail('Not found', 404);
      }
      if (route.startsWith('/api/browser-session')) {
        owner(device);
        requireValue(deviceCategory(device) === 'browser', 'Browser session required', 403);
        if (route === '/api/browser-session' && req.method === 'GET') return send(res, 200, publicDevice(device));
        if (route === '/api/browser-session/activity' && req.method === 'POST') {
          const current = await sessions.activity(device, req.authToken, res);
          if (req.headers.authorization === undefined && cookieValue(req, browserCookie)) await security.transaction(async (state, tx) => {
            const live = await tx.getForUpdate('device', current.id);
            if (live && live.tokenHash === current.tokenHash && browserValid(live, clock())) await trust.renew(tx, state, live, cookieValue(req, trustCookie), res);
          });
          return send(res, 200, publicDevice(current));
        }
        fail('Not found', 404);
      }
      if (route.startsWith('/api/read/v1/')) {
        requireValue(['reader', 'owner'].includes(device.role), 'Reader permission required', 403);
        if (await readApi.handle(req, res, url, device)) return;
        fail('Not found', 404);
      }
      // Reader tokens may never reach legacy management, upload or worker routes.
      requireValue(device.role !== 'reader', 'Read-only authorization', 403);
      if (route.startsWith('/api/security')) {
        owner(device);
        if (route === '/api/security' && req.method === 'GET') return send(res, 200, await security.status());
        requireValue(req.method === 'POST' && route.startsWith('/api/security/'), 'Not found', 404);
        const action = route.slice('/api/security/'.length);
        const result = await security.operation(action, await body(req), device);
        if (['credential', 'totp/confirm', 'totp/disable'].includes(action)) trust.clear(res);
        return send(res, 200, result);
      }
      if (route === '/api/devices/me/info' && req.method === 'POST') {
        const input = await body(req);
        const updated = await updateDevice(device, input, { lastSeen: now() });
        return send(res, 200, publicDevice(updated));
      }
      if (route === '/api/trash' && req.method === 'GET') {
        owner(device);
        return send(res, 200, (await store.list('trash')).filter(item => item.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)));
      }
      const removal = route.match(/^\/api\/archives\/([a-f0-9]{64})(\/restore)?$/);
      if (removal && (req.method === 'DELETE' || (req.method === 'POST' && removal[2]))) {
        owner(device);
        const archive = await store.get('archive', removal[1]);
        requireValue(archive, 'Archive not found', 404);
        const restore = Boolean(removal[2]);
        await store.put('trash', { id: archive.entryId, archiveId: archive.id, title: archive.meta.title, deletedAt: restore ? null : now(), deviceId: device.id });
        void readApi.refresh().catch(() => {});
        return send(res, 200, { deleted: !restore });
      }
      if (route === '/api/state' && req.method === 'GET') {
        owner(device);
        const archives = [];
        for (const archive of await store.list('archive')) if (!(await deleted(archive))) archives.push(archive);
        const devices = await Promise.all((await store.list('device')).filter(d => !d.revokedAt).map(d => sessions.ensure(d)));
        return send(res, 200, { me: publicDevice(device), devices: devices.filter(Boolean).map(publicDevice), tasks: (await store.list('task')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), archives: archives.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
      }
      if (route === '/api/pairings' && req.method === 'POST') {
        owner(device);
        const input = await body(req);
        requireValue(input.role === undefined || ['owner', 'worker'].includes(input.role), 'Invalid device role');
        const key = secret();
        const pairing = await store.put('pairing', { id: hash(key), role: input.role || null, creatorId: device.id, expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), usedAt: null });
        let qrDataUrl = null;
        if (input.role !== 'worker') {
          const scheme = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
          const server = publicUrl ? new URL(publicUrl).origin : new URL(scheme + '//' + req.headers.host).origin;
          // Keep the v1 QR marker readable by already-installed mobile clients.
          const payload = JSON.stringify({ protocol: 'personal-library-pairing', version: 1, server, key, role: 'owner', expiresAt: pairing.expiresAt });
          qrDataUrl = await QRCode.toDataURL(payload, { width: 420, margin: 4, errorCorrectionLevel: 'M' });
        }
        return send(res, 201, { key, expiresAt: pairing.expiresAt, qrDataUrl });
      }
      const revoke = route.match(/^\/api\/devices\/([^/]+)\/revoke$/);
      if (revoke && req.method === 'POST') {
        owner(device);
        const target = await store.get('device', revoke[1]);
        requireValue(target, 'Device not found', 404);
        await security.transaction(async (state, tx) => {
          await tx.delete('device', target.id);
          for (const proof of await tx.list('browser-trust')) if (proof.deviceId === target.id) await tx.delete('browser-trust', proof.id);
        });
        return send(res, 200, { revoked: true });
      }
      if (route === '/api/heartbeat' && req.method === 'POST') {
        worker(device);
        const input = await body(req);
        requireValue(Array.isArray(input.capabilities) && input.capabilities.every(x => types.includes(x)), 'Invalid capabilities');
        requireValue(Array.isArray(input.agents) && input.agents.every(x => ['codex', 'codebuddy'].includes(x)), 'Invalid agents');
        await updateDevice(device, input, { lastSeen: now(), lastHeartbeatAt: new Date(clock()).toISOString(), capabilities: [...new Set(input.capabilities)], agents: [...new Set(input.agents)] });
        return send(res, 200, { tasks: (await store.list('task')).filter(t => t.deviceId === device.id).map(t => ({ id: t.id, state: t.state })) });
      }
      if (route === '/api/tasks' && req.method === 'POST') {
        owner(device);
        const input = await body(req);
        const rawSubmission = Object.hasOwn(input, 'content');
        if (rawSubmission) text(input.content, 'collection content', 10000);
        const content = rawSubmission ? input.content : null;
        const source = rawSubmission ? null : sourceURL(text(input.url, 'URL', 4000));
        const taskType = input.type ?? 'auto';
        requireValue(taskType === 'auto' || types.includes(taskType), 'Invalid task type');
        const autoArchive = input.autoArchive ?? true;
        requireValue(typeof autoArchive === 'boolean', 'Invalid auto archive setting');
        const tags = input.tags ?? [];
        requireValue(Array.isArray(tags) && tags.length <= 20 && tags.every(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 60), 'Invalid tags');
        const preferredDeviceId = input.deviceId || null;
        if (preferredDeviceId) {
          const target = await store.get('device', preferredDeviceId);
          requireValue(target && workerAuthorized(target), 'Invalid dispatch device');
        }
        requireValue(!input.agent || ['codex', 'codebuddy'].includes(input.agent), 'Unknown agent');
        requireValue(!input.scenario || (typeof input.scenario === 'string' && input.scenario.length <= 10000), 'Invalid scenario');
        const submissionId = text(input.submissionId, 'submission ID', 100);
        return await serialized(`submission:${submissionId}`, async () => {
          const existing = (await store.list('task')).find(t => t.submissionId === submissionId);
          if (existing) {
            requireValue((existing.content ?? null) === content && existing.url === (source?.href || null) && existing.scenario === (input.scenario?.trim() || null) && existing.type === taskType && existing.preferredAgent === (input.agent || null) && (existing.autoArchive ?? true) === autoArchive && JSON.stringify(existing.tags || []) === JSON.stringify(tags) && (existing.preferredDeviceId || null) === preferredDeviceId, 'Submission ID already used', 409);
            return send(res, 200, existing);
          }
          const task = { id: id(), submissionId, content, url: source?.href || null, type: taskType, autoArchive, tags, preferredDeviceId, scenario: input.scenario?.trim() || null, preferredAgent: input.agent || null, deviceId: null, archiveId: null, createdAt: now() };
          return send(res, 201, await saveTask(task, 'queued', '等待可用电脑'));
        });
      }
      if (route === '/api/claim' && req.method === 'POST') {
        worker(device);
        requireValue(workerOnline(device, clock()), 'Heartbeat required', 409);
        return await serialized('claim', async () => {
          const tasks = await store.list('task');
          let task = tasks.find(t => t.deviceId === device.id && active.includes(t.state));
          if (!task && device.agents.length && !tasks.some(t => t.deviceId === device.id && t.state === 'waiting_action')) {
            task = tasks.filter(t => !t.deviceId && t.state === 'queued' && (t.type === 'auto' ? device.capabilities.length > 0 : device.capabilities.includes(t.type)) && (!t.preferredDeviceId || t.preferredDeviceId === device.id) && (!t.preferredAgent || device.agents.includes(t.preferredAgent))).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
            if (task) task = await saveTask({ ...task, deviceId: device.id }, 'assigned', `已分配给 ${device.name}`);
          }
          return send(res, 200, { task: task || null });
        });
      }
      const draftRoute = route.match(/^\/api\/tasks\/([^/]+)\/draft$/);
      if (draftRoute && req.method === 'GET') {
        owner(device);
        const task = await store.get('task', draftRoute[1]);
        requireValue(task?.state === 'awaiting_review', 'No pending review', 409);
        const draft = await store.get('draft', task.draftId);
        requireValue(draft, 'Draft not found', 404);
        const buffer = await storage.get(draft.key);
        await authenticate(req);
        requireValue((await store.get('task', task.id))?.state === 'awaiting_review', 'No pending review', 409);
        requireValue(hash(buffer) === draft.id, 'Draft checksum mismatch', 500);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(buffer);
      }
      const taskRoute = route.match(/^\/api\/tasks\/([^/]+)\/(progress|result|retry|cancel|approve)$/);
      if (taskRoute && req.method === 'POST') {
        const [, taskId, action] = taskRoute;
        const input = await body(req);
        if (action === 'approve') {
          owner(device);
          const task = await store.get('task', taskId);
          requireValue(task, 'Task not found', 404);
          if (task.state === 'completed') return send(res, 200, task);
          requireValue(task.state === 'awaiting_review', 'Invalid task transition', 409);
          const draft = await store.get('draft', task.draftId);
          requireValue(draft, 'Draft not found', 404);
          const result = await store.transaction(async tx => {
            await tx.put('archive', draft);
            return saveTask({ ...task, archiveId: draft.id }, 'completed', '用户已确认归档', tx);
          });
          void readApi.refresh().catch(() => {});
          return send(res, 200, result);
        }
        if (action === 'retry' || action === 'cancel') {
          owner(device);
          const task = await store.get('task', taskId);
          requireValue(task, 'Task not found', 404);
          requireValue(action === 'cancel' ? task.state !== 'completed' : ['waiting_action', 'failed'].includes(task.state), 'Invalid task transition', 409);
          return send(res, 200, await saveTask(task, action === 'cancel' ? 'cancelled' : task.deviceId ? 'assigned' : 'queued', action === 'cancel' ? '用户取消' : '等待原电脑继续'));
        }
        const task = await assigned(device, taskId);
        if (action === 'result') return send(res, 200, await publish(input, device, req, taskId));
        requireValue(active.includes(task.state), 'Task is not running', 409);
        requireValue(['running', 'uploading', 'waiting_action', 'failed'].includes(input.state), 'Invalid task state');
        return send(res, 200, await saveTask({ ...task, agent: input.agent || task.agent || null }, input.state, text(input.message, 'progress message', 1000)));
      }
      if (route === '/api/archives' && req.method === 'POST') {
        requireValue(['owner', 'worker'].includes(device.role), 'Archive publisher permission required', 403);
        return send(res, 201, await publish(await body(req), device, req));
      }
      const archiveRoute = route.match(/^\/api\/archives\/([a-f0-9]{64})$/);
      if (archiveRoute && req.method === 'GET') {
        const archive = await store.get('archive', archiveRoute[1]);
        await readable(archive);
        const buffer = await storage.get(archive.key);
        await readable(archive);
        await authenticate(req);
        requireValue(hash(buffer) === archive.id, 'Stored archive checksum mismatch', 500);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(buffer);
      }
      fail('Not found', 404);
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 500, { ...(req.url.startsWith('/api/read/v1/') ? { schema_version: 1 } : {}), ...(['mfa_required', 'mfa_invalid', 'credential_invalid'].includes(error.code) ? { code: error.code } : {}), error: error.status ? error.message : 'Internal service error' });
      else res.end();
      if (!error.status) console.error(error.name, error.code || 'request_failed');
    }
  });
  server.requestTimeout = 120000;
  return { server, store, close: () => new Promise((resolve, reject) => { server.close(() => readApi.close().then(() => store.close()).then(resolve, reject)); server.closeIdleConnections(); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = path.resolve(process.env.COLLECTOR_DATA || path.join(project, 'data'));
  fs.mkdirSync(dataDir, { recursive: true });
  const keyFile = path.join(dataDir, 'admin-key.txt');
  if (!process.env.COLLECTOR_MASTER_KEY && !fs.existsSync(keyFile)) fs.writeFileSync(keyFile, secret(), { mode: 0o600, flag: 'wx' });
  const masterKey = process.env.COLLECTOR_MASTER_KEY || fs.readFileSync(keyFile, 'utf8').trim();
  const storage = process.env.OSS_BUCKET ? new OssStorage({ region: process.env.OSS_REGION, bucket: process.env.OSS_BUCKET, accessKeyId: process.env.OSS_ACCESS_KEY_ID, accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET, stsToken: process.env.OSS_STS_TOKEN, internal: process.env.OSS_INTERNAL === 'true' }) : new LocalStorage(path.join(dataDir, 'objects'));
  const store = process.env.MYSQL_URL ? await MySqlStore.connect(process.env.MYSQL_URL) : new Store(path.join(dataDir, 'state.sqlite'));
  for (const device of await store.list('device')) if (device.revokedAt) await store.delete('device', device.id);
  const app = createService({ dataDir, masterKey, storage, store });
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4317);
  app.server.listen(port, host, () => console.log(`Collector: http://${host}:${port}\nStorage: ${process.env.OSS_BUCKET ? 'OSS' : 'local'}\nAdmin key: ${process.env.COLLECTOR_MASTER_KEY ? 'environment' : keyFile}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit()));
}
