import {test} from 'node:test';
import assert from 'node:assert/strict';
import {permitted} from '../../../../packages/core/node/archive.mjs';
test('媒体附件保留既有document角色并允许明确媒体后缀',()=>{
 for(const path of ['movie.mp4','movie.webm','movie.mov','voice.mp3','voice.wav','voice.m4a','voice.ogg'])assert.equal(permitted({path,role:'document'}),true);
 for(const path of ['paper.pdf','note.md','note.txt'])assert.equal(permitted({path,role:'document'}),true);
});
test('新增媒体后缀不放行未知角色、可执行格式和敏感命名',()=>{
 for(const file of [{path:'movie.mp4',role:'attachment'},{path:'app.exe',role:'document'},{path:'page.html',role:'document'},{path:'tokens.mp4',role:'document'},{path:'source/original.mp4',role:'original'},{path:'source/original.mp4',role:'source_snapshot'},{path:'source/original.mp4',role:'transcript_raw'}])assert.equal(permitted(file),false);
});
