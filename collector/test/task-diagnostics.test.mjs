import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../../services/api/server.mjs';
import {api} from '../../services/worker/worker.mjs';
import {secret,hash} from '../../packages/core/node/common.mjs';
import {createDiagnosticOutbox} from '../../packages/core/node/task-diagnostics.mjs';
import {capabilityFacts,runCapabilityProbe,observeTaskPermission} from '../../packages/core/node/capability-probe.mjs';
import {evaluateCapability,capabilityBlock,rankExecutionAgents} from '../../packages/core/node/capabilities.mjs';

async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'diagnostics-')),key=secret(),app=createService({dataDir:root,masterKey:key,pluginProfile:'legacy'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());const server='http://127.0.0.1:'+app.server.address().port;
 const owner={server,...await api({server},'/api/pair','POST',{key,name:'owner'})};
 async function worker(name){const pair=await api(owner,'/api/pairings','POST',{role:'worker'});const config={server,...await api({server},'/api/pair','POST',{key:pair.key,name,platform:process.platform})};config.deviceId=config.device.id;await api(config,'/api/heartbeat','POST',{capabilities:['article'],agents:['codex'],platform:process.platform});return config;}
 const one=await worker('Mac'),two=await worker('Windows');
 const task=await api(owner,'/api/tasks','POST',{type:'article',content:'https://example.com/diagnostic-fixture',submissionId:crypto.randomUUID(),autoArchive:false});
 const claimed=(await api(one,'/api/claim','POST',{assignmentProtocol:1})).task;
 return {root,app,server,owner,one,two,task,claimed};
}
const event=(task,device,extra={})=>({id:crypto.randomUUID(),taskId:task.id,attemptId:task.attemptId,deviceId:device.deviceId,runId:crypto.randomUUID(),at:new Date().toISOString(),state:'waiting_action',stage:'extracting',code:'AGENT_PERMISSION',message:'指定采集命令被拒绝',reportedBy:'worker',details:{exitCode:1},...extra});

test('task diagnostics bind executions, deduplicate replay and preserve late evidence without changing task',async t=>{
 const {app,owner,one,two,task,claimed}=await setup(t);assert.ok(claimed.attemptId);
 const e=event(claimed,one),batch={schemaVersion:1,attemptId:claimed.attemptId,events:[e]};
 await api(one,`/api/tasks/${task.id}/diagnostics`,'POST',batch);await api(one,`/api/tasks/${task.id}/diagnostics`,'POST',batch);
 await assert.rejects(api(two,`/api/tasks/${task.id}/diagnostics`,'POST',batch),{status:403});
 await api(one,`/api/tasks/${task.id}/progress`,'POST',{state:'waiting_action',message:'需要权限'},claimed.assignmentId);
 const blocked=await api(owner,`/api/read/v1/tasks/${task.id}/diagnostics`);assert.equal(blocked.diagnosis.code,'AGENT_PERMISSION');assert.equal(blocked.diagnosis.recovery_conditions[0].same_task,true);
 await api(owner,`/api/tasks/${task.id}/retry`,'POST',{});const resumed=(await api(one,'/api/claim','POST',{assignmentProtocol:1})).task;
 assert.equal(resumed.id,task.id);assert.notEqual(resumed.attemptId,claimed.attemptId);
 const late=event(claimed,one,{message:'旧执行补传证据'});await api(one,`/api/tasks/${task.id}/diagnostics`,'POST',{...batch,events:[late]});
 assert.equal((await app.store.get('task',task.id)).attemptId,resumed.attemptId);
 const report=await api(owner,`/api/read/v1/tasks/${task.id}/diagnostics`);assert.equal(report.attempts.length,2);assert.equal(report.events.filter(x=>x.id===e.id).length,1);assert.ok(report.routing_evaluations.length);assert.equal(report.diagnosis.status,'undetermined');
 const proof=await api(owner,`/api/read/v1/tasks/${task.id}/evidence/${e.id}`);assert.equal(proof.location.attempt_id,claimed.attemptId);
 const other=await api(owner,'/api/tasks','POST',{type:'article',content:'https://example.com/other',submissionId:crypto.randomUUID()});await assert.rejects(api(owner,`/api/read/v1/tasks/${other.id}/evidence/${e.id}`),{status:404});
});

