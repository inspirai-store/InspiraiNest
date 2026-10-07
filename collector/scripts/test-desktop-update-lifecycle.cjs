const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inspirainest-update-lifecycle-'));
  const config = path.join(root, 'worker.json');
  fs.writeFileSync(config, JSON.stringify({ dataDir: path.join(root, 'data') }));
  const executable = process.argv[2] || require('electron');
  const env = { ...process.env, COLLECTOR_CONFIG: config, COLLECTOR_DESKTOP_TEST: '1', COLLECTOR_DESKTOP_STORAGE_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: executable,
    args: [...(process.argv[2] ? [] : [path.resolve(__dirname, '../desktop')]), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env });
  try {
    await app.firstWindow();
    for (let i = 0; i < 100; i++) {
      if (await app.evaluate(() => Boolean(globalThis.workerDesktop?.().popover))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // A late Dock activation must not read the native wrapper of a destroyed panel.
    const lateActivation = await app.evaluate(async ({ app }) => {
      const { popover } = globalThis.workerDesktop();
      popover.destroy();
      try { app.emit('activate'); await new Promise(resolve => setTimeout(resolve, 20)); return null; }
      catch (error) { return error.message; }
    });
    assert.equal(lateActivation, null, 'activation after panel destruction must be safe');
    // Squirrel closes windows before app.before-quit. Exercise the real close handlers
    // without replacing the harness executable or touching an installed application.
    const result = await app.evaluate(async ({ app }) => {
      const { main, updates } = globalThis.workerDesktop();
      let nativeInstall = 0, closePrevented = false;
      main.on('close', event => { closePrevented = event.defaultPrevented; });
      const closed = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Installer did not close the window')), 5000);
        main.once('closed', () => { clearTimeout(timeout); resolve(); });
      });
      updates.updater.quitAndInstall = () => {
        nativeInstall++;
        app.emit('activate');
        main.close();
        app.emit('activate');
      };
      updates.set({ phase: 'downloaded' });
      await updates.install();
      await closed;
      return { nativeInstall, closePrevented, destroyed: main.isDestroyed() };
    });
    assert.deepEqual(result, { nativeInstall: 1, closePrevented: false, destroyed: true });
    const out = path.resolve(__dirname, '../test-output/update-lifecycle'); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: true, platform: process.platform,
      checks: ['late activation after destroyed status panel', 'installation close precedes before-quit', 'update close is not intercepted', 'activation during installation does not restore windows'],
      limitation: 'Native window lifecycle is real; the installer call is replaced in this isolated regression.' }, null, 2));
    console.log('Desktop update window lifecycle: passed');
  } finally {
    try { await app.evaluate(({ app }) => app.quit()); } catch {}
    await app.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
