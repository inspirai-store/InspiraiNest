import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';

// Only this versioned, checksummed release is exposed; never serve the build directory.
export function clientDownload({ releaseDir, publicUrl }) {
  const brandedNames = (version, suffix) => ['InspiraiNest', 'LingNest'].map(brand => `${brand}-v${version}-${suffix}`);
  function release() {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(releaseDir, 'android-release.json'), 'utf8'));
      if (!brandedNames(meta.version, 'Android.apk').includes(meta.filename) || !/^[a-f0-9]{64}$/i.test(meta.sha256)
        || !/^\d+\.\d+\.\d+$/.test(meta.version) || !Number.isSafeInteger(meta.size) || meta.size <= 0) return null;
      const file = path.join(releaseDir, meta.filename);
      if (fs.statSync(file).size !== meta.size) return null;
      if (!Number.isSafeInteger(meta.versionCode) || meta.versionCode <= 0) return null;
      return { version: meta.version, versionCode: meta.versionCode, filename: meta.filename, sha256: meta.sha256.toLowerCase(), size: meta.size,
        publishedAt: meta.publishedAt, minimumAndroid: '8.0',
        url: `/downloads/personal-library-${meta.version}-release.apk`, browserUrl: '/downloads/' + meta.filename,
        aliases: brandedNames(meta.version, 'Android.apk').map(name => '/downloads/' + name) };
    } catch { return null; }
  }
  function workerReleases() {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'worker-release.json'), 'utf8'));
      return Object.fromEntries(['windows_x64', 'macos_x64', 'macos_arm64', 'macos_x64_dmg', 'macos_arm64_dmg'].map(platform => {
        try {
        const meta = manifest[platform];
        const extension = platform.endsWith('_dmg') ? 'dmg' : 'zip';
        const suffix = platform === 'windows_x64' ? 'Windows-x64.exe' : `macOS-${platform.split('_')[1]}.${extension}`;
        if (!meta || !/^\d+\.\d+\.\d+$/.test(meta.version)
          || !brandedNames(meta.version, suffix).includes(meta.filename)
          || !/^[a-f0-9]{64}$/i.test(meta.sha256) || !Number.isSafeInteger(meta.size) || meta.size <= 0) return [platform, null];
        if (fs.statSync(path.join(releaseDir, meta.filename)).size !== meta.size) return [platform, null];
        return [platform, { ...meta, sha256: meta.sha256.toLowerCase(), url: '/downloads/' + meta.filename,
          aliases: brandedNames(meta.version, suffix).map(name => '/downloads/' + name),
          legacyUrl: `/downloads/personal-library-worker-${meta.version}-${platform.replaceAll('_', '-')}.${platform === 'windows_x64' ? 'exe' : extension}` }];
        } catch { return [platform, null]; }
      }));
    } catch { return { windows_x64: null, macos_x64: null, macos_arm64: null, macos_x64_dmg: null, macos_arm64_dmg: null }; }
  }
  function readerReleases() {
    const empty = { cli: {}, skill: null, checksums: null };
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'reader-release.json'), 'utf8'));
      if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) return empty;
      const version = manifest.version;
      function asset(key, filename) {
        const item = manifest.assets?.[key];
        if (!item || item.filename !== filename || !/^[a-f0-9]{64}$/i.test(item.sha256)
          || !Number.isSafeInteger(item.size) || item.size <= 0) return null;
        try { if (fs.statSync(path.join(releaseDir, filename)).size !== item.size) return null; } catch { return null; }
        return { version, filename, size: item.size, sha256: item.sha256.toLowerCase(), url: '/downloads/' + filename };
      }
      const cli = Object.fromEntries(['windows-amd64', 'darwin-amd64', 'darwin-arm64', 'linux-amd64', 'linux-arm64'].map(target =>
        [target, asset(target, `lingnest-${version}-${target}.${target.startsWith('windows') ? 'zip' : 'tar.gz'}`)]));
      return { cli, skill: asset('skill', `lingnest-library-${version}.zip`), checksums: asset('checksums', `lingnest-${version}-SHA256SUMS.txt`) };
    } catch { return empty; }
  }
  function macUpdates(workers) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'macos-update.json'), 'utf8'));
      if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !['macos_arm64', 'macos_x64'].every(key => workers[key]?.version === manifest.version)) return [];
      const allowed = ['latest-mac.yml', ...['arm64', 'x64'].map(arch => `InspiraiNest-v${manifest.version}-macOS-${arch}.zip.blockmap`)];
      const metadata = allowed.map(filename => {
        const item = manifest.assets?.[filename];
        if (!item || item.filename !== filename || !/^[a-f0-9]{64}$/i.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size <= 0
          || fs.statSync(path.join(releaseDir, filename)).size !== item.size) throw new Error('Invalid update asset');
        return item;
      });
      return [...metadata, workers.macos_arm64, workers.macos_x64].map(item => ({ ...item, url: '/updates/macos/' + item.filename }));
    } catch { return []; }
  }
  return async (req, res, route) => {
    if (!['/client-release.json', '/download/qr.svg'].includes(route) && !route.startsWith('/downloads/') && !route.startsWith('/updates/macos/')) return false;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }
    const meta = release();
    const workers = workerReleases();
    const reader = readerReleases();
    if (route === '/client-release.json') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ android: meta, ios: null, worker: workers, reader })); return true;
    }
    if (route === '/download/qr.svg') {
      const scheme = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
      const origin = publicUrl ? new URL(publicUrl).origin : new URL(scheme + '//' + req.headers.host).origin;
      const svg = await QRCode.toString(origin + '/download', { type: 'svg', margin: 2, width: 168, color: { dark: '#176f5b', light: '#ffffff' } });
      res.setHeader('Content-Type', 'image/svg+xml'); res.end(req.method === 'HEAD' ? undefined : svg); return true;
    }
    const selected = [meta, ...Object.values(workers), ...Object.values(reader.cli), reader.skill, reader.checksums, ...macUpdates(workers)].find(item => item &&
      (item.url === route || item.browserUrl === route || item.legacyUrl === route || item.aliases?.includes(route)));
    if (!selected) { res.writeHead(404); res.end('Release not available'); return true; }
    const file = path.join(releaseDir, selected.filename);
    const digest = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
    if (digest.digest('hex') !== selected.sha256) { res.writeHead(503); res.end('Release verification failed'); return true; }
    if (route.startsWith('/updates/macos/')) res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', selected.filename.endsWith('.apk') ? 'application/vnd.android.package-archive' : selected.filename.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${selected.filename}"`);
    res.setHeader('Content-Length', selected.size);
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    return true;
  };
}
