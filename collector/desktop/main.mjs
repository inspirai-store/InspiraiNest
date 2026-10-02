import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, screen, dialog, systemPreferences } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { WorkerManager } from './manager.mjs';
import electronUpdater from 'electron-updater';
import { DesktopUpdater } from './updater.mjs';
import { macosTrayGUID, macosWorkerActions, statusPanelPosition, createStatusPanelController, createDrainQuitController } from './macos-policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const isMac = process.platform === 'darwin';
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
let main, popover, tray, trayImage, panelController, refreshTimer, clickTimer, quitting = false, exitWhenStopped = false, openingManager = false, managerRevision = 0, dockHideTimer, lastDockHide = 0;
// Test-only main-process hook; never exposed to the renderer or normal launches.
let snapshotForTest;
if (process.env.COLLECTOR_DESKTOP_TEST === '1') globalThis.workerDesktop = () => ({ main, popover, tray, trayImage, updates,
  setSnapshot: value => { snapshotForTest = value; refreshTray(); },
});
function desktopSnapshot() {
  const state = snapshotForTest || { ...manager.snapshot(), quitAfterTask: Boolean(macQuit?.pending) };
  return isMac ? { ...state, actions: macosWorkerActions(state) } : state;
}
const trace = event => {
  if (process.env.COLLECTOR_DESKTOP_TRACE) fs.appendFileSync(process.env.COLLECTOR_DESKTOP_TRACE, JSON.stringify({ event, at: new Date().toISOString() }) + '\n');
};
const macQuit = isMac ? createDrainQuitController({ snapshot: () => manager.snapshot(), stop: () => manager.stop(), quit: () => {
  quitting = true; trace('drained-and-quit');
  // A stopped Worker can reach here synchronously from before-quit. Let that
  // prevented quit finish before starting the real quit, avoiding reentrancy.
  setImmediate(() => app.quit());
} }) : null;
const pageURL = pathToFileURL(path.join(here, 'index.html')).href;
function makeWindow(compact = false) {
  const window = new BrowserWindow({ width: compact ? 390 : 1020, height: compact ? 350 : 760,
    minWidth: compact ? 390 : 740, minHeight: compact ? 350 : 580,
    title: compact ? 'InspiraiNest · 状态' : 'InspiraiNest · 采集 Worker', icon: path.join(here, 'icon.png'), backgroundColor: '#0f1114', show: false,
    frame: !compact, resizable: !compact, skipTaskbar: compact, alwaysOnTop: compact,
    ...(isMac && compact ? { type: 'panel', fullscreenable: false } : {}),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.loadFile(path.join(here, 'index.html'), { query: { ...(compact ? { compact: '1' } : {}), ...(isMac ? { platform: 'darwin' } : {}) } });
  return window;
}
function hideStatus() { if (panelController) panelController.hide(); else popover?.hide(); }
async function openManager() {
  if (!main) return;
  const revision = ++managerRevision;
  openingManager = true;
  clearTimeout(dockHideTimer);
  hideStatus();
  try {
    if (isMac && !app.dock.isVisible()) await app.dock.show();
    if (revision !== managerRevision) { hideDock(); return; }
    if (main.isMinimized()) main.restore();
    main.show(); main.focus(); trace('manager-open');
  } finally { openingManager = false; }
}
function hideDock() {
  if (!isMac) return;
  clearTimeout(dockHideTimer);
  // Electron/macOS can ignore two dock.hide() calls less than a second apart.
  const delay = Math.max(0, lastDockHide + 1100 - Date.now());
  if (delay) dockHideTimer = setTimeout(() => { if (!main.isVisible()) hideDock(); }, delay);
  else { lastDockHide = Date.now(); app.dock.hide(); }
}
function hideManager() {
  managerRevision++;
  main?.hide();
  hideDock();
  trace('manager-hidden');
}
function showStatus() {
  if (!popover || !tray) return;
  const bounds = tray.getBounds();
  const work = screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }).workArea;
  if (isMac) {
    const position = statusPanelPosition(bounds, work, popover.getBounds());
    popover.setPosition(position.x, position.y);
  } else {
    const x = Math.max(work.x, Math.min(bounds.x + bounds.width / 2 - 195, work.x + work.width - 390));
    const y = bounds.y < work.y + work.height / 2 ? work.y + 6 : work.y + work.height - 356;
    popover.setPosition(Math.round(x), Math.round(y));
  }
  popover.show(); popover.focus(); trace('tray-single-status');
}
function icon() {
  const image = nativeImage.createFromPath(path.join(here, isMac ? 'trayTemplate.png' : 'tray.png'));
  if (isMac) image.setTemplateImage(true);
  return image;
}
async function perform(action) {
  if (action === 'start') {
    if (macQuit?.pending) throw new Error('正在完成当前任务后退出应用，请等待 Worker 停止。');
    return manager.start();
  }
  if (['pause', 'resume'].includes(action)) return manager.control(action);
  if (action === 'drain') return isMac ? manager.stop() : manager.control('drain');
  if (action === 'show') { await openManager(); return; }
  if (action === 'hide') { hideManager(); return; }
  if (action === 'remote') { const url = manager.snapshot().server; if (url) await shell.openExternal(url); return; }
  if (action === 'data') { fs.mkdirSync(manager.dataDir, { recursive: true }); const error = await shell.openPath(manager.dataDir); if (error) throw new Error(error); return; }
  if (isMac && ['quit', 'quit-after'].includes(action)) { await macQuit.request(); refreshTray(); return; }
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
    snapshot: desktopSnapshot, action: action => perform(action),
    logs: task => manager.logs(task),
    pair: input => manager.pair(input),
    'task-folder': async task => { const error = await shell.openPath(manager.taskDirectory(task)); if (error) throw new Error(error); },
  })) ipcMain.handle(`worker:${name}`, async (event, argument) => { trusted(event); return fn(argument); });
  for (const [name, fn] of Object.entries({
    status: () => updates.snapshot(), check: () => updates.check(),
    download: () => updates.download(), install: () => updates.install(),
  })) ipcMain.handle(`updates:${name}`, async event => { trusted(event); if (event.sender !== main?.webContents) throw new Error('请在主窗口管理客户端更新'); return fn(); });
}
async function menuAction(action) {
  try { await perform(action); }
  catch (error) {
    if (isMac) await openManager();
    await dialog.showMessageBox(main, { type: 'info', message: error.message });
  }
}
function refreshTray() {
  if (!tray || quitting) return;
  const s = desktopSnapshot();
  const itemState = (action, label, enabled) => isMac ? {
    label: s.actions[action].reason ? `${label} — ${s.actions[action].reason}` : label,
    enabled: s.actions[action].enabled, toolTip: s.actions[action].reason,
  } : { label, enabled };
  const label = s.quitAfterTask ? '完成后停止并退出' : !s.running ? '已停止' : s.legacy ? '旧版运行中' : s.mode === 'draining' ? '完成后停止' : s.mode === 'paused' ? '暂停领取' : s.online ? '在线' : '连接中断';
  tray.setToolTip(`InspiraiNest · ${label}`);
  // On macOS, keep the click handler independent from the supplemental right-click menu.
  const menu = Menu.buildFromTemplate([
    { label: `InspiraiNest · ${label}`, enabled: false },
    { label: '打开管理窗口', click: () => openManager() }, { type: 'separator' },
    { label: '检查客户端更新', click: () => { openManager(); main.webContents.send('updates:open'); } },
    { id: 'worker-start', ...itemState('start', '启动 Worker', !s.running && !s.starting && s.paired && !macQuit?.pending), click: () => menuAction('start') },
    { id: 'worker-pause-resume', ...itemState(s.mode === 'paused' ? 'resume' : 'pause', s.mode === 'paused' ? '继续领取' : '暂停领取（当前任务继续）', s.managed && !s.stale && s.mode !== 'draining'), click: () => menuAction(s.mode === 'paused' ? 'resume' : 'pause') },
    { id: 'worker-drain', ...itemState('drain', isMac ? '停止 Worker（完成当前任务后）' : '完成当前任务后停止', s.managed && !s.stale && s.mode !== 'draining'), click: () => menuAction('drain') },
    { type: 'separator' },
    ...(!isMac ? [{ label: '退出管理器，Worker 继续', click: () => menuAction('quit') }] : []),
    { id: 'quit-after', ...itemState('quit-after', isMac ? '完成当前任务后停止并退出应用' : '完成任务后停止并退出', !s.running || s.managed), click: () => menuAction('quit-after') },
  ]);
  tray.menu = menu;
  if (isMac) macQuit.check();
  else if (exitWhenStopped && !s.running) { quitting = true; trace('drained-and-quit'); app.quit(); }
}
function applicationMenu() {
  if (!isMac) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: '打开管理窗口', click: () => openManager() },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { id: 'safe-quit', label: '完成当前任务后停止并退出 InspiraiNest', accelerator: 'Command+Q', click: () => menuAction('quit-after') },
    ] },
    { role: 'editMenu' }, { role: 'windowMenu' },
  ]));
}
if (!ownsLock) app.quit();
else {
  app.on('second-instance', () => openManager());
  app.on('window-all-closed', () => {});
  app.on('activate', () => {
    // A status panel may activate this accessory app without requesting its manager.
    if (!openingManager && (!isMac || !popover?.isVisible())) openManager();
  });
  app.on('before-quit', event => {
    if (isMac && !quitting) { event.preventDefault(); void menuAction('quit-after'); return; }
    quitting = true; clearInterval(updateTimer); clearTimeout(initialUpdateTimer); updates?.dispose(); clearInterval(refreshTimer); clearTimeout(clickTimer); clearTimeout(dockHideTimer);
  });
  app.whenReady().then(() => {
    updates = new DesktopUpdater({ app, manager, updater: electronUpdater.autoUpdater });
    main = makeWindow(); popover = makeWindow(true);
    updates.on('changed', state => { if (!main.isDestroyed()) main.webContents.send('updates:changed', state); });
    main.on('close', event => { if (!quitting) { event.preventDefault(); hideManager(); trace('close-to-tray'); } });
    if (!isMac) main.on('minimize', event => { event.preventDefault(); hideManager(); trace('minimize-to-tray'); });
    trayImage = icon();
    if (isMac) {
      const guid = macosTrayGUID(manager.dataDir);
      // Registration defaults apply only when the user has no saved placement.
      // AppKit's leftmost initial slot can be obscured by a notch or hide tool.
      systemPreferences.registerDefaults({ [`NSStatusItem Preferred Position ${guid}`]: 0 });
      tray = new Tray(trayImage, guid);
    } else tray = new Tray(trayImage);
    if (isMac) {
      panelController = createStatusPanelController({ panel: popover, show: showStatus, trayBounds: () => tray.getBounds(), cursor: () => screen.getCursorScreenPoint() });
      tray.setIgnoreDoubleClickEvents(true);
      tray.on('click', () => panelController.toggle());
      popover.on('blur', () => panelController.blur());
      popover.webContents.on('before-input-event', (event, input) => { if (input.key === 'Escape') { event.preventDefault(); hideStatus(); } });
    } else {
      popover.on('blur', () => popover.hide());
      tray.on('click', () => { clearTimeout(clickTimer); clickTimer = setTimeout(showStatus, 450); });
      tray.on('double-click', () => { clearTimeout(clickTimer); trace('tray-double-open'); openManager(); });
    }
    tray.on('right-click', () => { clearTimeout(clickTimer); if (isMac) hideStatus(); refreshTray(); tray.popUpContextMenu(tray.menu); });
    registerIPC(); applicationMenu(); refreshTray(); refreshTimer = setInterval(refreshTray, 2000);
    if (process.env.COLLECTOR_DESKTOP_TEST !== '1') {
      initialUpdateTimer = setTimeout(() => updates.check(), 15000);
      updateTimer = setInterval(() => updates.check(), 6 * 60 * 60 * 1000);
    }
    main.once('ready-to-show', () => openManager());
  }).catch(error => { dialog.showErrorBox('管理器启动失败', error.message); quitting = true; app.quit(); });
}
