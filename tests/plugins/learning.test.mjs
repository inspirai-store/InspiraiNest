import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createService} from '../../services/api/server.mjs';
import {pathNodes,recommendation,validateResult} from '../../plugins/learning/protocol/model.mjs';
import {starterGoal,starterOverview} from '../../plugins/learning/protocol/starter.mjs';
import {teachingPacket,demoDocument} from '../../plugins/learning/protocol/handoff.mjs';
import {LearningClient} from '../../plugins/learning/web/client.ts';
import {createLearning} from '../../plugins/learning/server/learning.mjs';
import {canRunTask} from '../../packages/core/node/task-routing.mjs';

async function fixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nest-learning-')),key='learning-test-key-'.repeat(4),app=createService({dataDir:dir,masterKey:key,...options});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+app.server.address().port;
 const pair=await fetch(origin+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,name:'learning-owner'})}).then(r=>r.json());
 async function request(route,input,method=input===undefined?'GET':'POST',token=pair.token,assignment){
  const response=await fetch(origin+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':Buffer.isBuffer(input)?'application/octet-stream':'application/json',...(assignment?{'X-Task-Assignment':assignment}:{})},body:input===undefined?undefined:Buffer.isBuffer(input)?input:JSON.stringify(input)});
  return {status:response.status,body:await response.json()};
 }
 async function toggle(id,enabled){const config=(await request('/api/plugins')).body;return request('/api/plugins/'+id,{enabled,revision:config.revision},'PUT');}
 async function assignedTask(id){const code=(await request('/api/pairings',{role:'worker'})).body;const worker=await fetch(origin+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:code.key,name:'learning-worker'})}).then(r=>r.json());const task=await app.store.get('task',id),assignment=randomUUID();await app.store.put('task',{...task,deviceId:worker.device.id,assignmentId:assignment,state:'running'});return input=>request('/api/learning/runs/'+id+'/result',input,'POST',worker.token,assignment);}
 await toggle('learning',true);
 return {app,request,toggle,assignedTask,origin};
}
async function createGoal(request){const g=(await request('/api/learning/goals',starterGoal())).body;return (await request('/api/learning/goals/'+g.id+'/edit',{revision:g.revision,nodes:starterGoal().nodes})).body;}

test('existing built-in outlines become full lessons once, preserving user content and study records',async t=>{
 const {app,request,assignedTask}=await fixture(t),overview=starterOverview();
 let g=(await request('/api/learning/goals',overview)).body;
 g=(await request('/api/learning/goals/'+g.id+'/edit',{revision:g.revision,nodes:overview.nodes})).body;
 g=(await request('/api/learning/goals/'+g.id+'/progress',{revision:g.revision,nodeId:'kv-cache',notes:'我的缓存理解',mastery:'mastered'})).body;
 g=(await request('/api/learning/goals/'+g.id+'/edit',{revision:g.revision,nodes:g.nodes.map(n=>n.id==='compiler'?{...n,explanation:'自己改过的编译器内容'}:n)})).body;
 const job=(await request('/api/learning/goals/'+g.id+'/assist',{revision:g.revision,operation:'lesson',nodeId:'kv-cache'})).body,submit=await assignedTask(job.id);
 const prior=structuredClone(g),detail=(await request('/api/learning/goals/'+g.id)).body,kv=detail.nodes.find(n=>n.id==='kv-cache');
 assert.equal(detail.revision,prior.revision+1);assert.equal(detail.nodes.length,15);assert.equal(new Set(detail.nodes.map(n=>n.stage)).size,7);
 assert.match(kv.explanation,/一个不依赖框架的单头计算/);assert.equal(kv.contentRevision,prior.nodes.find(n=>n.id==='kv-cache').contentRevision+1);
 assert.equal(kv.notes,'我的缓存理解');assert.equal(kv.mastery,'mastered');assert.equal(kv.progressRevision,prior.nodes.find(n=>n.id==='kv-cache').progressRevision);
 assert.equal(detail.nodes.find(n=>n.id==='compiler').explanation,'自己改过的编译器内容');
 assert.deepEqual(detail.sources,prior.sources);assert.deepEqual(detail.nodes.map(n=>n.dependsOn),prior.nodes.map(n=>n.dependsOn));
 const history=(await app.store.list('learning-run')).find(r=>r.id.startsWith('curriculum-'));
 assert.equal(history.previousNodes.find(n=>n.id==='kv-cache').explanation,overview.nodes.find(n=>n.id==='kv-cache').explanation);
 assert.equal((await request('/api/learning/goals/'+g.id)).body.revision,detail.revision);
 assert.equal((await submit({protocol:1,nodes:[prior.nodes.find(n=>n.id==='kv-cache')]})).status,200);
 assert.equal((await request('/api/learning/goals/'+g.id)).body.runs.find(r=>r.id===job.id).state,'stale');
});

