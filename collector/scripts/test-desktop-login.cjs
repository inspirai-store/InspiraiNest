const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { showSettings } = require('./desktop-test-helpers.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-login-ui-'));
  const config = path.join(root, 'worker.json'); fs.writeFileSync(config, JSON.stringify({ dataDir: path.join(root, 'data') }));
  const env = { ...process.env, COLLECTOR_CONFIG: config, COLLECTOR_DESKTOP_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: process.argv[2] ? path.resolve(process.argv[2]) : require('electron'), args: [...(process.argv[2] ? [] : [path.resolve(__dirname, '../desktop')]), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env });
  const output = path.resolve(__dirname, '../test-output/desktop-login'); fs.mkdirSync(output, { recursive: true });
  try {
    await app.firstWindow();
    await app.evaluate(({ ipcMain }) => {
      const fixture = globalThis.loginFixture = { paired: false, server: '', calls: [], epoch: 0 };
      const handle = (name, fn) => { ipcMain.removeHandler('library:' + name); ipcMain.handle('library:' + name, (_event, data) => fn(data)); };
      const status = () => ({ paired: fixture.paired, server: fixture.server, deviceId: fixture.paired ? 'fixture-device' : null });
      handle('status', status);
      handle('cancel-login', () => { fixture.epoch++; });
      handle('state', () => ({ me: { id: 'fixture-device' }, devices: [], tasks: [], archives: [] }));
      handle('entries', () => ({ items: [], total: 0 }));
      handle('pair', async input => {
        const epoch = fixture.epoch; fixture.calls.push(input);
        await new Promise(resolve => setTimeout(resolve, input.key === 'slow' ? 500 : 80));
        if (epoch !== fixture.epoch) return { loginError: { message: '登录已取消' } };
        if (input.key === 'timeout') throw new Error('登录请求超时');
        if (input.key === 'limited') return { loginError: { status: 429, message: '验证过于频繁，请稍后重试' } };
        if (input.key === 'wrong') return { loginError: { code: 'credential_invalid', message: '登录密码或配对码不正确' } };
        if (input.key === 'mfa' && !input.otp && !input.recoveryCode) return { loginError: { code: 'mfa_required', message: '请输入动态码' } };
        if (input.key === 'mfa' && input.otp !== '123456' && input.recoveryCode !== 'fixture-recovery') return { loginError: { code: 'mfa_invalid', message: '动态码或恢复码无效' } };
        fixture.paired = true; fixture.server = input.server; return status();
      });
    });
    let page;
    for (let n = 0; n < 100 && !page; n++) { page = app.windows().find(p => p.url().startsWith('file:') && !p.url().includes('compact=1')); if (!page) await new Promise(r => setTimeout(r, 100)); }
    assert.ok(page); await page.reload(); await showSettings(page, 'devices');
    const server = page.locator('#owner-pair input[name=server]'), key = page.locator('#owner-pair input[name=key]'), submit = page.locator('#owner-pair button[type=submit]');
    await server.waitFor({ state: 'visible' }); assert.equal(await server.inputValue(), ''); assert.equal(await key.inputValue(), '');
    await page.screenshot({ path: path.join(output, 'first-login.png') });
    await server.fill('https://personal.example'); await key.fill('wrong'); await submit.click();
    await page.locator('#owner-pair [data-login-error]').filter({ hasText: '不正确' }).waitFor(); assert.equal(await key.inputValue(), '');
    for (const [secret, message] of [['limited', '验证过于频繁'], ['timeout', '超时']]) {
      await key.fill(secret); await submit.click();
      await page.locator('#owner-pair [data-login-error]').filter({ hasText: message }).waitFor();
      assert.equal(await key.inputValue(), ''); assert.equal(await submit.isEnabled(), true);
    }
    await key.fill('slow'); await submit.click(); await server.fill('https://review.example');
    await new Promise(r => setTimeout(r, 650)); assert.equal(await app.evaluate(() => globalThis.loginFixture.paired), false); assert.equal(await key.inputValue(), '');
    await key.fill('mfa'); await submit.click(); await page.locator('#login-mfa').waitFor({ state: 'visible' });
    assert.equal(await key.inputValue(), ''); await page.screenshot({ path: path.join(output, 'mfa.png') }); await page.locator('#login-factor').fill('bad'); await page.locator('#login-mfa-form button[type=submit]').click();
    await page.locator('#login-mfa-error').filter({ hasText: '无效' }).waitFor();
    await page.locator('#login-recovery').click(); await page.locator('#login-factor').fill('fixture-recovery'); await page.locator('#login-mfa-form button[type=submit]').click();
    await page.locator('#login-mfa').waitFor({ state: 'hidden' }); await page.locator('#overview-data').waitFor({ state: 'visible' });
    await showSettings(page, 'devices'); await page.locator('#switch-library').click();
    await server.fill('https://second.example'); await key.fill('  fixture password  '); await submit.click();
    await page.locator('#overview-data').waitFor({ state: 'visible' });
    const calls = await app.evaluate(() => globalThis.loginFixture.calls);
    assert.equal(calls.at(-1).key, '  fixture password  '); assert.equal(calls.at(-1).server, 'https://second.example');
    await showSettings(page, 'devices'); await page.locator('#switch-library').click();
    await page.locator('#owner-pair [data-login-mode]').click(); assert.equal(await page.locator('#owner-pair [data-login-key]').textContent(), '配对码');
    await key.fill('temporary'); await page.locator('[data-settings=appearance]').click(); assert.equal(await key.inputValue(), '');
    await showSettings(page, 'devices'); await page.screenshot({ path: path.join(output, 'login.png') });
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks: ['blank first address', 'timeout and throttling reset login', 'password error distinct from expired authorization', 'cancel discards delayed reply', 'MFA and recovery retry', 'raw password preserved', 'change deployment', 'pairing-code compatibility', 'navigation clears secrets'], limitation: 'Isolated synthetic IPC; no production authorization.' }, null, 2));
    console.log('Desktop login regression: passed');
  } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
