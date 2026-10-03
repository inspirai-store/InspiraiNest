const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const { createService } = await import('../src/server.mjs');
  const { secret } = await import('../src/common.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-ui-'));
  const key = secret(), service = createService({ dataDir: root, masterKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const server = `http://127.0.0.1:${service.server.address().port}`;
  const post = async (route, body) => (await fetch(server + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const output = path.resolve(__dirname, '../test-output/device-identity'); fs.mkdirSync(output, { recursive: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(server);
      await page.locator('#login-form').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(output, `login-${width}.png`), fullPage: true });
      await page.goto(server + '/download');
      await page.locator('#android-download').waitFor();
      assert.equal(await page.locator('#login-form').count(), 0);
      assert.equal(await page.getByText('继续使用网页版').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(output, `download-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(server + '/login');
    await page.locator('#login-form input[name=key]').fill(key); await page.locator('#login-form button').click();
    await page.locator('#app').waitFor({ state: 'visible' });
    const loginDevices = await service.store.list('device');
    assert.equal(loginDevices.length, 1); assert.equal(loginDevices[0].identity.source, 'browser-profile');
    await page.locator('[data-view=devices]').click();
    await page.locator('#devices strong').filter({ hasText: '浏览器登录' }).waitFor();
    await page.locator('#pair-device').click(); await page.locator('#pair-form button').click();
    await page.locator('#pair-result').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#pair-key').inputValue()).length >= 32);
    const grant = await post('/oauth/device_authorization', { client_id: 'lingnest-cli', scope: 'library:read', client_name: 'Fixture CLI' });
    await page.goto(server + '/authorize#code=' + grant.user_code);
    await page.locator('#consent').waitFor({ state: 'visible' });
    const devices = await service.store.list('device');
    assert.equal(devices.length, 1); assert.ok(devices[0].installationKey); assert.equal(devices[0].identity.source, 'browser-profile');
    assert.equal(devices[0].id, loginDevices[0].id);
    assert.equal(devices[0].deviceInfo.client.type, 'web');
    const pending = await post('/oauth/token', { client_id: 'lingnest-cli', grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: grant.device_code });
    assert.equal(pending.error, 'authorization_pending');
    const stable = await page.evaluate(() => window.browserDevice.metadata());
    assert.equal(stable.identity.digest, devices[0].identity.digest);
    await page.screenshot({ path: path.join(output, 'consent-desktop.png'), fullPage: true });
    await page.locator('#allow').click(); await page.locator('#result-title').filter({ hasText: '已允许只读访问' }).waitFor();
    await new Promise(resolve => setTimeout(resolve, (grant.interval + 0.1) * 1000));
    const token = await post('/oauth/token', { client_id: 'lingnest-cli', grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: grant.device_code });
    assert.equal(token.scope, 'library:read');
    const response = await fetch(server + '/api/read/v1/entries', { headers: { Authorization: 'Bearer ' + token.access_token } });
    assert.equal(response.status, 200);
    const management = await fetch(server + '/api/state', { headers: { Authorization: 'Bearer ' + token.access_token } });
    assert.equal(management.status, 403);
    await page.reload(); assert.deepEqual((await page.evaluate(() => window.browserDevice.metadata())).identity, stable.identity);
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(server + '/authorize');
      await page.locator('#code-form').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(output, `authorize-${width}.png`), fullPage: true });
    }
    const retryGrant = await post('/oauth/device_authorization', { client_id: 'lingnest-cli', scope: 'library:read', client_name: 'Re-login CLI' });
    await page.goto(server + '/authorize#code=' + retryGrant.user_code);
    await page.locator('#consent').waitFor({ state: 'visible' });
    await page.locator('#auth-logout').click();
    await page.locator('#auth-login').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('collector-token')), null);
    assert.equal(await page.locator('#user-code').inputValue(), retryGrant.user_code);
    await page.locator('#owner-key').fill(key); await page.locator('#auth-login button').click();
    await page.locator('#consent').waitFor({ state: 'visible' });
    assert.equal((await post('/oauth/token', { client_id: 'lingnest-cli', grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: retryGrant.device_code })).error, 'authorization_pending');
    assert.deepEqual(errors, []);
    for (const fixture of [
      { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', hints: null, family: 'Windows', version: null, brand: 'Chrome' },
      { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Edg/140.0.0.0', hints: { platform: 'Windows', platformVersion: '13.0.0' }, family: 'Windows', version: '11', brand: 'Edge' },
      { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.0 Safari/605.1.15', hints: null, family: 'macOS', version: null, brand: 'Safari' },
      { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0', hints: { platform: 'macOS', platformVersion: '26.0.1' }, family: 'macOS', version: '26.0.1', brand: 'Chrome' },
    ]) {
      const profile = await browser.newContext({ userAgent: fixture.ua });
      await profile.addInitScript(hints => Object.defineProperty(navigator, 'userAgentData', { value: hints ? { platform: hints.platform, getHighEntropyValues: async () => hints } : undefined }), fixture.hints);
      const tab = await profile.newPage(); await tab.goto(server + '/authorize');
      const metadata = await tab.evaluate(() => window.browserDevice.metadata());
      assert.equal(metadata.deviceInfo.os.family, fixture.family); assert.equal(metadata.deviceInfo.os.version, fixture.version);
      assert.equal(metadata.deviceInfo.client.name, fixture.brand); await profile.close();
    }
    await page.route('**/client-release.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ android: null }) }));
    await page.goto(server + '/download'); await page.locator('#release-meta').filter({ hasText: '请选择其他' }).waitFor();
    assert.ok(!(await page.locator('body').innerText()).includes('网页版'));
    await page.unroute('**/client-release.json');
    const conflictProfile = await browser.newContext(), conflictTab = await conflictProfile.newPage();
    await conflictTab.route('**/api/pair', route => route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Device identity conflict"}' }));
    await conflictTab.goto(server + '/authorize'); await conflictTab.locator('#owner-key').fill('fixture-key');
    await conflictTab.locator('#auth-login button').click(); await conflictTab.locator('#auth-message').filter({ hasText: '设备身份冲突' }).waitFor();
    await conflictProfile.close();
    const readGrant = await post('/oauth/device_authorization', { client_id: 'lingnest-cli', scope: 'library:read', client_name: 'Permission fixture' });
    await page.goto(server + '/authorize#code=' + readGrant.user_code);
    await page.locator('#consent').waitFor({ state: 'visible' });
    await page.locator('#allow').click(); await page.locator('#result-title').filter({ hasText: '已允许只读访问' }).waitFor();
    const readToken = await post('/oauth/token', { client_id: 'lingnest-cli', grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: readGrant.device_code });
    assert.ok(readToken.access_token);
    const revoked = await post('/api/pair', { key, name: 'Revoked Web fixture', clientType: 'web' });
    await service.store.put('device', { ...await service.store.get('device', revoked.device.id), revokedAt: new Date().toISOString() });
    for (const invalidToken of ['revoked-or-stale-token', revoked.token, readToken.access_token]) {
      const profile = await browser.newContext();
      await profile.addInitScript(value => sessionStorage.setItem('collector-token', value), invalidToken);
      const tab = await profile.newPage(); await tab.goto(server + '/authorize#code=' + retryGrant.user_code);
      await tab.locator('#auth-login').waitFor({ state: 'visible' });
      assert.equal(await tab.evaluate(() => sessionStorage.getItem('collector-token')), null);
      assert.equal(await tab.locator('#user-code').inputValue(), retryGrant.user_code);
      await profile.close();
    }
    console.log(JSON.stringify({ result: 'passed', checks: ['Web login and pairing restored', 'shared browser session and stable identity', 'no authorization before consent', 'CLI read-only approval and redemption', 'logout and re-login preserve confirmation code', 'stale and read-only sessions require owner login', '320/375px layouts'], screenshots: output }));
  } finally { await browser.close(); await service.close(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
