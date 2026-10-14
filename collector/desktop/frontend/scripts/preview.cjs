const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'inspirainest-ui-review-'));
app.setPath('userData', profile);
app.setName('InspiraiNest UI Review');
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1240, height: 820, useContentSize: true, minWidth: 740, minHeight: 580,
    title: '灵藏 · 页面骨架验收', backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await window.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/records/new' });
});
app.on('window-all-closed', () => app.quit());
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
