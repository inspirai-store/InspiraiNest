import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const app = path.resolve(process.argv[2] || '');
assert.equal(path.basename(app), '灵藏.app');
const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }));
assert.equal(plist.CFBundleName, '灵藏');
assert.equal(plist.CFBundleDisplayName, '灵藏');
assert.equal(plist.CFBundleExecutable, '灵藏');
assert.equal(plist.CFBundleIdentifier, 'store.inspirai.library.worker');
assert.ok(fs.existsSync(path.join(app, 'Contents/MacOS/灵藏')));
assert.ok(fs.existsSync(path.join(app, 'Contents/Frameworks/灵藏 Helper (Renderer).app')));
console.log('macOS bundle, Dock display name and helpers: 灵藏; existing bundle ID preserved');
