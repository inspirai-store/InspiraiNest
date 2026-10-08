const {setTheme,showSettings}=require('./desktop-test-helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { _electron } = require('playwright');

(async () => {
  const executable = process.argv[2];
  if (!executable) throw new Error('Pass the unpacked Electron executable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-worker-'));
  const config = path.join(root, 'worker.json');
  const { createService } = await import('../src/server.mjs');
  const { api } = await import('../src/worker.mjs');
  const { WorkerManager } = await import('../desktop/manager.mjs');
  const key = randomBytes(36).toString('hex');
  const service = createService({ dataDir: path.join(root, 'server'), masterKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const server = `http://127.0.0.1:${service.server.address().port}`;
  const owner = { server, ...await api({ server }, '/api/pair', 'POST', { key, name: 'packaged-test-owner' }) };
  const pairing = await api(owner, '/api/pairings', 'POST', {});
  const agent = path.resolve(__dirname, '../test/fixtures/fake-agent.mjs');
  fs.writeFileSync(config, JSON.stringify({ dataDir: path.join(root, 'data'), server, pollMs: 250,
    capabilities: ['article'], agents: { codex: { command: process.execPath, args: [agent], versionArgs: [agent, '--version'] } } }));
  const env = { ...process.env, COLLECTOR_CONFIG: config, COLLECTOR_DESKTOP_TEST: '1', COLLECTOR_DESKTOP_STORAGE_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.resolve(executable), env });
  const manager = new WorkerManager(config, process.execPath);
  const until = async fn => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Packaged Worker timeout'); };
  try {
    await app.firstWindow();
    await until(() => app.windows().some(window => window.url().startsWith('file:') && !window.url().includes('compact=1')));
    const page = app.windows().find(window => window.url().startsWith('file:') && !window.url().includes('compact=1'));
    assert.ok(page, 'Main Worker window missing');
    await page.locator('[data-view=nodes]').click();
    await page.locator('#pair-worker').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-action=start]').isDisabled(), true);
    await setTheme(page,'dark');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await setTheme(page);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('[name=themeMode][value=light]').isChecked(), true);
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    assert.equal(await page.title(), '灵藏 · 桌面工作台');
    const appPath = await app.evaluate(({ app }) => app.getAppPath());
    assert.equal(fs.existsSync(path.join(appPath, 'public/device-view.js')), true, 'Missing authorization presentation helper');
    assert.equal(fs.existsSync(path.join(appPath, 'public/pairing-dialog.css')), true, 'Missing pairing dialog stylesheet');
    assert.equal(fs.existsSync(path.join(appPath, '..', 'library', 'scripts', 'catalog.mjs')), true);
    const jsonWriter = path.join(appPath, '..', 'library', 'scripts', 'write-collection-json.mjs');
    assert.equal(fs.existsSync(jsonWriter), true, 'Missing UTF-8 collection JSON writer');
    assert.equal(fs.readFileSync(jsonWriter, 'utf8').replace(/\r\n/g, '\n'), fs.readFileSync(path.resolve(__dirname, '../../scripts/write-collection-json.mjs'), 'utf8').replace(/\r\n/g, '\n'));
    assert.equal(fs.existsSync(path.join(appPath, 'src', 'text-encoding.mjs')), true, 'Missing readable metadata validation');
    assert.equal(fs.existsSync(path.join(appPath, 'src', 'task-routing.mjs')), true, 'Missing cross-node task routing');
    assert.equal(await page.locator('#task-filter').inputValue(), 'unfinished');
    for (const file of ['settings.mjs','settings-renderer.js','nodes.js','owner-client.mjs','updater.mjs','workspace.css','workspace.js','client-login.js','vendor/marked.js','vendor/purify.js','vendor/lucide.js']) {
      assert.equal(fs.existsSync(path.join(appPath, 'desktop', file)), true, `Missing packaged resource: ${file}`);
    }
    assert.equal(fs.existsSync(path.join(appPath, '..', 'app-update.yml')), true, 'Missing packaged update provider configuration');
    await showSettings(page,'updates');
    await page.waitForFunction(() => document.querySelector('#update-current').textContent.startsWith('v'));
    assert.equal(await page.locator('#update-check').isEnabled(), true);
    await page.locator('[data-view=nodes]').click();
    await page.locator('#pair-worker [name=server]').fill(server);
    await page.locator('#pair-worker [name=key]').fill(pairing.key);
    await page.locator('#pair-worker button[type=submit]').click();
    await until(() => manager.snapshot().paired);
    await page.locator('#overview-data').waitFor({ state: 'visible' });
    await page.locator('[data-view=nodes]').click();
    await page.locator('[data-node=local]').click();
    await page.locator('[data-action=start]').click();
    await until(() => manager.snapshot().online);
    const task = await api(owner, '/api/tasks', 'POST', { content: '合成打包验收资料', submissionId: randomBytes(16).toString('hex') });
    await until(async () => (await api(owner, '/api/state')).tasks.some(item => item.id === task.id && item.state === 'completed'));
    await page.locator('[data-action=drain]').click();
    await until(() => !manager.snapshot().running);
    await page.locator('[data-view=overview]').click();
    await page.locator('#overview-data').waitFor({ state: 'visible' });
    await page.locator('[data-view=library]').click();
    await page.locator('#remote-entries [data-entry]').first().click();
    await page.waitForFunction(() => document.querySelector('#reader-paper')?.textContent?.includes('测试报告'));
    console.log('Packaged Worker, owner pairing, authenticated reader and resources: passed');
  } finally {
    if (manager.snapshot().managed) { await manager.control('drain'); await until(() => !manager.snapshot().running); }
    await app.evaluate(({ app }) => app.quit()); await app.close(); await service.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
