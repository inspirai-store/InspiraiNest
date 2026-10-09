import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('Android and iOS bundle exactly the shared capture UI',()=>{
 const result=spawnSync(process.execPath,['scripts/stage-capture.mjs','--check'],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
