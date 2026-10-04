import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Overlay this fix on the already-delivered local workbench. Concurrent source
// changes to pairing, server and mobile are not included in this local update.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = path.resolve(project, '../.runtime/local-workbench');
const baseline = path.join(home, 'build/win-unpacked/resources/app');
const staged = path.join(home, 'logs-build/win-unpacked/resources/app');
if (!fs.existsSync(path.join(staged, 'package.json')) || !fs.existsSync(path.join(baseline, 'package.json'))) throw new Error('Build both local directory packages before staging');
for (const directory of ['desktop', 'src']) fs.cpSync(path.join(baseline, directory), path.join(staged, directory), { recursive: true });
const changed = ['desktop/renderer.js', 'desktop/style.css', 'desktop/preload.cjs', 'src/agents.mjs', 'src/worker.mjs', 'src/worker-control.mjs', 'src/worker-events.mjs', 'src/collection-steps.mjs'];
for (const file of changed) fs.copyFileSync(path.join(project, file), path.join(staged, file));
const write = (file, value) => { fs.writeFileSync(path.join(staged, file), value); changed.push(file); };
const read = file => fs.readFileSync(path.join(baseline, file), 'utf8');
let main = read('desktop/main.mjs');
if (!main.includes('activity: task => manager.activity(task)')) main = main.replace('logs: task => manager.logs(task),', 'logs: task => manager.logs(task), activity: task => manager.activity(task),');
if (!main.includes('activity: task => manager.activity(task)')) throw new Error('Main IPC anchor missing');
write('desktop/main.mjs', main);
let manager = read('desktop/manager.mjs');
if (!manager.includes("from '../src/worker-events.mjs'")) manager = "import { readWorkerEvents } from '../src/worker-events.mjs';\n" + manager;
if (!manager.includes('  activity(taskId) {')) manager = manager.replace(/\}\s*$/, `  activity(taskId) {
    const state = workerSnapshot(this.dataDir);
    return readWorkerEvents(this.dataDir, { token: this.configuration().token, taskId, runId: state.running ? state.runId : null });
  }
}
`);
write('desktop/manager.mjs', manager);
const sourceHTML = fs.readFileSync(path.join(project, 'desktop/index.html'), 'utf8');
const panel = sourceHTML.match(/<section class="card logs-card full" id="logs-panel">[\s\S]*?<\/section>/)?.[0];
if (!panel) throw new Error('Source log panel missing');
let html = read('desktop/index.html');
if (!/<section class="card logs-card full" id="logs-panel">/.test(html)) throw new Error('Baseline log panel missing');
html = html.replace(/<section class="card logs-card full" id="logs-panel">[\s\S]*?<\/section>/, panel)
  .replace('>Worker 日志</button>', '>采集日志</button>').replace('>Agent 日志</button>', '>采集详情</button>');
write('desktop/index.html', html);
const manifest = changed.map(file => ({ file, sha256: createHash('sha256').update(fs.readFileSync(path.join(staged, file))).digest('hex') }));
fs.writeFileSync(path.join(home, 'logging-overlay.json'), JSON.stringify({ createdAt: new Date().toISOString(), baseline, staged, files: manifest }, null, 2));
console.log(`Staged ${manifest.length} log-only files on the existing local workbench`);
