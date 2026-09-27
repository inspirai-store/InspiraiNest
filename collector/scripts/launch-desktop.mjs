import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(project, 'desktop/package.json'));
try {
  const electron = require('electron');
  const data = path.join(project, 'worker-data');
  fs.mkdirSync(data, { recursive: true });
  const log = fs.openSync(path.join(data, 'desktop.log'), 'a', 0o600);
  const env = { ...process.env, COLLECTOR_NODE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(project, 'desktop')], { cwd: project, env,
    detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  child.on('error', error => { console.error(`Desktop failed to start: ${error.message}`); process.exitCode = 1; });
  child.unref(); fs.closeSync(log);
} catch {
  console.error('Install desktop dependencies first: cd collector/desktop && npm ci && node node_modules/electron/install.js');
  process.exitCode = 1;
}