test('diagnostics scope is independent and cannot modify tasks or read library content',async t=>{
 const {app,owner,server,task}=await setup(t);
 const diagnosticToken=secret(),libraryToken=secret();
 for(const [scope,token]of [['diagnostics:read',diagnosticToken],['library:read',libraryToken]])await app.store.put('device',{id:crypto.randomUUID(),role:'reader',scope,tokenHash:hash(token),expiresAt:new Date(Date.now()+60000).toISOString(),lastSeen:new Date().toISOString()});
 const diag={server,token:diagnosticToken},library={server,token:libraryToken};
 assert.equal((await api(diag,`/api/read/v1/tasks/${task.id}/diagnostics`)).task.id,task.id);
 await assert.rejects(api(library,`/api/read/v1/tasks/${task.id}/diagnostics`),{status:403});
 await assert.rejects(api(diag,'/api/read/v1/entries'),{status:403});
 await assert.rejects(api(diag,`/api/tasks/${task.id}/retry`,'POST',{}),{status:403});
 const grant=await api({server},'/oauth/device_authorization','POST',{client_id:'lingnest-cli',scope:'diagnostics:read',name:'diagnostic-test'});
 const request=await api(owner,'/api/reader-authorizations?code='+grant.user_code);assert.equal(request.scope,'diagnostics:read');
 await api(owner,'/api/reader-authorizations/decision','POST',{code:grant.user_code,decision:'allow'});
 const credential=await api({server},'/oauth/token','POST',{client_id:'lingnest-cli',grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:grant.device_code});assert.equal(credential.scope,'diagnostics:read');
 const d=(await app.store.list('device')).find(d=>d.tokenHash===hash(diagnosticToken));await app.store.put('device',{...d,revokedAt:new Date().toISOString()});await assert.rejects(api(diag,`/api/read/v1/tasks/${task.id}`),{status:401});await app.store.put('device',{...d,revokedAt:null,expiresAt:'2000-01-01T00:00:00Z'});await assert.rejects(api(diag,`/api/read/v1/tasks/${task.id}`),{status:401});
});

test('outbox retains offline diagnostics across restart and excludes prompts, private text and credentials',async t=>{
 const {root,owner,one,claimed,task}=await setup(t);const token='test-private-token';let offline=true;
 const call=(...args)=>{if(offline)throw Error('offline');return api(one,...args);};
 let out=createDiagnosticOutbox(root,{deviceId:one.deviceId,token,api:call});
 const e=out.record(claimed,{state:'waiting_action',message:'token='+token+' https://example.com/source?token=private',diagnostic:{code:'AGENT_PERMISSION',details:{exitCode:1,prompt:'private-writing',stdout:'private-output',cookie:'private-cookie'}}});
 await assert.rejects(out.flush());out=createDiagnosticOutbox(root,{deviceId:one.deviceId,token,api:call});offline=false;await out.flush();
 const report=await api(owner,`/api/read/v1/tasks/${task.id}/diagnostics`),saved=report.events.find(x=>x.id===e.id),json=JSON.stringify(saved);
 for(const value of [token,'private-writing','private-output','private-cookie','?token'])assert.equal(json.includes(value),false);
 assert.equal(saved.details.exitCode,1);assert.equal(fs.readdirSync(path.join(root,'diagnostic-outbox')).length,0);
});

test('legacy histories are explicitly incomplete and paginated diagnostics have stable identifiers',async t=>{
 const {app,owner}=await setup(t);const legacy={id:crypto.randomUUID(),state:'failed',createdAt:new Date().toISOString(),events:[{at:new Date().toISOString(),state:'failed',message:'旧版本失败'}]};await app.store.put('task',legacy);
 const report=await api(owner,`/api/read/v1/tasks/${legacy.id}/diagnostics`);assert.equal(report.completeness.legacy,true);assert.equal(report.completeness.complete,false);assert.equal(report.events[0].reportedBy,'legacy');
 const events=await api(owner,`/api/read/v1/tasks/${legacy.id}/events?limit=1`);assert.equal(events.items[0].id,report.events[0].id);
 await assert.rejects(api(owner,'/api/read/v1/tasks?limit=-1'),{status:400});
});

test('capability facts separate live availability, verification and scoped blockers',()=>{
 const config={agents:{codex:{command:'fixture'}}},available={codex:{available:true,version:'1'}};
 const facts=capabilityFacts(config,available,{version:'0.2.24'}),article=facts.find(f=>f.id==='capture.article');
 assert.equal(evaluateCapability({},article.id,{facts:[article]}).verification,'untested');
 assert.equal(evaluateCapability({},article.id,{online:false,facts:[article],proofs:[{capabilityId:article.id,fingerprint:article.fingerprint,passed:true}]}).verification,'passed');
 assert.equal(capabilityBlock({type:'article'},{capabilityFacts:[article]}),null);
 assert.equal(capabilityBlock({type:'article'},{capabilityFacts:[{...article,permission:'blocked'}]}),'AGENT_PERMISSION');
 assert.equal(capabilityBlock({type:'video'},{capabilityFacts:facts}),'CAPABILITY_UNAVAILABLE');
 assert.equal(capabilityBlock({type:'article'},{agents:['codex']}),null);
});

