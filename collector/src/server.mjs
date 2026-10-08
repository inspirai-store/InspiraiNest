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
import { deviceMetadata, publicDeviceMetadata, publicDevices, clientRuntime, deviceCategory, workerAuthorized, workerOnline } from './device-metadata.mjs';
import { createClientUpdateService, updateBlocksTasks } from './client-update-service.mjs';
import { browserSessions, browserCookie, browserValid } from './browser-session.mjs';
import { accountSecurity } from './account-security.mjs';
import { browserTrust, trustCookie, cookieValue } from './browser-trust.mjs';
import { createSkillService, taskCapabilities } from './skill-service.mjs';
import QRCode from 'qrcode';
import { createSkillHubClient } from './skillhub.mjs';
import { createAgentService } from './agent-service.mjs';
import { canRunTask, nodeFailureCodes, releaseTask } from './task-routing.mjs';
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

export function createService({ dataDir, masterKey, storage = new LocalStorage(path.join(dataDir, 'objects')), store = new Store(path.join(dataDir, 'state.sqlite')), releaseDir = process.env.COLLECTOR_RELEASE_DIR || path.join(project, 'mobile/dist'), publicUrl = process.env.COLLECTOR_PUBLIC_URL, reviewExpiresAt = process.env.COLLECTOR_REVIEW_EXPIRES_AT, clock = Date.now, skillHub = createSkillHubClient({ apiKey:process.env.SKILLHUB_API_KEY }), agentCatalog }) {
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
  const clientUpdates = createClientUpdateService({ store, serialized, owner, worker, body, send, clock, releases:download.workerReleases });
  const readApi = createReadApi({ dataDir, store, browser, publicUrl, authenticate, send });
  const readerAuth = readerAuthorization({ store, authenticate, serialized, publicUrl, body, send });
  const skills = createSkillService({ store, storage, serialized, updateDevice, owner, worker, body, send, clock });
  const agents = createAgentService({ store, serialized, owner, worker, body, send, clock, catalog: agentCatalog, deploymentId: async () => (await identityPolicy()).namespace });
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
    const duplicate = (await tx.list('device')).some(d => d.id !== deviceId && !d.revokedAt && !d.canonicalDeviceId
      && d.identity?.digest === data.identity.digest && d.identity?.namespace === data.identity.namespace
      && (deviceCategory(d) === 'desktop' && deviceCategory({ ...data, clientType }) === 'desktop'
        || (d.deviceInfo?.client.type || d.clientType) === (data.deviceInfo?.client.type || clientType)));
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
      const credential = device.credentialId ? await tx.getForUpdate('device', device.credentialId) : record;
      requireValue(credential && !credential.revokedAt && (!device.credentialTokenHash
        || [credential.tokenHash, credential.ownerTokenHash].includes(device.credentialTokenHash))
        && (!credential.canonicalDeviceId || credential.canonicalDeviceId === record.id), 'Device authorization required', 401);
      const alias = Boolean(credential.canonicalDeviceId);
      const boundKey = alias ? installationKey(input, credential.role) : key;
      const category = deviceCategory(record);
      if (data.deviceInfo) requireValue(category === 'unknown' || (category === 'desktop' ? ['desktop', 'worker', ...(record.clientType === 'web' ? ['web'] : [])].includes(data.deviceInfo.client.type)
        : category === 'mobile' ? ['android', 'ios'].includes(data.deviceInfo.client.type) : data.deviceInfo.client.type === 'web'), 'Client category cannot be changed', 409);
      requireValue(!credential.installationKey || !boundKey || boundKey === credential.installationKey, 'Installation ID does not match this authorization', 409);
      if (boundKey) requireValue(!(await tx.list('device')).some(d => d.id !== record.id && d.id !== credential.id && !d.canonicalDeviceId && d.installationKey === boundKey), 'Installation already paired; use the current authorization', 409);
      requireValue(!record.identity || !data.identity || record.identity.digest === data.identity.digest
        && record.identity.namespace === data.identity.namespace && record.identity.source === data.identity.source,
      'Device identity changed; confirm a new pairing', 409);
      // Existing legacy records remain usable until the desktop proves both
      // credentials. Only establishing an identity needs a duplicate check.
      if (!record.identity) await identityConflict(tx, data, record.id, record.clientType);
      const updated = { ...record, ...changes, ...data, installationKey: alias ? record.installationKey : key || record.installationKey || null,
        platform: input.platform ? text(input.platform, 'platform', 40) : record.platform || null,
        system: input.system ? text(input.system, 'system', 100) : record.system || null };
      if (category === 'unknown') { delete updated.category; Object.assign(updated, sessions.fields(updated)); }
      return tx.put('device', updated);
    }));
  }
  async function unifyClient(actor, input) {
    owner(actor);
    requireValue(deviceCategory(actor) === 'desktop', '仅电脑客户端可以迁移旧客户端身份', 403);
    requireValue(input && Object.keys(input).every(key => ['workerDeviceId', 'workerToken', 'installationId', 'identity', 'deviceInfo'].includes(key))
      && typeof input.workerDeviceId === 'string' && typeof input.workerToken === 'string' && input.workerToken.length <= 200, '客户端迁移请求无效');
    const data = await metadata(input), key = installationKey(input, 'worker');
    return serialized('client-identity', () => store.transaction(async tx => {
      await tx.getForUpdate('setting', 'device-identity-v2');
      const target = await tx.getForUpdate('device', input.workerDeviceId);
      const credential = await tx.getForUpdate('device', actor.credentialId || actor.id);
      requireValue(target && workerAuthorized(target) && target.tokenHash === hash(input.workerToken)
        && credential && !credential.revokedAt && credential.role === (credential.ownerTokenHash === actor.credentialTokenHash ? 'worker' : 'owner')
        && [credential.tokenHash, credential.ownerTokenHash].includes(actor.credentialTokenHash), '客户端授权已失效', 401);
      // Old Worker configurations retain the installation ID only in the data
      // directory. Both credentials and the full hardware identity prove the
      // client; preserve its existing binding when no ID was supplied.
      requireValue(deviceCategory(credential) === 'desktop' && (!target.installationKey || !key || target.installationKey === key), '客户端安装身份不匹配', 409);
      if (credential.id === target.id || credential.canonicalDeviceId === target.id) return { device: publicDevice(target), unified: true };
      requireValue(!credential.canonicalDeviceId, '旧授权已属于另一客户端', 409);
      const matches = identity => identity && data.identity && identity.digest === data.identity.digest
        && identity.namespace === data.identity.namespace && identity.source === data.identity.source;
      requireValue(['smbios', 'ioplatform'].includes(data.identity?.source) && matches(target.identity)
        && (!credential.identity || matches(credential.identity)), '两份旧授权不属于同一台电脑，请重新登录客户端', 409);
      // Retain the node ID, name, Worker credential, heartbeats and task ownership.
      // The old encrypted credential becomes a compatibility alias, with its
      // original limited scope and installation binding; it never grants upload.
      const client = await tx.put('device', { ...target, clientType: 'desktop', clientIdentityVersion: 1 });
      await tx.put('device', { ...credential, canonicalDeviceId: client.id, clientIdentityVersion: 1 });
      return { device: publicDevice(client), unified: true };
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
    let credential;
    if (device?.canonicalDeviceId) {
      credential = device;
      device = await store.get('device', credential.canonicalDeviceId);
      requireValue(credential.role === 'owner' && device && !device.revokedAt && !device.canonicalDeviceId
        && deviceCategory(device) === 'desktop', 'Device authorization required', 401);
    }
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
    const actor = { ...device, credentialId: credential?.id || device.id, credentialTokenHash: hash(token) };
    return credential || device.ownerTokenHash === hash(token) ? { ...actor, deviceRole: device.role, role: 'owner' } : actor;
  }
  function owner(device) { requireValue(device.role === 'owner', 'Owner permission required', 403); }
  function worker(device) { requireValue(workerAuthorized(device), 'Worker permission required', 403); }
  function sameOrigin(req) {
    const origin = publicUrl ? new URL(publicUrl).origin : `${req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
    requireValue(req.headers.origin === origin, 'Origin not allowed', 403);
  }
  function checkAssignment(device, task, req) {
    requireValue(task && task.deviceId === device.id, 'Task not assigned to this device', 403);
    requireValue(!task.assignmentId || req?.headers['x-task-assignment'] === task.assignmentId, 'Task assignment has changed', 409);
  }
  async function assigned(device, taskId, req) {
    worker(device);
    const task = await store.get('task', taskId);
    checkAssignment(device, task, req);
    return task;
  }
  async function reroute(task, reason, message, target = store, { manual = false } = {}) {
    const released = releaseTask(task, reason, message, new Date(clock()).toISOString());
    const alternatives = (await target.list('device')).filter(d => canRunTask(released, d));
    if (!alternatives.length) {
      requireValue(!manual, '没有其他能力匹配的授权节点，请先授权或配置另一台电脑', 409);
      return saveTask({ ...task, failedDeviceIds: released.failedDeviceIds, failover: { ...released.failover, exhausted: true } }, 'waiting_action',
        `${message}；没有其他尚未尝试且能力匹配的节点，请修复后继续或切换节点`, target);
    }
    return saveTask(released, 'queued', `${message}；等待其他能力匹配的节点接手（原电脑成果保留）`, target);
  }
  async function recoverUnavailableTasks() {
    return serialized('claim', async () => {
      for (const candidate of await store.list('task')) {
        if (!['assigned', 'running'].includes(candidate.state) || !candidate.deviceId) continue;
        const node = await store.get('device', candidate.deviceId);
        // Older clients cannot fence a previous attempt. Leave their offline work
        // intact; current clients stop when their assignment disappears on heartbeat.
        if (node && !node.revokedAt && (!candidate.assignmentId || clock() - Date.parse(node.lastHeartbeatAt || candidate.updatedAt) < 120000)) continue;
        await store.transaction(async tx => {
          const liveNode = await tx.getForUpdate('device', candidate.deviceId);
          const live = await tx.getForUpdate('task', candidate.id);
          if (!live || live.deviceId !== candidate.deviceId || !['assigned', 'running'].includes(live.state)) return;
          if (liveNode && !liveNode.revokedAt && (!live.assignmentId || clock() - Date.parse(liveNode.lastHeartbeatAt || live.updatedAt) < 120000)) return;
          await reroute(live, 'NODE_OFFLINE', '原工作节点超过两分钟未报告心跳或授权已失效', tx);
        });
      }
    });
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
      let previousBrowser, previousClient;
      if (key) for (const old of await tx.list('device')) {
        if (old.installationKey !== key || old.canonicalDeviceId) continue;
        if (deviceCategory(old) === 'browser' && category === 'browser') { previousBrowser = old; continue; }
        const busy = (await tx.list('task')).some(task => task.deviceId === old.id && [...active, 'waiting_action', 'queued'].includes(task.state));
        requireValue(!busy, 'This computer has an unfinished task; resume or cancel it before pairing again', 409);
        if (deviceCategory(old) === 'desktop' && category === 'desktop') previousClient = old;
        else await tx.delete('device', old.id);
      }
      await identityConflict(tx, data, previousBrowser?.id || previousClient?.id, input.clientType);
      const previous = previousClient || previousBrowser;
      const record = { ...previousClient, id: previous?.id || id(), name: previous?.name || text(name, 'device name', 100), role, clientType: previousClient?.clientType === 'desktop' ? 'desktop' : input.clientType || (role === 'worker' ? 'worker' : 'web'), tokenHash: hash(token), ...(ownerToken ? { ownerTokenHash: hash(ownerToken) } : {}), installationKey: key, platform, system, ...data, createdAt: previous?.createdAt || now(), lastSeen: now(), lastHeartbeatAt: null, revokedAt: null, capabilities: previousClient?.capabilities || [], agents: previousClient?.agents || [],
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
    const taskRecord = taskId ? await assigned(device, taskId, req) : null;
    if (taskRecord?.tags?.length) bundle = { ...bundle, meta: { ...bundle.meta, tags: [...new Set([...(bundle.meta?.tags || []), ...taskRecord.tags])] } };
    validateArchive(bundle);
    requireReadableMetadata(bundle.meta);
    const buffer = Buffer.from(JSON.stringify(bundle));
    const digest = hash(buffer);
    if (taskId) {
      const task = await assigned(device, taskId, req);
      if (task.state === 'completed' && task.archiveId === digest) return store.get('archive', digest);
      if (task.state === 'awaiting_review' && task.draftId === digest) return store.get('draft', digest);
      requireValue(active.includes(task.state), 'Task is not running', 409);
    }
    const key = `archives/${digest}.json`;
    await storage.put(key, buffer);
    // A revoked worker or cancelled task cannot commit a result after an in-flight upload.
    await authenticate(req);
    const record = { id: digest, entryId: bundle.meta.id, meta: bundle.meta, key, deviceId: device.id, createdAt: now(), omittedCount: bundle.omitted?.length || 0 };
    const commit = async tx => {
      const liveDevice = await tx.getForUpdate('device', device.id);
      requireValue(liveDevice && !liveDevice.revokedAt && liveDevice.tokenHash === device.tokenHash, 'Device authorization required', 401);
      const task = taskId ? await tx.getForUpdate('task', taskId) : null;
      if (taskId) {
        checkAssignment(device, task, req);
        if (task.state === 'completed' && task.archiveId === digest) return tx.get('archive', digest);
        if (task.state === 'awaiting_review' && task.draftId === digest) return tx.get('draft', digest);
        requireValue(active.includes(task.state), 'Task is no longer running', 409);
      }
      if (task?.autoArchive === false) {
        const draft = await tx.put('draft', record);
        await saveTask({ ...task, draftId: digest }, 'awaiting_review', '分析结果已上传，等待确认归档', tx);
        return draft;
      }
      const archive = (await tx.get('archive', digest)) || await tx.put('archive', record);
      if (taskId) await saveTask({ ...task, archiveId: digest }, 'completed', '归档校验完成，资料已上传', tx);
      return archive;
    };
    const result = await serialized('claim', () => store.transaction(commit));
    if (!taskRecord || taskRecord.autoArchive !== false) void readApi.refresh().catch(() => {});
    return result;
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
        '/node-presentation.js': ['public/node-presentation.js', 'text/javascript; charset=utf-8'],
        '/node-name-editor.js': ['public/node-name-editor.js', 'text/javascript; charset=utf-8'],
        '/node-presentation.css': ['public/node-presentation.css', 'text/css; charset=utf-8'],
        '/client-update-manager.js': ['public/client-update-manager.js', 'text/javascript; charset=utf-8'],
        '/client-update-manager.css': ['public/client-update-manager.css', 'text/css; charset=utf-8'],
          '/skill-market.js': ['public/skill-market.js', 'text/javascript; charset=utf-8'],
          '/skill-market.css': ['public/skill-market.css', 'text/css; charset=utf-8'],
          '/skill-manager.js': ['public/skill-manager.js', 'text/javascript; charset=utf-8'],
          '/skill-manager.css': ['public/skill-manager.css', 'text/css; charset=utf-8'],
          '/agent-manager.js': ['public/agent-manager.js', 'text/javascript; charset=utf-8'],
          '/agent-manager.css': ['public/agent-manager.css', 'text/css; charset=utf-8'],
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
      if (route === '/api/skillhub') {
        owner(device);
        requireValue(req.method === 'GET', 'Method not allowed', 405);
        return send(res, 200, await skillHub.request(Object.fromEntries(url.searchParams)));
      }
      if (await skills.handle(req, res, route, device)) return;
      if (await agents.handle(req, res, route, device)) return;
      if (await clientUpdates.handle(req, res, route, device)) return;
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
      if (route === '/api/devices/me/unify-client' && req.method === 'POST') return send(res, 200, await unifyClient(device, await body(req)));
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
        await recoverUnavailableTasks();
        const archives = [];
        for (const archive of await store.list('archive')) if (!(await deleted(archive))) archives.push(archive);
        const devices = await Promise.all((await store.list('device')).filter(d => !d.revokedAt).map(d => sessions.ensure(d)));
        return send(res, 200, { me: publicDevice(device), devices: publicDevices(devices.filter(Boolean),clock()), tasks: (await store.list('task')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), archives: archives.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
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
      const renameNode = route.match(/^\/api\/devices\/([^/]+)\/name$/);
      if (renameNode && req.method === 'POST') {
        owner(device);
        const input = await body(req);
        requireValue(input && Object.keys(input).length === 1 && typeof input.name === 'string', '只允许修改节点名称');
        const name = input.name.trim();
        requireValue(name.length > 0 && name.length <= 80 && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name), '节点名称须为 1–80 个字符，不含换行或控制字符');
        const updated = await serialized(`device:${renameNode[1]}`, () => store.transaction(async tx => {
          const target = await tx.getForUpdate('device', renameNode[1]);
          requireValue(target && !target.revokedAt, '节点不存在或授权已撤销', 404);
          requireValue(workerAuthorized(target), '只能修改已授权工作节点的名称', 409);
          return tx.put('device', { ...target, name });
        }));
        return send(res, 200, publicDevice(updated));
      }
      const revoke = route.match(/^\/api\/devices\/([^/]+)\/revoke$/);
      if (revoke && req.method === 'POST') {
        owner(device);
        const requested = await store.get('device', revoke[1]);
        const target = requested?.canonicalDeviceId ? await store.get('device', requested.canonicalDeviceId) : requested;
        requireValue(target, 'Device not found', 404);
        await security.transaction(async (state, tx) => {
          await agents.cancelDevice(tx, target.id);
          await clientUpdates.cancelDevice(tx, target.id);
          await tx.delete('device', target.id);
          for (const alias of await tx.list('device')) if (alias.canonicalDeviceId === target.id) await tx.delete('device', alias.id);
          for (const proof of await tx.list('browser-trust')) if (proof.deviceId === target.id) await tx.delete('browser-trust', proof.id);
        });
        return send(res, 200, { revoked: true });
      }
      const removeNode = route.match(/^\/api\/devices\/([^/]+)\/remove-node$/);
      if (removeNode && req.method === 'POST') {
        owner(device);
        const targetId = removeNode[1];
        requireValue(targetId !== device.id, '当前客户端的本机节点不能删除', 409);
        const result = await serialized('claim', () => serialized(`device:${targetId}`, () => store.transaction(async tx => {
          const target = await tx.getForUpdate('device', targetId);
          requireValue(target, '节点不存在', 404);
          if (target.nodeRemovedAt) return { removed: true, id: target.id };
          requireValue(workerAuthorized(target), '只能删除已授权的工作节点', 409);
          requireValue(!workerOnline(target, clock()), '节点已上线，无法删除', 409);
          const unfinished = ['queued', ...active, 'waiting_action', 'failed'];
          requireValue(!(await tx.list('task')).some(task => unfinished.includes(task.state)
            && (task.deviceId === target.id || task.state === 'queued' && task.preferredDeviceId === target.id)),
          '该节点还有未结束的任务，请先完成或取消任务', 409);
          const at = new Date(clock()).toISOString();
          await agents.cancelDevice(tx, target.id);
          await clientUpdates.cancelDevice(tx, target.id);
          await tx.put('device', { ...target, revokedAt: at, nodeRemovedAt: at });
          return { removed: true, id: target.id };
        })));
        return send(res, 200, result);
      }
      if (route === '/api/heartbeat' && req.method === 'POST') {
        worker(device);
        const input = await body(req);
        requireValue(Array.isArray(input.capabilities) && input.capabilities.every(x => types.includes(x)), 'Invalid capabilities');
        requireValue(Array.isArray(input.agents) && input.agents.every(x => ['codex', 'codebuddy'].includes(x)), 'Invalid agents');
        const runtime = input.skillRuntime;
        const agentRuntime = input.agentRuntime;
        requireValue(agentRuntime === undefined || agentRuntime && agentRuntime.schemaVersion === 1 && typeof agentRuntime.busy === 'boolean', 'Invalid Agent runtime');
        requireValue(runtime === undefined || runtime && runtime.schemaVersion === 1 && ['running','paused','draining'].includes(runtime.mode) && typeof runtime.idle === 'boolean', 'Invalid skill runtime');
        const reported = clientRuntime(input.clientRuntime);
        await updateDevice(device, input, { lastSeen: now(), lastHeartbeatAt: new Date(clock()).toISOString(), capabilities: [...new Set(input.capabilities)], agents: [...new Set(input.agents)], ...(reported?{workerRuntime:reported}:{}), skillRuntime:runtime ? { schemaVersion:1,mode:runtime.mode,idle:runtime.idle } : null, agentRuntime:agentRuntime ? { schemaVersion:1,busy:agentRuntime.busy } : null });
        return send(res, 200, { tasks: (await store.list('task')).filter(t => t.deviceId === device.id).map(t => ({ id: t.id, state: t.state, assignmentId: t.assignmentId || null })), skillOperations:runtime?await skills.inbox(device.id):[], agentOperations:agentRuntime?await agents.inbox(device.id):[], clientUpdates:reported?.remoteUpdate?await clientUpdates.inbox(device.id):[] });
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
          task.requiredCapabilities = taskCapabilities(task);
          return send(res, 201, await saveTask(task, 'queued', '等待可用电脑'));
        });
      }
      if (route === '/api/claim' && req.method === 'POST') {
        worker(device);
        const input = await body(req);
        requireValue(input.assignmentProtocol === undefined || input.assignmentProtocol === 1, 'Invalid assignment protocol');
        if (device.agentRuntime?.busy) return send(res, 200, { task: null });
        requireValue(workerOnline(device, clock()), 'Heartbeat required', 409);
        await recoverUnavailableTasks();
        return await serialized('claim', async () => {
          const tasks = await store.list('task');
          let task = tasks.find(t => t.deviceId === device.id && active.includes(t.state));
          if (task && !task.assignmentId && input.assignmentProtocol === 1) {
            task = await store.transaction(async tx => {
              const live = await tx.getForUpdate('task', task.id);
              if (!live || live.deviceId !== device.id || !active.includes(live.state)) return null;
              return live.assignmentId ? live : tx.put('task', { ...live, assignmentId: id() });
            });
          }
          if (!task && device.agents.length) {
            // A task waiting for user action keeps its workspace on this computer,
            // but does not occupy the execution slot. Explicit retries join the
            // queue and must wait for any current task to finish.
            const candidates = tasks.filter(t => t.state === 'queued' && (t.deviceId === device.id || !t.deviceId && canRunTask(t, device))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            for (const candidate of candidates) {
              const selected = await skills.selection(candidate,device,tasks);
              if (!selected.eligible) continue;
              task = await store.transaction(async tx => {
                const live = await tx.getForUpdate('device', device.id);
                requireValue(live && !live.revokedAt && live.tokenHash === device.tokenHash, 'Device authorization required', 401);
                requireValue(workerOnline(live, clock()), 'Heartbeat required', 409);
                if (live.agentRuntime?.busy || live.skillRuntime?.mode && live.skillRuntime.mode !== 'running') return null;
                if ((await tx.list('client-update')).some(o=>o.deviceId===device.id && updateBlocksTasks(o))) return null;
                if ((await tx.list('task')).some(t => t.deviceId === device.id && active.includes(t.state))) return null;
                const pending = await tx.getForUpdate('task', candidate.id);
                if (pending?.state !== 'queued' || (pending.deviceId ? pending.deviceId !== device.id : !canRunTask(pending, live))) return null;
                return saveTask({ ...pending, deviceId: device.id, assignmentId: input.assignmentProtocol === 1 || pending.assignmentId ? id() : null, selectedSkills:selected.selectedSkills, environmentDigest:selected.environmentDigest || pending.environmentDigest || null }, 'assigned', `已分配给 ${device.name}`, tx);
              });
              break;
            }
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
      const taskRoute = route.match(/^\/api\/tasks\/([^/]+)\/(progress|result|retry|cancel|approve|reassign)$/);
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
        if (['retry', 'cancel', 'reassign'].includes(action)) {
          owner(device);
          const result = await serialized('claim', () => store.transaction(async tx => {
            const task = await tx.getForUpdate('task', taskId);
            requireValue(task, 'Task not found', 404);
            requireValue(action === 'cancel' ? task.state !== 'completed' : action === 'reassign' ? ['queued', ...active, 'waiting_action', 'failed'].includes(task.state) && Boolean(task.deviceId) : ['waiting_action', 'failed'].includes(task.state), 'Invalid task transition', 409);
            if (action === 'reassign') return reroute(task, 'USER_SWITCH', '用户切换到其他工作节点', tx, { manual: true });
            const next = action === 'retry' ? { ...task, failedDeviceIds: [], failover: null, assignmentId: task.assignmentId ? id() : null } : task;
            return saveTask(next, action === 'cancel' ? 'cancelled' : 'queued', action === 'cancel' ? '用户取消' : task.deviceId ? '等待原电脑继续' : '等待可用电脑', tx);
          }));
          return send(res, 200, result);
        }
        await assigned(device, taskId, req);
        if (action === 'result') return send(res, 200, await publish(input, device, req, taskId));
        requireValue(['running', 'uploading', 'waiting_action', 'failed'].includes(input.state), 'Invalid task state');
        requireValue(input.failureCode === undefined || nodeFailureCodes.has(input.failureCode), 'Invalid node failure code');
        const message = text(input.message, 'progress message', 1000);
        const result = await serialized('claim', () => store.transaction(async tx => {
          const live = await tx.getForUpdate('task', taskId);
          checkAssignment(device, live, req);
          requireValue(active.includes(live.state), 'Task is not running', 409);
          const executionSkills = (live.selectedSkills || []).filter(s=>s.agent === (input.agent || live.agent));
          const updated = { ...live, agent: input.agent || live.agent || null, executionSkills };
          if (input.state === 'failed' || input.state === 'waiting_action' && nodeFailureCodes.has(input.failureCode)) {
            await saveTask(updated, input.state, message, tx);
            return reroute(updated, input.failureCode || 'EXECUTION_FAILED', '原工作节点未能完成采集', tx);
          }
          return saveTask(updated, input.state, message, tx);
        }));
        return send(res, 200, result);
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
      if (!res.headersSent) send(res, error.status || 500, { ...(req.url.startsWith('/api/read/v1/') ? { schema_version: 1 } : {}), ...(['mfa_required', 'mfa_invalid', 'credential_invalid', 'inventory_changed', 'skillhub_unavailable', 'skillhub_timeout', 'skillhub_rate_limited', 'skillhub_not_found', 'skillhub_input_invalid'].includes(error.code) ? { code: error.code } : {}), error: error.status ? error.message : 'Internal service error' });
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
