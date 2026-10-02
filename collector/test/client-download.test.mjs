import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createService } from '../src/server.mjs';

for (const brand of ['InspiraiNest', 'LingNest']) test(`${brand} releases preserve aliases, checksums and credential isolation`, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-release-'));
  const filename = `${brand}-v1.0.0-Android.apk`;
  const bytes = Buffer.from('synthetic release fixture');
  const meta = { version: '1.0.0', versionCode: 2, filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  fs.writeFileSync(path.join(root, filename), bytes);
  fs.writeFileSync(path.join(root, 'android-release.json'), JSON.stringify(meta));
  const workerFile = `${brand}-v0.1.0-Windows-x64.exe`;
  const workerBytes = Buffer.from('synthetic worker executable');
  fs.writeFileSync(path.join(root, workerFile), workerBytes);
  const dmgFile = `${brand}-v0.1.5-macOS-arm64.dmg`;
  const dmgBytes = Buffer.from('synthetic macOS disk image');
  fs.writeFileSync(path.join(root, dmgFile), dmgBytes);
  fs.writeFileSync(path.join(root, 'worker-release.json'), JSON.stringify({ windows_x64: {
    version: '0.1.0', filename: workerFile, size: workerBytes.length,
    sha256: createHash('sha256').update(workerBytes).digest('hex'),
  }, macos_arm64_dmg: {
    version: '0.1.5', filename: dmgFile, size: dmgBytes.length,
    sha256: createHash('sha256').update(dmgBytes).digest('hex'),
  } }));
  fs.writeFileSync(path.join(root, 'private-key.p12'), 'not public');
  const readerFiles = {
    'windows-amd64': 'lingnest-0.1.0-windows-amd64.zip',
    'darwin-amd64': 'lingnest-0.1.0-darwin-amd64.tar.gz',
    'darwin-arm64': 'lingnest-0.1.0-darwin-arm64.tar.gz',
    'linux-amd64': 'lingnest-0.1.0-linux-amd64.tar.gz',
    'linux-arm64': 'lingnest-0.1.0-linux-arm64.tar.gz',
    skill: 'lingnest-library-0.1.0.zip',
    checksums: 'lingnest-0.1.0-SHA256SUMS.txt',
  };
  const readerAssets = Object.fromEntries(Object.entries(readerFiles).map(([key, filename]) => {
    fs.writeFileSync(path.join(root, filename), bytes);
    return [key, { filename, size: bytes.length, sha256: meta.sha256 }];
  }));
  fs.writeFileSync(path.join(root, 'reader-release.json'), JSON.stringify({ version: '0.1.0', assets: readerAssets }));
  const app = createService({ dataDir: root, releaseDir: root, masterKey: randomBytes(32).toString('hex') });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const info = await (await fetch(base + '/client-release.json')).json();
  assert.equal(info.android.sha256, meta.sha256);
  assert.equal(info.android.versionCode, 2);
  assert.equal(info.android.url, '/downloads/personal-library-1.0.0-release.apk');
  assert.equal(info.android.browserUrl, '/downloads/' + filename);
  assert.equal((await fetch(base + '/client-release.json')).headers.get('cache-control'), 'no-store');
  assert.equal(info.worker.windows_x64.filename, workerFile);
  assert.equal(info.worker.macos_arm64, null);
  assert.equal(info.worker.macos_arm64_dmg.filename, dmgFile);
  for (const item of [info.android, info.worker.windows_x64, info.worker.macos_arm64_dmg]) {
    for (const url of item.aliases) {
      const response = await fetch(base + url);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(root, item.filename)));
    }
  }
  for (const item of [...Object.values(info.reader.cli), info.reader.skill, info.reader.checksums]) {
    const response = await fetch(base + item.url);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('content-disposition'), `attachment; filename="${item.filename}"`);
    assert.equal((await fetch(base + item.url, { method: 'HEAD' })).status, 200);
  }
  assert.equal((await fetch(base + '/downloads/reader-release.json')).status, 404);
  assert.equal((await fetch(base + '/downloads/lingnest-0.1.1-windows-amd64.zip')).status, 404);
  assert.equal((await fetch(base + info.reader.skill.url, { method: 'POST' })).status, 405);
  fs.writeFileSync(path.join(root, readerFiles.skill), Buffer.alloc(bytes.length, 65));
  assert.equal((await fetch(base + info.reader.skill.url)).status, 503);
  fs.unlinkSync(path.join(root, readerFiles['darwin-arm64']));
  assert.equal((await (await fetch(base + '/client-release.json')).json()).reader.cli['darwin-arm64'], null);
  readerAssets.skill.filename = '../private-key.p12';
  fs.writeFileSync(path.join(root, 'reader-release.json'), JSON.stringify({ version: '0.1.0', assets: readerAssets }));
  assert.equal((await (await fetch(base + '/client-release.json')).json()).reader.skill, null);
  assert.deepEqual(Buffer.from(await (await fetch(base + info.worker.windows_x64.url)).arrayBuffer()), workerBytes);
  assert.deepEqual(Buffer.from(await (await fetch(base + info.worker.macos_arm64_dmg.url)).arrayBuffer()), dmgBytes);
  const oldWorker = await fetch(base + '/downloads/personal-library-worker-0.1.0-windows-x64.exe');
  assert.equal(oldWorker.headers.get('content-disposition'), `attachment; filename="${workerFile}"`);
  assert.deepEqual(Buffer.from(await oldWorker.arrayBuffer()), workerBytes);
  assert.equal((await fetch(base + info.worker.windows_x64.url, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base + '/downloads/personal-library-worker-0.1.0-macos-arm64.zip')).status, 404);
  const download = await fetch(base + info.android.url);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const browserDownload = await fetch(base + info.android.browserUrl);
  assert.equal(browserDownload.headers.get('content-disposition'), `attachment; filename="${filename}"`);
  assert.deepEqual(Buffer.from(await browserDownload.arrayBuffer()), bytes);
  assert.equal((await fetch(base + '/downloads/personal-library-1.0.1-release.apk')).status, 404);
  assert.equal((await fetch(base + '/downloads/personal-library-worker-0.1.1-windows-x64.exe')).status, 404);
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await fetch(base + '/downloads/private-key.p12')).status, 404);
  assert.equal((await fetch(base + '/downloads/android-release.json')).status, 404);
  assert.equal((await fetch(base + '/downloads/worker-release.json')).status, 404);
  assert.equal((await fetch(base + '/download')).status, 200);
  assert.match(await (await fetch(base + '/download/qr.svg')).text(), /<svg/);
  const head = await fetch(base + info.android.url, { method: 'HEAD' });
  assert.equal(Number(head.headers.get('content-length')), bytes.length);
  fs.writeFileSync(path.join(root, filename), Buffer.alloc(bytes.length, 65));
  assert.equal((await fetch(base + info.android.url)).status, 503);
  fs.unlinkSync(path.join(root, filename));
  assert.equal((await (await fetch(base + '/client-release.json')).json()).android, null);
});


