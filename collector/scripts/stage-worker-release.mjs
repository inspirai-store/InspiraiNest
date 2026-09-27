import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const files = process.argv.slice(2);
if (!files.length) throw new Error('Pass one or more Worker build artifacts');
const releaseDir = path.resolve('mobile/dist');
fs.mkdirSync(releaseDir, { recursive: true });
const manifestFile = path.join(releaseDir, 'worker-release.json');
const worker = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
for (const source of files) {
  const filename = path.basename(source);
  const match = filename.match(/^(?:InspiraiNest|LingNest)-v(\d+\.\d+\.\d+)-(Windows-x64\.exe|macOS-(?:x64|arm64)\.(?:zip|dmg))$/);
  if (!match) throw new Error(`Unexpected Worker artifact name: ${filename}`);
  const platform = match[2].replace(/\.(exe|zip|dmg)$/, '').toLowerCase().replaceAll('-', '_');
  const releaseKey = filename.endsWith('.dmg') ? `${platform}_dmg` : platform;
  const bytes = fs.readFileSync(source);
  const target = path.join(releaseDir, filename);
  if (path.resolve(source) !== target) fs.copyFileSync(source, target);
  worker[releaseKey] = { version: match[1], filename, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    publishedAt: new Date().toISOString() };
}
fs.writeFileSync(manifestFile, JSON.stringify(worker, null, 2) + '\n');
console.log(`Staged ${Object.keys(worker).join(', ')} Worker artifact(s)`);
