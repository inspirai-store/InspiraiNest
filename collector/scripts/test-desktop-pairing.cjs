const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const QRCode = require('qrcode');
const {showSettings,setTheme} = require('./desktop-test-helpers.cjs');

// A separate desktop scope and synthetic IPC replies never use production credentials.
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-pairing-'));
  const config = path.join(root, 'worker.json');
  fs.writeFileSync(config, JSON.stringify({ server: 'https://fixture.invalid', dataDir: path.join(root, 'data') }));
  const env = { ...process.env, COLLECTOR_CONFIG: config, COLLECTOR_DESKTOP_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: process.argv[2] ? path.resolve(process.argv[2]) : require('electron'), args: process.argv[2] ? [] : [path.resolve(__dirname, '../desktop')], env });
  const output = path.resolve(__dirname, '../test-output/desktop-pairing');
  fs.mkdirSync(output, { recursive: true });
  let webServer;
  try {
    await app.firstWindow();
    await app.evaluate(async ({ ipcMain }, qrDataUrl) => {
      const fixture = globalThis.pairingFixture = { delay: 700, failures: 0, lifetime: 900000, calls: 0, completed: 0 };
      const mainId = globalThis.workerDesktop().main.webContents.id;
      const handle = (name, fn) => {
        ipcMain.removeHandler('library:' + name);
        ipcMain.handle('library:' + name, (event, ...args) => {
          if (event.sender.id !== mainId) throw new Error('Main window required');
          return fn(...args);
        });
      };
      handle('status', () => ({ paired: true, server: 'https://fixture.invalid', deviceId: 'fixture-owner' }));
      handle('state', () => ({ me: { id: 'fixture-owner' }, tasks: [], archives: [], devices: Array.from({ length: 16 }, (_, i) => ({
        id: i === 0 ? 'fixture-owner' : 'fixture-' + i, name: i === 1 ? '很长的设备名称 <script>unsafe</script> 用于验证截断和转义' : '合成电脑 ' + i, role: 'worker', category: 'desktop', online: i === 0,
        workerAuthorized: true, agents: ['codex'], capabilities: ['article'],
        displayName: 'Windows 11 · 客户端登录', lastSeen: new Date().toISOString(),
        deviceInfo: { model:'System Product Name', client:{ version:'0.1.11' } }, identity:{source:'smbios',shortId:'fixture123456'},
      })) }));
      handle('entries', () => ({ items: [], total: 0 }));
      handle('pairing', async () => {
        const call = ++fixture.calls, { delay, lifetime } = fixture;
        const fail = fixture.failures > 0;
        if (fail) fixture.failures--;
        await new Promise(resolve => setTimeout(resolve, delay));
        fixture.completed++;
        if (fail) throw new Error('合成网络连接失败');
        return { key: 'fixture-pairing-' + call, expiresAt: new Date(Date.now() + lifetime).toISOString(), qrDataUrl };
      });
    }, await QRCode.toDataURL('fixture-only-no-authority'));
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find(p => p.url().startsWith('file:') && !p.url().includes('compact=1'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(page);
    await page.reload();
    await page.locator('#overview-data').waitFor({ state: 'visible' });
    await setTheme(page,'dark');await showSettings(page,'devices');
    assert.equal(await page.locator('.device-card').count(), 16);
    assert.equal(await page.locator('.device-card script').count(), 0);
    assert.equal(await page.locator('.device-current').count(), 1);
    const geometry = async () => {
      const layout = await page.evaluate(() => {
        const rect = selector => { const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
        return {headingDisplay:getComputedStyle(document.querySelector('.pairing-heading')).display,codeDisplay:getComputedStyle(document.querySelector('.pairing-code')).display,
          heading:rect('.pairing-heading'),close:rect('[data-close-dialog=pair-dialog]'),key:rect('#pair-key'),copy:rect('#copy-key'),qr:rect('#pair-qr'),
          closeIcon:rect('[data-close-dialog=pair-dialog] svg'),copyIcon:rect('#copy-key svg'),dialog:rect('#pair-dialog'),viewport:{width:innerWidth,height:innerHeight}};
      });
      assert.equal(layout.headingDisplay,'flex','pairing stylesheet must actually load');assert.equal(layout.codeDisplay,'flex');
      assert.ok(layout.close.x>layout.heading.x+layout.heading.width/2&&layout.close.bottom<=layout.heading.bottom,'close stays in the top right of the header');
      assert.ok(Math.abs(layout.copy.y-layout.key.y)<=4&&layout.copy.x>=layout.key.right,'copy stays beside the input');
      assert.equal(layout.closeIcon.width,18);assert.equal(layout.copyIcon.width,18);
      assert.ok(layout.dialog.x>=0&&layout.dialog.right<=layout.viewport.width&&layout.dialog.y>=0&&layout.dialog.bottom<=layout.viewport.height,'dialog fits the viewport');
      return layout;
    };
    await page.setViewportSize({ width: 740, height: 580 });
    await page.locator('#pair-device').click();
    await page.locator('#pair-dialog[open]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pair-status').innerText(), '正在生成配对码…');
    assert.equal(await page.locator('#pair-generate').isDisabled(), true);
    await page.locator('#pair-key').waitFor({ state: 'visible' });
    assert.equal(await app.evaluate(() => globalThis.pairingFixture.calls), 1);
    assert.equal(await page.locator('#pair-qr').isVisible(), true);
    await page.locator('#pair-qr').evaluate(img => img.decode());
    assert.equal(await page.locator('#pair-key').getAttribute('type'), 'password');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.fixtureCopiedKey = value; } } }));
    await page.locator('#copy-key').click();
    assert.equal(await page.evaluate(() => window.fixtureCopiedKey), await page.locator('#pair-key').inputValue());
    await page.locator('#copy-key[aria-label="配对码已复制"]').waitFor();
    const box = await page.locator('#pair-key').boundingBox();
    const height = await page.evaluate(() => innerHeight);
    assert.ok(box.y >= 0 && box.y + box.height <= height, 'pairing must be visible above a long device list');
    const desktopLayout = await page.locator('#pair-dialog').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
    assert.ok(desktopLayout.width <= 400 && desktopLayout.height < 460, 'pairing stays compact');
    await geometry();
    const pairActionIcon=await page.locator('#pair-device svg').boundingBox();assert.equal(pairActionIcon.width,16);
    for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#pair-dialog')),true,'modal traps keyboard focus');}
    await page.screenshot({ path: path.join(output, 'pairing-narrow-fixture.png') });
    await page.evaluate(() => window.desktopSettings.update({themeMode:'light'}));
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(output, 'pairing-light-fixture.png') });
    await geometry();
    await page.setViewportSize({width:1240,height:820});
    await page.screenshot({path:path.join(output,'pairing-standard-light-fixture.png')});
    await page.evaluate(() => window.desktopSettings.update({themeMode:'dark'}));
    await page.screenshot({path:path.join(output,'pairing-standard-dark-fixture.png')});
    await geometry();
    await page.locator('[data-close-dialog=pair-dialog]').click();
    await page.waitForFunction(() => document.querySelector('#pair-key').value === '');
    assert.equal(await page.locator('#pair-key').inputValue(), '');
    assert.equal(await page.locator('#pair-qr').getAttribute('src'), null);
    await page.screenshot({path:path.join(output,'devices-dark-fixture.png')});
    await page.evaluate(() => window.desktopSettings.update({themeMode:'light'}));await page.screenshot({path:path.join(output,'devices-light-fixture.png')});
    await page.setViewportSize({width:740,height:580});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(output,'devices-minimum-light-fixture.png')});
    await page.evaluate(() => window.desktopSettings.update({themeMode:'dark'}));

    await page.locator('#pair-device').click();
    await page.locator('#pair-status').waitFor({ state: 'visible' });
    await page.locator('[data-close-dialog=pair-dialog]').click();
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#pair-key').inputValue(), '', 'closed dialogs discard late replies');
    assert.equal(await page.locator('#pair-qr').getAttribute('src'), null);

    await app.evaluate(() => { globalThis.pairingFixture.failures = 1; });
    await page.locator('#pair-device').click();
    await page.locator('#pair-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#pair-error').innerText(), /合成网络连接失败/);
    assert.equal(await page.locator('#pair-generate').innerText(), '重试');
    await page.locator('#pair-generate').click();
    await page.locator('#pair-key').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pair-error').isVisible(), false);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#pair-key').value === '');
    assert.equal(await page.locator('#pair-key').inputValue(), '');

    await app.evaluate(() => { globalThis.pairingFixture.lifetime = 250; });
    await page.locator('#pair-device').click();
    await page.locator('#pair-key').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#pair-status').textContent === '配对码已过期');
    assert.equal(await page.locator('#pair-key').inputValue(), '');
    assert.equal(await page.locator('#pair-qr').getAttribute('src'), null);
    await page.keyboard.press('Escape');

    const qrDataUrl = await QRCode.toDataURL('fixture-only-no-authority');
    webServer = http.createServer((req, res) => {
      const route = new URL(req.url, 'http://localhost').pathname;
      const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      if (route === '/api/state') return json({ me: { id: 'fixture-owner' }, devices: [], tasks: [], archives: [] });
      if (route === '/api/devices/me/info') return json({});
      if (route === '/api/pairings') return json({ key: 'fixture-web-pairing', expiresAt: new Date(Date.now() + 900000).toISOString(), qrDataUrl });
      if (route === '/browser-session.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('window.browserSession={ready:async()=>true,logout:async()=>{},adopt:()=>{}};'); }
      if (route === '/client-prompt.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(''); }
      if (/^\/vendor\/(lucide|marked|purify)\.js$/.test(route)) {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(fs.readFileSync(path.resolve(__dirname, '../../assets', route.slice(1))));
      }
      const relative = route === '/' ? 'index.html' : route.slice(1);
      const publicDir = path.resolve(__dirname, '../public');
      const file = path.resolve(publicDir, relative);
      if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => webServer.listen(0, '127.0.0.1', resolve));
    const webURL = `http://127.0.0.1:${webServer.address().port}/`;
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const window = new BrowserWindow({ show: true, width: 740, height: 580, webPreferences: { contextIsolation: true, nodeIntegration: false } });
      await window.loadURL(url);
    }, webURL);
    const webPage = app.windows().find(p => p.url() === webURL);
    assert.ok(webPage);
    await webPage.locator('#app').waitFor({ state: 'visible' });
    await webPage.locator('[data-view=devices]').click();
    await webPage.locator('#pair-device').click();
    await webPage.locator('#pair-generate').click();
    await webPage.locator('#pair-key').waitFor({ state: 'visible' });
    assert.equal(await webPage.locator('#pair-key').getAttribute('type'), 'password');
    const webLayout = await webPage.locator('#pair-dialog').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
    assert.equal(webLayout.width, desktopLayout.width);
    assert.ok(Math.abs(webLayout.height - desktopLayout.height) <= 4, 'Web and desktop share the same dialog layout');
    await webPage.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.fixtureCopiedKey = value; } } }));
    await webPage.locator('#copy-key').click();
    assert.equal(await webPage.evaluate(() => window.fixtureCopiedKey), 'fixture-web-pairing');
    await webPage.screenshot({ path: path.join(output, 'pairing-web-fixture.png') });
    await webPage.keyboard.press('Escape');
    await webPage.waitForFunction(() => document.querySelector('#pair-key').value === '');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, platform: process.platform,
      checks: ['immediate modal and loading feedback', 'pairing visible with 16 devices at minimum width',
        'one request while busy', 'QR rendering', 'masked key and copy feedback', 'loaded stylesheet and close/copy geometry', 'dark/light standard and minimum dialog', 'device card grouping and escaping', 'modal keyboard focus', 'shared compact Web and desktop layout', 'close and Escape clear credentials', 'late reply discarded',
        'error retry', 'expiration clears credentials'], limitation: 'Synthetic IPC and QR fixtures; no production pairing or device authorization.' }, null, 2));
    console.log('Desktop pairing regression: passed');
  } finally {
    webServer?.close();
    await app.evaluate(({ app }) => app.quit()).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
