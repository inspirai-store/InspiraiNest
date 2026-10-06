import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../collector/package.json', import.meta.url));
const OSS = require('ali-oss');
const required = name => { if (!process.env[name]) throw Error(`Missing ${name}`); return process.env[name]; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  const folder = path.resolve(process.argv[2]);
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'android-release.json')));
  const run = required('OSS_RELEASE_RUN_ID'), commit = required('OSS_RELEASE_SOURCE_COMMIT');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !/^\d+(?:-\d+)?$/.test(run) || !/^[a-f0-9]{40}$/.test(commit)
    || manifest.filename !== `InspiraiNest-v${manifest.version}-Android.apk`) throw Error('Invalid release identity');
  const bytes = fs.readFileSync(path.join(folder, manifest.filename));
  if (bytes.length !== manifest.size || hash(bytes) !== manifest.sha256) throw Error('APK checksum mismatch');
  const client = new OSS({ region: required('OSS_RELEASE_REGION'), bucket: required('OSS_RELEASE_BUCKET'),
    accessKeyId: required('OSS_RELEASE_ACCESS_KEY_ID'), accessKeySecret: required('OSS_RELEASE_ACCESS_KEY_SECRET'), secure: true, timeout: 300000 });
  const prefix = `releases/android/v${manifest.version}/${run}`, assets = [];
  for (const name of [manifest.filename, manifest.filename + '.sha256', 'android-release.json']) {
    const data = fs.readFileSync(path.join(folder, name)), sha256 = hash(data), key = prefix + '/' + name;
    try { await client.put(key, data, { headers: { 'x-oss-forbid-overwrite': 'true', 'x-oss-object-acl': 'private' }, meta: { sha256 } }); }
    catch (error) { if (error.code !== 'FileAlreadyExists') throw error; }
    if (hash((await client.get(key)).content) !== sha256) throw Error('OSS readback mismatch');
    assets.push({ name, key, sha256, size: data.length }); console.log('Verified private OSS object:', key);
  }
  const receipt = Buffer.from(JSON.stringify({ version: manifest.version, commit, run, assets }, null, 2));
  const key = prefix + '/release.json';
  try { await client.put(key, receipt, { headers: { 'x-oss-forbid-overwrite': 'true', 'x-oss-object-acl': 'private' } }); }
  catch (error) { if (error.code !== 'FileAlreadyExists') throw error; }
  if (!(await client.get(key)).content.equals(receipt)) throw Error('OSS receipt mismatch');
  console.log('Android signed OSS release verified');
}
main().catch(error => { console.error('Android OSS release failed:', error.code || error.name); if (!error.code) console.error(error.message); process.exitCode = 1; });
