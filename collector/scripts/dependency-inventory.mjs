import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url)));
const packages = Object.entries(lock.packages).filter(([name]) => name).map(([name, entry]) => ({
  path: name, version: entry.version, license: entry.license || null,
  integrity: entry.integrity || null, dev: Boolean(entry.dev),
}));
const output = new URL('../../docs/npm-dependencies.json', import.meta.url);
fs.writeFileSync(output, JSON.stringify({ source: 'collector/package-lock.json', packages }, null, 2) + '\n');
console.log(`Recorded ${packages.length} package entries in ${fileURLToPath(output)}; ${packages.filter(p => !p.license).length} missing license metadata.`);