test('personal practice saves without a Worker; AI feedback is explicitly requested and never controls progress',async t=>{
 const {app,request}=await fixture(t);const g=await createGoal(request),route='/api/learning/goals/'+g.id;
 const input={revision:g.revision,nodeId:'kv-cache',requestId:randomUUID(),question:'缓存保存了什么？',answer:'我先记录自己的理解',feedback:false};
 const a=(await request(route+'/attempts',input)).body;
 assert.equal((await request(route+'/attempts',input)).body.id,a.id);
 assert.equal((await app.store.list('task')).length,0);assert.equal((await request(route)).body.nodes.find(n=>n.id==='kv-cache').mastery,'pending');
 const first=await request(route+'/feedback',{revision:g.revision,attemptId:a.id}),again=await request(route+'/feedback',{revision:g.revision,attemptId:a.id});
 assert.equal(first.status,200);assert.equal(first.body.id,again.body.id);assert.equal((await app.store.list('task')).length,1);
 assert.equal((await request(route+'/feedback',{revision:g.revision,attemptId:randomUUID()})).status,404);
 assert.equal((await request(route)).body.nodes.find(n=>n.id==='kv-cache').mastery,'pending');
});

test('candidate intake saves originals first, retains provenance, deduplicates and requires confirmation',async t=>{
 const {app,request}=await fixture(t),input={requestId:randomUUID(),text:'  私密职位要求：理解 KV Cache 与集合通信。\n原始缩进与结尾保留。  ',title:'AI 系统能力',manual:true};
 const a=await request('/api/learning/intake',input),b=await request('/api/learning/intake',input);assert.equal(a.status,200);assert.equal(a.body.id,b.body.id);
 assert.equal((await request('/api/learning')).body.goals.length,0);
 const raw=await app.store.get('capture',a.body.sources[0].sourceId);assert.equal(raw.text,input.text);assert.equal(a.body.sources[0].coverage,'full');
 const confirmed=await request('/api/learning/candidates/'+a.body.id,{revision:1,action:'confirm',foundation:'软件工程基础'});assert.equal(confirmed.status,200);
 const g=(await request('/api/learning/goals/'+confirmed.body.goalId)).body;assert.equal(g.foundation,'软件工程基础');assert.equal(g.sources[0].sourceId,raw.id);
 assert.equal((await request('/api/learning/candidates/'+a.body.id,{revision:1,action:'confirm'})).status,409);
});
test('enabling learning and listing source versions never download archived payloads',async t=>{
 let downloads=0;
 const {app,request,toggle}=await fixture(t,{storage:{async get(){downloads++;throw Error('unexpected archive download');}}});
 await toggle('learning',false);await app.store.delete('learning-setting','intake');
 for(const [id,entryId,createdAt] of [['older','entry','2026-01-01'],['latest','entry','2026-01-02'],['deleted','removed','2026-01-03']])await app.store.put('archive',{id,entryId,key:id,createdAt,meta:{title:entryId,status:'archived'}});
 await app.store.put('trash',{id:'removed',deletedAt:'2026-01-04'});
 await app.store.put('capture',{id:'record',version:1,text:'旧记录正文',sourceUrl:'https://example.org/record'});
 assert.equal((await toggle('learning',true)).status,200);
 const sources=(await request('/api/learning/sources')).body.items;
 assert.deepEqual(sources.map(s=>[s.kind,s.sourceId,s.version]).sort(),[['entry','entry','latest'],['record','record','1']]);
 assert.equal(sources.find(s=>s.kind==='record').url,'https://example.org/record');
 assert.equal(sources.find(s=>s.kind==='entry').coverage,'partial');
 assert.equal((await app.store.list('learning-seen')).length,2);assert.equal(downloads,0);
 const start=(await app.store.get('learning-setting','intake')).startedAt;
 await app.store.put('capture',{id:'new-record',version:1,text:'停用后新增记录'});
 await toggle('learning',false);await toggle('learning',true);
 assert.equal((await app.store.get('learning-setting','intake')).startedAt,start);
 assert.equal((await app.store.list('learning-seen')).length,2,'re-enabling must not mark new source versions as already seen');
 assert.equal(downloads,0);
});
test('incremental intake resolves only unseen source payloads outside the write transaction',async()=>{
 const rows=new Map(),store={async get(k,id){return structuredClone(rows.get(k+':'+id)||null);},async getForUpdate(k,id){return this.get(k,id);},async list(k){return [...rows.entries()].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v));},async put(k,v){rows.set(k+':'+v.id,structuredClone(v));return v;},async transaction(fn){assert.equal(inTransaction,false);inTransaction=true;try{return await fn(this);}finally{inTransaction=false;}}};
 let inTransaction=false,index=Array.from({length:234},(_,i)=>({kind:'entry',sourceId:'old-'+i,version:'v1',title:'已有资料',coverage:'partial'}));
 const requests=[];
 const learning=createLearning({store,plugins:{enabled:async()=>true,assertEnabled:async()=>{}},readSourceIndex:async()=>index,readSources:async keys=>{assert.equal(inTransaction,false);requests.push(keys);return index.filter(s=>keys.includes(`${s.kind}:${s.sourceId}:${s.version}`)).map(s=>({...s,text:'新资料正文'}));},saveTask:async(task,state,_message,tx)=>tx.put('task',{...task,state})});
 await learning.initialize();await learning.scan();assert.deepEqual(requests,[]);
 index=[...index,{kind:'record',sourceId:'new',version:'1',title:'新资料',coverage:'full'}];
 await learning.initialize();await learning.scan();await learning.scan();
 assert.deepEqual(requests,[['record:new:1']]);assert.equal((await store.list('task')).length,1);
 assert.equal((await store.list('task'))[0].learningSnapshot.sources[0].text,'新资料正文');
});
test('path edits preserve notes and mastery, reject cycles, and retain removed node history',async t=>{
 const {request}=await fixture(t);let g=await createGoal(request);const kv=g.nodes.find(n=>n.id==='kv-cache');
 g=(await request('/api/learning/goals/'+g.id+'/progress',{revision:g.revision,nodeId:kv.id,notes:'我自己的解释',mastery:'mastered'})).body;
 const changed=g.nodes.map(n=>({...n,title:n.id===kv.id?'KV Cache 与容量估算':n.title}));
 g=(await request('/api/learning/goals/'+g.id+'/edit',{revision:g.revision,nodes:changed})).body;
 assert.equal(g.nodes.find(n=>n.id===kv.id).notes,'我自己的解释');assert.equal(g.nodes.find(n=>n.id===kv.id).mastery,'mastered');
 const cyclic=structuredClone(g.nodes);cyclic[0].dependsOn=[cyclic[0].id];assert.equal((await request('/api/learning/goals/'+g.id+'/edit',{revision:g.revision,nodes:cyclic})).status,400);
 const before=g.nodes[0].contentRevision;g=(await request('/api/learning/goals/'+g.id+'/edit',{revision:g.revision,nodes:g.nodes})).body;assert.equal(g.nodes[0].contentRevision,before);
 const last=g.nodes.at(-1);g=(await request('/api/learning/goals/'+g.id+'/edit',{revision:g.revision,nodes:g.nodes.slice(0,-1)})).body;assert.ok(g.retiredNodes.some(n=>n.id===last.id));
 assert.equal(recommendation(g),'tensors');
});
test('URL-only inputs save originals and wait for source extraction before suggesting learning content',async t=>{
 const {app,request}=await fixture(t);const result=await request('/api/learning/intake',{requestId:randomUUID(),title:'待读取文章',text:'https://example.org/guide'});
 assert.equal(result.status,200);assert.equal(result.body.state,'awaiting_content');assert.ok(result.body.sourceTaskId);
 assert.equal((await request('/api/learning')).body.candidates.length,0);
 const task=await app.store.get('task',result.body.sourceTaskId);assert.equal(task.purpose,'learning-source');assert.ok((await app.store.get('capture',task.recordId)).text.includes('https://example.org/guide'));
});
test('AI results remain proposals and late results cannot overwrite edited progress',async t=>{
 const {request,assignedTask}=await fixture(t);let g=await createGoal(request);
 const job=(await request('/api/learning/goals/'+g.id+'/assist',{revision:g.revision,operation:'lesson',nodeId:'kv-cache'})).body;
 const submit=await assignedTask(job.id);g=(await request('/api/learning/goals/'+g.id+'/progress',{revision:g.revision,nodeId:'kv-cache',notes:'编辑期间的笔记'})).body;
 g=(await request('/api/learning/goals/'+g.id+'/edit',{revision:g.revision,nodes:g.nodes.map(n=>n.id==='kv-cache'?{...n,explanation:n.explanation+'\n更新的讲解'}:n)})).body;
 const result={protocol:1,nodes:[g.nodes.find(n=>n.id==='kv-cache')],researchSources:[]};assert.equal((await submit(result)).status,200);assert.equal((await submit(result)).status,200);
 const detail=(await request('/api/learning/goals/'+g.id)).body;assert.equal(detail.runs[0].state,'stale');assert.equal(detail.nodes.find(n=>n.id==='kv-cache').notes,'编辑期间的笔记');
 assert.equal((await request('/api/learning/goals/'+g.id+'/apply',{revision:g.revision,runId:job.id})).status,409);
});
test('practice feedback never sets mastery; stale goal writes are rejected',async t=>{
 const {app,request,assignedTask}=await fixture(t);let g=await createGoal(request);
 const input={revision:g.revision,nodeId:'kv-cache',requestId:randomUUID(),question:'KV 保存什么？',answer:'保存 Key 和 Value'};
 const attempt=await request('/api/learning/goals/'+g.id+'/attempts',input);assert.equal(attempt.status,200);assert.equal((await request('/api/learning/goals/'+g.id+'/attempts',input)).body.id,attempt.body.id);
 const job=(await app.store.list('task')).find(t=>t.learningSnapshot?.operation==='feedback');const submit=await assignedTask(job.id);assert.equal((await submit({protocol:1,feedback:'概念正确，请进一步解释历史读取成本。'})).status,200);
 const detail=(await request('/api/learning/goals/'+g.id)).body;assert.match(detail.attempts[0].feedback,/概念正确/);assert.equal(detail.nodes.find(n=>n.id==='kv-cache').mastery,'pending');
 g=(await request('/api/learning/goals/'+g.id+'/progress',{revision:g.revision,nodeId:'kv-cache',mastery:'learning'})).body;
 assert.equal((await request('/api/learning/goals/'+g.id+'/progress',{revision:g.revision-1,nodeId:'kv-cache',mastery:'mastered'})).status,409);
});
test('review applies content over new progress without losing notes, and superseded proposals become history',async t=>{
 const {request,assignedTask}=await fixture(t);let g=await createGoal(request);
 const job=(await request('/api/learning/goals/'+g.id+'/assist',{revision:g.revision,operation:'lesson',nodeId:'kv-cache'})).body,submit=await assignedTask(job.id);
 const node=g.nodes.find(n=>n.id==='kv-cache');assert.equal((await submit({protocol:1,nodes:[{...node,explanation:node.explanation+'\n补充一个例子。'}],researchSources:[]})).status,200);
 g=(await request('/api/learning/goals/'+g.id+'/progress',{revision:g.revision,nodeId:node.id,notes:'待审期间保存的笔记'})).body;
 g=(await request('/api/learning/goals/'+g.id+'/apply',{revision:g.revision,runId:job.id})).body;assert.equal(g.nodes.find(n=>n.id===node.id).notes,'待审期间保存的笔记');assert.ok(g.nodes.find(n=>n.id===node.id).explanation.includes('补充一个例子'));
});
test('teaching packets freeze versions, import verified core media and survive plugin disable',async t=>{
 const {request,toggle}=await fixture(t);const g=await createGoal(request);
 const packet=(await request('/api/learning/goals/'+g.id+'/teaching',{revision:g.revision,nodeIds:['kv-cache'],format:'web',sourceKeys:[]})).body;
 assert.ok(packet.files.some(f=>f.name==='TASK.md'&&f.text.includes('验收标准')));assert.ok(packet.files.some(f=>f.name==='learning-handoff.json'));assert.equal(packet.nodes[0].id,'kv-cache');
 const bytes=Buffer.from('<button>改变上下文长度</button>'),sha=createHash('sha256').update(bytes).digest('hex');
 assert.equal((await request('/api/records/media/'+sha,bytes,'PUT')).status,200);
 const artifactInput={revision:g.revision,handoffId:packet.id,nodeId:'kv-cache',sha256:'0'.repeat(64),title:'demo.html',kind:'web'};
 assert.equal((await request('/api/learning/goals/'+g.id+'/artifacts',artifactInput)).status,404);
 artifactInput.sha256=sha;
 const imported=await request('/api/learning/goals/'+g.id+'/artifacts',artifactInput);assert.equal(imported.status,200,JSON.stringify(imported.body));
 assert.equal((await request('/api/learning/goals/'+g.id+'/artifacts',artifactInput)).body.id,imported.body.id);
 assert.equal((await request('/api/learning/artifacts/'+imported.body.id)).body.bytes,bytes.toString('base64'));
 const second=(await request('/api/learning/goals/'+g.id+'/teaching',{revision:g.revision,nodeIds:['kv-cache'],format:'web',sourceKeys:[]})).body;assert.equal(second.id,packet.id);
 assert.equal((await toggle('learning',false)).status,200);assert.equal((await request('/api/learning/goals/'+g.id)).status,200);assert.equal((await request('/api/learning/goals/'+g.id+'/progress',{revision:g.revision,nodeId:'kv-cache',mastery:'mastered'})).body.code,'plugin_disabled');
});
test('blog handoff creates one draft and excludes unselected private sources',async t=>{
 const {app,request,toggle}=await fixture(t);const g=await createGoal(request);
 g.sources.push({kind:'record',sourceId:'private',version:'1',text:'PRIVATE-JD-DO-NOT-PUBLISH',title:'内部 JD'});await app.store.put('learning-goal',g);
 assert.equal((await request('/api/learning/goals/'+g.id+'/writing',{revision:g.revision,nodeIds:['kv-cache']})).status,409);await toggle('writing',true);
 const input={revision:g.revision,nodeIds:['kv-cache'],includeNotes:false};const a=await request('/api/learning/goals/'+g.id+'/writing',input),b=await request('/api/learning/goals/'+g.id+'/writing',input);assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(a.body.id,b.body.id);
 const jobs=(await app.store.list('task')).filter(t=>t.writingSessionId===a.body.id);assert.equal(jobs.length,1);assert.equal(jobs[0].writingMode,'draft');assert.ok(!JSON.stringify(jobs[0].writingSnapshot).includes('PRIVATE-JD-DO-NOT-PUBLISH'));
});
test('frontier proposals reference retrieved source text, persist core originals and require review',async t=>{
 const {request,assignedTask,app}=await fixture(t);let g=await createGoal(request);
 const job=(await request('/api/learning/goals/'+g.id+'/assist',{revision:g.revision,operation:'frontier'})).body,submit=await assignedTask(job.id);
 const source={kind:'research',sourceId:'https://docs.example.org/release',version:'1',url:'https://docs.example.org/release',title:'官方版本说明',text:'此版本增加了分块执行能力。'};
 const result={protocol:1,researchSources:[source],summary:'补充新的执行方法',nodes:[{id:'frontier-new',stage:'前沿延伸',title:'分块执行',dependsOn:['scheduler'],objectives:['理解适用条件'],explanation:'来源说明了新增能力。',citations:[{...source,quote:'增加了分块执行能力'}],recall:['改变了哪个执行阶段？'],exercises:['列出比较条件']}]};
 const response=await submit(result);assert.equal(response.status,200,JSON.stringify(response.body));assert.equal((await submit(result)).status,200);
 let d=(await request('/api/learning/goals/'+g.id)).body;assert.ok(!d.nodes.some(n=>n.id==='frontier-new'));const run=d.runs.find(r=>r.id===job.id);assert.equal(run.result.researchSources[0].kind,'record');assert.ok(await app.store.get('capture',run.result.researchSources[0].sourceId));
 g=(await request('/api/learning/goals/'+g.id+'/apply',{revision:d.revision,runId:job.id})).body;assert.ok(g.nodes.some(n=>n.id==='frontier-new'));assert.equal(g.nodes.find(n=>n.id==='kv-cache').mastery,'pending');
});
test('automatic intake starts with new sources, deduplicates scans and stops while disabled',async()=>{
 const rows=new Map(),store={async get(k,id){return structuredClone(rows.get(k+':'+id)||null);},async getForUpdate(k,id){return this.get(k,id);},async list(k){return [...rows.entries()].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v));},async put(k,v){rows.set(k+':'+v.id,structuredClone(v));return v;},async transaction(fn){return fn(this);}};
 let enabled=true,sources=[{kind:'record',sourceId:'r',version:'1',title:'旧资料',text:'旧正文',coverage:'full'}];
 const learning=createLearning({store,plugins:{enabled:async()=>enabled,assertEnabled:async()=>{}},readSources:async()=>sources,saveTask:async(t,state,_m,tx)=>tx.put('task',{...t,state})});
 await learning.scan();assert.equal((await store.list('task')).length,0);sources=[...sources,{...sources[0],sourceId:'new',text:'新正文'}];await learning.scan();await learning.scan();assert.equal((await store.list('task')).length,1);
 enabled=false;sources.push({...sources[0],sourceId:'disabled'});await learning.scan();assert.equal((await store.list('task')).length,1);
});
test('source validation rejects invented quotations and browser requests are fenced by identity',async()=>{
 const source={kind:'record',sourceId:'r',version:'1',text:'缓存保存历史 KV',coverage:'partial',title:'材料'};
 assert.throws(()=>validateResult({protocol:1,candidates:[{title:'KV',reason:'学习',expectedAbility:'解释缓存',citations:[{...source,quote:'虚构内容'}]}]},{operation:'extract',sources:[source]}),/来源正文/);
 const current={paired:true,server:'https://one.invalid',deviceId:'a'};let status=current;const client=new LearningClient({status:async()=>status,capture:async()=>{status={...current,deviceId:'b'};return {status:200,json:{private:'old'}};}});await assert.rejects(client.request('/api/learning'),/切换/);
 const html=demoDocument('<script>fetch("https://example.com")</script>');assert.match(html,/connect-src 'none'/);assert.match(html,/base-uri 'none'/);
 const g={...starterGoal(),id:'g',revision:1,nodes:pathNodes(starterGoal().nodes)};const packet=teachingPacket(g,['kv-cache'],'web',[]);assert.equal(packet.sources.length,0);assert.equal(packet.nodes[0].mastery,'pending');
 assert.equal(canRunTask({type:'note',pluginId:'learning'},{role:'worker',clientType:'worker',agents:['codex'],capabilities:['note'],learningProtocol:0}),false);
});

test('selected records keep the original source link in reads and frozen AI inputs',async t=>{
 const {app,request}=await fixture(t),url='https://example.org/guide?v=2#kv-cache';
 const intake=(await request('/api/learning/intake',{requestId:randomUUID(),title:'学习来源链接',text:'已读取的 KV Cache 材料',url,manual:true})).body;
 const source=(await request('/api/learning/sources')).body.items.find(s=>s.sourceId===intake.sources[0].sourceId);assert.equal(source.url,url);
 const candidate=(await request('/api/learning/candidates/'+intake.id,{revision:1,action:'confirm'})).body;
 const g=(await request('/api/learning/goals/'+candidate.goalId)).body;const queued=(await request('/api/learning/goals/'+g.id+'/assist',{revision:g.revision,operation:'path'})).body;
 const task=await app.store.get('task',queued.id);assert.equal(task.learningSnapshot.sources[0].url,url);
});
