const {setTheme,showSettings}=require('./desktop-test-helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

(async () => {
  const executable = path.resolve(process.argv[2] || '');
  const installer = path.resolve(process.argv[3] || '');
  if (!fs.existsSync(executable) || !fs.existsSync(installer)) throw new Error('Pass the unpacked executable and its update package');
  const metadataName = process.platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inspirainest-update-test-'));
  const workerConfig = path.join(root, 'worker.json');
  fs.writeFileSync(workerConfig, JSON.stringify({ dataDir: path.join(root, 'data') }));
  const metadataFile = path.join(path.dirname(installer), metadataName);
  const current = require('../package.json').version;
  const next = current.replace(/\d+$/, value => String(Number(value) + 1));
  const metadata = fs.readFileSync(metadataFile, 'utf8').replace(`version: ${current}`, `version: ${next}`);
  if (!metadata.includes(`version: ${next}`)) throw new Error('Cannot prepare update fixture');
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/' + metadataName) { res.writeHead(200, { 'Content-Type': 'text/yaml' }); res.end(metadata); return; }
    const packageName = path.basename(route);
    const packageFile = path.join(path.dirname(installer), packageName);
    if (route === '/' + packageName && /^InspiraiNest-v\d+\.\d+\.\d+-(Windows-x64\.exe|macOS-(x64|arm64)\.zip)$/.test(packageName)
      && fs.existsSync(packageFile)) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(packageFile).size });
      fs.createReadStream(packageFile).pipe(res); return;
    }
    res.writeHead(404); res.end();
  });
  let app;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const env = { ...process.env, COLLECTOR_CONFIG: workerConfig, COLLECTOR_DESKTOP_TEST: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: executable, env });
    await app.evaluate((_, { url, cache }) => {
      const updater = globalThis.workerDesktop().updates.updater;
      Object.defineProperty(updater.app, 'baseCachePath', { value: cache });
      updater.setFeedURL({ provider: 'generic', url, useMultipleRangeRequest: false });
    }, { url: base, cache: path.join(root, 'updater-cache') });
    await app.firstWindow();
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find(window => window.url().startsWith('file:') && !window.url().includes('compact=1'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!page) throw new Error('Main application window did not load');
    await showSettings(page,'updates');
    await page.locator('#update-check').click();
    try { await page.waitForFunction(version => document.querySelector('#update-headline').textContent.includes(`v${version}`), next, { timeout: 30000 }); }
    catch (error) {
      console.error('Update status:', await page.evaluate(() => window.updates.status()));
      console.error('Update requests:', requests);
      throw error;
    }
    assert.equal(await page.locator('#update-download').isVisible(), true);
    await page.locator('#update-download').click();
    await page.locator('#update-install').waitFor({ state: 'visible', timeout: 120000 });
    assert.match(await page.locator('#update-description').innerText(), /已下载并校验/);
    const packageRequests = requests.map(url => new URL(url, 'http://localhost').pathname)
      .filter(route => /^\/InspiraiNest-v\d+\.\d+\.\d+-(Windows-x64\.exe|macOS-(x64|arm64)\.zip)$/.test(route));
    assert.ok(packageRequests.includes('/' + path.basename(installer)), `Updater selected the wrong package: ${packageRequests.join(', ')}`);
    assert.ok(packageRequests.every(route => route === '/' + path.basename(installer)), `Updater requested another architecture: ${packageRequests.join(', ')}`);
    console.log(`Packaged updater checked and downloaded ${path.basename(installer)} for ${process.platform}`);
  } finally {
    if (app) { try { await app.evaluate(({ app }) => app.quit()); } catch {} await app.close().catch(() => {}); }
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
