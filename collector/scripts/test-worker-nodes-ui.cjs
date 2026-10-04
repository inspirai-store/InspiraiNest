const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const { createService } = await import('../src/server.mjs');
  const { hash, secret } = await import('../src/common.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-worker-nodes-'));
  let at = Date.now();
  const key = secret(), service = createService({ dataDir: root, masterKey: key, clock: () => at });
  const output = path.resolve(__dirname, '../test-output/worker-nodes'); fs.mkdirSync(output, { recursive: true });
  const stamp = offset => new Date(at + offset).toISOString();
  const device = (id, overrides = {}) => ({ id, name: '家里台式', role: 'worker', category: 'desktop', tokenHash: hash(secret()),
    capabilities: ['article', 'video'], agents: ['codex'], lastHeartbeatAt: stamp(0), lastSeen: stamp(0), revokedAt: null,
    deviceInfo: { os: { family: 'Windows', version: '11' }, client: { type: 'desktop', name: 'InspiraiNest', version: '0.1.8' }, model: 'Test PC' },
    identity: { version: 2, source: 'smbios', digest: 'a'.repeat(64) }, ...overrides });
  for (const record of [
    device('node-ready'), device('node-no-agent', { name: '备用电脑', agents: [] }),
    device('node-offline', { name: '<script>do-not-run</script>', lastHeartbeatAt: stamp(-120000),
      deviceInfo: { os: { family: 'macOS', version: '26' }, client: { type: 'desktop', version: '0.1.7' }, model: 'MacBook Pro' } }),
    device('node-no-heartbeat', { name: '尚未启动', lastHeartbeatAt: null }),
    device('node-revoked', { name: '已撤销', revokedAt: stamp(0) }),
    device('desktop-manager-only', { name: '纯管理客户端', role: 'owner' }),
    device('phone-with-agents', { name: '手机', role: 'owner', category: 'mobile', clientType: 'android' }),
    device('browser-with-agents', { name: '浏览器', role: 'owner', category: 'browser', clientType: 'web', browserExpiresAt: stamp(86400000) }),
    device('readonly-cli', { name: '只读工具', role: 'reader', category: 'integration', scope: 'library:read', expiresAt: stamp(86400000) }),
  ]) await service.store.put('device', record);
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.locator('#login-form [name=key]').fill(key);
    await page.locator('#login-form button[type=submit]').click(); await page.locator('#app').waitFor({ state: 'visible' });
    const library = page.frameLocator('#library-frame'); await library.locator('#search').fill('阅读状态保留');
    await page.locator('#worker-node-count').filter({ hasText: '2/4' }).waitFor();
    assert.ok((await page.locator('#worker-nodes-toggle').getAttribute('aria-label')).includes('2 个在线 / 4 个已授权'));
    const footer = await page.locator('.workspace-footer').boundingBox(); assert.equal(footer.x, 0); assert.equal(footer.y + footer.height, 900);
    await page.locator('#worker-nodes-toggle').click(); await page.locator('#worker-nodes-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.node-card').count(), 4);
    assert.equal(await page.locator('.node-card[data-status=online]').count(), 2);
    assert.equal(await page.locator('.node-card[data-node-id=node-no-agent] .node-state').textContent(), '无可用 Agent');
    assert.ok((await page.locator('.node-card[data-node-id=node-ready]').innerText()).includes('Windows 11 · 客户端登录'));
    assert.ok((await page.locator('.node-card[data-node-id=node-ready]').innerText()).includes('Codex'));
    assert.ok((await page.locator('.node-card[data-node-id=node-ready]').innerText()).includes('aaaaaaaaaaaa'));
    assert.ok((await page.locator('.node-card[data-node-id=node-offline]').innerText()).includes('MacBook Pro'));
    assert.ok((await page.locator('.node-card[data-node-id=node-offline]').innerText()).includes('<script>do-not-run</script>'));
    assert.equal(await page.locator('#worker-nodes script').count(), 0);
    assert.ok((await page.locator('.node-card[data-node-id=node-no-heartbeat]').innerText()).includes('尚无心跳'));
    for (const id of ['node-revoked', 'desktop-manager-only', 'phone-with-agents', 'browser-with-agents', 'readonly-cli'])
      assert.equal(await page.locator(`[data-node-id="${id}"]`).count(), 0);
    await page.keyboard.press('Escape'); await page.locator('#worker-nodes-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'worker-nodes-toggle');
    assert.equal(await library.locator('#search').inputValue(), '阅读状态保留');
    await page.locator('#worker-nodes-toggle').click(); await page.mouse.click(4, 4);
    await page.locator('#worker-nodes-dialog').waitFor({ state: 'hidden' });
    for (const width of [1440, 760, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const status = await page.locator('.workspace-footer').boundingBox();
      assert.ok(status.y + status.height <= 900 && status.x + status.width <= width);
      if (width <= 760) {
        const frame = await page.locator('#library-frame').boundingBox(); assert.ok(frame.y + frame.height <= status.y + 1);
      }
      await page.screenshot({ path: path.join(output, `footer-${width}.png`) });
      await page.locator('#worker-nodes-toggle').click();
      assert.ok(await page.locator('#worker-nodes-dialog').evaluate(element => element.scrollWidth <= element.clientWidth));
      await page.screenshot({ path: path.join(output, `nodes-${width}.png`) });
      await page.locator('#worker-nodes-dialog [data-close]').click();
    }
    await page.locator('#worker-nodes-toggle').click();
    await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Fixture unavailable"}' }));
    await page.evaluate(() => document.querySelector('#refresh').click());
    await page.locator('#worker-node-count').filter({ hasText: '—/4' }).waitFor();
    assert.equal(await page.locator('.node-card[data-status=unknown]').count(), 4);
    assert.ok((await page.locator('#node-connection-state').textContent()).includes('状态待更新'));
    await page.unroute('**/api/state'); await page.evaluate(() => document.querySelector('#refresh').click());
    await page.locator('#worker-node-count').filter({ hasText: '2/4' }).waitFor();
    // Management activity cannot substitute for a real worker heartbeat.
    at += 60000;
    await service.store.put('device', { ...await service.store.get('device', 'node-ready'), lastSeen: stamp(0) });
    await page.locator('#worker-node-count').filter({ hasText: '0/4' }).waitFor();
    assert.equal(await page.locator('.node-card[data-status=online]').count(), 0);
    await service.store.put('device', { ...await service.store.get('device', 'node-ready'), lastHeartbeatAt: stamp(0) });
    await page.locator('#worker-node-count').filter({ hasText: '1/4' }).waitFor();
    await service.store.delete('device', 'node-ready');
    await page.locator('#worker-node-count').filter({ hasText: '0/3' }).waitFor();
    assert.equal(await page.locator('.node-card').count(), 3);
    for (const id of ['node-no-agent', 'node-offline', 'node-no-heartbeat']) await service.store.delete('device', id);
    await page.locator('#worker-node-count').filter({ hasText: '0/0' }).waitFor();
    await page.locator('.nodes-empty').waitFor({ state: 'visible' });
    await page.locator('#manage-worker-nodes').click();
    assert.equal(await page.locator('#worker-nodes-dialog').isVisible(), false);
    assert.equal(await page.locator('#devices-view').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', onlineOverAuthorized: true, excludesNonWorkersAndRevoked: true,
      graphAndDeviceDetails: true, heartbeatOnly: true, pollingAndRevocationUpdates: true, disconnectedStateIsUnknown: true,
      emptyState: true, preservedReaderState: true, mobileFooterDoesNotOverlap: true, responsiveWidths: [320, 375, 760, 1440], productionCredentialsUsed: false, screenshots: output }));
  } finally {
    await browser.close(); await service.close();
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'collector-worker-nodes-'))); fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
