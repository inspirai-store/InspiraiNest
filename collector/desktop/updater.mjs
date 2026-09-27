import { EventEmitter } from 'node:events';

const supportedPlatform = platform => platform === 'win32' || platform === 'darwin';
const updateError = error => {
  const message = error?.message || String(error);
  if (/404 Not Found|Cannot find channel/i.test(message)) return '更新服务尚未提供此平台版本，请稍后重试或前往下载页。';
  if (/signature|sha512|checksum/i.test(message)) return '更新包校验失败，请稍后重新下载。';
  if (/ENOTFOUND|ECONN|ETIMEDOUT|ERR_NETWORK/i.test(message)) return '暂时无法连接更新服务，请检查网络后重试。';
  return message.split('\n')[0].slice(0, 180);
};

export class DesktopUpdater extends EventEmitter {
  constructor({ app, manager, updater, platform = process.platform, pollMs = 2000 }) {
    super();
    this.app = app;
    this.manager = manager;
    this.updater = updater;
    this.pollMs = pollMs;
    this.supported = Boolean(app.isPackaged && supportedPlatform(platform));
    this.state = { version: app.getVersion(), phase: this.supported ? 'idle' : 'unsupported', availableVersion: null,
      progress: null, error: null, supported: this.supported };
    this.workerTimer = null;
    this.busy = false;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.on('update-available', info => this.set({ phase: 'available', availableVersion: info.version, error: null }));
    updater.on('update-not-available', () => this.set({ phase: 'current', availableVersion: null, progress: null, error: null }));
    updater.on('download-progress', info => this.set({ phase: 'downloading', progress: Math.max(0, Math.min(100, Math.round(info.percent))) }));
    updater.on('update-downloaded', info => this.set({ phase: 'downloaded', availableVersion: info.version, progress: 100, error: null }));
    updater.on('error', error => this.set({ phase: 'error', error: updateError(error) }));
  }
  snapshot() { return { ...this.state }; }
  set(changes) { Object.assign(this.state, changes); this.emit('changed', this.snapshot()); return this.snapshot(); }
  async check() {
    if (!this.supported) return this.set({ phase: 'unsupported', error: '当前运行方式不支持应用内更新，请安装正式版客户端' });
    if (this.busy || ['downloading', 'downloaded', 'waiting_worker', 'installing'].includes(this.state.phase)) return this.snapshot();
    this.busy = true;
    this.set({ phase: 'checking', error: null });
    try {
      const result = await this.updater.checkForUpdates();
      // electron-updater emits the result, but a custom provider may return without an event.
      if (this.state.phase === 'checking') this.set(result?.updateInfo?.version && result.updateInfo.version !== this.state.version
        ? { phase: 'available', availableVersion: result.updateInfo.version } : { phase: 'current' });
    } catch (error) { this.set({ phase: 'error', error: updateError(error) }); }
    finally { this.busy = false; }
    return this.snapshot();
  }
  async download() {
    if (this.state.phase !== 'available') throw new Error('当前没有可下载的客户端更新');
    this.set({ phase: 'downloading', progress: 0, error: null });
    try { await this.updater.downloadUpdate(); }
    catch (error) { this.set({ phase: 'error', error: updateError(error) }); }
    return this.snapshot();
  }
  async install() {
    if (this.state.phase !== 'downloaded') throw new Error('请先下载并校验客户端更新');
    if (this.manager.snapshot().running) {
      const worker = this.manager.snapshot();
      if (!worker.managed || worker.stale) throw new Error('Worker 正在运行但无法安全控制，请先手动停止 Worker 再安装');
      await this.manager.control('drain');
      this.set({ phase: 'waiting_worker' });
      this.workerTimer = setInterval(() => this.installWhenStopped(), this.pollMs);
      this.installWhenStopped();
      return this.snapshot();
    }
    this.startInstall();
    return this.snapshot();
  }
  installWhenStopped() {
    if (this.state.phase !== 'waiting_worker') { this.stopWaiting(); return; }
    if (!this.manager.snapshot().running) {
      try { this.startInstall(); } catch { /* The downloaded update remains available for another attempt. */ }
    }
  }
  startInstall() {
    this.stopWaiting();
    this.set({ phase: 'installing' });
    // The detached Worker runs from this application bundle, so its process must exit first.
    try { this.updater.quitAndInstall(false, true); }
    catch (error) { this.set({ phase: 'downloaded', error: updateError(error) }); throw error; }
  }
  stopWaiting() { if (this.workerTimer) clearInterval(this.workerTimer); this.workerTimer = null; }
  dispose() { this.stopWaiting(); this.removeAllListeners(); }
}
