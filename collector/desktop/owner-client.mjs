import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { atomicJson, remoteURL, safePath } from '../src/common.mjs';
import { computerMetadata } from '../src/device-identity.mjs';
import { clientOrigin, loginFailure } from '../src/client-login.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const entryId = value => {
  if (typeof value !== 'string' || !value || value.length > 300) throw new Error('资料编号无效');
  return value;
};
const taskId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new Error('任务编号无效');
  return value;
};
const archiveId = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('归档编号无效');
  return value;
};

export class OwnerClient {
  constructor({ file, workerServer, encryption, fetcher = fetch, identityDir = path.dirname(file) }) {
    this.file = file;
    this.workerServer = workerServer;
    this.encryption = encryption;
    this.fetcher = fetcher;
    this.identityDir = identityDir;
    this.identityAttemptAt = 0;
    this.identityError = null;
    this.identity = null;
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      const token = encryption.decryptString(Buffer.from(stored.encryptedToken, 'base64'));
      this.identity = { server: remoteURL(stored.server), deviceId: stored.deviceId, installationId: stored.installationId, token };
    } catch { this.identity = null; }
  }
  status() {
    let lastServer = '';
    try { lastServer = clientOrigin(JSON.parse(fs.readFileSync(this.file + '.origin', 'utf8')).server); } catch {}
    return { paired: Boolean(this.identity), server: this.identity?.server || this.workerServer() || lastServer, deviceId: this.identity?.deviceId || null };
  }
  serverForPair(input) {
    const worker = this.workerServer();
    const server = clientOrigin(input.server || worker);
    if (worker && server !== worker) throw new Error('管理端必须连接本机工作节点使用的同一服务地址');
    if (this.identity && server !== this.identity.server) throw new Error('请先退出当前管理端授权，再连接其他服务');
    return server;
  }
  assertWorkerServer(server) {
    if (this.identity && remoteURL(server) !== this.identity.server) throw new Error('工作节点必须连接管理端使用的同一服务地址');
  }
  async pair(input) {
    if (!this.encryption.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存管理端授权');
    const server = this.serverForPair(input);
    const key = String(input.key || '');
    const name = String(input.name || os.hostname()).trim().slice(0, 100);
    if (!key || key.length > 200 || !name) throw new Error('请输入设备名称和配对码');
    const installationId = this.identity?.installationId || randomUUID();
    const result = await this.call(server, null, '/api/pair', 'POST', { key, name, installationId, clientType: 'web', platform: process.platform, system: `${os.type()} ${os.release()} · ${os.arch()}`, ...(input.otp ? { otp: input.otp } : {}), ...(input.recoveryCode ? { recoveryCode: input.recoveryCode } : {}) });
    if (result.device?.role !== 'owner' || typeof result.token !== 'string') throw new Error('配对权限不匹配，请生成新的设备配对码');
    return this.saveCredential({ server, installationId, deviceId: result.device.id, token: result.token });
  }
  saveCredential({ server, installationId, deviceId, token }, { allowServerChange = false } = {}) {
    if (!this.encryption.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存设备授权');
    if (typeof token !== 'string' || !token || !deviceId) throw new Error('设备授权无效');
    server = allowServerChange ? clientOrigin(server) : this.serverForPair({ server });
    if (allowServerChange && this.workerServer() && clientOrigin(this.workerServer()) !== server) throw new Error('管理端与工作节点地址不一致');
    const stored = { server, deviceId, installationId, encryptedToken: this.encryption.encryptString(token).toString('base64') };
    atomicJson(this.file, stored);
    this.identity = { server, deviceId, installationId, token };
    this.identityAttemptAt = 0; this.identityError = null;
    try { atomicJson(this.file + '.origin', { server }); } catch {}
    return this.status();
  }
  logout() { this.identity = null; try { fs.unlinkSync(this.file); } catch (error) { if (error.code !== 'ENOENT') throw error; } return this.status(); }
  async call(server, token, route, method = 'GET', data, binary = false) {
    const response = await this.fetcher(server + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(binary ? 120000 : 20000), redirect: 'error' });
    if (!response.ok) {
      let message, body;
      try { body = await response.json(); message = body.error; } catch {}
      if (route === '/api/pair' && !token) throw loginFailure(response.status, body);
      if (response.status === 401 && token) throw new Error('管理端授权已失效，请重新配对');
      if (response.status === 404 && route.startsWith('/api/read/v1/')) throw new Error('服务端尚未提供新版资料阅读接口，请先升级服务端');
      throw new Error(message || `服务请求失败（${response.status}）`);
    }
    return binary ? { bytes: Buffer.from(await response.arrayBuffer()), sha256: response.headers.get('x-content-sha256') } : response.json();
  }
  api(route, method = 'GET', data, binary = false) {
    if (!this.identity) throw new Error('请先配对管理端');
    return this.call(this.identity.server, this.identity.token, route, method, data, binary);
  }
  agents(input) {
    if(!input || typeof input !== 'object')throw new Error('Agent 请求无效');
    if(input.kind==='catalog')return this.api('/api/agents/catalog');
    if(input.kind==='environment')return this.api('/api/agents/devices/'+taskId(input.deviceId)+'/environment');
    if(input.kind==='history')return this.api('/api/agents/operations?deviceId='+taskId(input.deviceId));
    if(input.kind==='cancel')return this.api('/api/agents/operations/'+archiveId(input.operationId)+'/cancel','POST',{});
    if(input.kind==='create')return this.api('/api/agents/operations','POST',input.operation);
    throw new Error('Agent 请求无效');
  }
  skills(input) {
    if (!input || typeof input !== 'object') throw new Error('技能请求无效');
    if (input.kind === 'environment') {
      const query = new URLSearchParams({offset:String(Number(input.offset)||0)});
      if(input.snapshotId)query.set('snapshotId',archiveId(input.snapshotId));
      return this.api(`/api/skills/devices/${taskId(input.deviceId)}/environment?${query}`);
    }
    if (input.kind === 'versions') return this.api('/api/skills/versions');
    if (input.kind === 'operation') return this.api('/api/skills/operations/'+archiveId(input.operationId));
    if (input.kind === 'history') return this.api('/api/skills/operations?deviceId='+taskId(input.deviceId));
    if (input.kind === 'create' && ['refresh','configure-projects','prepare-publish','publish','compare','sync','verify','rollback'].includes(input.operation?.action)) return this.api('/api/skills/operations','POST',input.operation);
    throw new Error('不支持的技能请求');
  }
  async state() {
    const identity = this.identity;
    if (identity && Date.now() - this.identityAttemptAt > 60000) {
      this.identityAttemptAt = Date.now();
      try {
        const info = await computerMetadata({ server: identity.server, dataDir: this.identityDir, installationId: identity.installationId, clientType: 'desktop', fetcher: this.fetcher });
        if (this.identity === identity) await this.api('/api/devices/me/info', 'POST', info);
        this.identityError = null;
      } catch (error) { this.identityError = error.message; }
    }
    const result = await this.api('/api/state');
    return { ...result, identityWarning: this.identityError };
  }
  entries(filters = {}) {
    const params = new URLSearchParams();
    for (const key of ['q', 'type', 'status', 'tag', 'from', 'to']) if (filters[key]) params.set(key, String(filters[key]));
    params.set('limit', String(Math.max(1, Math.min(100, Number(filters.limit) || 30))));
    params.set('offset', String(Math.max(0, Number(filters.offset) || 0)));
    return this.api('/api/read/v1/' + (filters.q ? 'search' : 'entries') + '?' + params);
  }
  entry(id) { return this.api('/api/read/v1/entry?id=' + encodeURIComponent(entryId(id))); }
  content({ id, file, startLine = 1, startColumn = 0 }) {
    const params = new URLSearchParams({ id: entryId(id), start_line: String(startLine), start_column: String(startColumn), max_lines: '200' });
    if (file) params.set('file', safePath(file));
    return this.api('/api/read/v1/content?' + params);
  }
  async fileBytes({ id, file }) {
    const metadata = await this.entry(id);
    const record = metadata.files.find(item => item.path === safePath(file));
    if (!record?.sha256) throw new Error('附件未登记或缺少校验值');
    const params = new URLSearchParams({ id: entryId(id), file });
    const result = await this.api('/api/read/v1/file?' + params, 'GET', undefined, true);
    if (result.bytes.length > 20 * 1024 * 1024 || digest(result.bytes) !== record.sha256 || (result.sha256 && result.sha256 !== record.sha256)) throw new Error('附件校验失败');
    return { bytes: result.bytes, name: path.posix.basename(file), type: path.extname(file).toLowerCase() };
  }
  async preview(input) {
    if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(input.file || '')) throw new Error('当前仅支持图片预览');
    const result = await this.fileBytes(input);
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }[result.type];
    return { dataUrl: `data:${mime};base64,${result.bytes.toString('base64')}`, name: result.name };
  }
  createTask(input) {
    if (!input || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 10000 || typeof input.submissionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.submissionId)) throw new Error('采集内容或提交编号无效');
    const payload = { content: input.content, submissionId: input.submissionId, autoArchive: Boolean(input.autoArchive), tags: Array.isArray(input.tags) ? input.tags : [], deviceId: input.deviceId || '', agent: input.agent || '' };
    return this.api('/api/tasks', 'POST', payload);
  }
  taskAction({ id, action }) {
    if (!['retry', 'cancel', 'approve'].includes(action)) throw new Error('不支持的任务操作');
    return this.api(`/api/tasks/${taskId(id)}/${action}`, 'POST', {});
  }
  async draft(id) {
    const bundle = await this.api(`/api/tasks/${taskId(id)}/draft`);
    const file = bundle.files?.find(f => f.role === 'summary' && /\.md$/i.test(f.path)) || bundle.files?.find(f => f.role === 'analysis' && /\.md$/i.test(f.path));
    return { meta: bundle.meta, summary: file ? Buffer.from(file.body, 'base64').toString('utf8').slice(0, 100000) : '暂无可预览的摘要', files: (bundle.files || []).map(f => ({ path: f.path, role: f.role, bytes: f.bytes })) };
  }
  pairing() { return this.api('/api/pairings', 'POST', {}); }
  revoke(id) { return this.api(`/api/devices/${encodeURIComponent(taskId(id))}/revoke`, 'POST', {}); }
  removeNode(id) { return this.api(`/api/devices/${encodeURIComponent(taskId(id))}/remove-node`, 'POST', {}); }
  trash() { return this.api('/api/trash'); }
  removeArchive(id) { return this.api(`/api/archives/${archiveId(id)}`, 'DELETE'); }
  restoreArchive(id) { return this.api(`/api/archives/${archiveId(id)}/restore`, 'POST', {}); }
}
