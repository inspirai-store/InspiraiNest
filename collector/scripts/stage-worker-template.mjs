import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const collector = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const library = path.resolve(collector, '..');
const stage = path.join(collector, 'desktop', 'template');
const files = [
  'LICENSE', 'AGENTS.md', 'README.md', 'scripts/catalog.mjs', 'scripts/browser-data.mjs', 'scripts/write-collection-json.mjs',
  'assets/library-time.js', 'templates/source.template.json',
  'templates/summary.md', 'templates/scenario.md',
];
for (const file of files) {
  const target = path.join(stage, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(library, file), target);
}
console.log(`Staged ${files.length} worker template files`);
