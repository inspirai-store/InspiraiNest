const {setTheme,showSettings}=require('./desktop-test-helpers.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');

// Isolated IPC fixture: clicking start never starts a real Worker or claims tasks.
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-status-start-'));
  const config = path.join(root, 'worker.json');
  fs.writeFileSync(config, JSON.stringify({ server: 'https://library.example', dataDir: root }));
  const env = { ...process.env, COLLECTOR_CONFIG: config, COLLECTOR_DESKTOP_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const installed = process.argv[2];
  const executable = installed ? path.resolve(installed) : (() => {
    try { return require('../desktop/node_modules/electron'); } catch { return require('electron'); }
  })();
  const app = await _electron.launch({ executablePath: executable, args: installed ? [] : [path.resolve(__dirname, '../desktop')], env });
  try {
    await app.firstWindow();
    let page, compact;
    for (let n = 0; n < 100 && (!page || !compact); n++) {
      page = app.windows().find(p => p.url().startsWith('file:') && !p.url().includes('compact=1'));
      compact = app.windows().find(p => p.url().includes('compact=1'));
      if (!page || !compact) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(page && compact);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ ipcMain }) => {
      const fixture = globalThis.statusStartFixture = {
        calls: 0, fail: false, release: null,
        state: { paired: false, running: false, starting: false, managed: false, online: false, device: '测试电脑', tasks: [], agents: {}, server: 'https://library.example' },
      };
      ipcMain.removeHandler('worker:snapshot');
      ipcMain.handle('worker:snapshot', () => ({ ...fixture.state }));
      ipcMain.removeHandler('worker:action');
      ipcMain.handle('worker:action', async (_, action) => {
        if (action !== 'start') throw new Error('Unexpected test action');
        fixture.calls++; fixture.state.starting = true;
        await new Promise(resolve => { fixture.release = resolve; });
        fixture.release = null; fixture.state.starting = false;
        if (fixture.fail) throw new Error('测试启动失败：Agent 未安装');
        Object.assign(fixture.state, { running: true, managed: true, online: true, mode: 'running', phase: 'idle' });
        return { ...fixture.state };
      });
    });
    const reload = async () => { await page.reload(); await page.waitForFunction(() => document.querySelector('#connection').textContent !== '连接未知'); };
    const badge = page.locator('#connection');
    await reload();
    assert.equal(await badge.evaluate(node => node.tagName), 'BUTTON');
    assert.equal(await badge.isDisabled(), true);
    assert.match(await badge.getAttribute('title'), /先连接/);
    await app.evaluate(() => { globalThis.statusStartFixture.state.paired = true; });
    await reload(); await badge.waitFor();
    assert.equal(await badge.isEnabled(), true);
    assert.match(await badge.getAttribute('aria-label'), /点击启动/);
    const output = path.resolve(__dirname, '../../.runtime/local-workbench/status-start'); fs.mkdirSync(output, { recursive: true });
    await page.locator('.topbar').screenshot({ path: path.join(output, installed ? 'installed-stopped-dark.png' : 'source-stopped-dark.png') });
    await setTheme(page);
    await page.locator('.topbar').screenshot({ path: path.join(output, installed ? 'installed-stopped-light.png' : 'source-stopped-light.png') });
    await page.evaluate(() => { const node = document.querySelector('#connection'); node.click(); node.click(); });
    await page.waitForFunction(() => document.querySelector('#connection').textContent === '启动中…');
    assert.equal(await badge.isDisabled(), true);
    assert.equal(await badge.getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('[data-action=start]').isDisabled(), true);
    assert.equal(await app.evaluate(() => globalThis.statusStartFixture.calls), 1);
    await app.evaluate(() => globalThis.statusStartFixture.release());
    await page.waitForFunction(() => document.querySelector('#connection').textContent === '在线');
    assert.equal(await badge.isDisabled(), true);
    assert.equal(await badge.evaluate(node => getComputedStyle(node).opacity), '1');
    await compact.waitForFunction(() => document.querySelector('#connection').textContent === '在线');
    assert.equal(await compact.locator('#connection').isVisible(), true, 'Running tray status must remain visible');
    await badge.evaluate(node => node.click());
    assert.equal(await app.evaluate(() => globalThis.statusStartFixture.calls), 1);
    await app.evaluate(() => {
      const fixture = globalThis.statusStartFixture; fixture.fail = true;
      Object.assign(fixture.state, { running: false, managed: false, online: false });
    });
    await reload(); await badge.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#connection').getAttribute('aria-busy') === 'true');
    await app.evaluate(() => globalThis.statusStartFixture.release());
    await page.waitForFunction(() => document.querySelector('#action-result').textContent.includes('测试启动失败'));
    assert.equal(await badge.isEnabled(), true);
    assert.equal(await badge.innerText(), '已停止');
    assert.equal(await badge.getAttribute('aria-busy'), 'false');
    assert.equal(await app.evaluate(() => globalThis.statusStartFixture.calls), 2);
    await app.evaluate(() => { globalThis.statusStartFixture.state.starting = true; });
    await reload(); assert.equal(await badge.isDisabled(), true); assert.equal(await badge.innerText(), '启动中…');
    await app.evaluate(() => { Object.assign(globalThis.statusStartFixture.state, { starting: false, quitAfterTask: true }); });
    await reload(); assert.equal(await badge.isDisabled(), true); assert.match(await badge.getAttribute('title'), /退出/);
    assert.deepEqual(errors, []);
    console.log('Worker status start: pairing gate, one-click start, duplicate guard, keyboard, error feedback, busy state, readable running status and tray visibility: passed (isolated IPC)');
  } finally {
    await app.evaluate(({ app }) => { globalThis.statusStartFixture?.release?.(); app.quit(); }).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
