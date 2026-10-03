const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

// UI-only fixtures deliberately avoid production credentials and data writes.
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-ui-'));
  const config = path.join(root, 'worker.json');
  fs.writeFileSync(config, JSON.stringify({ server: 'https://library.example', dataDir: path.join(root, 'data') }));
  const env = { ...process.env, COLLECTOR_CONFIG: config, COLLECTOR_DESKTOP_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = (() => { try { return require('../desktop/node_modules/electron'); } catch { return require('electron'); } })();
  const app = await _electron.launch({ executablePath: electron, args: [path.resolve(__dirname, '../desktop')], env });
  const output = path.resolve(__dirname, '../test-output/desktop');
  fs.mkdirSync(output, { recursive: true });
  try {
    await app.firstWindow();
    let page, compact;
    for (let n = 0; n < 100 && (!page || !compact); n++) {
      page = app.windows().find(p => p.url().startsWith('file:') && !p.url().includes('compact=1'));
      compact = app.windows().find(p => p.url().includes('compact=1'));
      if (!page || !compact) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(page && compact);
    const dimensions = await app.evaluate(() => {
      const { main, popover } = globalThis.workerDesktop();
      return { main: main.getSize(), minimum: main.getMinimumSize(), trayContent: popover.getContentSize() };
    });
    assert.deepEqual(dimensions.main, [1240, 820]);
    assert.deepEqual(dimensions.minimum, [740, 580]);
    assert.ok(Math.abs(dimensions.trayContent[0] - 390) <= 2);
    // Windows can round the non-resizable minimum height by two DIP at 150% scaling.
    assert.ok(Math.abs(dimensions.trayContent[1] - 350) <= 2);
    const selectedContrast = () => page.locator('#remote-entries [aria-selected="true"] time').evaluate(element => {
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = value => rgb(value).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const foreground = luminance(getComputedStyle(element).color), background = luminance(getComputedStyle(element.closest('.list-item')).backgroundColor);
      return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    });
    assert.match(await compact.evaluate(() => window.library.status().catch(e => e.message)), /主窗口/);
    await app.evaluate(({ ipcMain }, mainId) => {
      const fixture = globalThis.workbenchUIFixture = { revoked: false, offline: false, contentDelay: 0, failChunk: false, entriesDelay: 0 };
      const items = Array.from({ length: 32 }, (_, n) => ({ id: `fixture:${n}`, title: n === 1 ? '非常长的资料标题与路径'.repeat(12) : `合成资料 ${n}`, summary: '用于验证桌面交互的合成内容', type: 'article', status: 'archived', tags: ['测试'], collected_at: '2026-09-27T00:24:55+08:00' }));
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const handle = (name, fn) => {
        ipcMain.removeHandler('library:' + name);
        ipcMain.handle('library:' + name, async (event, ...args) => {
          if (event.sender.id !== mainId) throw new Error('管理操作仅限主窗口');
          return fn(...args);
        });
      };
      handle('status', () => ({ paired: !fixture.revoked, server: 'https://library.example' }));
      handle('logout', () => { fixture.revoked = true; return { paired: false, server: 'https://library.example' }; });
      handle('state', () => {
        if (fixture.revoked) throw new Error('管理端授权已失效，请重新配对');
        if (fixture.offline) throw new Error('测试连接中断');
        return { me: { id: 'owner-fixture' }, tasks: [], devices: [
          { id: 'node-fixture', name: 'Preserved computer note', role: 'worker', category: 'desktop', workerAuthorized: true, online: false, agents: ['codex'], capabilities: ['article'], displayName: 'Windows 11 · 客户端登录' },
          { id: 'mobile-fixture', name: 'Preserved mobile note', role: 'owner', category: 'mobile', online: false, displayName: 'Android 16 · 客户端登录' },
          { id: 'browser-fixture', name: 'Preserved browser note', role: 'owner', category: 'browser', online: false, browserExpiresAt: '2099-01-01T00:00:00.000Z', displayName: 'Windows 11 · Chrome 浏览器登录' }
        ], archives: items.map(e => ({ entryId: e.id, createdAt: e.collected_at, meta: e })) };
      });
      handle('entries', async filter => {
        const delay = fixture.entriesDelay; fixture.entriesDelay = 0;
        await sleep(delay);
        const found = filter.q ? items.filter(e => e.title.includes(filter.q)) : items;
        return { items: found.slice(filter.offset, filter.offset + filter.limit), total: found.length, index: { complete: false } };
      });
      handle('entry', async id => {
        if (id === 'fixture:0') { await sleep(500); throw new Error('旧资料请求失败'); }
        return { ...items.find(e => e.id === id), creator: '测试作者', files: [{ path: 'analysis.md', role: 'analysis' }, { path: 'long.md', role: 'analysis' }, { path: 'original.txt', role: 'original' }], related: [], omitted: ['video.mp4', 'cookies.txt'] };
      });
      handle('content', async input => {
        const delay = fixture.contentDelay; fixture.contentDelay = 0;
        await sleep(delay);
        if (input.file === 'long.md' && input.startLine > 1 && fixture.failChunk) { fixture.failChunk = false; throw new Error('分段测试中断'); }
        if (input.file === 'analysis.md') return { content: '# 分析报告\n<script>window.fixtureXss = true</script>\n<img src=x onerror="window.fixtureXss=true">\n[危险](javascript:alert(1))', truncated: false };
        if (input.file === 'original.txt') return { content: '当前原文，旧的分析报告不应覆盖此处。', truncated: false };
        const lines = Array.from({ length: 270 }, (_, n) => `正文第 ${n + 1} 行`);
        return { content: lines.slice(input.startLine - 1, input.startLine + 199).join('\n'), truncated: input.startLine === 1, next_line: 201, next_column: 0 };
      });
    }, await app.evaluate(() => globalThis.workerDesktop().main.webContents.id));
    await page.reload();
    await page.locator('#overview-data').waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 1240, height: 820 });
    assert.equal(await page.title(), '灵藏 · 桌面工作台');
    await page.locator('[data-view=devices]').click();
    for (const category of ['desktop', 'mobile', 'browser']) assert.equal(await page.locator(`[data-category=${category}] .device-card`).count(), 1);
    assert.match(await page.locator('[data-category=desktop]').innerText(), /工作节点离线/);
    assert.match(await page.locator('[data-category=mobile]').innerText(), /已登录/);
    assert.match(await page.locator('[data-category=browser]').innerText(), /有效至/);
    await page.screenshot({ path: path.join(output, 'device-categories-wide.png') });
    await page.setViewportSize({ width: 740, height: 580 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'device-categories-narrow.png') });
    await page.locator('#capture-top').click();
    assert.equal(await page.locator('#capture-device option').count(), 2);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1240, height: 820 });
    await page.locator('[data-view=library]').click();
    await page.waitForFunction(() => document.querySelectorAll('#remote-entries [data-entry]').length === 30);
    assert.match(await page.locator('#entries-count').innerText(), /索引仍在更新/);
    await page.locator('#load-more').click();
    await page.waitForFunction(() => document.querySelectorAll('#remote-entries [data-entry]').length === 32);
    await page.locator('[data-entry="fixture:0"]').click();
    await page.locator('[data-entry="fixture:1"]').click();
    await page.locator('#reader-paper .document-body').waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    assert.match(await page.locator('#entry-detail .detail-title').innerText(), /非常长/);
    assert.ok(await selectedContrast() >= 4.5, 'selected metadata must retain readable contrast in dark mode');
    assert.equal(await page.evaluate(() => Boolean(window.fixtureXss)), false);
    assert.equal(await page.locator('#reader-paper script, #reader-paper [onerror], #reader-paper a[href]').count(), 0);
    assert.equal(await page.locator('#reader-paper select').count(), 1);
    await app.evaluate(() => { globalThis.workbenchUIFixture.contentDelay = 500; });
    await page.locator('[data-tab=analysis]').click();
    await page.locator('[data-tab=source]').click();
    await page.waitForFunction(() => document.querySelector('#reader-paper').textContent.includes('当前原文'));
    await page.waitForTimeout(600);
    assert.equal((await page.locator('#reader-paper').innerText()).trim(), '当前原文，旧的分析报告不应覆盖此处。');
    await page.locator('[data-tab=analysis]').click();
    await page.locator('#reader-paper select').selectOption('long.md');
    await page.waitForFunction(() => document.querySelector('.document-body')?.textContent.includes('正文第 200 行'));
    await app.evaluate(() => { globalThis.workbenchUIFixture.failChunk = true; });
    await page.locator('.more-content').click();
    await page.locator('.document-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('.document-body').innerText(), /正文第 200 行/);
    await page.locator('.more-content').click();
    await page.waitForFunction(() => document.querySelector('.document-body')?.textContent.includes('正文第 270 行'));
    assert.equal(await page.locator('.document-error, .more-content').count(), 0);
    assert.equal((await page.locator('.document-body').innerText()).match(/正文第 200 行/g).length, 1);
    assert.equal(await page.locator('#reader-paper select').count(), 1);
    await page.setViewportSize({ width: 740, height: 580 });
    await page.locator('#entry-back').click();
    assert.equal(await page.locator('#entry-detail').isVisible(), false);
    assert.equal(await page.locator('[data-entry="fixture:1"]').evaluate(el => el === document.activeElement), true);
    await page.locator('[data-entry="fixture:0"]').click();
    await page.waitForFunction(() => document.querySelector('#entry-detail').textContent.includes('旧资料请求失败'));
    await page.locator('#entry-back').click();
    assert.equal(await page.locator('#entry-detail').isVisible(), false, 'failed entry loads still provide a way back on narrow windows');
    await page.locator('[data-entry="fixture:1"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('#reader-paper .document-body').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'entry-detail');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'library-minimum-long-dark.png') });
    await page.locator('#theme-toggle').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.waitForTimeout(280);
    assert.ok(await selectedContrast() >= 4.5, 'selected metadata must retain readable contrast in light mode');
    await page.screenshot({ path: path.join(output, 'library-minimum-light.png') });
    await compact.screenshot({ path: path.join(output, 'tray-light.png') });
    await compact.locator('#theme-toggle').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.waitForTimeout(280);
    await compact.screenshot({ path: path.join(output, 'tray-dark.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('[data-entry="fixture:2"]').evaluate(el => el.click());
    await page.locator('#entry-detail .detail-title').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#entry-detail').evaluate(el => el.getAnimations().length), 0);
    assert.equal(await page.locator('.list-item').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await app.evaluate(() => { globalThis.workbenchUIFixture.offline = true; });
    await page.waitForFunction(() => document.querySelector('#owner-indicator').textContent.includes('连接中断'), null, { timeout: 8000 });
    await app.evaluate(() => { globalThis.workbenchUIFixture.offline = false; });
    await page.waitForFunction(() => document.querySelector('#owner-indicator').textContent.includes('已连接'), null, { timeout: 8000 });
    await app.evaluate(() => { globalThis.workbenchUIFixture.entriesDelay = 6500; globalThis.workbenchUIFixture.revoked = true; });
    await page.locator('#library-search').fill('合成');
    await page.locator('#owner-gate').waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(6800);
    assert.equal(await page.locator('#remote-entries [data-entry]').count(), 0, 'late requests must not repopulate private data after revocation');
    await page.locator('[data-view=worker]').click();
    assert.equal(await page.locator('#worker-view').isVisible(), true);
    assert.doesNotMatch(await page.locator('#workspace-toast').innerText(), /Cannot read properties/);
    fs.writeFileSync(path.join(output, 'workspace-ui-result.json'), JSON.stringify({ passed: true, checks: ['tray rejects owner IPC', 'pagination and index status', 'stale entry failure', 'stale document success', 'sanitized Markdown', 'multi-document selector', 'long document chunk retry', 'minimum width and keyboard focus', 'two tray themes', 'reduced motion', 'offline recovery', 'revocation discards late data'], limitation: 'UI-only IPC fixtures, no production data or authorization; Windows only.' }, null, 2));
    console.log('Workspace UI concurrency, accessibility and responsive fixtures: passed');
  } finally {
    await app.evaluate(({ app }) => app.quit()).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
