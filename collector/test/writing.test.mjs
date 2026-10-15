import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,round} from './writing-fixture.mjs';
import {createService} from '../src/server.mjs';
import { hash } from '../src/common.mjs';
import { processTask } from '../src/worker.mjs';
import {validateCaptureRequest} from '../src/capture-request.mjs';
import {captureRequest} from '../desktop/capture-client.mjs';

test('owner session and history survive restart and a different device resumes the same version',async t=>{
 const f=await fixture(t),created=await f.create(),node=await f.worker(),task=await f.claim(node);await f.submit(task,node,round(task));
 await f.stop();const app=createService({dataDir:f.root,masterKey:f.masterKey});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const server=`http://127.0.0.1:${app.server.address().port}`;const second=await (await fetch(server+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:f.masterKey,name:'another device'})})).json();const read=async route=>await (await fetch(server+route,{headers:{Authorization:'Bearer '+second.token}})).json();
 const s=await read('/api/writing/sessions/'+created.id);assert.equal(s.rounds.length,1);assert.equal(s.status,'awaiting_answers');
 const history=await read(`/api/writing/sessions/${s.id}/history`);assert.equal(history.items.length,2);assert.equal(history.items[0].sources[0].text,s.sources[0].text);
});
test('only owner routes pass native capture validation, and a question round cannot publish a draft',async t=>{
 const sid=crypto.randomUUID(),tid=crypto.randomUUID();for(const route of [`/api/writing/sessions/${sid}/history`,`/api/writing/sessions/${sid}/files/${tid}`])assert.doesNotThrow(()=>validateCaptureRequest({route}));assert.throws(()=>validateCaptureRequest({route:`/api/writing/tasks/${tid}/result`,method:'POST'}));
 const f=await fixture(t);await f.create();const node=await f.worker(),task=await f.claim(node);assert.equal(task.writingSnapshot.context.audience,'技术实践者');const repeated=round(task);repeated.questions[0].key='audience';assert.equal((await f.submit(task,node,repeated)).status,400);const response=await f.request(`/api/writing/tasks/${task.id}/result`,'POST',{kind:'draft',skillHash:task.writingSnapshot.skill.hash},node,task.assignmentId);assert.equal(response.status,409);assert.equal((await f.app.store.list('draft')).length,0);
});
test('committed material retries reuse receipts even when the original source is no longer listed',async t=>{
 const f=await fixture(t),recordId=crypto.randomUUID();await f.request(`/api/records/${recordId}`,'PUT',{requestId:crypto.randomUUID(),baseVersion:0,text:'原始记录',attachments:[],createdAt:new Date().toISOString()});
 const payload={requestId:crypto.randomUUID(),sources:[{kind:'record',role:'material',id:recordId}]},first=await f.request('/api/writing/sessions','POST',payload);assert.equal(first.status,201);await f.app.store.delete('capture',recordId);
 const retry=await f.request('/api/writing/sessions','POST',payload);assert.deepEqual(retry.value,first.value);assert.equal((await f.app.store.list('writing-session')).length,1);
});
test('mixed record originals keep their attachment identity, require full reading, and transfer by authorized files',async t=>{
 const f=await fixture(t),recordId=crypto.randomUUID(),attachmentId=crypto.randomUUID(),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),sha=hash(bytes);
 const upload=await fetch(f.server+'/api/records/media/'+sha,{method:'PUT',headers:{Authorization:'Bearer '+f.owner.token,'Content-Type':'image/png'},body:bytes});assert.equal(upload.status,200);
 assert.equal((await f.request('/api/records/'+recordId,'PUT',{requestId:crypto.randomUUID(),baseVersion:0,text:'照片与文字的记录',attachments:[{id:attachmentId,name:'photo.png',mime:'image/png',bytes:bytes.length,sha256:sha}],createdAt:new Date().toISOString()})).status,200);
 const created=await f.create({sources:[{kind:'record',role:'material',id:recordId},{kind:'text',role:'exemplar',text:'指定的测试范文。'}]}),s=await f.session(created.id),file=s.sources[0].files[0];assert.equal(file.attachmentId,attachmentId);assert.equal(file.storageKey,undefined);
 const read=await f.request(`/api/writing/sessions/${s.id}/files/${file.id}`);assert.deepEqual(read.value,bytes);const node=await f.worker(),task=await f.claim(node),result=round(task);result.coverage[0].files=[];assert.equal((await f.submit(task,node,result)).status,400);result.coverage[0].files=[file.id];assert.equal((await f.submit(task,node,result)).status,200);
});
test('draft worker preserves provenance, builds valid catalogs and uploads a reviewable publication',async t=>{
 const f=await fixture(t),created=await f.create(),node=await f.worker(),first=await f.claim(node);await f.submit(first,node,round(first,true));let s=await f.session(created.id);await f.change(s,'style',{candidateId:s.styleCandidates[0].id,ruleIds:['r1']});s=await f.session(s.id);await f.change(s,'start',{planVersion:s.planVersion,styleVersion:s.style.id});const task=await f.claim(node);
 const fake=path.join(f.root,'draft-agent.mjs');fs.writeFileSync(fake,`import fs from 'node:fs';const i=JSON.parse(fs.readFileSync('writing-input.json'));const entry='notes/writing-'+i.sessionId+'-'+i.taskId;fs.mkdirSync(entry,{recursive:true});const m=JSON.parse(fs.readFileSync('templates/source.template.json'));Object.assign(m,{id:'note:writing-'+i.sessionId+'-'+i.taskId,title:'一次采集实践',type:'note',platform:'personal',source_url:null,status:'archived',organized_at:new Date().toISOString().slice(0,10),summary:'具体经历与判断',coverage_note:'已完整读取测试材料和指定范文',files:[{path:'article.md',role:'publication'},{path:'summary.md',role:'summary'},{path:'references.md',role:'reference'}]});fs.writeFileSync(entry+'/source.json',JSON.stringify(m));fs.writeFileSync(entry+'/article.md','# 一次采集实践\\n\\n从一次失败开始，先保留原始材料，再恢复后续流程。');fs.writeFileSync(entry+'/summary.md','实践经历与限制条件。');fs.writeFileSync(entry+'/references.md','依据指定原始材料。');fs.writeFileSync('writing-result.json',JSON.stringify({schemaVersion:1,kind:'draft',entry,coverage:i.sources.map(s=>({sourceId:s.id,status:'read',files:s.files.map(f=>f.id)}))}));process.stdin.resume();`);
 await processTask({...node,dataDir:path.join(f.root,'worker'),agents:{codex:{command:process.execPath,args:[fake]}}},task,{codex:{available:true}},undefined);s=await f.session(s.id);assert.equal(s.status,'awaiting_review');
 const draft=(await f.request(`/api/writing/sessions/${s.id}/drafts/${task.id}`)).value;assert.match(draft.article,/原始材料/);assert.ok(draft.files.some(f=>f.path==='writing-provenance.txt'));assert.equal((await f.app.store.list('archive')).length,0);
 const oldStyle=s.style.id;await f.change(s,'style',{candidateId:s.styleCandidates[0].id,ruleIds:['r1']});s=await f.session(s.id);assert.notEqual(s.style.id,oldStyle);assert.equal(s.ready,false);assert.equal(s.runs.at(-1).mode,'round');assert.equal((await f.change(s,'revise',{scope:'local',message:'直接使用新风格'})).status,409);
});


