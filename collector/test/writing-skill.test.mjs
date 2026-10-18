import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writingSkill,skillForVersion,writingCapabilities} from '../../plugins/writing/protocol/writing-protocol.mjs';

test('writing Skill contents and version are stable across Windows and Unix line endings',t=>{
  const original=writingSkill(),root=fs.mkdtempSync(path.join(os.tmpdir(),'writing-skill-eol-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const newline of ['\r\n','\n','\r']){
    for(const file of original.files){const target=path.join(root,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.text.replaceAll('\n',newline));}
    assert.deepEqual(writingSkill(root),original);
  }
});

test('legacy Skill remains frozen while current capability advertises v2 separately',()=>{
 assert.equal(skillForVersion(1).hash,'385f6d5137c0b19f5cb946322c0d6a5d117d2fd8293ad04fc2c225ce86870b4b');
 assert.notEqual(skillForVersion(2).hash,skillForVersion(1).hash);assert.deepEqual(writingCapabilities().map(s=>s.version),[1,2,2]);
});
