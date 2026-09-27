import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, screen, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { WorkerManager } from './manager.mjs';
import electronUpdater from 'electron-updater';
import { DesktopUpdater } from './updater.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
if (app.isPackaged) {
  const home = path.join(app.getPath('appData'), 'LibraryWorker');
  fs.mkdirSync(home, { recursive: true });
  process.env.COLLECTOR_CONFIG ||= path.join(home, 'worker.local.json');
  process.env.COLLECTOR_NODE = process.execPath;
  process.env.COLLECTOR_ELECTRON_NODE = '1';
  process.env.COLLECTOR_LIBRARY_ROOT = path.join(process.resourcesPath, 'library');
  if (!fs.existsSync(process.env.COLLECTOR_CONFIG)) {
    fs.copyFileSync(path.join(here, '..', 'worker.production.example.json'), process.env.COLLECTOR_CONFIG);
  }
}
const manager = new WorkerManager();
const scope = createHash('sha256').update(manager.dataDir.toLowerCase()).digest('hex').slice(0, 16);
app.setPath('userData', path.join(app.getPath('appData'), 'LibraryWorker', scope));
app.setName('InspiraiNest');
const ownsLock = app.requestSingleInstanceLock();
let updates, updateTimer, initialUpdateTimer;
let main, popover, tray, refreshTimer, clickTimer, quitting = false, exitWhenStopped = false;
// Test-only main-process hook; never exposed to the renderer or normal launches.
if (process.env.COLLECTOR_DESKTOP_TEST === '1') globalThis.workerDesktop = () => ({ main, popover, tray, updates });
const trace = event => {
  if (process.env.COLLECTOR_DESKTOP_TRACE) fs.appendFileSync(process.env.COLLECTOR_DESKTOP_TRACE, JSON.stringify({ event, at: new Date().toISOString() }) + '\n');
};
const pageURL = pathToFileURL(path.join(here, 'index.html')).href;
function makeWindow(compact = false) {
  const window = new BrowserWindow({ width: compact ? 390 : 1020, height: compact ? 350 : 760,
    minWidth: compact ? 390 : 740, minHeight: compact ? 350 : 580,
    title: compact ? 'InspiraiNest · 状态' : 'InspiraiNest · 采集 Worker', icon: path.join(here, 'icon.png'), backgroundColor: '#0f1114', show: false,
    frame: !compact, resizable: !compact, skipTaskbar: compact, alwaysOnTop: compact,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.loadFile(path.join(here, 'index.html'), { query: compact ? { compact: '1' } : {} });
  return window;
}
function openManager() { if (!main) return; popover?.hide(); main.show(); main.restore(); main.focus(); trace('manager-open'); }
function showStatus() {
  if (!popover) return;
  const bounds = tray.getBounds();
  const work = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
  const x = Math.max(work.x, Math.min(bounds.x + bounds.width / 2 - 195, work.x + work.width - 390));
  const y = bounds.y < work.y + work.height / 2 ? work.y + 6 : work.y + work.height - 356;
  popover.setPosition(Math.round(x), Math.round(y));
  popover.show(); popover.focus(); trace('tray-single-status');
}
function icon() {
  return nativeImage.createFromPath(path.join(here, 'tray.png'));
}
async function perform(action) {
  if (action === 'start') return manager.start();
  if (['pause', 'resume', 'drain'].includes(action)) return manager.control(action);
  if (action === 'show') { openManager(); return; }
  if (action === 'hide') { main.hide(); trace('manager-hidden'); return; }
  if (action === 'remote') { const url = manager.snapshot().server; if (url) await shell.openExternal(url); return; }
  if (action === 'data') { fs.mkdirSync(manager.dataDir, { recursive: true }); const error = await shell.openPath(manager.dataDir); if (error) throw new Error(error); return; }
  if (action === 'quit') { quitting = true; trace('manager-quit-worker-kept'); app.quit(); return; }
  if (action === 'quit-after') {
    if (manager.snapshot().running) await manager.control('drain');
    exitWhenStopped = true; return;
  }
  throw new Error('不支持的操作');
}
function trusted(event) {
  const sender = event.senderFrame?.url;
  if (![main?.webContents, popover?.webContents].includes(event.sender) || !sender || sender.split('?')[0] !== pageURL) throw new Error('不允许的页面');
}
function registerIPC() {
  for (const [name, fn] of Object.entries({
    snapshot: () => manager.snapshot(), action: action => perform(action),
    logs: task => manager.logs(task),
    pair: input => manager.pair(input),
    'task-folder': async task => { const error = await shell.openPath(manager.taskDirectory(task)); if (error) throw new Error(error); },
  })) ipcMain.handle(`worker:${name}`, async (event, argument) => { trusted(event); return fn(argument); });
  for (const [name, fn] of Object.entries({
    status: () => updates.snapshot(), check: () => updates.check(),
    download: () => updates.download(), install: () => updates.install(),
  })) ipcMain.handle(`updates:${name}`, async event => { trusted(event); if (event.sender !== main?.webContents) throw new Error('请在主窗口管理客户端更新'); return fn(); });
}
async function menuAction(action) { try { await perform(action); } catch (error) { await dialog.showMessageBox(main, { type: 'info', message: error.message }); } }
function refreshTray() {
  const s = manager.snapshot();
  const label = !s.running ? '已停止' : s.legacy ? '旧版运行中' : s.mode === 'draining' ? '完成后停止' : s.mode === 'paused' ? '暂停领取' : s.online ? '在线' : '连接中断';
  tray.setToolTip(`InspiraiNest · ${label}`);
  // Do not setContextMenu on macOS: it suppresses click/double-click delivery.
  const menu = Menu.buildFromTemplate([
    { label: `InspiraiNest · ${label}`, enabled: false },
    { label: '打开管理窗口', click: openManager }, { type: 'separator' },
    { label: '检查客户端更新', click: () => { openManager(); main.webContents.send('updates:open'); } },
    { label: '启动 Worker', enabled: !s.running && !s.starting && s.paired, click: () => menuAction('start') },
    { label: s.mode === 'paused' ? '继续领取' : '暂停领取（当前任务继续）', enabled: s.managed && !s.stale && s.mode !== 'draining', click: () => menuAction(s.mode === 'paused' ? 'resume' : 'pause') },
    { label: '完成当前任务后停止', enabled: s.managed && !s.stale && s.mode !== 'draining', click: () => menuAction('drain') },
    { type: 'separator' }, { label: '退出管理器，Worker 继续', click: () => menuAction('quit') },
    { label: '完成任务后停止并退出', enabled: !s.running || s.managed, click: () => menuAction('quit-after') },
  ]);
  tray.menu = menu;
  if (exitWhenStopped && !s.running) { quitting = true; trace('drained-and-quit'); app.quit(); }
}
if (!ownsLock) app.quit();
else {
  app.on('second-instance', openManager);
  app.on('window-all-closed', () => {});
  app.on('activate', openManager);
  app.on('before-quit', () => { quitting = true; clearInterval(refreshTimer); clearInterval(updateTimer); clearTimeout(initialUpdateTimer); clearTimeout(clickTimer); updates?.dispose(); });
  app.whenReady().then(() => {
    updates = new DesktopUpdater({ app, manager, updater: electronUpdater.autoUpdater });
    main = makeWindow(); popover = makeWindow(true);
    updates.on('changed', state => { if (!main.isDestroyed()) main.webContents.send('updates:changed', state); });
    main.on('close', event => { if (!quitting) { event.preventDefault(); main.hide(); trace('close-to-tray'); } });
    main.on('minimize', event => { event.preventDefault(); main.hide(); trace('minimize-to-tray'); });
    popover.on('blur', () => popover.hide());
    tray = new Tray(icon());
    tray.on('click', () => { clearTimeout(clickTimer); clickTimer = setTimeout(showStatus, 450); });
    tray.on('double-click', () => { clearTimeout(clickTimer); trace('tray-double-open'); openManager(); });
    tray.on('right-click', () => { clearTimeout(clickTimer); refreshTray(); tray.popUpContextMenu(tray.menu); });
    registerIPC(); refreshTray(); refreshTimer = setInterval(refreshTray, 2000);
    if (process.env.COLLECTOR_DESKTOP_TEST !== '1') {
      initialUpdateTimer = setTimeout(() => updates.check(), 15000);
      updateTimer = setInterval(() => updates.check(), 6 * 60 * 60 * 1000);
    }
    main.once('ready-to-show', openManager);
  }).catch(error => { dialog.showErrorBox('管理器启动失败', error.message); app.quit(); });
}
