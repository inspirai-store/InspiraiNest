import {collectorRoot,collectorPath} from '../../tooling/layout.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const project = collectorRoot;
const require = createRequire(collectorPath( 'desktop/package.json'));
try {
  const electron = process.env.COLLECTOR_DESKTOP_EXECUTABLE || (() => {
    try { return require('electron'); }
    catch { return createRequire(collectorPath( 'package.json'))('electron'); }
  })();
  const data = collectorPath( 'worker-data');
  fs.mkdirSync(data, { recursive: true });
  const log = fs.openSync(path.join(data, 'desktop.log'), 'a', 0o600);
  const env = { ...process.env, COLLECTOR_NODE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [collectorPath( 'desktop')], { cwd: project, env,
    detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  child.on('error', error => { console.error(`Desktop failed to start: ${error.message}`); process.exitCode = 1; });
  child.unref(); fs.closeSync(log);
} catch {
  console.error('Install desktop dependencies first: cd collector/desktop && npm ci && node node_modules/electron/install.js');
  process.exitCode = 1;
}
