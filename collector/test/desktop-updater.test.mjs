import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DesktopUpdater } from '../desktop/updater.mjs';

class FakeUpdater extends EventEmitter {
  checks = 0;
  downloads = 0;
  installs = 0;
  async checkForUpdates() { this.checks++; this.emit('update-available', { version: '0.3.1' }); return { updateInfo: { version: '0.3.1' } }; }
  async downloadUpdate() { this.downloads++; this.emit('download-progress', { percent: 58.2 }); this.emit('update-downloaded', { version: '0.3.1' }); }
  quitAndInstall() { this.installs++; }
}

test('desktop update checks and downloads, then waits for detached Worker to exit before installing', async () => {
  const fake = new FakeUpdater();
  let running = true, drains = 0;
  const manager = { snapshot: () => ({ running, managed: true, stale: false }), control: async action => { assert.equal(action, 'drain'); drains++; } };
  const updates = new DesktopUpdater({ app: { isPackaged: true, getVersion: () => '0.3.0' }, manager,
    updater: fake, platform: 'win32', pollMs: 10000 });
  assert.equal((await updates.check()).phase, 'available');
  assert.equal(fake.autoDownload, false);
  assert.equal((await updates.download()).phase, 'downloaded');
  assert.equal(updates.snapshot().progress, 100);
  assert.equal((await updates.check()).phase, 'downloaded');
  assert.equal(fake.checks, 1);
  assert.equal((await updates.install()).phase, 'waiting_worker');
  assert.equal(drains, 1);
  assert.equal(fake.installs, 0);
  running = false;
  updates.installWhenStopped();
  assert.equal(updates.snapshot().phase, 'installing');
  assert.equal(fake.installs, 1);
  updates.dispose();
});

test('desktop update refuses unsafe Worker replacement and unsupported unpackaged sessions', async () => {
  const fake = new FakeUpdater();
  const manager = { snapshot: () => ({ running: true, managed: false, stale: true }) };
  const updates = new DesktopUpdater({ app: { isPackaged: true, getVersion: () => '0.3.0' }, manager,
    updater: fake, platform: 'darwin' });
  await updates.check(); await updates.download();
  await assert.rejects(updates.install(), /无法安全控制/);
  assert.equal(fake.installs, 0);
  updates.dispose();
  const unpackaged = new DesktopUpdater({ app: { isPackaged: false, getVersion: () => '0.3.0' }, manager,
    updater: new FakeUpdater(), platform: 'darwin' });
  assert.equal((await unpackaged.check()).phase, 'unsupported');
  unpackaged.dispose();
});

test('an older server gives a clear update message instead of a raw updater stack', async () => {
  const fake = new FakeUpdater();
  fake.checkForUpdates = async () => { throw new Error('Cannot find channel "latest.yml" update info: HttpError: 404 Not Found\nstack'); };
  const updates = new DesktopUpdater({ app: { isPackaged: true, getVersion: () => '0.3.0' },
    manager: { snapshot: () => ({ running: false }) }, updater: fake, platform: 'darwin' });
  const result = await updates.check();
  assert.equal(result.phase, 'error');
  assert.match(result.error, /更新服务尚未提供/);
  assert.doesNotMatch(result.error, /stack/);
  updates.dispose();
});
