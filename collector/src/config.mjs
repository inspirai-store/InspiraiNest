import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './common.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadWorkerConfig(file = process.env.COLLECTOR_CONFIG || path.join(project, 'worker.local.json')) {
  file = path.resolve(file);
  const config = fs.existsSync(file) ? readJson(file) : {};
  const base = path.dirname(file);
  for (const key of ['dataDir', 'watchLibrary']) {
    if (config[key]) config[key] = path.resolve(base, config[key]);
  }
  for (const profile of Object.values(config.agents || {})) {
    if (profile.command?.startsWith('.')) profile.command = path.resolve(base, profile.command);
  }
  return { file, config };
}

export function initializeWorkerConfig(file, { captureProfile = false } = {}) {
  const template = path.join(project, captureProfile ? 'worker.capture.example.json' : 'worker.example.json');
  const { config } = loadWorkerConfig(template);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return config;
}
