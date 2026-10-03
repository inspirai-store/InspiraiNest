import fs from 'node:fs';
import path from 'node:path';
import { atomicJson, id, readJson } from './common.mjs';

export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
export function readOptional(file) {
  try { return readJson(file); } catch { return null; }
}
export function redact(value, token) {
  let text = String(value ?? '');
  if (token) text = text.split(token).join('[已隐藏凭据]');
  return text.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [已隐藏]')
    .replace(/("(?:token|ownerToken|encryptedToken|refresh_token|access_token|api[_-]?key|password|secret|authorization|cookie|pairingCode|key)"\s*:\s*")[^"\r\n]+/gi, '$1[已隐藏]')
    .replace(/([?&](?:share_token|access_token|token|api_key|key|secret|code)=)[^&\s"<>]+/gi, '$1[已隐藏]')
    .replace(/((?:api[_-]?key|password|secret|authorization|cookie)\s*[=:]\s*)[^\s"'\\,;]+/gi, '$1[已隐藏]');
}
export function workerSnapshot(dataDir) {
  let pid = 0;
  try { pid = Number(fs.readFileSync(path.join(dataDir, 'worker.lock'), 'utf8')); } catch {}
  const running = alive(pid);
  const saved = readOptional(path.join(dataDir, 'worker-status.json'));
  const managed = running && saved?.pid === pid && saved?.protocol === 1 && saved.phase !== 'stopped';
  return { ...(managed || !running ? saved || {} : {}), pid: running ? pid : null, running,
    managed: Boolean(managed), legacy: running && !managed,
    stale: managed && Date.now() - Date.parse(saved.updatedAt) > 15000,
    online: Boolean(managed && saved.connection === 'online' && Date.now() - Date.parse(saved.lastHeartbeat) < 45000) };
}

// A command is addressed to one run, never to a reused PID or the next startup.
export function sendControl(dataDir, action) {
  if (!['pause', 'resume', 'drain'].includes(action)) throw new Error('不支持的 Worker 操作');
  const status = workerSnapshot(dataDir);
  if (!status.managed || status.stale) throw new Error('当前进程尚未接入控制，或状态已过期；未发送操作');
  const command = { runId: status.runId, id: id(), action };
  atomicJson(path.join(dataDir, 'worker-control.json'), command);
  return command.id;
}

export function createWorkerControl(dataDir, { paused = false, token, runId = id(), onDiagnostic, onMode } = {}) {
  let closed = false;
  let writeWarning = false;
  let retryTimer, failedWrites = 0, stableWrites = 0;
  const file = path.join(dataDir, 'worker-status.json');
  const previous = readOptional(file);
  const state = { protocol: 1, runId, pid: process.pid, startedAt: new Date().toISOString(),
    phase: 'starting', mode: paused ? 'paused' : 'running', connection: 'unknown', current: null,
    lastTask: previous?.lastTask || null, agents: {}, tasks: [], lastHeartbeat: null, error: null };
  const persist = () => {
    if (closed) return;
    // Windows readers / antivirus may briefly deny rename. Observability must never
    // terminate the Agent; retain the last complete snapshot and retry on the next tick.
    const temp = `${file}.${id()}.tmp`;
    try {
      fs.writeFileSync(temp, redact(JSON.stringify(state, null, 2), token) + '\n', { mode: 0o600 });
      fs.renameSync(temp, file);
      clearTimeout(retryTimer); retryTimer = null; failedWrites = 0;
      if (writeWarning && ++stableWrites >= 3) {
        writeWarning = false;
        try { onDiagnostic?.({ recovered: true }); } catch {}
      }
    } catch (error) {
      stableWrites = 0; failedWrites++;
      if (onDiagnostic) { try { onDiagnostic({ error }); } catch {} }
      else if (!writeWarning) console.error(`[${new Date().toISOString()}] 本机状态暂时无法保存（${error.code || error.name}），采集继续并自动重试。`);
      writeWarning = true;
      if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code) && !retryTimer && failedWrites <= 3) {
        retryTimer = setTimeout(() => { retryTimer = null; persist(); }, 80 * 2 ** (failedWrites - 1));
      }
    } finally { try { fs.unlinkSync(temp); } catch {} }
  };
  const update = patch => {
    if (closed) return;
    Object.assign(state, patch, { updatedAt: new Date().toISOString() });
    persist();
  };
  const readCommand = () => {
    const command = readOptional(path.join(dataDir, 'worker-control.json'));
    if (command?.runId === state.runId && command.id !== state.commandId && ['pause', 'resume', 'drain'].includes(command.action)) {
      // Once stopping, require a fresh startup rather than racing a resume against shutdown.
      if (state.mode !== 'draining') {
        const mode = { pause: 'paused', resume: 'running', drain: 'draining' }[command.action];
        if (state.mode !== mode) { state.mode = mode; onMode?.(mode); }
      }
      update({ commandId: command.id });
    }
  };
  update({});
  const timer = setInterval(() => { readCommand(); update({}); }, 1000);
  return { state, update, readCommand, close() { clearInterval(timer); clearTimeout(retryTimer); retryTimer = null; update({ phase: 'stopped', connection: 'offline', current: null }); closed = true; clearTimeout(retryTimer); } };
}
