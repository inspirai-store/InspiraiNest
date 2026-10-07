import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { hash, canonicalJson, contained } from './common.mjs';

export function agentHome(home = os.homedir(), platform = process.platform) {
  return path.join(home, platform === 'win32' ? 'AppData/Local' : platform === 'darwin' ? 'Library/Application Support' : '.local/share', 'LingNest', 'agents');
}
export function managedState(home, platform) {
  try { return JSON.parse(fs.readFileSync(path.join(agentHome(home, platform), 'current.json'), 'utf8')); } catch { return {}; }
}
export function resolveAgentProfile(name, profile, { home = os.homedir(), platform = process.platform } = {}) {
  // An explicitly configured executable must remain authoritative.
  if (profile.command !== name) return profile;
  const root = agentHome(home, platform), entry = managedState(home, platform)[name];
  if (!entry?.command || !path.isAbsolute(entry.command) || !contained(root, entry.command) || !fs.existsSync(entry.command)) return profile;
  return { ...profile, command: entry.command, managedRuntime: entry.runtime || null };
}
export function commandEnvironment(profile, env) {
  if (!profile.managedRuntime) return env;
  const clean = { ...env, PATH: path.dirname(profile.managedRuntime) + path.delimiter + (env.PATH || ''), DISABLE_AUTOUPDATER:'1', DISABLE_UPDATES:'1' };
  delete clean.ELECTRON_RUN_AS_NODE;
  return clean;
}
export function executable(command, env = process.env, platform = process.platform) {
  const suffixes = platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const directory of path.isAbsolute(command) ? [''] : String(env.PATH || '').split(path.delimiter)) {
    for (const suffix of suffixes) {
      const file = directory ? path.join(directory, command + suffix) : command + suffix;
      try { fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); if (fs.statSync(file).isFile()) return path.resolve(file); } catch {}
    }
  }
  return null;
}
export const installationFingerprint = value => hash(canonicalJson({ command: value.command, version: value.version, source: value.source }));
export function agentVersion(output) {
  return String(output || '').split('\n').reverse().map(line=>line.trim()).find(line=>/^(?:[a-zA-Z][a-zA-Z0-9 ._-]{0,60}\s+)?v?\d+\.\d+\.\d+(?:[-+][^\s]+)?(?:\s.*)?$/.test(line))?.slice(0,150) || null;
}
