import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createService} from '../src/server.mjs';
import {api,runWorker,processTask} from '../src/worker.mjs';
import {writingInput,writingResult} from '../src/selection-writing.mjs';
import {validateCaptureRequest} from '../src/capture-request.mjs';
async function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'writing-protocol-')),key=crypto.randomUUID();const service=createService({dataDir:path.join(root,'service'),masterKey:key});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});const server=`http://127.0.0.1:${service.server.address().port}`;const owner={server,...await api({server},'/api/pair','POST',{key,name:'writing owner'})};const pair=async name=>{const p=await api(owner,'/api/pairings','POST',{role:'worker'});return {server,...await api({server},'/api/pair','POST',{key:p.key,name})};};return {root,service,server,owner,pair};}
const request=patch=>({requestId:crypto.randomUUID(),operation:'polish',text:'这是一段写作素材。',...patch});
const beat=(worker,protocol)=>api(worker,'/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],...(protocol?{selectionWritingProtocol:1}:{} )});
test('writing input is bounded text; preload does not allow Worker result submission or arbitrary endpoints',()=>{
 assert.equal(writingInput(request()).value.fullText,undefined);assert.throws(()=>writingInput(request({attachments:[]})));assert.throws(()=>writingInput(request({operation:'custom',instructions:''})));assert.throws(()=>writingResult({protocol:1,html:'<b>bad</b>',text:'x'}));assert.equal(writingResult({protocol:1,text:'<b>literal</b>\r\n正文'}).text,'<b>literal</b>\n正文');
 for(const [route,method] of [['/api/selection-writing/tasks','POST'],['/api/selection-writing/tasks/id','GET'],['/api/selection-writing/tasks/id/cancel','POST']])assert.doesNotThrow(()=>validateCaptureRequest({route,method}));
 assert.throws(()=>validateCaptureRequest({route:'/api/selection-writing/tasks/id/result',method:'POST'}));
});
test('idempotent writing queue excludes old Worker, requires assignment tokens and never enters archives',async t=>{
 const f=await fixture(t),old=await f.pair('old'),worker=await f.pair('writing');await beat(old,false);await api(old,'/api/heartbeat','POST',{writingProtocol:1,capabilities:['note'],agents:['codex']});await beat(worker,true);
 assert.equal((await api(f.owner,'/api/state')).selectionWritingProtocol,1);
 const input=request(),task=await api(f.owner,'/api/selection-writing/tasks','POST',input);const again=await Promise.all([api(f.owner,'/api/selection-writing/tasks','POST',input),api(f.owner,'/api/selection-writing/tasks','POST',input)]);assert(again.every(x=>x.id===task.id));await assert.rejects(api(f.owner,'/api/selection-writing/tasks','POST',{...input,text:'changed'}),e=>e.status===409);
 assert.equal((await api(old,'/api/claim','POST',{assignmentProtocol:1})).task,null);assert.equal((await api(worker,'/api/claim','POST',{})).task,null);
 const claimed=(await api(worker,'/api/claim','POST',{assignmentProtocol:1})).task;assert.equal(claimed.purpose,'selection-writing');assert(claimed.assignmentId);
 await assert.rejects(api(worker,`/api/selection-writing/tasks/${task.id}/result`,'POST',{protocol:1,text:'输出'}),e=>e.status===409);
 await assert.rejects(api(worker,`/api/tasks/${task.id}/result`,'POST',{},claimed.assignmentId),e=>e.status===409);
 const done=await api(worker,`/api/selection-writing/tasks/${task.id}/result`,'POST',{protocol:1,text:'输出'},claimed.assignmentId);assert.equal(done.state,'completed');assert.equal((await api(f.owner,`/api/selection-writing/tasks/${task.id}`)).result.text,'输出');
 assert.equal((await f.service.store.list('archive')).length,0);assert.equal((await f.service.store.list('draft')).length,0);assert.equal((await f.service.store.list('task')).length,1);assert.equal((await api(f.owner,'/api/state')).tasks.length,0);
});
test('cancel invalidates in-flight assignment and cannot be overwritten by late text result',async t=>{
 const f=await fixture(t),worker=await f.pair('writer');await beat(worker,true);const task=await api(f.owner,'/api/selection-writing/tasks','POST',request());const claimed=(await api(worker,'/api/claim','POST',{assignmentProtocol:1})).task;
 await api(f.owner,`/api/selection-writing/tasks/${task.id}/cancel`,'POST',{});await assert.rejects(api(worker,`/api/selection-writing/tasks/${task.id}/result`,'POST',{protocol:1,text:'迟到结果'},claimed.assignmentId),e=>e.status===409);assert.equal((await api(f.owner,`/api/selection-writing/tasks/${task.id}`)).state,'cancelled');
});
test('real Worker pipeline advertises writing protocol, runs Agent and restores text checkpoint without archive input',async t=>{
 const f=await fixture(t),worker=await f.pair('writer'),input=request({fullText:'本次正文上下文'}),task=await api(f.owner,'/api/selection-writing/tasks','POST',input);
 const script=fileURLToPath(new URL('./fixtures/writing-agent.mjs',import.meta.url));const config={...worker,dataDir:path.join(f.root,'worker'),capabilities:['note'],agents:{codex:{command:process.execPath,args:[script],versionArgs:[script,'--version']},codebuddy:{enabled:false}}};await runWorker(config,{once:true});
 const done=await api(f.owner,`/api/selection-writing/tasks/${task.id}`);assert.equal(done.state,'completed');assert.match(done.result.text,/保持专注/);const cwd=path.join(config.dataDir,'writing-tasks',task.id);assert(!fs.existsSync(path.join(config.dataDir,'tasks',task.id,'library')));const received=fs.readFileSync(path.join(cwd,'received-prompt.txt'),'utf8');assert.match(received,/本次正文上下文/);assert(!received.includes('token'));
 const task2=await api(f.owner,'/api/selection-writing/tasks','POST',request());await beat(worker,true);const claimed=(await api(worker,'/api/claim','POST',{assignmentProtocol:1})).task;
 const second=path.join(config.dataDir,'writing-tasks',task2.id);fs.mkdirSync(second,{recursive:true});fs.writeFileSync(path.join(second,'writing-result.json'),JSON.stringify({protocol:1,text:'重启恢复结果'}));await processTask(config,claimed,{},new AbortController().signal);assert.equal((await api(f.owner,`/api/selection-writing/tasks/${task2.id}`)).result.text,'重启恢复结果');
 assert.equal((await f.service.store.list('archive')).length,0);
});

test('writing Agent failure is explicit and a new request can retry without rerouting into archive work',async t=>{
 const f=await fixture(t),worker=await f.pair('writer');await beat(worker,true);const task=await api(f.owner,'/api/selection-writing/tasks','POST',request({instructions:'失败回归'}));const claimed=(await api(worker,'/api/claim','POST',{assignmentProtocol:1})).task;const script=fileURLToPath(new URL('./fixtures/writing-agent.mjs',import.meta.url));const config={...worker,dataDir:path.join(f.root,'worker'),agents:{codex:{command:process.execPath,args:[script]},codebuddy:{enabled:false}}};await processTask(config,claimed,{codex:{available:true}},new AbortController().signal);assert.equal((await api(f.owner,`/api/selection-writing/tasks/${task.id}`)).state,'failed');const next=await api(f.owner,'/api/selection-writing/tasks','POST',request());assert.notEqual(next.id,task.id);assert.equal((await api(worker,'/api/claim','POST',{assignmentProtocol:1})).task.id,next.id);assert.equal((await f.service.store.list('archive')).length,0);
});
