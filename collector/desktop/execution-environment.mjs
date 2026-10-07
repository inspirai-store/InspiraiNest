import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { agentEnvironment } from '../src/agents.mjs';

const run = promisify(execFile);
const marker = '\0LINGNEST_EXECUTION_PATH\0';
export async function desktopExecutionEnvironment(source = process.env, { platform = process.platform, shell = source.SHELL || os.userInfo().shell, execute = run } = {}) {
  const result = { ...source };
  if (platform !== 'darwin' || source.COLLECTOR_ELECTRON_NODE !== '1') return result;
  // Finder and login-item launches do not inherit the terminal's tool paths.
  // Read only PATH from this user's shell; never import its exported credentials.
  if (!path.isAbsolute(shell || '') || !['zsh', 'bash', 'sh', 'ksh', 'fish'].includes(path.basename(shell))) shell = '/bin/zsh';
  const command = path.basename(shell) === 'fish'
    ? "printf '\\0LINGNEST_EXECUTION_PATH\\0%s\\0' (string join : $PATH)"
    : "printf '\\0LINGNEST_EXECUTION_PATH\\0%s\\0' \"$PATH\"";
  const env = agentEnvironment(source);
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const { stdout } = await execute(shell, ['-ilc', command], { env, cwd: os.homedir(), encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, windowsHide: true });
    const start = stdout.lastIndexOf(marker);
    if (start < 0) return result;
    const value = stdout.slice(start + marker.length).split('\0')[0];
    if (!value || /[\x00-\x1f]/.test(value)) return result;
    const directories = [...String(source.PATH || '').split(':'), ...value.split(':')].filter(directory => path.isAbsolute(directory));
    result.PATH = [...new Set(directories)].join(':');
  } catch { /* A shell failure must not prevent the manager from starting. */ }
  return result;
}
