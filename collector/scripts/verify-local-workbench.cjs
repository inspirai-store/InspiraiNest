const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright');

// Read-only acceptance on the real profile. Pairing is entered by the user in the app.
(async () => {
  const output = path.resolve(__dirname, '../../.runtime/local-workbench');
  const executable = path.join(output, 'build/win-unpacked/InspiraiNest.exe');
  const config = path.join(process.env.APPDATA, 'LibraryWorker/worker.local.json');
  const env = { ...process.env, COLLECTOR_CONFIG: config };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'COLLECTOR_DESKTOP_TEST', 'COLLECTOR_DESKTOP_TRACE']) delete env[key];
  const app = await _electron.launch({ executablePath: executable, env });
  const report = { synthetic: false, checks: [], ownerPaired: false, officialReading: false };
  try {
    let page;
    for (let n = 0; n < 100 && !page; n++) {
      page = app.windows().find(p => p.url().startsWith('file:') && !p.url().includes('compact=1'));
      if (!page) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(page, 'Official-profile main window did not open');
    const worker = await page.evaluate(() => window.worker.snapshot());
    assert.equal(worker.server, 'https://library.inspirai.store');
    assert.equal(worker.paired, true);
    assert.equal(worker.dataDir, path.join(process.env.APPDATA, 'LibraryWorker/worker-data-prod'));
    report.worker = { paired: worker.paired, running: worker.running, server: worker.server, dataDir: worker.dataDir };
    report.checks.push('official Worker config and data directory');
    await page.screenshot({ path: path.join(output, 'official-overview.png'), animations: 'disabled' });
    console.log('Local workbench opened with the official Worker profile. Waiting for owner pairing in the visible window.');
    fs.writeFileSync(path.join(output, 'real-verification.json'), JSON.stringify(report, null, 2));
    for (let n = 0; n < 180; n++) {
      if ((await page.evaluate(() => window.library.status())).paired) { report.ownerPaired = true; break; }
      if (fs.existsSync(path.join(output, 'finish-verification'))) break;
      await new Promise(r => setTimeout(r, 5000));
    }
    if (report.ownerPaired) {
      await page.locator('[data-view=library]').click();
      await page.waitForFunction(() => document.querySelector('#entries-count').textContent.includes('条结果'), null, { timeout: 30000 });
      report.checks.push('official authenticated entries');
      const count = await page.locator('#remote-entries [data-entry]').count();
      report.visibleEntries = count;
      if (count) {
        await page.locator('#remote-entries [data-entry]').first().click();
        await page.waitForFunction(() => document.querySelector('#reader-paper .document-body'), null, { timeout: 30000 });
        report.officialReading = Boolean((await page.locator('#reader-paper .document-body').innerText()).trim());
        assert.equal(report.officialReading, true);
        report.checks.push('official archived document read');
        await page.screenshot({ path: path.join(output, 'official-library.png'), animations: 'disabled' });
      }
      await page.locator('[data-view=tasks]').click();
      await page.waitForFunction(() => document.querySelector('#tasks-count').textContent.includes('项任务'));
      report.checks.push('official task list read');
      await page.locator('[data-view=devices]').click();
      await page.locator('.device-card').first().waitFor({ state: 'visible' });
      report.checks.push('official device list read');
    } else report.pending = 'Management pairing is required before real library, tasks and devices can be verified.';
    console.log(JSON.stringify(report));
  } finally {
    fs.writeFileSync(path.join(output, 'real-verification.json'), JSON.stringify(report, null, 2));
    await app.evaluate(({ app }) => app.quit()).catch(() => {});
    await app.close().catch(() => {});
    // Leave the ordinary application open, without the test driver or fixture hooks.
    const child = spawn(path.join(process.env.SystemRoot, 'System32/wscript.exe'), [path.join(output, 'Start-Workbench.vbs')], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
