import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const cfg = fs.readFileSync('app/build.gradle', 'utf8');
const version = /versionName '([^']+)'/.exec(cfg)?.[1], versionCode = Number(/versionCode (\d+)/.exec(cfg)?.[1]);
if (!/^\d+\.\d+\.\d+$/.test(version) || !versionCode) throw Error('Invalid Android version');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const apk = 'app/build/outputs/apk/release/app-release.apk', bytes = fs.readFileSync(apk);
const response = await fetch('https://library.inspirai.store/client-release.json', { redirect: 'error' });
if (!response.ok) throw Error('Cannot read previous signed release');
const previous = (await response.json()).android;
if (!previous?.sha256 || versionCode <= previous.versionCode) throw Error('Android release must increase versionCode');
const url = new URL(previous.browserUrl, 'https://library.inspirai.store');
if (url.origin !== 'https://library.inspirai.store' || !url.pathname.endsWith('.apk')) throw Error('Invalid previous APK route');
const oldResponse = await fetch(url, { redirect: 'error' });
if (!oldResponse.ok) throw Error('Cannot read previous APK');
const old = Buffer.from(await oldResponse.arrayBuffer());
if (hash(old) !== previous.sha256) throw Error('Previous APK checksum mismatch');
const oldFile = path.join(process.env.RUNNER_TEMP, 'inspirainest-previous-android.apk');
fs.writeFileSync(oldFile, old);
const signer = path.join(process.env.ANDROID_HOME, 'build-tools/36.0.0/apksigner');
const certificate = file => {
  const output = execFileSync(signer, ['verify', '--print-certs', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const digests = [...output.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)/g)].map(m => m[1].toLowerCase()).sort();
  if (!digests.length) throw Error('Missing APK signing certificate');
  return digests.join(',');
};
try { if (certificate(apk) !== certificate(oldFile)) throw Error('Android signing identity changed; existing installs cannot upgrade'); }
finally { fs.rmSync(oldFile, { force: true }); }
const folder = '../dist', filename = `InspiraiNest-v${version}-Android.apk`, sha256 = hash(bytes);
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, filename), bytes);
fs.writeFileSync(path.join(folder, filename + '.sha256'), sha256 + '\n');
fs.writeFileSync(path.join(folder, 'android-release.json'), JSON.stringify({ version, versionCode, filename, sha256, size: bytes.length, publishedAt: new Date().toISOString() }, null, 2));
console.log('Android release staged with the existing signing certificate');
