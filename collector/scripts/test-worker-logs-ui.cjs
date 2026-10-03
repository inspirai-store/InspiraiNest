const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');

// Isolated synthetic log records, no production task or credential access.
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-log-ui-'));
  const { createWorkerEvents } = await import('../src/worker-events.mjs');
  const { atomicJson } = await import('../src/common.mjs');
  let now = Date.now() - 5000;
  const journal = createWorkerEvents(root, { token: 'private-fixture-token', runId: 'fixture-run', now: () => now });
  const config = path.join(root, 'worker.json'); atomicJson(config, { dataDir: root, token: 'private-fixture-token', server: 'http://127.0.0.1:9' });
  fs.writeFileSync(path.join(root, 'worker.lock'), String(process.pid));
  atomicJson(path.join(root, 'worker-status.json'), { protocol: 1, pid: process.pid, runId: journal.runId, phase: 'idle', mode: 'paused', connection: 'online', startedAt: new Date(now).toISOString(), updatedAt: new Date().toISOString(), lastHeartbeat: new Date().toISOString() });
  journal.event({ taskId: 'task-fixture', stage: 'fetching', code: 'TASK_RUNNING', message: '正在获取公开正文' });
  now += 1000;
  journal.event({ taskId: 'task-fixture', stage: 'analyzing', code: 'TASK_RUNNING', message: '正在整理中文摘要 <img src=x onerror="window.logXss=true">' });
  now += 1000;
  for (let n = 0; n < 12; n++) journal.fault('status', { code: 'EPERM', message: '本机状态暂时无法保存，采集继续并自动重试', details: { message: 'sharing violation', stack: 'Bearer private-fixture-token' } });
  journal.flush();
  now += 1000;
  journal.event({ taskId: 'task-fixture', stage: 'completed', code: 'TASK_COMPLETED', message: '轻量资料已归档，原媒体保留本机' });
  fs.writeFileSync(path.join(root, 'worker.stderr.log'), 'Connection unavailable: SyntaxError\nBearer private-fixture-token');
  const env = { ...process.env, COLLECTOR_CONFIG: config, COLLECTOR_DESKTOP_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.argv[2] ? path.resolve(process.argv[2]) : (() => {
    try { return require('../desktop/node_modules/electron'); }
    catch { return require('electron'); }
  })();
  const app = await _electron.launch({ executablePath: executable, args: process.argv[2] ? [] : [path.resolve(__dirname, '../desktop')], env });
  const output = path.resolve(__dirname, '../test-output/worker-logs'); fs.mkdirSync(output, { recursive: true });
  try {
    await app.firstWindow();
    let page;
    for (let n = 0; n < 100 && !page; n++) { page = app.windows().find(p => p.url().startsWith('file:') && !p.url().includes('compact=1')); if (!page) await new Promise(r => setTimeout(r, 100)); }
    assert.ok(page);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.locator('[data-view=worker]').click();
    await page.locator('#logs .log-event').first().waitFor();
    assert.equal(await page.locator('#logs .log-event').count(), 3);
    assert.match(await page.locator('#logs .log-event').first().innerText(), /已归档/);
    assert.doesNotMatch(await page.locator('#logs').innerText(), /SyntaxError|EPERM|sharing violation/);
    assert.match(await page.locator('#logs time strong').first().innerText(), /^\d{2}:\d{2}:\d{2}$/);
    assert.equal(await page.evaluate(() => window.logXss), undefined);
    const timestamps = await page.locator('#logs time').evaluateAll(nodes => nodes.map(node => Date.parse(node.dateTime)));
    assert.deepEqual(timestamps, [...timestamps].sort((a,b) => b-a));
    await page.locator('#logs .log-event summary').first().click();
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('#logs .log-event').first().getAttribute('open'), '');
    await page.locator('#logs-system').click();
    assert.equal(await page.locator('#logs .log-event').count(), 1);
    assert.match(await page.locator('#logs').innerText(), /重复 12 次/);
    await page.locator('#logs .log-event summary').click();
    assert.match(await page.locator('#logs .event-detail').innerText(), /EPERM|处理建议/);
    assert.ok(!(await page.locator('body').innerText()).includes('private-fixture-token'));
    await page.screenshot({ path: path.join(output, 'system-dark.png') });
    await page.locator('#logs-collection').click();
    await page.screenshot({ path: path.join(output, 'collection-dark.png') });
    await page.locator('#theme-toggle').click();
    await page.screenshot({ path: path.join(output, 'collection-light.png') });
    await app.evaluate(() => globalThis.workerDesktop().main.setSize(740,580));
    await page.screenshot({ path: path.join(output, 'collection-minimum-light.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#logs-collection').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#logs-system').getAttribute('aria-selected'), 'true');
    now += 1000; journal.recover('status', '本机状态保存已恢复');
    await page.waitForFunction(() => document.querySelector('#logs').textContent.includes('已恢复'));
    assert.equal(await page.locator('#log-issue-count').innerText(), '0');
    await page.locator('#log-raw summary').click();
    await page.waitForFunction(() => document.querySelector('#log-raw-output').textContent.includes('SyntaxError'));
    assert.ok(!(await page.locator('#log-raw-output').innerText()).includes('private-fixture-token'));
    assert.deepEqual(errors, []);
    console.log('Worker log UI: newest-first, Chinese stages, system separation, dedup/recovery, expandable diagnostics, redaction, themes, minimum size and keyboard: passed');
  } finally { await app.evaluate(({app}) => app.quit()).catch(() => {}); await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