test('macOS update feed serves only verified current release assets', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'macos-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = '0.1.7', workers = {}, assets = {};
  const stage = filename => {
    const bytes = Buffer.from('fixture:' + filename);
    fs.writeFileSync(path.join(root, filename), bytes);
    return { filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  for (const arch of ['arm64', 'x64']) {
    workers['macos_' + arch] = { version, ...stage(`InspiraiNest-v${version}-macOS-${arch}.zip`) };
    const filename = `InspiraiNest-v${version}-macOS-${arch}.zip.blockmap`;
    assets[filename] = stage(filename);
  }
  assets['latest-mac.yml'] = stage('latest-mac.yml');
  fs.writeFileSync(path.join(root, 'worker-release.json'), JSON.stringify(workers));
  fs.writeFileSync(path.join(root, 'macos-update.json'), JSON.stringify({ version, assets }));
  const app = createService({ dataDir: root, releaseDir: root, masterKey: randomBytes(32).toString('hex') });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/updates/macos/`;
  for (const item of [...Object.values(workers), ...Object.values(assets)]) {
    const response = await fetch(base + item.filename);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(root, item.filename)));
    assert.equal((await fetch(base + item.filename, { method: 'HEAD' })).status, 200);
  }
  assert.equal((await fetch(base + 'macos-update.json')).status, 404);
  assert.equal((await fetch(base + 'latest-mac.yml', { method: 'POST' })).status, 405);
  fs.writeFileSync(path.join(root, 'latest-mac.yml'), Buffer.alloc(assets['latest-mac.yml'].size, 65));
  assert.equal((await fetch(base + 'latest-mac.yml')).status, 503);
  fs.writeFileSync(path.join(root, 'macos-update.json'), JSON.stringify({ version: '0.1.8', assets }));
  assert.equal((await fetch(base + 'latest-mac.yml')).status, 404);
});
