import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, screen, dialog, systemPreferences, safeStorage, nativeTheme, powerMonitor } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { WorkerManager } from './manager.mjs';
import { OwnerClient } from './owner-client.mjs';
import electronUpdater from 'electron-updater';
import { DesktopUpdater } from './updater.mjs';
import { DesktopSettings } from './settings.mjs';
import { DesktopLoginItem } from './login-item.mjs';
import { WorkerSession } from './worker-session.mjs';
import { clientOrigin } from '../src/client-login.mjs';
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
const scope = createHash('sha256').update(path.resolve(manager.configuration().loginDataRoot || manager.dataDir).toLowerCase()).digest('hex').slice(0, 16);
app.setPath('userData', path.join(app.getPath('appData'), 'LibraryWorker', scope));
// Keep the existing safeStorage Keychain namespace across display-name updates.
// macOS shows the packaged bundle name and the application menu below as 灵藏.
app.setName('InspiraiNest');
const ownsLock = app.requestSingleInstanceLock();
// Isolated GUI fixtures opt in explicitly; normal launches always use OS encryption.
const credentialEncryption = process.env.COLLECTOR_DESKTOP_TEST === '1' && process.env.COLLECTOR_DESKTOP_STORAGE_FIXTURE === '1'
  ? { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('fixture:' + value), decryptString: value => value.toString().slice(8) }
  : safeStorage;
