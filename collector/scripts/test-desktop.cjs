const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');

(async () => {
  const { createService } = await import('../src/server.mjs');
  const { api } = await import('../src/worker.mjs');
  const { WorkerManager } = await import('../desktop/manager.mjs');
  const { atomicJson, secret } = await import('../src/common.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-fixture-'));
  const key = secret(); const service = createService({ dataDir: path.join(root, 'server'), masterKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const server = `http://127.0.0.1:${service.server.address().port}`;
  const owner = { server, ...await api({ server }, '/api/pair', 'POST', { key, name: 'fixture-owner' }) };
  const pairing = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
  const paired = await api({ server }, '/api/pair', 'POST', { key: pairing.key, name: '桌面验收工作站' });
  const agent = path.resolve(__dirname, '../test/fixtures/slow-agent.mjs');
  const config = { server, token: paired.token, name: '桌面验收工作站', dataDir: path.join(root, 'worker'), pollMs: 250, capabilities: ['article'], agents: { codex: { command: process.execPath, args: [agent], versionArgs: [agent, '--version'] }, codebuddy: { enabled: false } } };
  const file = path.join(root, 'worker.json'); atomicJson(file, config);
  const output = path.resolve(__dirname, '../test-output/desktop'); fs.mkdirSync(output, { recursive: true });
  const electron = process.env.COLLECTOR_DESKTOP_EXECUTABLE || (() => {
    try { return require('../desktop/node_modules/electron'); }
    catch { return require('electron'); }
  })();
  const env = { ...process.env, COLLECTOR_CONFIG: file, COLLECTOR_NODE: process.execPath, COLLECTOR_DESKTOP_TEST: '1', COLLECTOR_DESKTOP_TRACE: path.join(output, 'events.jsonl') };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.COLLECTOR_DESKTOP_APP ? [path.resolve(process.env.COLLECTOR_DESKTOP_APP)] : process.env.COLLECTOR_DESKTOP_EXECUTABLE ? [] : [path.resolve(__dirname, '../desktop')];
  const app = await _electron.launch({ executablePath: electron, args, env });
  const macOS = process.platform === 'darwin';
  const desktopProcess = app.process();
  const manager = new WorkerManager(file, process.execPath);
  const bounded = async (promise, milliseconds) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('desktop cleanup timeout')), milliseconds); })]); }
    finally { clearTimeout(timer); }
  };
  const wait = async fn => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('desktop fixture timeout'); };
  const nativeAction = async id => {
    await wait(() => app.evaluate((_, id) => globalThis.workerDesktop().tray.menu.getMenuItemById(id)?.enabled, id));
    // Invoke the real Electron MenuItem handler; this is not a physical mouse click.
    await app.evaluate((_, id) => globalThis.workerDesktop().tray.menu.getMenuItemById(id).click(), id);
  };
  try {
    await wait(() => app.windows().some(page => page.url().startsWith('file:') && !page.url().includes('compact=1')));
    const page = app.windows().find(page => page.url().startsWith('file:') && !page.url().includes('compact=1'));
    await page.waitForFunction(() => document.querySelector('#headline').textContent === 'Worker 已停止');
    if (macOS) {
      const buttons = await page.locator('[data-action=drain], [data-action=quit-after]').evaluateAll(elements => elements.map(button => ({ action: button.dataset.action, width: button.clientWidth, contentWidth: button.scrollWidth })));
      for (const button of buttons) assert.ok(button.contentWidth <= button.width, `${button.action} label overflows its button: ${button.contentWidth} > ${button.width}`);
    }
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().nodeIntegration), false);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().contextIsolation), true);
    await wait(() => app.windows().some(window => window.url().includes('compact=1')));
    const compactPage = app.windows().find(window => window.url().includes('compact=1'));
    if (macOS) {
      const base = await page.evaluate(() => window.worker.snapshot());
      const states = [
        { name: 'unpaired', patch: { running: false, managed: false, paired: false }, expected: { start: [false, '尚未配对'], pause: [false, '已停止'], resume: [false, '已停止'], drain: [false, '已停止'], 'quit-after': [true, ''] } },
        { name: 'stopped', patch: { running: false, managed: false }, expected: { start: [true, ''], pause: [false, '已停止'], resume: [false, '已停止'], drain: [false, '已停止'], 'quit-after': [true, ''] } },
        { name: 'starting', patch: { starting: true }, expected: { start: [false, '正在启动'], pause: [false, '正在启动'], resume: [false, '正在启动'], drain: [false, '正在启动'], 'quit-after': [false, '正在启动'] } },
        { name: 'running', patch: { running: true, managed: true, mode: 'running' }, expected: { start: [false, '已运行'], pause: [true, ''], resume: [false, '未暂停'], drain: [true, ''], 'quit-after': [true, ''] } },
        { name: 'paused', patch: { running: true, managed: true, mode: 'paused' }, expected: { start: [false, '已运行'], pause: [false, '已暂停'], resume: [true, ''], drain: [true, ''], 'quit-after': [true, ''] } },
        { name: 'stale', patch: { running: true, managed: true, stale: true }, expected: { start: [false, '已运行'], pause: [false, '状态已过期'], resume: [false, '状态已过期'], drain: [false, '状态已过期'], 'quit-after': [false, '状态已过期'] } },
        { name: 'legacy', patch: { running: true, managed: false, legacy: true }, expected: { start: [false, '已运行'], pause: [false, '旧版 Worker'], resume: [false, '旧版 Worker'], drain: [false, '旧版 Worker'], 'quit-after': [false, '旧版 Worker'] } },
        { name: 'draining', patch: { running: true, managed: true, mode: 'draining' }, expected: { start: [false, '已运行'], pause: [false, '当前任务后停止'], resume: [false, '当前任务后停止'], drain: [false, '当前任务后停止'], 'quit-after': [true, ''] } },
        { name: 'safe-quit pending', patch: { running: true, managed: true, mode: 'draining', quitAfterTask: true }, expected: { start: [false, '退出应用'], pause: [false, '退出应用'], resume: [false, '退出应用'], drain: [false, '退出应用'], 'quit-after': [false, '退出应用'] } },
      ];
      await app.evaluate(() => globalThis.workerDesktop().main.setSize(740, 580));
      for (const state of states) {
        const snapshot = { ...base, ...state.patch };
        await app.evaluate((_, value) => globalThis.workerDesktop().setSnapshot(value), snapshot);
        for (const view of [page, compactPage]) {
          await view.waitForFunction(expected => Object.entries(expected).every(([action, [enabled, reason]]) => {
            const button = document.querySelector(`[data-action="${action}"]`);
            return button.disabled === !enabled && (enabled ? button.dataset.disabledReason === '' : button.title.includes(reason));
          }), state.expected);
          const buttons = await view.locator('[data-action]').evaluateAll(elements => elements.map(button => ({ action: button.dataset.action, reason: button.dataset.disabledReason, description: button.getAttribute('aria-description') })));
          for (const button of buttons) if (state.expected[button.action]?.[0] === false) assert.equal(button.description, button.reason, `${state.name}: accessible disabled explanation`);
          const hasVisibleDisabled = await view.locator('[data-action]').evaluateAll(elements => elements.some(button => button.dataset.disabledReason && !button.hidden && getComputedStyle(button).display !== 'none'));
          assert.equal(await view.locator('#controls-hint').isVisible(), hasVisibleDisabled, `${state.name}: explanations follow visible disabled controls`);
          if (hasVisibleDisabled) assert.ok(await view.locator('#controls-hint').innerText(), `${state.name}: visible control explanation`);
          const layout = await view.evaluate(() => {
            const controls = document.querySelector('.controls'); controls.scrollIntoView({ block: 'nearest' });
            const visible = [...controls.querySelectorAll('button')].filter(button => getComputedStyle(button).display !== 'none');
            const reachable = visible.every(button => { const rect = button.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button; });
            const open = document.querySelector('[data-action=show]'), rect = open.getBoundingClientRect();
            return { reachable, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, openReachable: document.body.classList.contains('compact') ? rect.bottom <= innerHeight && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === open : true };
          });
          assert.equal(layout.horizontalOverflow, false, `${state.name}: reasons fit width`);
          assert.equal(layout.reachable, true, `${state.name}: control buttons remain reachable`);
          assert.equal(layout.openReachable, true, `${state.name}: compact manager entry remains reachable`);
        }
        const native = await app.evaluate(() => {
          const menu = globalThis.workerDesktop().tray.menu;
          return Object.fromEntries(['worker-start', 'worker-pause-resume', 'worker-drain', 'quit-after'].map(id => { const item = menu.getMenuItemById(id); return [id, { enabled: item.enabled, label: item.label, reason: item.toolTip }]; }));
        });
        for (const [id, action] of Object.entries({ 'worker-start': 'start', 'worker-pause-resume': snapshot.mode === 'paused' ? 'resume' : 'pause', 'worker-drain': 'drain', 'quit-after': 'quit-after' })) {
          const [enabled, reason] = state.expected[action];
          assert.equal(native[id].enabled, enabled, `${state.name}: native ${action} availability`);
          if (!enabled) { assert.ok(native[id].label.includes(reason), `${state.name}: native ${action} visible reason`); assert.ok(native[id].reason.includes(reason)); }
          else assert.equal(native[id].reason, '', `${state.name}: cleared disabled reason`);
        }
        if (state.name === 'unpaired') { await page.screenshot({ path: path.join(output, 'unpaired-disabled.png') }); await compactPage.screenshot({ path: path.join(output, 'unpaired-status-disabled.png') }); }
      }
      await app.evaluate(() => { const desktop = globalThis.workerDesktop(); desktop.setSnapshot(null); desktop.main.setSize(1020, 760); });
      await page.waitForFunction(() => !document.querySelector('[data-action=start]').disabled);
    }
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.locator('#theme-toggle').click();
    await wait(async () => await compactPage.locator('html').getAttribute('data-theme') === 'light');
    assert.equal(await page.locator('#theme-toggle').getAttribute('aria-label'), '切换到黑夜模式');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#headline').textContent === 'Worker 已停止');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await compactPage.locator('#theme-toggle').click();
    await wait(async () => await page.locator('html').getAttribute('data-theme') === 'dark');
    if (macOS) await nativeAction('worker-start'); else await page.locator('[data-action=start]').click();
    await wait(() => manager.snapshot().online);
    if (macOS) await nativeAction('worker-pause-resume'); else await page.locator('[data-action=pause]').click();
    await wait(() => manager.snapshot().mode === 'paused');
    const task = await api(owner, '/api/tasks', 'POST', { content: '桌面验收：合成资料任务', submissionId: crypto.randomUUID() });
    if (macOS) {
      await wait(() => app.evaluate(() => globalThis.workerDesktop().tray.menu.getMenuItemById('worker-pause-resume').label === '继续领取'));
      await nativeAction('worker-pause-resume');
    } else await page.locator('[data-action=resume]').click();
    await wait(() => manager.snapshot().current?.id === task.id);
    await page.screenshot({ path: path.join(output, 'working.png') });
    if (macOS) await nativeAction('worker-drain'); else await page.locator('[data-action=drain]').click();
    await wait(() => !manager.snapshot().running);
    assert.equal((await api(owner, '/api/state')).tasks.find(x => x.id === task.id).state, 'completed');
    await page.locator('#worker-logs').click();
    await page.locator('#logs-panel').waitFor({ state: 'visible' });
    assert.ok(!(await page.locator('body').innerText()).includes(config.token));
    await page.locator('#close-logs').click();
    await page.screenshot({ path: path.join(output, 'completed.png') });
    if (macOS) {
      assert.equal(await app.evaluate(({ app }) => app.dock.isVisible()), true);
      await app.evaluate(() => globalThis.workerDesktop().main.minimize());
      await wait(() => app.evaluate(() => globalThis.workerDesktop().main.isMinimized()));
      assert.equal(await app.evaluate(({ app }) => app.dock.isVisible()), true, 'native minimization keeps Dock');
      await app.evaluate(({ app }) => app.emit('activate'));
      await wait(() => app.evaluate(() => { const { main } = globalThis.workerDesktop(); return main.isVisible() && !main.isMinimized(); }));
      await app.evaluate(() => globalThis.workerDesktop().main.close());
      await wait(() => app.evaluate(({ app }) => !app.dock.isVisible()));
      assert.equal(await app.evaluate(() => globalThis.workerDesktop().main.isDestroyed()), false, 'red close keeps manager alive');
      await app.evaluate(({ app }) => app.emit('activate'));
      await wait(() => app.evaluate(() => globalThis.workerDesktop().main.isVisible()));
      await app.evaluate(() => globalThis.workerDesktop().main.close());
      await wait(() => app.evaluate(({ app }) => !app.dock.isVisible()));
    } else await page.locator('[data-action=hide]').click();
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'InspiraiNest · 采集 Worker').isVisible()), false);
    await app.evaluate(() => {
      const { tray } = globalThis.workerDesktop();
      if (tray.isDestroyed() || tray.getBounds().width <= 0) throw new Error('No native tray icon');
      tray.emit('click');
    });
    if (macOS) {
      assert.equal(await app.evaluate(() => globalThis.workerDesktop().popover.isVisible()), true, 'single click shows immediately');
      assert.equal(await app.evaluate(() => globalThis.workerDesktop().trayImage.isTemplateImage()), true);
      const { macosTrayGUID } = await import('../desktop/macos-policy.mjs');
      assert.equal(await app.evaluate(() => globalThis.workerDesktop().tray.getGUID()), macosTrayGUID(config.dataDir), 'native macOS tray uses its stable Worker identity');
      assert.equal(await app.evaluate(() => globalThis.workerDesktop().tray.getIgnoreDoubleClickEvents()), true);
      assert.equal(await app.evaluate(() => globalThis.workerDesktop().main.isVisible()), false);
      assert.equal(await app.evaluate(({ app }) => app.dock.isVisible()), false, 'status panel keeps Dock hidden');
      const bounds = await app.evaluate(({ screen }) => {
        const { tray, popover } = globalThis.workerDesktop();
        const icon = tray.getBounds();
        const work = screen.getDisplayNearestPoint({ x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 }).workArea;
        return { work, panel: popover.getBounds(), icon };
      });
      assert.ok(bounds.panel.x >= bounds.work.x && bounds.panel.x + bounds.panel.width <= bounds.work.x + bounds.work.width);
      assert.ok(bounds.panel.y >= bounds.work.y && bounds.panel.y + bounds.panel.height <= bounds.work.y + bounds.work.height);
      await app.evaluate(() => globalThis.workerDesktop().tray.emit('click'));
      assert.equal(await app.evaluate(() => globalThis.workerDesktop().popover.isVisible()), false, 'second click hides immediately');
      await app.evaluate(() => globalThis.workerDesktop().tray.emit('click'));
      await app.evaluate(() => {
        const { popover } = globalThis.workerDesktop();
        // CDP keyboard.press bypasses Electron's native before-input-event.
        popover.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        popover.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      });
      await wait(() => app.evaluate(() => !globalThis.workerDesktop().popover.isVisible()));
      await app.evaluate(() => globalThis.workerDesktop().tray.emit('click'));
      await app.evaluate(() => globalThis.workerDesktop().popover.blur());
      await wait(() => app.evaluate(() => !globalThis.workerDesktop().popover.isVisible()));
      await app.evaluate(() => globalThis.workerDesktop().tray.emit('click'));
    }
    await wait(() => app.evaluate(() => globalThis.workerDesktop().popover.isVisible()));
    const compact = app.windows().find(page => page.url().includes('compact=1'));
    await compact.screenshot({ path: path.join(output, 'tray-status.png') });
    if (macOS) {
      await app.evaluate(() => globalThis.workerDesktop().tray.emit('double-click'));
      assert.equal(await app.evaluate(() => globalThis.workerDesktop().main.isVisible()), false, 'double click has no manager shortcut');
      await compact.locator('[data-action=show]').click();
      await wait(() => app.evaluate(({ app }) => { const { main, popover } = globalThis.workerDesktop(); return main.isVisible() && !popover.isVisible() && app.dock.isVisible(); }));
      assert.equal(await page.locator('[data-action=quit]').isVisible(), false, 'macOS has no invisible-worker exit');
      assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('safe-quit').accelerator), 'Command+Q');
    } else {
      await app.evaluate(() => { const { tray } = globalThis.workerDesktop(); tray.emit('click'); tray.emit('double-click'); });
      await new Promise(resolve => setTimeout(resolve, 600));
      assert.equal(await app.evaluate(() => { const { main, popover } = globalThis.workerDesktop(); return main.isVisible() && !popover.isVisible(); }), true);
    }
    config.agents.codex.args = [path.resolve(__dirname, '../test/fixtures/waiting-agent.mjs')]; atomicJson(file, config);
    const waitingTask = await api(owner, '/api/tasks', 'POST', { content: '合成验收：待操作原因', submissionId: crypto.randomUUID() });
    await page.locator('[data-action=start]').click(); await wait(() => manager.snapshot().online);
    await wait(() => manager.snapshot().lastTask?.state === 'waiting_action');
    await page.waitForFunction(() => document.querySelector('#task-message').textContent.includes('补齐本机测试工具'));
    await page.screenshot({ path: path.join(output, 'waiting-action.png') });
    const exited = new Promise(resolve => desktopProcess.once('exit', resolve));
    if (macOS) {
      await page.locator('[data-action=drain]').click();
      await wait(() => !manager.snapshot().running);
      // Resolve only this synthetic waiting task; it otherwise blocks new claims.
      await api(owner, `/api/tasks/${waitingTask.id}/cancel`, 'POST', {});
      const quitAgent = path.join(root, 'quit-agent.mjs');
      const fakeAgent = require('node:url').pathToFileURL(path.resolve(__dirname, '../test/fixtures/fake-agent.mjs')).href;
      fs.writeFileSync(quitAgent, `if (process.argv.includes('--version')) { console.log('quit-fixture 1.0'); process.exit(); }\nawait new Promise(resolve => setTimeout(resolve, 4500));\nawait import(${JSON.stringify(fakeAgent)});\n`);
      config.agents.codex.args = [quitAgent]; atomicJson(file, config);
      const finishing = await api(owner, '/api/tasks', 'POST', { content: '合成验收：退出前保留当前任务', submissionId: crypto.randomUUID() });
      await page.locator('[data-action=start]').click();
      await wait(() => manager.snapshot().current?.id === finishing.id);
      const queued = await api(owner, '/api/tasks', 'POST', { content: '合成验收：退出后不领取', submissionId: crypto.randomUUID() });
      await app.evaluate(({ app }) => app.quit());
      assert.equal(desktopProcess.exitCode, null, 'standard Quit waits for current task');
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('safe-quit').click());
      await wait(() => manager.snapshot().mode === 'draining');
      assert.equal(manager.snapshot().running, true, 'Worker continues the synthetic task during drain');
      assert.equal(await app.evaluate(() => !globalThis.workerDesktop().tray.isDestroyed()), true, 'menu-bar entry remains while draining');
      await exited;
      assert.equal(manager.snapshot().running, false, 'macOS quit also stops Worker');
      const state = await api(owner, '/api/state');
      assert.equal(state.tasks.find(x => x.id === finishing.id).state, 'completed');
      assert.equal(state.tasks.find(x => x.id === queued.id).state, 'queued');
    } else {
      const pid = manager.snapshot().pid;
      await page.locator('[data-action=quit]').click().catch(error => { if (!/has been closed/.test(error.message)) throw error; });
      await exited;
      assert.equal(manager.snapshot().pid, pid, 'quitting manager must keep worker');
      assert.equal(manager.snapshot().running, true);
    }
    assert.deepEqual(errors, []);
    const platformChecks = macOS ? ['disabled action reasons match native menu and both panels across nine states', 'disabled reasons fit minimum manager and compact controls', 'native MenuItem handlers start pause resume and drain synthetic Worker', 'full manager stop and quit labels fit their buttons', 'single click toggles immediately', 'Escape and blur hide panel', 'template tray icon', 'stable Worker-scoped menu-bar GUID', 'red close hides Dock and retains manager', 'native minimize and Dock activation restore', 'explicit manager restores Dock', 'standard Quit and application menu drain before exit', 'current task completed and next task left queued'] : ['single-click handler shows status', 'double-click handler restores manager', 'double click cancels pending single click', 'quit keeps worker'];
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, platform: process.platform, checks: ['isolated renderer', 'theme persistence and cross-window sync', 'start', 'pause', 'resume', 'drain preserves task', 'logs', 'hide', 'native tray exists', ...platformChecks], limitation: 'Tray events, MenuItem handlers and Dock activation are invoked by the harness, not physical OS mouse clicks. This does not verify real menu-bar click delivery or the icon appearance in both system themes.', errors }, null, 2));
    console.log('Desktop fixture passed. Screenshots: collector/test-output/desktop');
  } catch (error) {
    console.error('Desktop fixture failed:', error.message);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: false, platform: process.platform, error: error.stack }, null, 2));
    throw error;
  } finally {
    try {
      if (manager.snapshot().managed) { await manager.stop(); await wait(() => !manager.snapshot().running); }
    } catch (error) { console.error('Synthetic Worker cleanup:', error.message); }
    if (desktopProcess.exitCode === null) {
      try { await bounded(app.close(), 5000); }
      catch (error) {
        console.error('Desktop fixture UI cleanup:', error.message);
        // Only this harness-owned UI process; the synthetic Worker was drained above.
        const exited = new Promise(resolve => desktopProcess.once('exit', resolve));
        desktopProcess.kill('SIGTERM');
        await bounded(exited, 3000).catch(() => desktopProcess.kill('SIGKILL'));
      }
    }
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
