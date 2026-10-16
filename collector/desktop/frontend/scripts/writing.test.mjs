import test from 'node:test';import assert from 'node:assert/strict';
import {WritingClient} from '../src/writing/client.ts';
import {zipFiles,articleHTML} from '../src/writing/export.ts';
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
const connection={paired:true,server:'https://library.invalid',deviceId:'owner'};
test('lost acknowledgement retries the same request and base version even after a refresh or restart',async()=>{const disk=storage(),calls=[];let fail=true;const bridge={status:async()=>connection,capture:async input=>{calls.push(input.json);if(fail)throw Error('connection lost');return {status:200,json:{id:'session',version:2}};}};await assert.rejects(new WritingClient(bridge,disk).mutate('/api/writing/sessions/id/materials',{baseVersion:1,sources:['material']}));fail=false;await new WritingClient(bridge,disk).mutate('/api/writing/sessions/id/materials',{baseVersion:2,sources:['material']});assert.deepEqual(calls[0],calls[1]);});
test('conflict keeps user input outside the journal and allows a new rebased request',async()=>{const calls=[],bridge={status:async()=>connection,capture:async input=>{calls.push(input.json);return calls.length===1?{status:409,json:{error:'refresh'}}:{status:200,json:{id:'session',version:3}};}},client=new WritingClient(bridge,storage());await assert.rejects(client.mutate('/route',{baseVersion:1,text:'kept'}),/refresh/);await client.mutate('/route',{baseVersion:2,text:'kept'});assert.notEqual(calls[0].requestId,calls[1].requestId);assert.equal(calls[1].baseVersion,2);});
test('account change fences in-flight reads and attachment corruption is rejected',async()=>{let current=connection;const bridge={status:async()=>current,capture:async()=>{current={...connection,deviceId:'other'};return {status:200,json:{private:'old account'}};}};await assert.rejects(new WritingClient(bridge,storage()).request('/route'),/切换/);const bad={status:async()=>connection,capture:async()=>({status:200,bytes:btoa('bad'),mime:'image/png'})};await assert.rejects(new WritingClient(bad,storage()).file('s','t',{id:'file',sha256:'0'.repeat(64),bytes:3}),/校验/);});
test('offline export escapes titles, blocks path traversal and preserves UTF-8 file names',()=>{assert.match(articleHTML('<script>','<p>body</p>','ref'),/&lt;script&gt;/);for(const name of ['../secret','C:/secret','\\secret','safe/../secret'])assert.throws(()=>zipFiles([{name,bytes:new Uint8Array()}]));assert.throws(()=>zipFiles([{name:'same.md',bytes:new Uint8Array()},{name:'SAME.md',bytes:new Uint8Array()}]));assert.ok(zipFiles([{name:'图片/流程.png',bytes:new Uint8Array([1,2])}]).length>100);});

test('switching accounts between journaling and dispatch cannot send the old material to the new space',async()=>{let reads=0,sent=0;const disk=storage(),bridge={status:async()=>++reads===1?connection:{...connection,server:'https://other.invalid'},capture:async()=>{sent++;return {status:200,json:{id:'wrong'}};}};await assert.rejects(new WritingClient(bridge,disk).mutate('/api/writing/sessions',{sources:['private original']}),/切换/);assert.equal(sent,0);assert.ok(disk.getItem('writing:pending:'+connection.server+':'+connection.deviceId+':/api/writing/sessions'));});

import {answerFor,emptyTurn,legacyTurn,turnInput} from '../src/writing/turn.ts';
test('recommended choices are never submitted implicitly, and a free correction preserves partial answers',()=>{
 const questions=[{id:'q1',recommendedOptionId:'recommended'},{id:'q2'}],draft=emptyTurn();
 assert.deepEqual(turnInput(questions,draft,'r').answers,[]);assert.deepEqual(answerFor(draft,'q1').selected,[]);
 draft.answers=[{questionId:'q1',selected:['my-choice'],text:'自己的补充',uncertain:false}];draft.message='调整主旨';draft.index=1;
 const restored=JSON.parse(JSON.stringify(draft));assert.deepEqual(turnInput(questions,restored,'r'),{roundId:'r',answers:draft.answers,message:'调整主旨'});assert.equal(restored.index,1);
});

test('old local questionnaire input migrates without becoming an automatic submission',()=>{
 const disk=storage(),answers=[{questionId:'old-q',selected:['kept'],text:'保留原话',uncertain:false}];disk.setItem('scope:answers:r',JSON.stringify(answers));disk.setItem('scope:message',JSON.stringify('原来的补充'));
 const draft=legacyTurn(disk,'scope','r');assert.deepEqual(draft.answers,answers);assert.equal(draft.message,'原来的补充');assert.ok(disk.getItem('scope:answers:r'));disk.setItem('scope:message','broken JSON');assert.deepEqual(legacyTurn(disk,'scope','r'),emptyTurn());
});
