import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('desktop package and legacy release checks use the same version',()=>{
 const read=relative=>JSON.parse(fs.readFileSync(new URL('../../../'+relative,import.meta.url),'utf8'));
 const version=read('package.json').version;
 assert.equal(read('collector/package.json').version,version);
 const lock=read('package-lock.json');assert.equal(lock.version,version);assert.equal(lock.packages[''].version,version);assert.equal(lock.packages.collector.version,version);
});
