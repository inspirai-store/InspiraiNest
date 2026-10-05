import OSS from 'ali-oss';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const required = name => {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
};
async function digest(stream) {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}
async function main() {
  const dir = path.resolve(process.argv[2] || 'desktop/dist');
  const { version } = JSON.parse(await readFile(path.resolve(dir, '../../package.json')));
  const brand = process.argv[3] || 'LingNest';
  if (!['LingNest', 'InspiraiNest'].includes(brand)) throw new Error('Invalid product name');
  const run = required('OSS_RELEASE_RUN_ID');
  if (!/^[0-9]+(?:-[0-9]+)?$/.test(run) || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error('Invalid version or run ID');
  const prefix = `releases/macos/v${version}/${run}`;
  const client = new OSS({
    region: required('OSS_RELEASE_REGION'), bucket: required('OSS_RELEASE_BUCKET'),
    accessKeyId: required('OSS_RELEASE_ACCESS_KEY_ID'), accessKeySecret: required('OSS_RELEASE_ACCESS_KEY_SECRET'),
    secure: true, timeout: 300000,
  });
  const names = ['arm64', 'x64'].flatMap(arch => ['zip', 'dmg'].map(ext => `${brand}-v${version}-macOS-${arch}.${ext}`));
  const sums = await readFile(path.join(dir, 'SHASUMS256.txt'), 'utf8');
  const expected = new Map(sums.trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{64}) [ *](\S+)$/.exec(line);
    if (!match) throw new Error('Invalid checksum manifest');
    return [match[2], match[1]];
  }));
  if (expected.size !== 4 || names.some(name => !expected.has(name))) throw new Error('Unexpected package list');
  const assets = [];
  // Validate every local file before making any remote changes.
  const updateFiles = brand === 'InspiraiNest' ? [...names.map(name => name + '.blockmap'), 'latest-mac.yml'] : [];
  for (const name of [...names, ...updateFiles, 'SHASUMS256.txt']) {
    const file = path.join(dir, name);
    const sha256 = await digest(createReadStream(file));
    const size = (await stat(file)).size;
    if (!size || (expected.has(name) && expected.get(name) !== sha256)) throw new Error(`Checksum mismatch: ${name}`);
    assets.push({ name, size, sha256, key: `${prefix}/${name}` });
  }
  async function upload(key, content, sha256, size) {
    console.log(`Uploading ${key} (${size} bytes)`);
    try {
      await client.put(key, content, { headers: { 'x-oss-forbid-overwrite': 'true', 'x-oss-object-acl': 'private' }, meta: { sha256 } });
    } catch (error) {
      if (error.code !== 'FileAlreadyExists') throw error;
    }
    const remote = await client.getStream(key);
    if (await digest(remote.stream) !== sha256) throw new Error(`OSS readback mismatch: ${key}`);
    const head = await client.head(key);
    if (Number(head.res.headers['content-length']) !== size) throw new Error(`OSS size mismatch: ${key}`);
    console.log(`Verified private OSS object: ${key}`);
  }
  for (const asset of assets) await upload(asset.key, path.join(dir, asset.name), asset.sha256, asset.size);
  // The completion manifest is written only after every asset passes readback verification.
  const receipt = Buffer.from(JSON.stringify({ version, run, commit: process.env.OSS_RELEASE_SOURCE_COMMIT || process.env.GITHUB_SHA || null, assets }, null, 2) + '\n');
  await upload(`${prefix}/release.json`, receipt, createHash('sha256').update(receipt).digest('hex'), receipt.length);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## macOS OSS upload\n\nPrivate prefix: \`${prefix}/\`\n\nBoth architectures, ZIP/DMG and SHA-256 manifest uploaded and read back successfully.\n`);
  }
}
main().catch(error => {
  // SDK errors may contain request headers; never dump the full error object.
  console.error(`OSS upload failed: ${error.code || error.name}${error.status ? ` (${error.status})` : ''}`);
  if (!error.code) console.error(error.message);
  process.exitCode = 1;
});
