const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const { createService } = await import('../src/server.mjs');
  const { secret, hash } = await import('../src/common.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-sessions-ui-'));
  const key = secret(), service = createService({ dataDir: root, masterKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const output = path.resolve(__dirname, '../test-output/browser-sessions'); fs.mkdirSync(output, { recursive: true });
  const errors = [];
  let context;
  try {
    for (const clientType of ['desktop', 'android', 'ios']) {
      const response = await fetch(base + '/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, clientType, name: 'Fixture ' + clientType }) });
      assert.equal(response.status, 201);
    }
    context = await browser.newContext(); let page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.locator('#login-form [name=key]').fill(key); await page.locator('#login-form button').click(); await page.locator('#app').waitFor({ state: 'visible' });
    assert.equal(await page.title(), '资料库 · 灵藏');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('collector-token') || localStorage.getItem('collector-token')), null);
    const cookie = (await context.cookies()).find(c => c.name === 'collector_browser_session');
    assert.ok(cookie.httpOnly && cookie.secure && cookie.sameSite === 'Strict');
    const profile = (await service.store.list('device')).find(d => d.category === 'browser');
    const expiry = profile.browserExpiresAt;
    await page.locator('[data-view=devices]').click();
    assert.equal(await page.locator('[data-category=desktop] .row').count(), 1);
    assert.equal(await page.locator('[data-category=mobile] .row').count(), 2);
    assert.equal(await page.locator('[data-category=browser] .row').count(), 1);
    assert.ok((await page.locator('[data-category=desktop]').innerText()).includes('工作节点离线'));
    await page.locator('[data-view=tasks]').click(); await page.locator('#new-task').click();
    assert.equal(await page.locator('#dispatch-device option').count(), 2); await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // A background state fetch does not renew the browser authorization.
    await page.evaluate(() => fetch('/api/state')); assert.equal((await service.store.get('device', profile.id)).browserExpiresAt, expiry);
    await page.locator('[data-view=devices]').click();
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: 950 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(output, `devices-${width}.png`), fullPage: true });
    }
    const state = await context.storageState(); await context.close();
    context = await browser.newContext({ storageState: state }); page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.locator('#app').waitFor({ state: 'visible' });
    assert.equal((await service.store.list('device')).filter(d => d.category === 'browser').length, 1);
    await page.goto(base + '/library/'); await page.locator('#open-trash').waitFor({ state: 'visible' });
    await page.locator('#open-trash').click();
    await page.waitForFunction(() => document.querySelector('#trash-dialog .trash-list')?.textContent === '回收站为空');
    await page.goto(base); await page.locator('#app').waitFor({ state: 'visible' });
    await page.route('**/api/browser-session/logout', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Fixture unavailable"}' }));
    await page.locator('#logout').click(); await page.locator('#notice').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#app').isVisible(), true);
    assert.equal((await service.store.get('device', profile.id)).loggedOutAt, undefined);
    await page.unroute('**/api/browser-session/logout');
    await page.goto(base + '/security'); await page.locator('#security-settings').waitFor({ state: 'visible' }); assert.equal(await page.title(), '账户安全 · 灵藏');
    await page.goto(base + '/authorize'); await page.locator('#code-form').waitFor({ state: 'visible' });
    await page.locator('#auth-logout').click(); await page.locator('#auth-login').waitFor({ state: 'visible' });
    assert.ok((await service.store.get('device', profile.id)).loggedOutAt);
    await page.goto(base); await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.equal((await service.store.list('device')).length, 4);
    const legacyToken = secret();
    await service.store.put('device', { id: 'legacy-browser-fixture', name: 'Preserved legacy note', role: 'owner', clientType: 'web', tokenHash: hash(legacyToken), revokedAt: null });
    await context.close(); context = await browser.newContext();
    await context.addInitScript(token => { if (window === window.top) sessionStorage.setItem('collector-token', token); }, legacyToken);
    page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.locator('#app').waitFor({ state: 'visible' });
    const migrated = await service.store.get('device', 'legacy-browser-fixture');
    assert.equal(migrated.category, 'browser'); assert.equal(migrated.role, 'owner'); assert.equal(migrated.tokenHash, hash(legacyToken));
    assert.equal(migrated.name, 'Preserved legacy note'); assert.ok(migrated.browserExpiresAt);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('collector-token')), null);
    assert.ok((await context.cookies()).some(c => c.name === 'collector_browser_session' && c.httpOnly));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', privatePersistentCookie: true, restoredAfterBrowserRestart: true, legacyIdentificationInPlace: true, groupedRecords: true, onlyWorkerDispatch: true, pollingDoesNotRenew: true, securityAndConsentShareSession: true, logoutPreservesRecords: true, chineseBrand: '灵藏', responsiveWidths: [320, 375, 1440], productionSecretsUsed: false }));
  } finally { await context?.close(); await browser.close(); await service.close(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
