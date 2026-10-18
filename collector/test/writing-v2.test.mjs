import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,round} from './writing-fixture.mjs';
import {roundV2,v2Worker} from './writing-v2-fixture.mjs';
import {writingCapabilities,skillForVersion} from '../../plugins/writing/protocol/writing-protocol.mjs';
import {validateCaptureRequest} from '../../packages/core/node/capture-request.mjs';
import {processTask} from '../../services/worker/worker.mjs';
import {createService} from '../../services/api/server.mjs';

const create=f=>f.create({protocolVersion:2,brief:'连续学习、连续思考',sources:[]});
test('brief alone is durable intent, uses builtin rules and routes only to a matching Worker',async t=>{
 const f=await fixture(t),created=await create(f),old=await f.worker();assert.equal(await f.claim(old),null);
 const node=await v2Worker(f);await f.request('/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],writingProtocol:1,writingSkills:[{version:2,hash:'0'.repeat(64)}]},node);assert.equal(await f.claim(node),null);
 const bad=await f.request('/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],writingSkills:[{version:2,hash:'x'}]},node);assert.equal(bad.status,400);
 await f.request('/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],writingProtocol:1,writingSkills:writingCapabilities()},node);
 const task=await f.claim(node);assert.equal(task.writingSnapshot.brief,'连续学习、连续思考');assert.deepEqual(task.writingSnapshot.sources,[]);assert.equal(task.writingSnapshot.style.origin,'builtin');
 assert.equal((await f.submit(task,node,roundV2(task))).status,200);const s=await f.session(created.id);assert.equal(s.title,'让学习进入下一次思考');assert.equal(s.plan,null);assert.ok(s.workingPlan.outline.length);assert.deepEqual(s.answers,[]);assert.equal((await f.change(s,'start',{})).status,409);
 assert.equal((await f.create({protocolVersion:2,brief:'',sources:[]})).id,undefined);
});
test('partial choices and a correction share one idempotent turn; missing answers never become decisions',async t=>{
 const f=await fixture(t),created=await create(f),node=await v2Worker(f),task=await f.claim(node);await f.submit(task,node,roundV2(task));const s=await f.session(created.id),roundId=s.rounds[0].id;
 const input={requestId:crypto.randomUUID(),baseVersion:s.version,roundId,answers:[{questionId:'q1',selected:['loop'],text:'',uncertain:false}],message:'不写我的个人经历，先解释应用反馈。'};
 const a=await f.request(`/api/writing/sessions/${s.id}/turns`,'POST',input),b=await f.request(`/api/writing/sessions/${s.id}/turns`,'POST',input);assert.equal(a.status,200);assert.deepEqual(a.value,b.value);
 const current=await f.session(s.id);assert.equal(current.turns.length,1);assert.equal(current.turns[0].message,input.message);assert.equal(current.answers.length,1);assert.ok(current.rounds[0].supersededAt);assert.equal(current.answers.some(a=>a.questionId==='q2'),false);
 assert.equal((await f.change(s,'turns',{message:'另一设备过期修改'})).status,409);assert.equal((await f.change(current,'answers',{roundId,answers:[]})).status,409);
 const next=await f.claim(node);assert.equal(next.writingSnapshot.turns[0].message,input.message);assert.equal(next.writingSnapshot.answers[0].labels[0],'学习与应用的循环');assert.equal((await f.submit(next,node,roundV2(next))).status,200);
 const history=(await f.request(`/api/writing/sessions/${s.id}/history`)).value.items;assert.equal(history[0].workingPlan,null);assert.ok(history.at(-1).workingPlan);assert.equal(task.writingSnapshot.turns.length,0);
});
test('ready agreement can draft without exemplar, with frozen plan and exact default rules; no automatic draft',async t=>{
 const f=await fixture(t),created=await create(f),node=await v2Worker(f),task=await f.claim(node);await f.submit(task,node,roundV2(task,true));let s=await f.session(created.id);
 assert.equal(s.status,'ready');assert.equal(await f.claim(node),null);assert.equal((await f.app.store.list('draft')).length,0);
 assert.equal((await f.change(s,'start',{planVersion:s.planVersion,styleVersion:s.style.id})).status,200);const draft=await f.claim(node);assert.equal(draft.writingMode,'draft');assert.equal(draft.writingSnapshot.style.id,'builtin-editorial-v1');assert.equal(draft.writingSnapshot.style.version,1);assert.deepEqual(draft.writingSnapshot.sources,[]);
 s=await f.session(s.id);await f.change(s,'turns',{message:'换成个人复盘，先重新讨论'});assert.equal((await f.app.store.get('task',draft.id)).state,'cancelled');assert.equal(draft.writingSnapshot.plan.thesis,'通过应用和反馈连接持续学习与思考');assert.equal((await f.session(s.id)).ready,false);
});
test('v2 result validation rejects malformed recommendations, missing outline and premature sample prose',async t=>{
 const f=await fixture(t);await create(f);const node=await v2Worker(f),task=await f.claim(node);
 for(const change of [r=>r.questions[0].recommendedOptionId='unknown',r=>delete r.workingPlan,r=>r.schemaVersion=1,r=>r.styleCandidate={name:'假风格',appliesTo:'所有文章',sample:'一段未经授权的试写',rules:[]}]){const result=roundV2(task);change(result);assert.equal((await f.submit(task,node,result)).status,400);}
 assert.equal((await f.submit(task,node,roundV2(task))).status,200);
});
test('new Worker executes a frozen v1 task then promotes the old conversation through turns',async t=>{
 const f=await fixture(t),created=await f.create(),node=await v2Worker(f),old=await f.claim(node);assert.equal(old.writingSnapshot.skill.version,1);assert.equal(old.writingSnapshot.skill.hash,skillForVersion(1).hash);await f.submit(old,node,round(old));let s=await f.session(created.id);
 assert.equal((await f.change(s,'turns',{roundId:s.rounds[0].id,message:'由你先提出方向，我来选择'})).status,200);s=await f.session(s.id);assert.equal(s.protocolVersion,2);assert.equal(s.sources.length,2);assert.equal(s.rounds[0].result.schemaVersion,1);
 const next=await f.claim(node);assert.equal(next.writingSnapshot.skill.version,2);assert.equal(next.writingSnapshot.rounds[0].result.schemaVersion,1);assert.notEqual(next.writingSnapshot.skill.hash,old.writingSnapshot.skill.hash);
});
test('worker saves one v2 round and releases execution without asking or writing a draft',async t=>{
 const f=await fixture(t),created=await create(f),node=await v2Worker(f),task=await f.claim(node),fake=path.join(f.root,'v2-agent.mjs');
 fs.writeFileSync(fake,`import fs from 'node:fs';const input=JSON.parse(fs.readFileSync('writing-input.json'));const roundV2=${roundV2.toString()};fs.writeFileSync('writing-result.json',JSON.stringify(roundV2({writingSnapshot:input})));process.stdin.resume();`);
 await processTask({...node,dataDir:path.join(f.root,'worker'),agents:{codex:{command:process.execPath,args:[fake]}}},task,{codex:{available:true}},undefined);
 assert.equal((await f.session(created.id)).status,'awaiting_answers');assert.equal((await f.app.store.get('task',task.id)).state,'completed');assert.equal(await f.claim(node),null);assert.equal((await f.app.store.list('archive')).length,0);
});
test('submitted mixed turns and working outline resume after restart on a different owner device',async t=>{
 const f=await fixture(t),created=await create(f),node=await v2Worker(f),task=await f.claim(node);await f.submit(task,node,roundV2(task));let s=await f.session(created.id);await f.change(s,'turns',{roundId:s.rounds[0].id,answers:[{questionId:'q2',selected:['general'],text:'',uncertain:false}],message:'保留通用情境'});await f.stop();
 const app=createService({pluginProfile:'legacy',dataDir:f.root,masterKey:f.masterKey});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const server=`http://127.0.0.1:${app.server.address().port}`;
 const owner=await (await fetch(server+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:f.masterKey,name:'second owner'})})).json();const current=await (await fetch(server+'/api/writing/sessions/'+s.id,{headers:{Authorization:'Bearer '+owner.token}})).json();assert.equal(current.turns[0].message,'保留通用情境');assert.equal(current.answers[0].selected[0],'general');assert.deepEqual(current.workingPlan,s.workingPlan);assert.equal(current.brief,'连续学习、连续思考');
});
test('turn route uses owner credentials and does not widen Worker inbox management',async t=>{
 const f=await fixture(t),created=await create(f),node=await v2Worker(f),route=`/api/writing/sessions/${created.id}/turns`;
 assert.doesNotThrow(()=>validateCaptureRequest({route,method:'POST',json:{message:'补充'}}));assert.throws(()=>validateCaptureRequest({route,method:'GET'}));assert.equal((await f.request(route,'POST',{requestId:crypto.randomUUID(),baseVersion:1,message:'越权'},node)).status,403);
});
