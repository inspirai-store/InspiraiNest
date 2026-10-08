import { atomicJson } from '../src/common.mjs';
import { readOptional } from '../src/worker-control.mjs';

const modes = ['stopped', 'running', 'paused'];
export class WorkerSession {
  constructor({ file, manager }) {
    this.file = file;
    this.manager = manager;
    this.error = null;
    this.restoring = null;
    const saved = readOptional(file), state = manager.snapshot();
    this.mode = saved?.version === 1 && modes.includes(saved.mode) ? saved.mode
      : ['running', 'paused'].includes(state.mode) ? state.mode : 'stopped';
    this.preserveDrain = saved?.preserveDrain === true;
    this.saved = saved?.version === 1 && modes.includes(saved.mode);
    this.observe();
  }
  record(mode, preserveDrain = false) {
    if (this.saved && this.mode === mode && this.preserveDrain === preserveDrain) return;
    try {
      atomicJson(this.file, { version: 1, mode, preserveDrain });
      this.mode = mode; this.preserveDrain = preserveDrain; this.saved = true; this.error = null;
    } catch { this.error = '工作节点运行状态未保存，请检查本机配置目录。'; }
  }
  observe() {
    const state = this.manager.snapshot();
    if (state.running && state.mode === 'draining') { if (!this.preserveDrain) this.record('stopped'); }
    else if (state.running && ['running', 'paused'].includes(state.mode)) this.record(state.mode);
    else if (state.starting) this.record(this.mode === 'paused' ? 'paused' : 'running');
    else if (!this.saved) this.record(this.mode, this.preserveDrain);
    // A missing process is not a user stop. Keep its last intended mode so a
    // future application launch can recover after shutdown or a process exit.
  }
  async start(options) { const result = await this.manager.start(options); this.error = null; this.record(result.mode === 'paused' ? 'paused' : 'running'); return result; }
  async control(action) {
    const result = await this.manager.control(action);
    if (action === 'drain') this.record('stopped'); else this.observe();
    return result;
  }
  async stop() { const result = await this.manager.stop(); this.record('stopped'); return result; }
  async drainForUpdate() {
    const state = this.manager.snapshot();
    const mode = state.mode === 'paused' ? 'paused' : state.mode === 'draining' ? 'stopped' : 'running';
    this.record(mode, mode !== 'stopped');
    try { return await this.manager.control('drain'); }
    catch (error) { this.record(mode); throw error; }
  }
  restore() {
    if (this.restoring) return this.restoring;
    this.restoring = (async () => {
      const state = this.manager.snapshot();
      if (state.running || state.starting) { this.observe(); return state; }
      if (this.mode === 'stopped') return state;
      if (!state.paired) { this.error = '尚未配对，无法恢复上次的工作节点状态。请先连接这台电脑。'; return state; }
      try { return await this.start({ paused: this.mode === 'paused' }); }
      catch { this.error = '工作节点未能恢复上次运行状态，请查看本机日志后重试。'; return this.manager.snapshot(); }
    })();
    return this.restoring;
  }
  async recoverUpdate() {
    if(this.mode==='stopped')return true;
    const state=this.manager.snapshot();if(state.running)return state.mode!=='draining';
    this.restoring=null;return this.restore();
  }
}