test('writing round routing, owner boundaries, stable creation, full material reading and immutable record snapshot',async t=>{
 const f=await fixture(t),recordId=crypto.randomUUID();await f.request('/api/records/'+recordId,'PUT',{requestId:crypto.randomUUID(),baseVersion:0,text:'第一版材料',attachments:[],createdAt:new Date().toISOString()});
 const input={requestId:crypto.randomUUID(),sources:[{kind:'record',role:'material',id:recordId,version:1}]};const a=await f.request('/api/writing/sessions','POST',input),b=await f.request('/api/writing/sessions','POST',input);assert.deepEqual(a.value,b.value);
 await f.request('/api/records/'+recordId,'PUT',{requestId:crypto.randomUUID(),baseVersion:1,text:'第二版材料',attachments:[]});
 const old=await f.worker(0);assert.equal(await f.claim(old),null);assert.equal((await f.request('/api/writing/sessions','GET',undefined,old)).status,403);
 const node=await f.worker(),task=await f.claim(node);assert.equal(task.writingSnapshot.sources[0].text,'第一版材料');assert.equal((await f.request(`/api/writing/tasks/${task.id}/result`,'POST',{},node,'stale')).status,409);
 const result=round({...task,writingSnapshot:{...task.writingSnapshot,sources:[...task.writingSnapshot.sources,{id:'unused',role:'exemplar',files:[]}]}});delete result.styleCandidate;result.coverage.pop();
 result.coverage=[];assert.equal((await f.submit(task,node,result)).status,400);
 result.coverage=task.writingSnapshot.sources.map(s=>({sourceId:s.id,status:'read',files:[]}));assert.equal((await f.submit(task,node,result)).status,200);assert.equal((await f.submit(task,node,result)).status,200);
 const s=await f.session(a.value.id);assert.equal(s.status,'awaiting_answers');assert.equal(s.rounds.length,1);assert.equal((await f.request('/api/state')).value.archives.length,0);
});
test('answer rounds persist, reject repeated decided questions and require explicit start plus confirmed style',async t=>{
 const f=await fixture(t),created=await f.create(),node=await f.worker(),task=await f.claim(node);assert.equal((await f.submit(task,node,round(task))).status,200);
 let s=await f.session(created.id);assert.equal((await f.change(s,'start',{planVersion:0,styleVersion:null})).status,409);
 const answered=await f.change(s,'answers',{roundId:s.rounds.at(-1).id,answers:[{questionId:'q1',selected:['practice']},{questionId:'q2',text:'接口失败后，通过完整正文校验继续采集。'}]});assert.equal(answered.status,200);
 assert.equal((await f.change(s,'discuss',{message:'过期修改'})).status,409);
 const next=await f.claim(node);assert.equal(next.writingSnapshot.answers[0].labels[0],'实践复盘');assert.equal((await f.submit(next,node,round(next))).status,400);
 assert.equal((await f.submit(next,node,round(next,true))).status,200);s=await f.session(created.id);assert.equal(s.status,'awaiting_style');assert.equal(s.runs.length,2);
 const candidate=s.styleCandidates.at(-1);assert.equal((await f.change(s,'style',{candidateId:candidate.id,ruleIds:['r1']})).status,200);s=await f.session(s.id);assert.equal(s.status,'ready');
 assert.equal((await f.change(s,'start',{planVersion:s.planVersion,styleVersion:'stale'})).status,409);
 assert.equal((await f.change(s,'start',{planVersion:s.planVersion,styleVersion:s.style.id})).status,200);const writing=await f.claim(node);assert.equal(writing.writingMode,'draft');assert.equal(writing.writingSnapshot.planVersion,1);assert.equal(writing.writingSnapshot.style.id,s.style.id);
 const original=writing.writingSnapshot.sources[0].text;s=await f.session(s.id);await f.change(s,'materials',{sources:[{kind:'text',role:'material',text:'后来发现新的失败案例'}]});assert.equal((await f.app.store.get('task',writing.id)).state,'cancelled');assert.equal(writing.writingSnapshot.sources[0].text,original);assert.equal((await f.session(s.id)).sources.length,3);
});
test('worker completes one round then releases the task without producing or archiving an article',async t=>{
 const f=await fixture(t),created=await f.create(),node=await f.worker(),task=await f.claim(node);
 const fake=path.join(f.root,'fake-agent.mjs');fs.writeFileSync(fake,`import fs from 'node:fs';const input=JSON.parse(fs.readFileSync('writing-input.json','utf8'));const task={writingSnapshot:input};const round=${round.toString()};fs.writeFileSync('writing-result.json',JSON.stringify(round(task)));process.stdin.resume();`);
 await processTask({...node,dataDir:path.join(f.root,'worker'),agents:{codex:{command:process.execPath,args:[fake]}}},task,{codex:{available:true}},undefined);
 const s=await f.session(created.id);assert.equal(s.status,'awaiting_answers');assert.equal((await f.app.store.get('task',task.id)).state,'completed');assert.equal((await f.app.store.list('archive')).length,0);assert.equal(await f.claim(node),null);
 assert.ok(fs.existsSync(path.join(f.root,'worker','tasks',task.id,'library','writing-input.json')));
});
test('draft publish is gated, review and local revision retain linkage and original style version',async t=>{
 const f=await fixture(t),created=await f.create(),node=await f.worker(),first=await f.claim(node);await f.submit(first,node,round(first,true));let s=await f.session(created.id);
 await f.change(s,'style',{candidateId:s.styleCandidates[0].id,ruleIds:['r1']});s=await f.session(s.id);await f.change(s,'start',{planVersion:s.planVersion,styleVersion:s.style.id});const task=await f.claim(node);
 const makeFile=(name,role,content)=>{const bytes=Buffer.from(content);return {path:name,role,body:bytes.toString('base64'),bytes:bytes.length,sha256:hash(bytes)};};
 const files=[makeFile('article.md','publication','# 实践文章\n\n一个真实的问题。'),makeFile('summary.md','summary','原始材料的摘要。'),makeFile('references.md','reference','依据个人记录，未外推量化成效。')];
 const meta={schema_version:1,id:'note:writing-'+task.id,title:'实践文章',summary:'具体实践及其适用条件',coverage_note:'已读取全部材料及范文',type:'note',status:'archived',verification_status:'source_only',mode:'general',scenario:null,tags:[],aliases:[],related:[],published_at:null,collected_at:new Date().toISOString(),organized_at:'2026-10-16',verified_at:null,source_url:null,canonical_url:null,files:files.map(({path,role})=>({path,role}))};
 const response=await f.request(`/api/writing/tasks/${task.id}/result`,'POST',{kind:'draft',skillHash:task.writingSnapshot.skill.hash,coverage:task.writingSnapshot.sources.map(s=>({sourceId:s.id,status:'read',files:[]})),bundle:{version:1,meta,files}},node,task.assignmentId);assert.equal(response.status,200);
 s=await f.session(s.id);assert.equal(s.status,'awaiting_review');const draft=await f.request(`/api/writing/sessions/${s.id}/drafts/${task.id}`);assert.match(draft.value.article,/真实的问题/);assert.equal((await f.app.store.list('archive')).length,0);
 assert.equal((await f.request(`/api/tasks/${task.id}/approve`,'POST',{})).status,200);assert.equal((await f.session(s.id)).status,'archived');
 assert.equal((await f.change(s,'revise',{scope:'local',message:'把开头改得更简洁'})).status,200);const revision=await f.claim(node);assert.equal(revision.writingMode,'revision');assert.equal(revision.writingSnapshot.style.id,s.style.id);assert.ok(revision.writingSnapshot.sources.some(s=>s.role==='previous'));
 const previous=revision.writingSnapshot.sources.find(s=>s.role==='previous').files[0];const file=await f.request(`/api/writing/tasks/${revision.id}/files/${previous.id}`,'GET',undefined,node,revision.assignmentId);assert.equal(hash(file.value),previous.sha256);
 const revisionRound=round(revision);assert.equal((await f.submit(revision,node,revisionRound)).status,200);assert.equal((await f.session(s.id)).status,'awaiting_answers');assert.equal((await f.app.store.list('archive')).length,1);
});

test('JSON originals cross the desktop bridge as exact bytes and API errors remain structured',async()=>{
 const sid=crypto.randomUUID(),fid=crypto.randomUUID(),raw=' { "steps": [1, 2] }\n',owner={identity:{server:'https://library.invalid',deviceId:'owner',token:'test'},fetcher:async()=>new Response(raw,{headers:{'Content-Type':'application/json'}})};
 const file=await captureRequest(owner,{route:`/api/writing/sessions/${sid}/files/${fid}`});assert.equal(Buffer.from(file.bytes,'base64').toString(),raw);assert.equal(file.json,undefined);
 owner.fetcher=async()=>new Response('{"error":"not found"}',{status:404,headers:{'Content-Type':'application/json'}});assert.equal((await captureRequest(owner,{route:`/api/writing/sessions/${sid}/files/${fid}`})).json.error,'not found');
});
