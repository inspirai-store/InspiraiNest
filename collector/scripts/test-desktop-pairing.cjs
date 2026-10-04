const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const QRCode = require('qrcode');

// A separate desktop scope and synthetic IPC replies never use production credentials.
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-pairing-'));
  const config = path.join(root, 'worker.json');
  fs.writeFileSync(config, JSON.stringify({ server: 'https://fixture.invalid', dataDir: path.join(root, 'data') }));
  const env = { ...process.env, COLLECTOR_CONFIG: config, COLLECTOR_DESKTOP_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../desktop')], env });
  const output = path.resolve(__dirname, '../test-output/desktop-pairing');
  fs.mkdirSync(output, { recursive: true });
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
        id: 'fixture-' + i, name: '合成电脑 ' + i, role: 'worker', category: 'desktop', online: false,
        workerAuthorized: true, agents: ['codex'], capabilities: ['article'],
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
    const page = app.windows().find(p => p.url().startsWith('file:') && !p.url().includes('compact=1'));
    assert.ok(page);
    await page.reload();
    await page.locator('#overview-data').waitFor({ state: 'visible' });
    await page.locator('[data-view=devices]').click();
    assert.equal(await page.locator('.device-card').count(), 16);
    await page.setViewportSize({ width: 740, height: 580 });
    await page.locator('#pair-device').click();
    await page.locator('#pair-dialog[open]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pair-status').innerText(), '正在生成配对码…');
    assert.equal(await page.locator('#pair-generate').isDisabled(), true);
    await page.locator('#pair-key').waitFor({ state: 'visible' });
    assert.equal(await app.evaluate(() => globalThis.pairingFixture.calls), 1);
    assert.equal(await page.locator('#pair-qr').isVisible(), true);
    const box = await page.locator('#pair-key').boundingBox();
    const height = await page.evaluate(() => innerHeight);
    assert.ok(box.y >= 0 && box.y + box.height <= height, 'pairing must be visible above a long device list');
    await page.screenshot({ path: path.join(output, 'pairing-narrow-fixture.png') });
    await page.locator('[data-close-dialog=pair-dialog]').click();
    await page.waitForFunction(() => document.querySelector('#pair-key').textContent === '');
    assert.equal(await page.locator('#pair-key').textContent(), '');
    assert.equal(await page.locator('#pair-qr').getAttribute('src'), null);

    await page.locator('#pair-device').click();
    await page.locator('#pair-status').waitFor({ state: 'visible' });
    await page.locator('[data-close-dialog=pair-dialog]').click();
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#pair-key').textContent(), '', 'closed dialogs discard late replies');
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
    await page.waitForFunction(() => document.querySelector('#pair-key').textContent === '');
    assert.equal(await page.locator('#pair-key').textContent(), '');

    await app.evaluate(() => { globalThis.pairingFixture.lifetime = 250; });
    await page.locator('#pair-device').click();
    await page.locator('#pair-key').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#pair-status').textContent === '配对码已过期');
    assert.equal(await page.locator('#pair-key').textContent(), '');
    assert.equal(await page.locator('#pair-qr').getAttribute('src'), null);
    await page.keyboard.press('Escape');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, platform: process.platform,
      checks: ['immediate modal and loading feedback', 'pairing visible with 16 devices at minimum width',
        'one request while busy', 'QR rendering', 'close and Escape clear credentials', 'late reply discarded',
        'error retry', 'expiration clears credentials'], limitation: 'Synthetic IPC and QR fixtures; no production pairing or device authorization.' }, null, 2));
    console.log('Desktop pairing regression: passed');
  } finally {
    await app.evaluate(({ app }) => app.quit()).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
