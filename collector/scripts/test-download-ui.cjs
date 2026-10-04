const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');

async function main() {
  const { createService } = await import('../src/server.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'download-ui-'));
  const releases = {};
  for (const [platform, version, suffix] of [['windows_x64', '0.1.11', 'Windows-x64.exe'], ['macos_arm64_dmg', '0.1.7', 'macOS-arm64.dmg'], ['macos_x64_dmg', '0.1.7', 'macOS-x64.dmg']]) {
    const filename = `InspiraiNest-v${version}-${suffix}`, bytes = Buffer.from('isolated download fixture: ' + platform);
    fs.writeFileSync(path.join(root, filename), bytes);
    releases[platform] = { version, filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  fs.writeFileSync(path.join(root, 'worker-release.json'), JSON.stringify(releases));
  const app = createService({ dataDir: root, releaseDir: root, masterKey: randomBytes(32).toString('hex') });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const output = path.resolve(__dirname, '../test-output/download');
  fs.mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    for (const [name, width, height] of [['desktop', 1440, 1000], ['minimum', 740, 580], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(base + '/download');
      await page.locator('#worker-windows[href]').waitFor();
      assert.match(await page.locator('#worker-windows').innerText(), /v0\.1\.11.*NSIS/);
      assert.match(await page.locator('#worker-macos-arm64').innerText(), /v0\.1\.7.*正式发布版/);
      assert.equal(await page.locator('#worker-windows').getAttribute('download'), releases.windows_x64.filename);
      assert.equal(await page.locator('#worker-macos-arm64').getAttribute('href'), '/downloads/' + releases.macos_arm64_dmg.filename);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' overflow');
      await page.locator('#worker-checks summary').click();
      assert.equal(await page.locator('#worker-windows-sha').innerText(), releases.windows_x64.sha256);
      assert.equal(await page.locator('#worker-windows-file').innerText(), releases.windows_x64.filename);
      await page.locator('#worker-title').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    }
    await page.route('**/client-release.json', route => route.fulfill({ status: 503, body: '{}' }));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#worker-status').textContent.includes('暂时无法获取'));
    assert.equal(await page.locator('#worker-windows').getAttribute('href'), null);
    await page.unroute('**/client-release.json');
    fs.writeFileSync(path.join(root, 'worker-release.json'), '{}');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#worker-status').textContent.includes('暂未发布'));
    assert.equal(await page.locator('#worker-windows').getAttribute('aria-disabled'), 'true');
    assert.deepEqual(errors, []);
    console.log('Download UI passed: platform versions, filenames, checksums, responsive layouts, unavailable and empty releases.');
  } finally {
    await browser.close(); await app.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
