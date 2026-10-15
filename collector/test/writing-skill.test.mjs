import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writingSkill} from '../src/writing-protocol.mjs';

test('writing Skill contents and version are stable across Windows and Unix line endings',t=>{
  const original=writingSkill(),root=fs.mkdtempSync(path.join(os.tmpdir(),'writing-skill-eol-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const newline of ['\r\n','\n','\r']){
    for(const file of original.files){const target=path.join(root,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.text.replaceAll('\n',newline));}
    assert.deepEqual(writingSkill(root),original);
  }
});
