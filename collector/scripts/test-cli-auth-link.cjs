const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

(async () => {
  const { createService } = await import('../src/server.mjs');
  const { secret } = await import('../src/common.mjs');
  const binary = path.resolve(process.argv[2] || path.join(__dirname, '../cli/dist', process.platform === 'win32' ? 'lingnest.exe' : 'lingnest'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-link-ui-')), key = secret();
  const service = createService({ dataDir: root, masterKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const server = `http://127.0.0.1:${service.server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const login = spawn(binary, ['--server', server, '--json', 'auth', 'login', '--no-browser'], { windowsHide: true });
  let output = '', diagnostics = '';
  login.stdout.on('data', data => output += data);
  login.stderr.on('data', data => diagnostics += data);
  const finished = new Promise((resolve, reject) => { login.on('error', reject); login.on('close', code => resolve(code)); });
  const link = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CLI did not print a verification link')), 15000);
    login.stderr.on('data', () => { const match = diagnostics.match(/Authorize this device at ([^\r\n]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    login.on('error', error => { clearTimeout(timer); reject(error); });
    login.on('close', () => { clearTimeout(timer); reject(Error('CLI exited before printing a link')); });
  });
  try {
    const url = await link, code = new URLSearchParams(new URL(url).hash.slice(1)).get('code');
    assert.match(code, /^[A-F0-9]{4}-[A-F0-9]{4}$/);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#auth-login').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#user-code').inputValue(), code);
    assert.equal(page.url(), server + '/authorize');
    await page.locator('#owner-key').fill(key); await page.locator('#auth-login button').click();
    await page.locator('#consent').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#confirmation-code').innerText(), code);
    assert.equal((await service.store.list('reader_grant'))[0].state, 'pending');
    assert.equal(login.exitCode, null);
    const screenshots = path.resolve(__dirname, '../test-output/cli-auth-link'); fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'prefilled-consent.png'), fullPage: true });
    await page.locator('#allow').click();
    await page.locator('#result-title').filter({ hasText: '已允许只读访问' }).waitFor();
    assert.equal(await finished, 0, diagnostics);
    assert.equal(JSON.parse(output).authenticated, true);
    const read = await run(binary, ['--server', server, '--json', 'list'], { windowsHide: true });
    assert.equal(JSON.parse(read.stdout).schema_version, 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', completeCliLink: true, prefilledBeforeLogin: true, requestOpenedAfterLogin: true, explicitConsent: true, actualWindowsCredentialStoreAndRead: true, productionCredentialsUsed: false }));
  } finally {
    if (login.exitCode === null) login.kill();
    await finished.catch(() => {});
    await run(binary, ['--server', server, '--json', 'auth', 'logout'], { windowsHide: true }).catch(error => { console.error('Could not remove test-only authorization:', error.code); });
    await browser.close(); await service.close(); fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