test('permission probe requires a real result file and keeps writing input out of its workspace',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'capability-probe-test-')),config={dataDir:root,agents:{codex:{command:'fixture'}}};
 const success=await runCapabilityProbe(config,'codex',async(name,profiles,{cwd})=>{assert.equal(fs.existsSync(path.join(cwd,'writing-input.json')),false);fs.writeFileSync(path.join(cwd,'capability-ready.json'),'{"ready":true}');return {code:0};});assert.equal(success.passed,true);
 const denied=await runCapabilityProbe(config,'codex',async()=>({code:1,permissionBlocked:true}));assert.equal(denied.permission,'blocked');assert.equal(denied.passed,false);
});


test('confirmed permission failures are local to execution mode and automatic routing prefers matching verified paths',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'capability-observation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config={dataDir:root,agents:{codebuddy:{command:'fixture'},codex:{command:'fixture'}}},available={codebuddy:{available:true},codex:{available:true}};
 observeTaskPermission(config,{id:'task'},'codex',{blocked:true});
 const observations=JSON.parse(fs.readFileSync(path.join(root,'capability-observations.json')));const facts=capabilityFacts(config,available,{observations});
 assert.equal(facts.find(f=>f.agent==='codex'&&f.id==='capture.article').permission,'blocked');
 assert.equal(facts.find(f=>f.agent==='codex'&&f.id==='writing.materials').permission,'unknown');
 assert.deepEqual(rankExecutionAgents({type:'article'},['codebuddy','codex'],{facts}),[]);
 observeTaskPermission(config,{id:'task'},'codex',{passed:true});const refreshed=capabilityFacts(config,available,{observations:JSON.parse(fs.readFileSync(path.join(root,'capability-observations.json')))});
 const f=refreshed.find(f=>f.agent==='codex'&&f.id==='capture.article');assert.deepEqual(rankExecutionAgents({type:'article'},['codebuddy','codex'],{facts:refreshed,proofs:[{agent:'codex',capabilityId:f.id,fingerprint:f.fingerprint,passed:true}]}),['codex']);
});

test('control transitions remain events in one task and evidence stays readable after execution device goes offline',async t=>{
 const {app,owner,one,task,claimed}=await setup(t);
 const take=event(claimed,one,{code:'BROWSER_WAITING',message:'用户已接管页面'});const back=event(claimed,one,{code:'BROWSER_RESUMED',state:'running',message:'用户已交还页面',at:new Date(Date.now()+10).toISOString()});
 await api(one,`/api/tasks/${task.id}/diagnostics`,'POST',{schemaVersion:1,attemptId:claimed.attemptId,events:[take]});let report=await api(owner,`/api/read/v1/tasks/${task.id}/diagnostics`);assert.equal(report.diagnosis.status,'manual');
 await api(one,`/api/tasks/${task.id}/diagnostics`,'POST',{schemaVersion:1,attemptId:claimed.attemptId,events:[back]});
 const device=await app.store.get('device',one.deviceId);await app.store.put('device',{...device,lastSeen:'2000-01-01T00:00:00Z'});
 report=await api(owner,`/api/read/v1/tasks/${task.id}/diagnostics`);assert.equal(report.task.id,task.id);assert.equal(report.attempts[0].id,claimed.attemptId);assert.notEqual(report.diagnosis.status,'manual');
 assert.equal((await api(owner,`/api/read/v1/tasks/${task.id}/evidence/${take.id}`)).evidence.code,'BROWSER_WAITING');
 const byDevice=await api(owner,'/api/read/v1/tasks?device='+one.deviceId);assert.ok(byDevice.items.some(t=>t.id===task.id));
});

test('outbox flush drains events recorded while a prior batch is in flight',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'diagnostic-flush-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let release,started;const start=new Promise(r=>started=r),seen=[];
 const out=createDiagnosticOutbox(root,{deviceId:'node',api:async(_route,_method,batch)=>{seen.push(...batch.events);if(seen.length===1){started();await new Promise(r=>release=r);}return {accepted:true};}}),task={id:'task',attemptId:'attempt'};
 out.record(task,{state:'running',message:'已开始'});const flush=out.flush();await start;out.record(task,{state:'completed',code:'ATTEMPT_FINISHED'});release();await flush;assert.equal(seen.length,2);assert.equal(fs.readdirSync(path.join(root,'diagnostic-outbox')).length,0);
});
