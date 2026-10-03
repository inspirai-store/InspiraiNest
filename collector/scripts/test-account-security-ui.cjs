const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const { createService } = await import('../src/server.mjs');
  const { secret } = await import('../src/common.mjs');
  const OTPAuth = await import('otpauth');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-ui-')), key = secret(), next = 'Nest2030';
  const service = createService({ dataDir: root, masterKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const screenshots = path.resolve(__dirname, '../test-output/account-security'); fs.mkdirSync(screenshots, { recursive: true });
  const errors = [];
  async function page() { const context = await browser.newContext(); const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return page; }
  async function fillForm(page, form, input) { for (const [key, value] of Object.entries(input)) await page.locator(`${form} [name=${key}]`).fill(value); }
  try {
    const owner = await page(); await owner.goto(base + '/login');
    await fillForm(owner, '#login-form', { key }); await owner.locator('#login-form button').click(); await owner.locator('#app').waitFor({ state: 'visible' });
    const original = (await service.store.list('device'))[0];
    await service.store.put('task', { id: 'preserved-task', deviceId: original.id, state: 'running', submissionId: 'fixture', content: 'Fixture only', type: 'auto', createdAt: new Date().toISOString(), events: [] });
    await owner.locator('a[href="/security"]').click(); await owner.locator('#security-settings').waitFor({ state: 'visible' });
    assert.equal(await owner.locator('[name=currentKey]').count(), 0);
    assert.equal(await owner.locator('#security-settings input').count(), 0);
    assert.equal(await owner.locator('dialog[open]').count(), 0);
    await owner.locator('#edit-credential').click(); await fillForm(owner, '#credential-form', { newKey: 'discarded', confirmKey: 'discarded' });
    await owner.keyboard.press('Escape'); await owner.locator('#credential-dialog').waitFor({ state: 'hidden' });
    await owner.locator('#edit-credential').click(); assert.equal(await owner.locator('#credential-form [name=newKey]').inputValue(), '');
    await fillForm(owner, '#credential-form', { newKey: 'Nest2026', confirmKey: 'Nest2026' });
    await owner.locator('#credential-form button[type=submit]').click(); await owner.locator('#security-message').filter({ hasText: '登录凭据已修改' }).waitFor();
    await owner.locator('#setup-factor').click(); await owner.locator('#setup-panel').waitFor({ state: 'visible' });
    await owner.keyboard.press('Escape'); await owner.locator('#setup-dialog').waitFor({ state: 'hidden' });
    await owner.locator('#setup-factor').click(); await owner.locator('#setup-panel').waitFor({ state: 'visible' });
    const seed = await owner.locator('#totp-secret').inputValue();
    assert.ok(await owner.locator('#totp-qr').evaluate(img => img.complete && img.naturalWidth > 0));
    const authenticator = new OTPAuth.TOTP({ secret: seed });
    const validCodes = [-30000, 0, 30000].map(delta => authenticator.generate({ timestamp: Date.now() + delta }));
    let badCode = '000000'; while (validCodes.includes(badCode)) badCode = String(Number(badCode) + 1).padStart(6, '0');
    await fillForm(owner, '#confirm-factor-form', { otp: badCode }); await owner.locator('#confirm-factor-form button[type=submit]').click();
    await owner.locator('#setup-message').filter({ hasText: '动态码不正确' }).waitFor();
    assert.equal((await service.store.get('setting', 'account-security-v1')).totp, null);
    await fillForm(owner, '#confirm-factor-form', { otp: authenticator.generate() });
    await owner.locator('#confirm-factor-form button[type=submit]').click(); await owner.locator('#recovery-dialog').waitFor({ state: 'visible' });
    let codes = (await owner.locator('#recovery-codes').innerText()).trim().split('\n'); assert.equal(codes.length, 10);
    const downloadEvent = owner.waitForEvent('download'); await owner.locator('#download-recovery').click(); const download = await downloadEvent;
    assert.ok(fs.readFileSync(await download.path(), 'utf8').includes(codes[0]));
    await owner.locator('#close-recovery').click();
    assert.equal(await owner.locator('#recovery-codes').innerText(), '');
    await owner.locator('#rotate-recovery').click(); await fillForm(owner, '#factor-form', { factor: codes[0] }); await owner.locator('#factor-submit').click();
    await owner.locator('#recovery-dialog').waitFor({ state: 'visible' }); const oldCodes = codes;
    codes = (await owner.locator('#recovery-codes').innerText()).trim().split('\n'); assert.notDeepEqual(codes, oldCodes);
    await owner.locator('#close-recovery').click();
    await owner.locator('#edit-credential').click();
    await fillForm(owner, '#credential-form', { newKey: next, confirmKey: next, factor: codes[0] });
    await owner.locator('#credential-form button[type=submit]').click(); await owner.locator('#security-message').filter({ hasText: '登录凭据已修改' }).waitFor();
    assert.equal((await service.store.get('device', original.id)).tokenHash, original.tokenHash); assert.equal((await service.store.get('task', 'preserved-task')).deviceId, original.id);
    for (const width of [320, 375, 1440]) {
      await owner.setViewportSize({ width, height: 900 });
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `security overflow ${width}`);
      await owner.screenshot({ path: path.join(screenshots, `security-${width}.png`), fullPage: true });
      await owner.locator('#edit-credential').click();
      const box = await owner.locator('#credential-dialog').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0, `dialog framing ${width}`);
      assert.ok(await owner.evaluate(() => { const d = document.querySelector('#credential-dialog'); return d.scrollWidth <= d.clientWidth; }), `dialog overflow ${width}`);
      await owner.screenshot({ path: path.join(screenshots, `credential-dialog-${width}.png`), fullPage: true });
      await owner.keyboard.press('Escape'); await owner.locator('#credential-dialog').waitFor({ state: 'hidden' });
    }
    const fresh = await page(); await fresh.goto(base + '/login');
    await fillForm(fresh, '#login-form', { key }); await fresh.locator('#login-form button').click(); await fresh.locator('#login-error').filter({ hasText: 'Invalid' }).waitFor();
    await fillForm(fresh, '#login-form', { key: next }); await fresh.locator('#login-form button').click(); await fresh.locator('#login-error').filter({ hasText: '动态码' }).waitFor();
    await fillForm(fresh, '#login-form', { factor: codes[1] }); await fresh.locator('#login-form button').click(); await fresh.locator('#app').waitFor({ state: 'visible' });
    for (const width of [320, 375, 1440]) { await fresh.setViewportSize({ width, height: 900 }); assert.ok(await fresh.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `app overflow ${width}`); }
    const grant = await (await fetch(base + '/oauth/device_authorization', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: 'lingnest-cli', scope: 'library:read' }) })).json();
    const authorize = await page(); await authorize.goto(base + '/authorize#code=' + grant.user_code); await authorize.locator('#auth-login').waitFor({ state: 'visible' });
    await fillForm(authorize, '#auth-login', { key: next }); await authorize.locator('#auth-login button').click(); await authorize.locator('#auth-message').filter({ hasText: '动态码' }).waitFor();
    await fillForm(authorize, '#auth-login', { factor: codes[2] }); await authorize.locator('#auth-login button').click(); await authorize.locator('#consent').waitFor({ state: 'visible' });
    assert.equal((await service.store.list('reader_grant'))[0].state, 'pending');
    await authorize.locator('#allow').click(); await authorize.locator('#result-title').filter({ hasText: '已允许只读访问' }).waitFor();
    assert.equal((await service.store.list('reader_grant'))[0].state, 'approved');
    await owner.locator('#disable-factor').click(); await fillForm(owner, '#factor-form', { factor: codes[3] }); await owner.locator('#factor-submit').click();
    await owner.locator('#totp-status').filter({ hasText: '尚未绑定' }).waitFor(); assert.equal((await service.store.get('setting', 'account-security-v1')).totp, null);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', modalActionsOnly: true, currentCredentialNotRequested: true, eightCharacterCredentialAccepted: true, cancelClearsFields: true, qrRendered: true, confirmedBinding: true, recoveryDownloadAndRotation: true, unbindDialog: true, credentialRotation: true, oldKeyRejected: true, mfaRequiredForLoginAndAuthorize: true, explicitCliConsent: true, existingTaskAndTokenPreserved: true, responsiveWidths: [320, 375, 1440], productionSecretsUsed: false }));
  } finally { await browser.close(); await service.close(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