let owner, updates, settings, workerSession, loginItem, endingSession = false, updateTimer, initialUpdateTimer, loginController;
let main, popover, tray, trayImage, panelController, refreshTimer, clickTimer, quitting = false, exitWhenStopped = false, openingManager = false, managerRevision = 0, dockHideTimer, lastDockHide = 0;
// Test-only main-process hook; never exposed to the renderer or normal launches.
let snapshotForTest;
if (process.env.COLLECTOR_DESKTOP_TEST === '1') globalThis.workerDesktop = () => ({ main, popover, tray, trayImage, updates, owner,
  loginItem,
  checkNativeLoginItem: () => {
    const item = new DesktopLoginItem({ app, name: 'InspiraiNest-Test-' + process.pid });
    try { item.configure(true); const on = item.snapshot(); item.configure(false, { explicit: true }); return { on, off: item.snapshot() }; }
    finally { item.configure(false, { explicit: true }); }
  },
  ownerState: () => owner.state(),
  setSnapshot: value => { snapshotForTest = value; refreshTray(); },
});
function desktopSnapshot() {
  const snapshot = manager.snapshot();
  const state = snapshotForTest || { ...snapshot, launchError: snapshot.launchError || workerSession?.error, quitAfterTask: Boolean(macQuit?.pending) };
  return isMac ? { ...state, actions: macosWorkerActions(state) } : state;
}
const trace = event => {
  if (process.env.COLLECTOR_DESKTOP_TRACE) fs.appendFileSync(process.env.COLLECTOR_DESKTOP_TRACE, JSON.stringify({ event, at: new Date().toISOString() }) + '\n');
};
const macQuit = isMac ? createDrainQuitController({ snapshot: () => manager.snapshot(), stop: () => workerSession.stop(), quit: () => {
  quitting = true; trace('drained-and-quit');
  // A stopped Worker can reach here synchronously from before-quit. Let that
  // prevented quit finish before starting the real quit, avoiding reentrancy.
  setImmediate(() => app.quit());
} }) : null;
const pageURL = pathToFileURL(path.join(here, 'index.html')).href;
const liveWindow = window => Boolean(window && !window.isDestroyed());
const exiting = () => quitting || endingSession || updates?.snapshot().phase === 'installing';
function makeWindow(compact = false) {
  const window = new BrowserWindow({ width: compact ? 390 : 1240, height: compact ? 350 : 820,
    minWidth: compact ? 390 : 740, minHeight: compact ? 350 : 580,
    title: compact ? '灵藏 · 状态' : '灵藏 · 桌面工作台', icon: path.join(here, 'icon.png'), backgroundColor: settings.background(), show: false,
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
function hideStatus() { if (panelController) panelController.hide(); else if (!exiting() && liveWindow(popover)) popover.hide(); }
async function openManager() {
  if (exiting() || !liveWindow(main)) return;
  const window = main;
  const revision = ++managerRevision;
  openingManager = true;
  clearTimeout(dockHideTimer);
  hideStatus();
  try {
    if (isMac && !app.dock.isVisible()) await app.dock.show();
    if (exiting() || !liveWindow(window)) return;
    if (revision !== managerRevision) { hideDock(); return; }
    if (window.isMinimized()) window.restore();
    window.show(); window.focus(); trace('manager-open');
  } finally { openingManager = false; }
}
function hideDock() {
  if (!isMac || exiting() || !liveWindow(main)) return;
  clearTimeout(dockHideTimer);
  // Electron/macOS can ignore two dock.hide() calls less than a second apart.
  const delay = Math.max(0, lastDockHide + 1100 - Date.now());
  if (delay) dockHideTimer = setTimeout(() => { if (!exiting() && liveWindow(main) && !main.isVisible()) hideDock(); }, delay);
  else { lastDockHide = Date.now(); app.dock.hide(); }
}
function hideManager() {
  if (exiting() || !liveWindow(main)) return;
  managerRevision++;
  main.hide();
  hideDock();
  trace('manager-hidden');
}
function showStatus() {
  if (exiting() || !liveWindow(popover) || !tray || tray.isDestroyed()) return;
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
    if (macQuit?.pending) throw new Error('正在完成当前任务后退出应用，请等待工作节点停止。');
    if (['waiting_worker', 'installing'].includes(updates?.snapshot().phase)) throw new Error('正在安装客户端更新，请等待安装完成。');
    return workerSession.start();
  }
  if (['pause', 'resume'].includes(action)) return workerSession.control(action);
  if (action === 'drain') return workerSession.stop();
  if (action === 'show') { await openManager(); return; }
  if (action === 'hide') { hideManager(); return; }
  if (action === 'remote') { const url = manager.snapshot().server; if (url) await shell.openExternal(url); return; }
  if (action === 'data') { fs.mkdirSync(manager.dataDir, { recursive: true }); const error = await shell.openPath(manager.dataDir); if (error) throw new Error(error); return; }
  if (isMac && ['quit', 'quit-after'].includes(action)) { await macQuit.request(); workerSession.record('stopped'); refreshTray(); return; }
  if (action === 'quit') { quitting = true; trace('manager-quit-worker-kept'); app.quit(); return; }
  if (action === 'quit-after') {
    await workerSession.stop();
    exitWhenStopped = true; return;
  }
  throw new Error('不支持的操作');
}
function trusted(event) {
  const sender = event.senderFrame?.url;
  if (![main?.webContents, popover?.webContents].includes(event.sender) || !sender || sender.split('?')[0] !== pageURL) throw new Error('不允许的页面');
}
function trustedMain(event) {
  trusted(event);
  if (event.sender !== main?.webContents) throw new Error('此功能只允许在主窗口使用');
}
async function pairDesktop(input) {
  clientOrigin(input.server);
  if (loginController) throw new Error('登录正在进行');
  if (!owner.encryption.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存设备授权');
  const controller = new AbortController(); loginController = controller;
  try {
    const result = await manager.pair(input, { clientType: 'desktop', signal: controller.signal,
      current: () => loginController === controller && !controller.signal.aborted,
      onPaired: ({ server, installationId, result }) => owner.saveCredential({ server, installationId, deviceId: result.device.id, token: result.ownerToken }, { allowServerChange: true }) });
    main.webContents.send('library:changed', owner.status());
    return result;
  } catch (error) {
    return { loginError: { code: error.code || '', status: error.status || 0,
      message: controller.signal.aborted ? '登录已取消' : error.message } };
  } finally { if (loginController === controller) loginController = null; }
}
function registerIPC() {
  ipcMain.handle('desktop-settings:get', event => { trusted(event); return settings.snapshot(); });
  ipcMain.handle('desktop-settings:update', (event, input) => { trustedMain(event); return settings.update(input); });
  for (const [name, fn] of Object.entries({
    snapshot: desktopSnapshot, action: action => perform(action),
    logs: task => manager.logs(task), activity: task => manager.activity(task),
    pair: input => pairDesktop(input),
    'task-folder': async task => { const error = await shell.openPath(manager.taskDirectory(task)); if (error) throw new Error(error); },
    'skill-config': async agent => {
      if(!['codex','codebuddy','claude'].includes(agent))throw new Error('Agent 无效');
      const directory=path.join(os.homedir(),agent==='codex'?'.codex':'.'+agent);
      fs.mkdirSync(directory,{recursive:true});const error=await shell.openPath(directory);if(error)throw new Error(error);
    },
  })) ipcMain.handle(`worker:${name}`, async (event, argument) => { if (['pair','skill-config'].includes(name)) trustedMain(event); else trusted(event); return fn(argument); });
  const library = {
    status: () => owner.status(), pair: async input => { const result = await pairDesktop(input); return result.loginError ? result : owner.status(); },
    'cancel-login': () => { loginController?.abort(); return true; },
    logout: () => { loginController?.abort(); return owner.logout(); },
    state: () => owner.state(), entries: input => owner.entries(input), entry: id => owner.entry(id),
    skills: input => owner.skills(input),
    content: input => owner.content(input), preview: input => owner.preview(input),
    task: input => owner.createTask(input), 'task-action': input => owner.taskAction(input),
    draft: id => owner.draft(id), pairing: () => owner.pairing(), revoke: id => owner.revoke(id),
    trash: () => owner.trash(), remove: id => owner.removeArchive(id), restore: id => owner.restoreArchive(id),
    download: async input => {
      const file = await owner.fileBytes(input);
      const saved = await dialog.showSaveDialog(main, { defaultPath: file.name });
      if (saved.canceled || !saved.filePath) return { saved: false };
      fs.writeFileSync(saved.filePath, file.bytes);
      return { saved: true, path: saved.filePath };
    },
    source: async id => {
      const entry = await owner.entry(id);
      const raw = entry.canonical_url || entry.source_url;
      if (!raw) throw new Error('这条资料没有来源链接');
      const url = new URL(raw);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('来源链接无效');
      await shell.openExternal(url.href);
    },
  };
  for (const [name, fn] of Object.entries(library)) ipcMain.handle(`library:${name}`, async (event, argument) => { trustedMain(event); return fn(argument); });
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
  if (!snapshotForTest) workerSession?.observe();
  const s = desktopSnapshot();
  const itemState = (action, label, enabled) => isMac ? {
    label: s.actions[action].reason ? `${label} — ${s.actions[action].reason}` : label,
    enabled: s.actions[action].enabled, toolTip: s.actions[action].reason,
  } : { label, enabled };
  const label = s.quitAfterTask ? '完成后停止并退出' : !s.running ? '已停止' : s.legacy ? '旧版运行中' : s.mode === 'draining' ? '完成后停止' : s.mode === 'paused' ? '暂停领取' : s.online ? '在线' : '连接中断';
  tray.setToolTip(`灵藏 · ${label}`);
  // On macOS, keep the click handler independent from the supplemental right-click menu.
  const menu = Menu.buildFromTemplate([
    { label: `灵藏 · ${label}`, enabled: false },
    { label: '打开管理窗口', click: () => openManager() }, { type: 'separator' },
    { label: '检查客户端更新', click: async () => { await openManager(); if (!exiting() && liveWindow(main)) main.webContents.send('updates:open'); } },
    { id: 'worker-start', ...itemState('start', '启动工作节点', !s.running && !s.starting && s.paired && !macQuit?.pending), click: () => menuAction('start') },
    { id: 'worker-pause-resume', ...itemState(s.mode === 'paused' ? 'resume' : 'pause', s.mode === 'paused' ? '继续领取' : '暂停领取（当前任务继续）', s.managed && !s.stale && s.mode !== 'draining'), click: () => menuAction(s.mode === 'paused' ? 'resume' : 'pause') },
    { id: 'worker-drain', ...itemState('drain', isMac ? '停止工作节点（完成当前任务后）' : '完成当前任务后停止', s.managed && !s.stale && s.mode !== 'draining'), click: () => menuAction('drain') },
    { type: 'separator' },
    ...(!isMac ? [{ label: '退出管理器，工作节点继续', click: () => menuAction('quit') }] : []),
    { id: 'quit-after', ...itemState('quit-after', isMac ? '完成当前任务后停止并退出应用' : '完成任务后停止并退出', !s.running || s.managed), click: () => menuAction('quit-after') },
  ]);
  tray.menu = menu;
  if (isMac) macQuit.check();
  else if (exitWhenStopped && !s.running) { quitting = true; trace('drained-and-quit'); app.quit(); }
}
function applicationMenu() {
  if (!isMac) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '灵藏', submenu: [
      { role: 'about', label: '关于灵藏' }, { type: 'separator' },
      { label: '打开管理窗口', click: () => openManager() },
      { role: 'hide', label: '隐藏灵藏' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { id: 'safe-quit', label: '完成当前任务后停止并退出灵藏', accelerator: 'Command+Q', click: () => menuAction('quit-after') },
    ] },
    { role: 'editMenu' }, { role: 'windowMenu' },
  ]));
}
if (!ownsLock) app.quit();
else {
  app.on('second-instance', (_event, argv) => { if (!argv.includes('--startup')) openManager(); });
  app.on('window-all-closed', () => {});
  app.on('activate', () => {
    // A status panel may activate this accessory app without requesting its manager.
    if (!exiting() && !openingManager && (!isMac || !liveWindow(popover) || !popover.isVisible())) openManager();
  });
  app.on('before-quit', event => {
    workerSession?.observe();
    if (isMac && !quitting && !endingSession && updates?.snapshot().phase !== 'installing') { event.preventDefault(); void menuAction('quit-after'); return; }
    quitting = true; managerRevision++; loginController?.abort(); panelController?.dispose(); clearInterval(updateTimer); clearTimeout(initialUpdateTimer); updates?.dispose(); settings?.dispose(); clearInterval(refreshTimer); clearTimeout(clickTimer); clearTimeout(dockHideTimer);
  });
  app.whenReady().then(() => {
    loginItem = new DesktopLoginItem({ app, test: process.env.COLLECTOR_DESKTOP_TEST === '1' });
    settings = new DesktopSettings({ file: path.join(app.getPath('userData'), 'desktop-settings.json'), nativeTheme, loginItem });
    workerSession = new WorkerSession({ file: path.join(app.getPath('userData'), 'desktop-worker-state.json'), manager });
    owner = new OwnerClient({ file: path.join(app.getPath('userData'), 'owner-auth.json'),
      workerServer: () => manager.snapshot().paired ? manager.snapshot().server : '', encryption: credentialEncryption, identityDir: manager.dataDir });
    updates = new DesktopUpdater({ app, manager: { snapshot: () => manager.snapshot(), control: () => workerSession.drainForUpdate() }, updater: electronUpdater.autoUpdater });
    main = makeWindow(); popover = makeWindow(true);
    settings.on('changed', value => {
      for (const window of [main, popover]) if (window && !window.isDestroyed()) {
        window.setBackgroundColor(settings.background());
        window.webContents.send('desktop-settings:changed', value);
      }
    });
    updates.on('changed', state => { if (liveWindow(main)) main.webContents.send('updates:changed', state); });
    main.on('close', event => {
      loginController?.abort();
      // Squirrel closes windows before app.before-quit. Installation must pass
      // through this handler instead of applying the normal close-to-tray policy.
      if (exiting()) return;
      workerSession.observe();
      event.preventDefault();
      if (settings.snapshot().closeBehavior === 'quit') {
        // This explicit window preference exits only the manager, including on macOS.
        // Command+Q, drain-and-quit and updater installation keep their safe-stop paths.
        quitting = true; trace('close-manager-worker-kept'); setImmediate(() => app.quit());
      } else { hideManager(); trace('close-to-tray'); }
    });
    main.on('blur', () => loginController?.abort());
    main.on('hide', () => loginController?.abort());
    main.once('closed', () => { main = null; managerRevision++; });
    popover.once('closed', () => { panelController?.dispose(); popover = null; });
    const sessionEnding = () => { endingSession = true; workerSession.observe(); };
    main.on('query-session-end', sessionEnding); main.on('session-end', sessionEnding);
    powerMonitor.on('shutdown', sessionEnding);
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
      panelController = createStatusPanelController({ panel: popover, show: showStatus, isActive: () => !exiting(), trayBounds: () => tray.getBounds(), cursor: () => screen.getCursorScreenPoint() });
      tray.setIgnoreDoubleClickEvents(true);
      tray.on('click', () => panelController.toggle());
      popover.on('blur', () => panelController.blur());
      popover.webContents.on('before-input-event', (event, input) => { if (input.key === 'Escape') { event.preventDefault(); hideStatus(); } });
    } else {
      popover.on('blur', hideStatus);
      tray.on('click', () => { clearTimeout(clickTimer); clickTimer = setTimeout(showStatus, 450); });
      tray.on('double-click', () => { clearTimeout(clickTimer); trace('tray-double-open'); openManager(); });
    }
    tray.on('right-click', () => { clearTimeout(clickTimer); if (isMac) hideStatus(); refreshTray(); tray.popUpContextMenu(tray.menu); });
    registerIPC(); applicationMenu(); refreshTray(); refreshTimer = setInterval(refreshTray, 2000);
    void workerSession.restore().then(() => refreshTray());
    if (process.env.COLLECTOR_DESKTOP_TEST !== '1') {
      initialUpdateTimer = setTimeout(() => updates.check(), 15000);
      updateTimer = setInterval(() => updates.check(), 6 * 60 * 60 * 1000);
    }
    main.once('ready-to-show', () => process.argv.includes('--startup') || loginItem.openedAtLogin ? hideManager() : openManager());
  }).catch(error => { dialog.showErrorBox('管理器启动失败', error.message); quitting = true; app.quit(); });
}
