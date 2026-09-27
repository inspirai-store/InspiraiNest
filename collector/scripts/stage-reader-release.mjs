// Build an explicit public download allowlist; never expose an entire directory.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const collector = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(collector, 'cli/dist');
const output = path.resolve(process.argv[2] || path.join(collector, 'mobile/dist'));
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid version');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = new Map(fs.readFileSync(path.join(dist, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/).map(line => {
  const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line);
  if (!match) throw new Error('Invalid checksum line');
  return [match[2], match[1]];
}));
fs.mkdirSync(output, { recursive: true });
const assets = {};
function write(key, filename, bytes) {
  assets[key] = { filename, size: bytes.length, sha256: hash(bytes) };
  fs.writeFileSync(path.join(output, filename), bytes);
}
for (const target of ['windows-amd64', 'darwin-amd64', 'darwin-arm64', 'linux-amd64', 'linux-arm64']) {
  const filename = `lingnest-${version}-${target}.${target.startsWith('windows') ? 'zip' : 'tar.gz'}`;
  const bytes = fs.readFileSync(path.join(dist, filename));
  if (!manifest.archives.includes(filename) || hash(bytes) !== checks.get(filename)) throw new Error('Package checksum mismatch: ' + filename);
  write(target, filename, bytes);
}
// A small deterministic ZIP containing only the reviewed skill files (stored entries).
const locals = [], central = [];
let offset = 0;
const files = ['SKILL.md', 'references/cli.md', 'agents/openai.yaml'];
for (const relative of files) {
  const filename = Buffer.from('lingnest-library/' + relative);
  const bytes = fs.readFileSync(path.join(collector, '../skills/lingnest-library', relative));
  const crc = crc32(bytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16);
  directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24);
  directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
  locals.push(local, filename, bytes); central.push(directory, filename);
  offset += local.length + filename.length + bytes.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
write('skill', `lingnest-library-${version}.zip`, Buffer.concat([...locals, directory, end]));
const sums = Object.values(assets).map(item => `${item.sha256}  ${item.filename}\n`).join('');
write('checksums', `lingnest-${version}-SHA256SUMS.txt`, Buffer.from(sums));
fs.writeFileSync(path.join(output, 'reader-release.json'), JSON.stringify({ version, assets }, null, 2) + '\n');
console.log(JSON.stringify({ version, output, files: Object.values(assets).map(item => item.filename) }));
