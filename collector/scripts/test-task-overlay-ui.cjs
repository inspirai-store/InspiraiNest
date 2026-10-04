const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const { createService } = await import('../src/server.mjs');
  const { secret } = await import('../src/common.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-task-overlay-'));
  const key = secret(), service = createService({ dataDir: root, masterKey: key });
  const output = path.resolve(__dirname, '../test-output/task-overlay');
  fs.mkdirSync(output, { recursive: true });
  const states = ['queued', 'assigned', 'running', 'uploading', 'waiting_action', 'awaiting_review', 'failed', 'completed', 'cancelled'];
  for (let i = 0; i < 45; i++) {
    const at = new Date(Date.now() - i * 1000).toISOString();
    await service.store.put('task', { id: `overlay-${i}`, content: `隔离测试资料 ${i + 1}：文章与视频分析 https://example.com/item-${i}`,
      type: 'auto', state: states[i] || 'queued', createdAt: at, updatedAt: at, scenario: null,
      autoArchive: true, tags: ['测试'], events: [{ at, message: '等待可用电脑' }] });
  }
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('#login-form [name=key]').fill(key);
    await page.locator('#login-form button[type=submit]').click();
    await page.locator('#app').waitFor({ state: 'visible' });
    const library = page.frameLocator('#library-frame');
    await library.locator('#search').fill('保留阅读筛选');
    assert.equal(await page.title(), '资料库 · 灵藏');
    assert.equal(await page.locator('#archives-view').isVisible(), true);
    assert.equal(await page.locator('#tasks-dialog').isVisible(), false);
    assert.equal(await page.locator('nav [data-view=tasks]').count(), 0);
    assert.equal(await page.locator('#task-count').textContent(), '43');
    const brand = await page.locator('#app header .brand').boundingBox();
    const toggle = await page.locator('#tasks-toggle').boundingBox();
    assert.ok(toggle.x >= brand.x + brand.width && toggle.y < 72);
    await page.locator('#tasks-toggle').click();
    await page.locator('#tasks-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.title(), '采集任务 · 灵藏');
    assert.equal(await page.locator('nav [data-view=archives]').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#tasks-toggle').getAttribute('aria-expanded'), 'true');
    const box = await page.locator('#tasks-dialog').boundingBox();
    assert.ok(box.width > 1440 * 0.9 && box.height > 900 * 0.9);
    await page.locator('#status-filter').selectOption('queued');
    assert.equal(await page.locator('#tasks .row').count(), 37);
    await page.locator('#tasks-view').evaluate(element => element.scrollTop = 300);
    await page.locator('#tasks-dialog [data-close]').click();
    await page.locator('#tasks-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#tasks-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tasks-toggle');
    assert.equal(await library.locator('#search').inputValue(), '保留阅读筛选');
    await page.locator('#tasks-toggle').click();
    assert.equal(await page.locator('#status-filter').inputValue(), 'queued');
    assert.ok(await page.locator('#tasks-view').evaluate(element => element.scrollTop >= 290));
    // Closing and reopening in one event turn must not leave stale ARIA state.
    await page.evaluate(() => {
      document.querySelector('#tasks-dialog [data-close]').click();
      document.querySelector('#tasks-toggle').click();
    });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#tasks-toggle').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    await page.locator('#tasks-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.title(), '资料库 · 灵藏');
    await page.locator('#tasks-toggle').click();
    await page.mouse.click(4, 4);
    await page.locator('#tasks-dialog').waitFor({ state: 'hidden' });
    await page.locator('[data-view=devices]').click();
    await page.locator('#tasks-toggle').click();
    assert.ok(await page.locator('#tasks-view').evaluate(element => element.scrollTop >= 290));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#devices-view').isVisible(), true);
    assert.equal(await page.title(), '授权设备 · 灵藏');
    await page.locator('[data-view=archives]').click();
    await page.locator('#tasks-toggle').click();
    await page.locator('#new-task').click();
    await page.locator('#task-form [name=content]').fill('隔离任务弹窗测试 https://example.com/new');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#tasks-dialog').isVisible(), true);
    await page.locator('#new-task').click();
    assert.ok((await page.locator('#task-form [name=content]').inputValue()).includes('隔离任务弹窗测试'));
    await page.locator('#task-form button[type=submit]').click();
    await page.locator('#task-dialog').waitFor({ state: 'hidden' });
    await page.locator('#task-count').filter({ hasText: '44' }).waitFor();
    assert.equal(await page.locator('#tasks-dialog').isVisible(), true);
    await page.locator('#tasks-view').evaluate(element => element.scrollTop = 0);
    await page.locator('#tasks [data-task]').first().click();
    await page.locator('#detail-dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#tasks-dialog').isVisible(), true);
    await page.locator('#tasks [data-task]').first().click();
    await page.locator('#detail-dialog [data-cancel]').click();
    await page.locator('#detail-dialog').waitFor({ state: 'hidden' });
    await page.locator('#task-count').filter({ hasText: '43' }).waitFor();
    await page.locator('#status-filter').selectOption('all');
    const beforePoll = await page.locator('#tasks-view').evaluate(element => element.scrollTop = 240);
    await page.waitForResponse(response => response.url() === base + '/api/state' && response.request().method() === 'GET');
    assert.equal(await page.locator('#tasks-dialog').isVisible(), true);
    assert.equal(await page.locator('#tasks-view').evaluate(element => element.scrollTop), beforePoll);
    await page.keyboard.press('Escape');
    for (const width of [1440, 760, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `library-${width}.png`) });
      await page.locator('#tasks-toggle').click();
      await page.locator('#tasks-view').evaluate(element => element.scrollTop = 0);
      assert.ok(await page.locator('#tasks-dialog').evaluate(element => element.scrollWidth <= element.clientWidth));
      const modal = await page.locator('#tasks-dialog').boundingBox();
      assert.ok(modal.x >= 0 && modal.y >= 0 && modal.x + modal.width <= width);
      await page.screenshot({ path: path.join(output, `tasks-${width}.png`) });
      await page.locator('#new-task').click();
      assert.ok(await page.locator('#task-dialog').evaluate(element => element.scrollWidth <= element.clientWidth));
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#tasks-dialog').isVisible(), true);
      await page.keyboard.press('Escape');
    }
    await page.reload();
    await page.locator('#app').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#archives-view').isVisible(), true);
    assert.equal(await page.locator('#tasks-dialog').isVisible(), false);
    const seed = (await service.store.list('task'))[0];
    for (let i = 0; i < 70; i++) await service.store.put('task', { ...seed, id: `extra-${i}`, state: 'queued' });
    await page.locator('#refresh').click();
    await page.locator('#task-count').filter({ hasText: '99+' }).waitFor();
    assert.ok((await page.locator('#tasks-toggle').getAttribute('aria-label')).includes('113'));
    for (const task of await service.store.list('task')) await service.store.put('task', { ...task, state: 'completed' });
    await page.locator('#refresh').click();
    await page.locator('#task-count').filter({ hasText: /^0$/ }).waitFor();
    assert.ok((await page.locator('#task-count').getAttribute('class')).includes('is-empty'));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', defaultView: 'library', headerTaskBadge: true,
      overlayKeepsReadingState: true, closeMethods: ['button', 'escape', 'backdrop'], nestedDialogs: true,
      filterAndScrollPreserved: true, pollingAndSubmissionCounts: true, zeroAndOverflowBadges: true,
      restoredLoginDefaultsToLibrary: true, responsiveWidths: [320, 375, 760, 1440], productionCredentialsUsed: false, screenshots: output }));
  } finally {
    await browser.close(); await service.close();
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'collector-task-overlay-')));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
