const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'node-actions-'));
  const config = path.join(root, 'worker.json');
  fs.writeFileSync(config, JSON.stringify({ dataDir: path.join(root, 'worker') }));
  const env = { ...process.env, COLLECTOR_CONFIG: config, COLLECTOR_DESKTOP_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: process.argv[2] || require('electron'), args: [...(process.argv[2] ? [] : [path.resolve(__dirname, '../desktop')]), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env });
  const output = path.resolve(__dirname, '../test-output/node-actions');
  fs.mkdirSync(output, { recursive: true });
  let page;
  try {
    await app.firstWindow();
    await app.evaluate(({ ipcMain }) => {
      const fixture = globalThis.nodeActionsFixture = { revision: 1, removed: false, removalCalls: 0 };
      const handle = (channel, fn) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, input) => fn(input)); };
      const device = id => ({ id, name: id === 'local-node' ? '本机验收' : id === 'offline-node' ? '离线验收' : '远端验收', role: 'worker', clientType: 'worker', online: id !== 'offline-node', agents: ['codex'], capabilities: ['article'], lastHeartbeatAt: new Date(fixture.revision * 1000).toISOString() });
      handle('library:status', () => ({ paired: true, server: 'https://fixture.example', deviceId: 'owner' }));
      handle('library:state', () => ({ me: { id: 'owner' }, devices: [device('local-node'), device('remote-node'), ...fixture.removed ? [] : [device('offline-node')]], tasks: [], archives: [] }));
      handle('library:removeNode', async id => {
        if (id !== 'offline-node') throw Error('Fixture must only remove its offline node');
        fixture.removalCalls++;
        if (fixture.removalError) throw Error(fixture.removalError);
        await new Promise(resolve => { fixture.releaseRemoval = resolve; });
        fixture.removed = true; return { removed: true, id };
      });
      handle('library:entries', () => ({ items: [], total: 0 }));
      handle('worker:snapshot', () => ({ paired: true, server: 'https://fixture.example', deviceId: 'local-node', device: '本机验收', running: false, online: true, phase: 'idle', mode: 'running', agents: [], tasks: [], macOS: { capabilities: {} } }));
      handle('library:skills', input => input.kind === 'environment' ? { items: [], agents: [], projects: [], nextOffset: null, snapshotId: 'fixture', scannedAt: new Date().toISOString() } : input.kind === 'versions' ? { versions: [] } : { operations: [] });
    });
    for (let i = 0; i < 100 && !page; i++) { page = app.windows().find(p => p.url().startsWith('file:') && !p.url().includes('compact=1')); if (!page) await new Promise(r => setTimeout(r, 100)); }
    assert.ok(page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.reload();
    await page.locator('[data-view=nodes]').click();
    await page.locator('#node-dispatch').waitFor();
    for (const node of ['local', 'remote-node']) {
      await page.locator(`[data-node="${node}"]`).click();
      assert.equal(await page.locator('[data-node-remove]').isVisible(), false, 'local and online nodes have no delete control');
      for (const selector of ['#node-dispatch', '[data-node-skills]']) {
        const button = await page.locator(selector).elementHandle();
        const bounds = await button.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        const previous = await page.locator('#nodes-freshness').innerText();
        await app.evaluate(() => globalThis.nodeActionsFixture.revision++);
        await page.waitForFunction(previous => document.querySelector('#nodes-freshness').textContent !== previous, previous);
        assert.equal(await button.evaluate(el => el.isConnected), true, `${node}: refresh must retain ${selector} during a pointer press`);
        await page.mouse.up();
        if (selector === '#node-dispatch') {
          await page.locator('#capture-dialog').waitFor({ state: 'visible' });
          assert.equal(await page.locator('#capture-device').inputValue(), node === 'local' ? 'local-node' : node);
          await page.locator('[data-close-dialog=capture-dialog][aria-label="关闭"]').click();
        } else {
          await page.locator('.skill-manager').waitFor({ state: 'visible' });
          await page.locator('.skill-manager [data-close]').click();
        }
        assert.equal(await page.evaluate(() => Boolean(document.querySelector(':modal'))), false);
        // A closed dialog must leave the same button available to keyboard users.
        await page.locator(selector).focus();
        await page.keyboard.press('Enter');
        await page.locator(selector === '#node-dispatch' ? '#capture-dialog' : '.skill-manager').waitFor({ state: 'visible' });
        await page.locator(selector === '#node-dispatch' ? '[data-close-dialog=capture-dialog][aria-label="关闭"]' : '.skill-manager [data-close]').click();
      }
    }
    await page.locator('[data-node="offline-node"]').click();
    const remove = page.locator('[data-node-remove]'); await remove.waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(output, 'offline-node-delete.png') });
    page.once('dialog', dialog => dialog.dismiss()); await remove.click();
    assert.equal(await app.evaluate(() => globalThis.nodeActionsFixture.removalCalls), 0, 'cancel never invokes deletion');
    await app.evaluate(() => globalThis.nodeActionsFixture.removalError = '节点已上线，无法删除');
    page.once('dialog', dialog => dialog.accept()); await remove.click();
    await page.locator('#workspace-toast').filter({ hasText: '节点已上线' }).waitFor();
    assert.equal(await page.locator('[data-node="offline-node"]').count(), 1);
    await app.evaluate(() => { delete globalThis.nodeActionsFixture.removalError; });
    const heldButton = await remove.elementHandle(), bounds = await heldButton.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
    const previous = await page.locator('#nodes-freshness').innerText();
    await app.evaluate(() => globalThis.nodeActionsFixture.revision++);
    await page.waitForFunction(previous => document.querySelector('#nodes-freshness').textContent !== previous, previous);
    assert.equal(await heldButton.evaluate(el => el.isConnected), true);
    page.once('dialog', dialog => dialog.accept()); await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('[data-node-remove]').disabled);
    await app.evaluate(() => globalThis.nodeActionsFixture.revision++);
    await page.waitForFunction(() => Boolean(document.querySelector('[data-node-remove]').disabled));
    assert.equal(await app.evaluate(() => globalThis.nodeActionsFixture.removalCalls), 2);
    await app.evaluate(() => globalThis.nodeActionsFixture.releaseRemoval());
    await page.locator('[data-node="offline-node"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-node="local"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'node-actions.png') });
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks: ['local and remote pointer press during heartbeat refresh', 'dispatch target retained', 'skill dialog close and reopen', 'keyboard activation after modal close', 'offline-only removal, cancellation, server rejection, pending protection and selection fallback'], errors }, null, 2));
    console.log('Desktop node actions: passed');
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally { if (page && !page.isClosed()) await page.mouse.up().catch(() => {}); await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
