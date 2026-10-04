const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const { createService } = await import('../src/server.mjs');
  const { secret } = await import('../src/common.mjs');
  const { trustCookie } = await import('../src/browser-trust.mjs');
  const OTPAuth = await import('otpauth');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-trust-ui-')), key = secret();
  let at = Date.now();
  const app = createService({ dataDir: root, masterKey: key, clock: () => at });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let browser = await chromium.launch({ channel: 'chrome', headless: true });
  const output = path.resolve(__dirname, '../test-output/browser-trust'); fs.mkdirSync(output, { recursive: true });
  const errors = [];
  const track = async context => { const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return page; };
  const request = async (route, body, token) => {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  const start = async (page, form = '#login-form', value = key) => {
    at += 60001;
    await page.locator(form + ' [name=key]').fill(value); await page.locator(form + ' button[type=submit]').click();
  };
  const finish = async (page, code) => {
    await page.locator('#login-mfa-dialog [name=factor]').fill(code); await page.locator('#login-mfa-dialog button[type=submit]').click();
  };
  try {
    const admin = await request('/api/pair', { key, name: 'Fixture admin', clientType: 'android' });
    const setup = await request('/api/security/totp/setup', {}, admin.token);
    const authenticator = new OTPAuth.TOTP({ secret: setup.secret });
    const enabled = await request('/api/security/totp/confirm', { otp: authenticator.generate({ timestamp: at }) }, admin.token);
    const context = await browser.newContext(), page = await track(context);
    await page.goto(base);
    assert.equal(await page.locator('#login-form input').count(), 1);
    await start(page, '#login-form', 'wrong-key'); await page.locator('#login-error').filter({ hasText: 'Invalid' }).waitFor();
    assert.equal(await page.locator('#login-mfa-dialog').count(), 0);
    await start(page); await page.locator('#login-mfa-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#login-form [name=key]').inputValue(), '');
    const before = (await app.store.get('setting', 'account-security-v1')).failures.count;
    assert.equal(before, 0);
    await finish(page, 'not-a-valid-code'); await page.locator('#login-mfa-error').filter({ hasText: '无效' }).waitFor();
    assert.equal((await app.store.get('setting', 'account-security-v1')).failures.count, 1);
    assert.equal(await page.locator('#login-mfa-dialog [name=factor]').inputValue(), '');
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const box = await page.locator('#login-mfa-dialog').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width);
      assert.ok(await page.locator('#login-mfa-dialog').evaluate(d => d.scrollWidth <= d.clientWidth));
      await page.screenshot({ path: path.join(output, `factor-${width}.png`) });
    }
    await page.keyboard.press('Escape'); await page.locator('#login-mfa-dialog').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#login-form [name=key]').inputValue(), '');
    await start(page); await page.locator('#login-mfa-dialog').waitFor({ state: 'visible' });
    await finish(page, authenticator.generate({ timestamp: at })); await page.locator('#app').waitFor({ state: 'visible' });
    const proof = (await context.cookies()).find(c => c.name === trustCookie);
    assert.ok(proof && proof.httpOnly && proof.secure && proof.sameSite === 'Strict');
    assert.ok(!(await page.evaluate(() => document.cookie)).includes(trustCookie));
    assert.equal(await page.evaluate(() => sessionStorage.getItem('collector-token') || localStorage.getItem('collector-token')), null);
    const authorized = (await app.store.list('device')).find(d => d.category === 'browser');
    await page.locator('#logout').click(); await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.ok((await context.cookies()).some(c => c.name === trustCookie));
    await start(page); await page.locator('#app').waitFor({ state: 'visible' }); assert.equal(await page.locator('#login-mfa-dialog').count(), 0);
    assert.equal((await app.store.list('device')).find(d => d.category === 'browser').id, authorized.id);
    const saved = await context.storageState();
    await browser.close(); browser = await chromium.launch({ channel: 'chrome', headless: true });
    const restored = await browser.newContext({ storageState: saved }), reopened = await track(restored);
    await reopened.goto(base + '/security'); await reopened.locator('#browser-trust-status').filter({ hasText: '已确认' }).waitFor();
    await reopened.screenshot({ path: path.join(output, 'security-confirmed.png') });
    await reopened.locator('#forget-browser').click(); await reopened.locator('#browser-trust-status').filter({ hasText: '尚未确认' }).waitFor();
    assert.equal(await reopened.locator('#security-settings').isVisible(), true);
    await reopened.reload(); await reopened.locator('#browser-trust-status').filter({ hasText: '尚未确认' }).waitFor();
    assert.ok(!(await restored.cookies()).some(c => c.name === trustCookie));
    await reopened.goto(base); await reopened.locator('#app').waitFor({ state: 'visible' });
    await reopened.locator('#logout').click(); await reopened.locator('#login-view').waitFor({ state: 'visible' });
    const grant = await request('/oauth/device_authorization', { client_id: 'lingnest-cli', scope: 'library:read' });
    await reopened.goto(base + '/authorize#code=' + grant.user_code); await reopened.locator('#auth-login').waitFor({ state: 'visible' });
    assert.equal(await reopened.locator('#auth-login input').count(), 1);
    await start(reopened, '#auth-login'); await reopened.locator('#login-mfa-dialog').waitFor({ state: 'visible' });
    await reopened.locator('#login-mfa-dialog [name=factor]').fill('discarded-value');
    await reopened.keyboard.press('Escape'); await reopened.locator('#login-mfa-dialog').waitFor({ state: 'detached' });
    assert.equal(await reopened.locator('#user-code').inputValue(), grant.user_code);
    await start(reopened, '#auth-login'); await reopened.locator('#login-mfa-dialog').waitFor({ state: 'visible' });
    await finish(reopened, enabled.recoveryCodes[0]); await reopened.locator('#consent').waitFor({ state: 'visible' });
    assert.equal((await app.store.list('reader_grant'))[0].state, 'pending');
    await reopened.locator('#allow').click(); await reopened.locator('#result-title').filter({ hasText: '已允许' }).waitFor();
    // New/private browser contexts and cleared site data have no remembered proof.
    const privateContext = await browser.newContext(), privatePage = await track(privateContext);
    await privatePage.goto(base); await start(privatePage); await privatePage.locator('#login-mfa-dialog').waitFor({ state: 'visible' });
    await privatePage.goto(base + '/authorize'); await privatePage.locator('#auth-login').waitFor({ state: 'visible' });
    assert.equal(await privatePage.locator('#owner-key').inputValue(), '');
    await restored.clearCookies(); await reopened.goto(base); await reopened.evaluate(() => localStorage.clear()); await reopened.reload();
    await start(reopened); await reopened.locator('#login-mfa-dialog').waitFor({ state: 'visible' });
    await reopened.keyboard.press('Escape');
    // A genuine, pre-feature live login gets exactly one migration without a factor.
    const legacyContext = await browser.newContext(), legacyPage = await track(legacyContext);
    await legacyPage.goto(base); const metadata = await legacyPage.evaluate(() => window.browserDevice.metadata());
    const legacy = await request('/api/pair', { key, name: 'Legacy fixture', ...metadata, recoveryCode: enabled.recoveryCodes[1] });
    const record = await app.store.get('device', legacy.device.id); delete record.browserTrustMigrated; await app.store.put('device', record);
    const settings = await app.store.get('setting', 'account-security-v1'); delete settings.trustEpoch; await app.store.put('setting', settings);
    await legacyContext.addCookies([{ name: 'collector_browser_session', value: legacy.token, url: base, httpOnly: true, secure: true, sameSite: 'Strict' }]);
    await legacyPage.goto(base + '/security'); await legacyPage.locator('#browser-trust-status').filter({ hasText: '已确认' }).waitFor();
    assert.equal((await app.store.get('device', record.id)).tokenHash, record.tokenHash);
    assert.equal((await app.store.get('device', record.id)).browserTrustMigrated, true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', keyOnlyByDefault: true, badKeyDoesNotChallenge: true, modalOtpAndRecovery: true,
      restartAndLogoutRetainTrust: true, forgetCannotBootstrapAgain: true, legacyLiveSessionMigrated: true,
      privateAndClearedBrowsersChallenge: true, cancelAndNavigationClearSecrets: true, cliCodeRetainedAndExplicitConsent: true,
      responsiveWidths: [320, 375, 1440], productionSecretsUsed: false }));
  } finally { await browser.close(); await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
