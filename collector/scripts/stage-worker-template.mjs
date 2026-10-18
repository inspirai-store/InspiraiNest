import {sourcePath,repositoryRoot} from '../../tooling/layout.mjs';
import {collectorRoot,collectorPath} from '../../tooling/layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const collector = collectorRoot;
const library = path.resolve(collector, '..');
const stage = collectorPath( 'desktop', 'template');
const files = [
  'LICENSE', 'AGENTS.md', 'README.md', 'scripts/catalog.mjs', 'scripts/browser-data.mjs', 'scripts/write-collection-json.mjs',
  'assets/library-time.js', 'packages/library-kit/catalog.mjs','packages/library-kit/browser-data.mjs','packages/library-kit/write-collection-json.mjs','apps/offline-reader/assets/library-time.js','templates/source.template.json',
  'templates/summary.md', 'templates/scenario.md',
];
for (const file of files) {
  const target = path.join(stage, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file==='AGENTS.md'?sourcePath('resources/templates/AGENTS.md'):file==='README.md'?sourcePath('resources/templates/library-README.md'):fs.existsSync(path.join(library,file))?path.join(library,file):sourcePath(path.relative(repositoryRoot,path.join(library,file))), target);
}
console.log(`Staged ${files.length} worker template files`);
