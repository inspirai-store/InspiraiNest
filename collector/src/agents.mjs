import spawn from 'cross-spawn';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAgentProfile, commandEnvironment, agentVersion } from './agent-paths.mjs';

export const defaults = {
  codex: { command: 'codex', args: ['exec', '--skip-git-repo-check', '--json', '--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '-c', 'approval_policy="never"', '-'] },
  codebuddy: { enabled: false, command: 'codebuddy', args: ['-p', '--output-format', 'stream-json', '--verbose'] },
};

export function agentProfile(name, profiles = {}, options) {
  const profile = { ...(defaults[name] || { command: name }), ...profiles[name] };
  // Upgrade only the old built-in profile. Explicitly customized network policies stay authoritative.
  const previous = ['exec', '--skip-git-repo-check', '--json', '--sandbox', 'workspace-write', '-c', 'approval_policy="never"', '-'];
  if (name === 'codex' && JSON.stringify(profile.args) === JSON.stringify(previous)) profile.args = [...defaults.codex.args];
  return resolveAgentProfile(name, profile, options);
}

export function terminate(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => child.kill());
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  }
}

// Do not pass service, cloud, signing or device credentials to a spawned Agent.
// Agent login files are still accessible to the OS user: this is not isolation.
export function agentEnvironment(source = process.env) {
  const blocked = /^(?:COLLECTOR_(?:MASTER_KEY|PAIR_KEY)|OSS_.+|MYSQL_URL|DATABASE_URL|GH_TOKEN|GITHUB_TOKEN|GIT_ASKPASS|SSH_AUTH_SOCK|AWS_.+|AZURE_.+|GOOGLE_APPLICATION_CREDENTIALS|CSC_.+|APPLE_.+|LIBRARY_SIGNING_.+)$/i;
  return { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...Object.fromEntries(Object.entries(source).filter(([key]) => !blocked.test(key))) };
}

export function execute(command, args, { cwd, input = '', logFile, timeoutMs = 30000, signal, env = agentEnvironment() } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    let tail = '';
    let bytes = 0;
    let timedOut = false;
    let aborted = signal?.aborted || false;
    let spawnError;
    let forceTimer;
    let toolActivity = false;
    let permissionBlocked = false;
    let pendingLine = '';
    const log = logFile ? fs.createWriteStream(logFile, { flags: 'a', mode: 0o600 }) : null;
    const collect = chunk => {
      tail = (tail + chunk.toString()).slice(-32000);
      bytes += chunk.length;
      if (log && bytes <= 8 * 1024 * 1024) log.write(chunk);
    };
    child.stdout.on('data', collect);
    child.stdout.on('data', chunk => {
      pendingLine += chunk.toString();
      const lines = pendingLine.split('\n');
      pendingLine = lines.pop().slice(-100000);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'function_call'].includes(event.item?.type) || event.message?.content?.some?.(part => part.type === 'tool_use')) toolActivity = true;
          const results = event.message?.content;
          if (Array.isArray(results) && results.some(part => part.type === 'tool_result' && /Permission to use .+ has been denied because this tool requires approval but permission prompts are not available in non-interactive mode/.test(typeof part.content === 'string' ? part.content : JSON.stringify(part.content)))) {
            permissionBlocked = true;
            terminate(child);
          }
        } catch { /* Non-JSON startup messages are retained only in the local log. */ }
      }
    });
    child.stderr.on('data', collect);
    child.stdin.on('error', () => {});
    child.on('error', error => { spawnError = error.code || error.message; });
    const stop = () => { terminate(child); forceTimer ||= setTimeout(()=>{if(child.exitCode===null && process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}},5000); };
    const abort = () => { aborted = true; stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal?.removeEventListener('abort', abort);
      log?.end();
      resolve({ code, tail, spawnError, timedOut, aborted, toolActivity, permissionBlocked });
    });
    if (aborted) stop();
    else child.stdin.end(input);
  });
}

export function unavailableBeforeWork(result) {
  if (result.spawnError || [127, 9009].includes(result.code)) return true;
  if (result.code === 0 || result.toolActivity || result.timedOut || result.aborted) return false;
  return result.tail.split('\n').some(line => {
    try {
      const event = JSON.parse(line);
      return event.type === 'turn.failed' && /model requires a newer version of Codex/.test(event.error?.message || '');
    } catch { return false; }
  });
}

export function describeAgentFailure(name, result) {
  let error = '';
  for (const line of result.tail.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'turn.failed' || event.type === 'error') {
        let value = event.error?.message || event.message || '';
        try { const nested = JSON.parse(value); value = nested.error?.message || nested.message || value; } catch {}
        error = String(value).slice(0, 2000);
      }
    } catch {}
  }
  const details = { agent: name, exitCode: result.code, ...(error ? { error } : {}) };
  if (/model.+(?:not supported|requires a newer version)|unsupported model/i.test(error)) return {
    code: 'AGENT_MODEL', message: '本机采集程序配置的模型不可用，请更换当前账号支持的模型后继续', details };
  if (/authentication|not logged in|sign in|\b401\b|expired.{0,30}token/i.test(error)) return {
    code: 'AGENT_LOGIN', message: '本机采集程序的登录授权异常，请重新登录后继续', details };
  return { code: 'AGENT_EXIT', message: `${name} 执行退出（${result.code}），成果已保留；请展开执行详情检查后继续`, details };
}

export async function detectAgents(profiles = {}) {
  const results = {};
  for (const name of Object.keys(defaults)) {
    const profile = agentProfile(name, profiles);
    if (profile.enabled === false) continue;
    const result = await execute(profile.command, profile.versionArgs || ['--version'], { timeoutMs: 15000, env: commandEnvironment(profile, agentEnvironment()) });
    results[name] = { available: result.code === 0, version: result.code === 0 ? agentVersion(result.tail) || result.tail.trim().slice(0,200) : null, error: result.spawnError || (result.timedOut ? 'timeout' : result.code === 0 ? null : `exit ${result.code}`) };
  }
  return results;
}

export function agentOrder(config, task, available) {
  if (task.agent) return available[task.agent]?.available ? [task.agent] : [];
  if (task.preferredAgent) return available[task.preferredAgent]?.available ? [task.preferredAgent] : [];
  const preferred = task.selectedSkills?.length ? task.selectedSkills.map(s => s.agent) : config.byType?.[task.type] || [];
  return [...new Set([...preferred, config.defaultAgent || 'codex', ...(config.fallbackAgents || ['codebuddy'])])].filter(name => available[name]?.available);
}

export async function runAgent(name, profiles, { cwd, prompt, signal, timeoutMs }) {
  const profile = agentProfile(name, profiles);
  return execute(profile.command, profile.args, { cwd, input: prompt, signal, timeoutMs, env: commandEnvironment(profile, agentEnvironment()), logFile: path.join(cwd, '..', `${name}.log`) });
}
