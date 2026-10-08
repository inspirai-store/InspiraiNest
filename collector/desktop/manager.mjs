import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';
import { loadWorkerConfig } from '../src/config.mjs';
import { workerSnapshot, sendControl, readOptional, redact } from '../src/worker-control.mjs';
import { atomicJson, contained, remoteURL } from '../src/common.mjs';
import { readWorkerEvents } from '../src/worker-events.mjs';
import { computerMetadata, appVersion } from '../src/device-identity.mjs';
import { clientOrigin, loginFailure } from '../src/client-login.mjs';
import { desktopExecutionEnvironment } from './execution-environment.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export class WorkerManager {
  constructor(file, node = process.env.COLLECTOR_NODE || 'node') {
    this.file = loadWorkerConfig(file).file;
    this.node = node;
    this.starting = false;
    this.error = null;
  }
  configuration() { return loadWorkerConfig(this.file).config; }
  async pair({ server, key, name, otp, recoveryCode }, { clientType = 'worker', onPaired, signal, current = () => true } = {}) {
    if (this.pairing || this.starting || workerSnapshot(this.dataDir).running) throw new Error('请先让工作节点完成任务并停止');
    const origin = clientType === 'desktop' ? clientOrigin(server) : remoteURL(server);
    if (typeof key !== 'string' || !key || key.length > 200) throw new Error('请输入登录密码或配对码');
    const deviceName = String(name || os.hostname()).trim().slice(0, 100);
    if (!deviceName) throw new Error('请输入电脑名称');
    const identityFile = path.join(this.dataDir, 'installation-id');
    const installationId = this.configuration().installationId || (fs.existsSync(identityFile) ? fs.readFileSync(identityFile, 'utf8').trim() : randomUUID());
    this.pairing = true;
    try {
      const device = await computerMetadata({ server: origin, dataDir: this.dataDir, installationId, clientType, allowChange: true });
      const response = await fetch(origin + '/api/pair', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: clientType === 'desktop' ? key : key.trim(), name: deviceName, ...device,
          ...(otp ? { otp } : {}), ...(recoveryCode ? { recoveryCode } : {}) }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), redirect: 'error',
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('登录响应格式无效，请检查资料库地址'); }
      if (!response.ok) throw clientType === 'desktop' ? loginFailure(response.status, result) : new Error(result.error || '配对失败');
      if (result.device?.role !== 'worker' || !result.token) throw new Error('配对权限不匹配，请生成新的设备配对码');
      if (clientType === 'desktop' && !result.ownerToken) throw new Error('服务端尚未支持桌面统一配对，请先升级服务端');
      if (!current() || signal?.aborted) throw new Error('登录已取消');
      const previous = this.configuration();
      const switching = previous.server && remoteURL(previous.server) !== origin;
      const loginDataRoot = previous.loginDataRoot || this.dataDir;
      const dataDir = switching ? path.join(loginDataRoot, 'server-profiles', createHash('sha256').update(origin).digest('hex').slice(0, 24)) : this.dataDir;
      atomicJson(this.file, { ...previous, server: origin, name: deviceName, ...(clientType === 'desktop' ? { loginDataRoot, dataDir } : {}),
        installationId, clientType, deviceId: result.device.id, token: result.token });
      try { if (onPaired) await onPaired({ server: origin, installationId, result }); }
      catch (error) { atomicJson(this.file, previous); throw error; }
      return this.snapshot();
    } finally { this.pairing = false; }
  }
  get dataDir() { return path.resolve(this.configuration().dataDir || path.join(project, 'worker-data')); }
  snapshot() {
    const config = this.configuration();
    const state = workerSnapshot(this.dataDir);
    // Legacy processes have no status channel. Never infer connectivity from a PID.
    if (state.legacy) state.error = '检测到旧版工作节点，正在保留其运行。它尚无本地控制接口；结束后重新启动即可接入。当前阶段与联网状态未知。';
    return JSON.parse(redact(JSON.stringify({ ...state, starting: this.starting,
      device: config.name || os.hostname(), deviceId: config.deviceId || null, server: config.server ? remoteURL(config.server) : '',
      clientVersion: appVersion(),
      paired: Boolean(config.token && config.server), defaultAgent: config.defaultAgent || 'codex',
      dataDir: this.dataDir, launchError: this.error }), config.token));
  }
  async start({ paused = false } = {}) {
    if (this.pairing || this.starting || workerSnapshot(this.dataDir).running) throw new Error('工作节点已在运行或登录中，未重复启动');
    const config = this.configuration();
    if (!config.server || !config.token) throw new Error('请先按 README 完成本机配对');
    this.starting = true;
    this.error = null;
    fs.mkdirSync(this.dataDir, { recursive: true });
    const out = fs.openSync(path.join(this.dataDir, 'worker.stdout.log'), 'a', 0o600);
    const err = fs.openSync(path.join(this.dataDir, 'worker.stderr.log'), 'a', 0o600);
    try {
      const env = await desktopExecutionEnvironment();
      const child = spawn(this.node, [path.join(project, 'src/worker.mjs'), 'run', ...(paused ? ['--paused'] : [])], {
        cwd: project, env: { ...env, COLLECTOR_CONFIG: this.file,
          ...(process.env.COLLECTOR_ELECTRON_NODE === '1' ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }, detached: true,
        windowsHide: true, stdio: ['ignore', out, err],
      });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      // Wait for the lock/status handshake; another launch can win the worker's atomic lock.
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (workerSnapshot(this.dataDir).running) return this.snapshot();
        if (child.exitCode !== null) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('工作节点未完成启动，请查看本机日志');
    } catch (error) {
      this.error = redact(error.message, config.token);
      throw new Error(this.error);
    } finally { fs.closeSync(out); fs.closeSync(err); this.starting = false; }
  }
  async stop() {
    const state = this.snapshot();
    if (!state.running || (state.managed && !state.stale && state.mode === 'draining')) return state;
    return this.control('drain');
  }
  async control(action) {
    const commandId = sendControl(this.dataDir, action);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const status = workerSnapshot(this.dataDir);
      if (status.commandId === commandId) return this.snapshot();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('操作尚未确认，请查看状态后再试');
  }
  taskDirectory(taskId) {
    if (typeof taskId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(taskId)) throw new Error('没有可打开的任务目录');
    const root = fs.realpathSync(this.dataDir);
    const target = fs.realpathSync(path.join(root, 'tasks', taskId));
    if (!contained(root, target)) throw new Error('任务目录不在本机数据目录内');
    return target;
  }
  logs(taskId) {
    const directory = taskId ? this.taskDirectory(taskId) : this.dataDir;
    const names = taskId ? ['codex.log', 'codebuddy.log'] : ['worker.stderr.log', 'worker.stdout.log'];
    return names.map(name => {
      const target = path.join(directory, name);
      if (!fs.existsSync(target)) return `${name}：暂无日志`;
      if (!contained(fs.realpathSync(directory), fs.realpathSync(target))) throw new Error('日志路径无效');
      const fd = fs.openSync(target, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        const buffer = Buffer.alloc(Math.min(size, 24000));
        fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
        return `── ${name}（末尾最多 24 KB）──\n${redact(buffer.toString('utf8'), this.configuration().token)}`;
      } finally { fs.closeSync(fd); }
    }).join('\n\n');
  }
  activity(taskId) {
    const state = workerSnapshot(this.dataDir);
    return readWorkerEvents(this.dataDir, { token: this.configuration().token, taskId, runId: state.running ? state.runId : null });
  }
}
