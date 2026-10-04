const {setTheme,showSettings}=require('./desktop-test-helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

// Validate the log-only local overlay against an isolated service and Agent.
(async () => {
  const executable = path.resolve(process.argv[2]);
  const { createService } = await import('../src/server.mjs');
  const { api } = await import('../src/worker.mjs');
  const { WorkerManager } = await import('../desktop/manager.mjs');
  const { atomicJson } = await import('../src/common.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-log-pipeline-'));
  const key = crypto.randomUUID();
  const service = createService({ dataDir: path.join(root, 'service'), masterKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const server = `http://127.0.0.1:${service.server.address().port}`;
  const owner = { server, ...await api({ server }, '/api/pair', 'POST', { key, name: 'isolated-log-owner' }) };
  const pairing = await api(owner, '/api/pairings', 'POST', {});
  const file = path.join(root, 'worker.json');
  const agent = path.resolve(__dirname, '../test/fixtures/slow-agent.mjs');
  atomicJson(file, { dataDir: path.join(root, 'data'), server, pollMs: 250, capabilities: ['article'], agents: { codex: { command: process.execPath, args: [agent], versionArgs: [agent, '--version'] }, codebuddy: { enabled: false } } });
  const env = { ...process.env, COLLECTOR_CONFIG: file, COLLECTOR_DESKTOP_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  const manager = new WorkerManager(file);
  const until = async fn => { for (let n = 0; n < 200; n++) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Packaged log pipeline timeout'); };
  const app = await _electron.launch({ executablePath: executable, env });
  try {
    await until(() => app.windows().some(p => p.url().startsWith('file:') && !p.url().includes('compact=1')));
    const page = app.windows().find(p => p.url().startsWith('file:') && !p.url().includes('compact=1'));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('[data-view=nodes]').click();
    await page.locator('#pair-worker [name=server]').fill(server);
    await page.locator('#pair-worker [name=name]').fill('隔离日志测试电脑');
    await page.locator('#pair-worker [name=key]').fill(pairing.key);
    await page.locator('#pair-worker button[type=submit]').click();
    await until(() => manager.snapshot().paired);
    await page.locator('[data-action=start]').click();
    await until(() => manager.snapshot().online);
    const task = await api(owner, '/api/tasks', 'POST', { content: '隔离打包日志测试', submissionId: crypto.randomUUID() });
    await until(() => manager.snapshot().current?.id === task.id);
    await page.locator('[data-action=drain]').click();
    await until(() => !manager.snapshot().running);
    assert.equal((await api(owner, '/api/state')).tasks.find(item => item.id === task.id).state, 'completed');
    await page.locator('#worker-logs').click();
    await page.waitForFunction(() => document.querySelector('#logs').textContent.includes('归档上传完成'));
    const events = await page.evaluate(() => window.worker.activity());
    assert.ok(events.events.some(event => event.code === 'TASK_CLAIMED'));
    for (const stage of ['running', 'validating', 'uploading', 'completed']) assert.ok(events.events.some(event => event.stage === stage), stage);
    assert.equal(events.activeIssues, 0);
    assert.ok(events.events.filter(event => event.domain === 'collection').every(event => event.taskId === task.id));
    assert.equal(await page.locator('#logs .log-event').first().locator('.event-meta').innerText(), `完成 · 任务 ${task.id.slice(0,8)} · codex`);
    const secret = manager.configuration().token; assert.ok(!(await page.locator('body').innerText()).includes(secret));
    const output = path.resolve(__dirname, '../test-output/worker-logs'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'packaged-collection.png') });
    await page.locator('[data-view=overview]').click();
    await page.locator('#overview-data').waitFor({ state: 'visible' });
    await page.locator('[data-view=library]').click();
    await page.locator('#remote-entries [data-entry]').first().click();
    await page.waitForFunction(() => document.querySelector('#reader-paper').textContent.includes('测试报告'));
    assert.deepEqual(errors, []);
    console.log('Log-only packaged client: real child process, pipeline stages, validated archive, descending log UI, credential redaction and existing reader: passed (isolated fixtures)');
  } finally {
    if (manager.snapshot().managed) { await manager.control('drain'); await until(() => !manager.snapshot().running); }
    await app.evaluate(({app}) => app.quit()).catch(() => {}); await app.close(); await service.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
