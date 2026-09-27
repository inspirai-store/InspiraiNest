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
    .replace(/("(?:token|api[_-]?key|password|secret|authorization)"\s*:\s*")[^"\r\n]+/gi, '$1[已隐藏]');
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

export function createWorkerControl(dataDir, { paused = false, token } = {}) {
  let closed = false;
  let writeWarning = false;
  const file = path.join(dataDir, 'worker-status.json');
  const previous = readOptional(file);
  const state = { protocol: 1, runId: id(), pid: process.pid, startedAt: new Date().toISOString(),
    phase: 'starting', mode: paused ? 'paused' : 'running', connection: 'unknown', current: null,
    lastTask: previous?.lastTask || null, agents: {}, tasks: [], lastHeartbeat: null, error: null };
  const update = patch => {
    if (closed) return;
    Object.assign(state, patch, { updatedAt: new Date().toISOString() });
    // Windows readers / antivirus may briefly deny rename. Observability must never
    // terminate the Agent; retain the last complete snapshot and retry on the next tick.
    const temp = `${file}.${id()}.tmp`;
    try {
      fs.writeFileSync(temp, redact(JSON.stringify(state, null, 2), token) + '\n', { mode: 0o600 });
      fs.renameSync(temp, file);
      writeWarning = false;
    } catch (error) {
      if (!writeWarning) console.error('Worker status update deferred:', error.code || error.name);
      writeWarning = true;
    } finally { try { fs.unlinkSync(temp); } catch {} }
  };
  const readCommand = () => {
    const command = readOptional(path.join(dataDir, 'worker-control.json'));
    if (command?.runId === state.runId && command.id !== state.commandId && ['pause', 'resume', 'drain'].includes(command.action)) {
      // Once stopping, require a fresh startup rather than racing a resume against shutdown.
      if (state.mode !== 'draining') state.mode = { pause: 'paused', resume: 'running', drain: 'draining' }[command.action];
      update({ commandId: command.id });
    }
  };
  update({});
  const timer = setInterval(() => { readCommand(); update({}); }, 1000);
  return { state, update, readCommand, close() { clearInterval(timer); update({ phase: 'stopped', connection: 'offline', current: null }); closed = true; } };
}
