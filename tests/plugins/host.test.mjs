import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRegistry,scopedStore} from '../../packages/plugin-sdk/runtime.mjs';
import {manifests} from '../../packages/plugin-sdk/catalog.mjs';
import {createService} from '../../services/api/server.mjs';
import {createPluginHost} from '../../packages/plugin-sdk/server.mjs';
import {definitions} from '../../plugins/registry.mjs';
import {Store} from '../../services/api/storage/store.mjs';
const key='plugin-test-key-'.repeat(4);
async function fixture(t,{legacy=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nest-plugins-'));
 const store=new Store(path.join(dir,'state.sqlite'));
 if(legacy)await store.put('capture',{id:'old-record',text:'旧内容',version:1,attachments:[],createdAt:new Date().toISOString()});
 const app=createService({dataDir:dir,masterKey:key,store});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+app.server.address().port;
 const pair=await fetch(origin+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,name:'plugin-owner'})}).then(r=>r.json());
 async function request(route,method='GET',input,token=pair.token,mime='application/json'){const response=await fetch(origin+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':mime},body:input===undefined?undefined:Buffer.isBuffer(input)?input:JSON.stringify(input)});return {status:response.status,body:await response.json()};}
 const toggle=async(id,enabled)=>{const current=(await request('/api/plugins')).body;return request('/api/plugins/'+id,'PUT',{enabled,revision:current.revision});};
 return {app,request,toggle,origin};
}
test('new spaces enable AI only; existing spaces preserve all delivered features',async t=>{
 const fresh=await fixture(t);const a=await fresh.request('/api/plugins');assert.equal(a.status,200);assert.deepEqual(a.body.enabled,{'agent-lab':false,'ai-assistant':true,blocks:false,learning:false,writing:false});
 const old=await fixture(t,{legacy:true});const b=await old.request('/api/plugins');assert.equal(b.body.enabled.blocks,false);assert.ok(['ai-assistant','writing','agent-lab'].every(id=>b.body.enabled[id]));assert.equal(b.body.migrated,true);
});
test('dependencies, active jobs, authorization and stale updates are enforced server-side',async t=>{
 const {app,request,toggle}=await fixture(t);
 assert.equal((await toggle('writing',true)).status,200);
 const blocked=await toggle('ai-assistant',false);assert.equal(blocked.status,409);assert.deepEqual(blocked.body.details.dependents,['writing']);
 await toggle('writing',false);
 await app.store.put('task',{id:'busy',state:'queued',pluginId:'ai-assistant',createdAt:new Date().toISOString()});
 const busy=await toggle('ai-assistant',false);assert.equal(busy.status,409);assert.equal(busy.body.details.jobs[0].id,'busy');
 await app.store.put('task',{id:'busy',state:'completed',pluginId:'ai-assistant'});
 const stale=await request('/api/plugins/ai-assistant','PUT',{enabled:false,revision:0});assert.equal(stale.body.code,'plugin_config_changed');
 await app.store.put('agent-operation',{id:'cancel-pending',state:'cancel_requested'});
 assert.equal((await toggle('ai-assistant',false)).body.details.jobs[0].id,'cancel-pending');
 await app.store.put('agent-operation',{id:'cancel-pending',state:'cancelled'});
 assert.equal((await toggle('ai-assistant',false)).status,200);
 const host=createPluginHost({store:app.store,serialized:async(_key,work)=>work(),definitions});await host.ready;
 const access=host.access('ai-assistant',['agent-operation']);
 await assert.rejects(access.transaction(tx=>tx.put('agent-operation',{id:'late-operation',state:'queued'})),e=>e.code==='plugin_disabled');
 assert.equal(await app.store.get('agent-operation','late-operation'),null);
 const denied=await request('/api/plugins','GET',undefined,'invalid');assert.equal(denied.status,401);
 assert.equal((await request('/api/writing/sessions','POST',{})).body.code,'plugin_disabled');
});
test('all extensions off: legacy sharing saves raw links and attachments, sync and read remain available',async t=>{
 const {app,request,toggle}=await fixture(t);assert.equal((await toggle('ai-assistant',false)).status,200);
 const bytes=Buffer.from('89504e470d0a1a0a00000000','hex'),sha=createHash('sha256').update(bytes).digest('hex');
 assert.equal((await request('/api/records/media/'+sha,'PUT',bytes,undefined,'image/png')).status,200);
 const attachment={id:crypto.randomUUID(),sha256:sha,name:'original.png'};
 const input={attachments:[attachment],submissionId:'raw-share',codexTrial:{deviceId:crypto.randomUUID()},url:'https://example.com/post?lang=zh',type:'webpage',tags:['灵感']};
 const shared=await request('/api/tasks','POST',input);assert.equal(shared.status,201);assert.equal(shared.body.state,'completed');assert.equal(shared.body.pluginId,null);
 const record=await request('/api/records/'+shared.body.sourceRecordId);assert.equal(record.status,200);assert.equal(record.body.text,input.url);assert.deepEqual(record.body.tasks,[]);
 assert.equal((await request('/api/tasks','POST',input)).body.id,shared.body.id);
 const changes=await request('/api/records/changes');assert.ok(!changes.body.records.some(r=>r.id===record.body.id));assert.ok(changes.body.excluded.some(r=>r.id===record.body.id&&r.origin==='collection_input'));
 const process=await request('/api/records/'+record.body.id+'/process','POST',{requestId:crypto.randomUUID(),baseVersion:1,preset:'summary'});assert.equal(process.body.code,'plugin_disabled');
 const saved=await app.store.get('capture',record.body.id);assert.equal(saved.text,input.url);
 const exported=await request('/api/records/'+record.body.id+'/export');assert.equal(exported.status,200);assert.equal(exported.body.record.text,input.url);assert.equal(exported.body.kind,'inspirainest-record');assert.equal(exported.body.files[0].sha256,sha);assert.deepEqual(Buffer.from(exported.body.files[0].body,'base64'),bytes);
 await toggle('ai-assistant',true);assert.equal((await app.store.list('task')).filter(t=>t.purpose==='codex-trial').length,0);assert.equal((await request('/api/records/'+record.body.id)).body.text,input.url);
});
test('disabled writing keeps history; re-enable recovers existing sessions without erasing data',async t=>{
 const {app,request,toggle}=await fixture(t);await toggle('writing',true);
 await app.store.put('writing-session',{id:'retained',title:'历史文章',version:1,runs:[],sources:[],updatedAt:new Date().toISOString(),createdAt:new Date().toISOString()});
 await toggle('writing',false);
 assert.equal((await app.store.get('writing-session','retained')).title,'历史文章');
 const historical=await request('/api/writing/sessions');assert.equal(historical.status,200);assert.ok(historical.body.items.some(s=>s.id==='retained'));
 await toggle('writing',true);assert.equal((await request('/api/writing/sessions')).status,200);
});
test('catalog rejects cycles and scoped plugin data cannot access another namespace',async()=>{
 assert.throws(()=>createRegistry([{...manifests[0],id:'first',dependencies:['second']},{...manifests[1],id:'second',dependencies:['first']}]),/cycle/);
 const rows=new Map(),store={get:async(k,id)=>rows.get(k+':'+id),put:async(k,v)=>rows.set(k+':'+v.id,v)};
 const a=scopedStore(store,'writing'),b=scopedStore(store,'agent-lab');await a.put('draft',{id:'same',text:'mine'});assert.equal(await b.get('draft','same'),undefined);assert.throws(()=>a.get('../writing','same'));
});

test('Worker uses registered handlers and never falls back for an unknown plugin job',async()=>{
 const {createWorkerRegistry}=await import('../../packages/plugin-sdk/worker.mjs');
 const registry=createWorkerRegistry([{id:'specific',matches:t=>t.pluginId==='specific',run:async c=>({handled:c.task.id})}]);
 assert.deepEqual(await registry.dispatch({task:{id:'one',pluginId:'specific'}}),{handled:'one'});
 await assert.rejects(registry.dispatch({task:{id:'two',pluginId:'unknown'}}),/没有支持/);
 assert.throws(()=>createWorkerRegistry([{id:'same',matches:()=>true,run:()=>{}},{id:'same',matches:()=>true,run:()=>{}}]),/Invalid Worker/);
});

test('blocks: disabled writes, version conflicts, persistence and paused state',async t=>{
 const {request,toggle}=await fixture(t);const input={title:'AI 前沿',goals:[{title:'文章',output:'article',parts:[{title:'证据',conditions:['可追溯'],dependsOn:[]}]}]};
 assert.equal((await request('/api/blocks','POST',input)).status,409);
 assert.equal((await toggle('blocks',true)).status,200);
 const created=await request('/api/blocks','POST',input);assert.equal(created.status,200);const b=created.body;
 assert.equal((await request('/api/blocks/'+b.id+'/pause','POST',{revision:0,paused:true})).status,409);
 const paused=await request('/api/blocks/'+b.id+'/pause','POST',{revision:b.revision,paused:true});assert.equal(paused.status,200);assert.equal(paused.body.paused,true);assert.equal(paused.body.evaluations[0].goals[0].ready,false);
 for(const task of (await request('/api/state')).body.tasks.filter(t=>t.pluginId==='blocks'&&t.state==='queued'))await request('/api/tasks/'+task.id+'/cancel','POST',{});
 assert.equal((await toggle('blocks',false)).status,200);assert.equal((await request('/api/blocks/'+b.id)).body.title,input.title);
});

test('手机快速加入与实际 Worker 语义结果更新评价，排除后不自动加回',async t=>{
 const {app,request,toggle,origin}=await fixture(t);await toggle('blocks',true);
 const rid=crypto.randomUUID(),at=new Date().toISOString();await app.store.put('capture',{id:rid,version:1,text:'独立运营的视频账号先验证选题、制作和发布三个环节。',attachments:[],createdAt:at});
 const created=(await request('/api/blocks','POST',{title:'账号运营',goals:[{title:'验证运营流程',output:'product',parts:[{title:'流程',conditions:['明确运营环节'],dependsOn:[]}]}]})).body;
 await new Promise(resolve=>setTimeout(resolve,100));
 const current=(await request('/api/blocks/'+created.id)).body;
 const joined=await request('/api/blocks/'+created.id+'/join','POST',{revision:current.revision,kind:'record',sourceId:rid,partId:created.goals[0].parts[0].id});assert.equal(joined.status,200);assert.equal(joined.body.links[0].relation,'lead');
 await new Promise(resolve=>setTimeout(resolve,100));
 // An old match snapshot is fenced after an explicit join changed the matching epoch.
 const tasks=(await app.store.list('task')).filter(t=>t.purpose==='blocks-match');assert.ok(tasks.length);
 const code=(await request('/api/pairings','POST',{role:'worker'})).body;
 const pair=await fetch(origin+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:code.key,name:'matcher'})}).then(r=>r.json());
 const job=tasks.filter(t=>t.state==='queued').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1),assignment=crypto.randomUUID();await app.store.put('task',{...job,deviceId:pair.device.id,assignmentId:assignment,state:'running'});
 const value={protocol:1,matches:[{sourceKey:job.blockSnapshot.sources[0].key,partId:created.goals[0].parts[0].id,relation:'support',reason:'正文明确列举三个运营环节',scopeReason:'完整记录正文列出了用户的运营步骤，不作为外部事实核验',evidence:[{unitId:job.blockSnapshot.sources[0].units[0].id,condition:'明确运营环节',quote:'先验证选题、制作和发布三个环节'}]}]};
 const response=await fetch(origin+'/api/blocks/matches/'+job.id,{method:'POST',headers:{Authorization:'Bearer '+pair.token,'Content-Type':'application/json','X-Task-Assignment':assignment},body:JSON.stringify(value)});
 assert.equal(response.status,200,await response.text());
 const accepted=await fetch(origin+'/api/blocks/matches/'+job.id,{method:'POST',headers:{Authorization:'Bearer '+pair.token,'Content-Type':'application/json','X-Task-Assignment':assignment},body:JSON.stringify(value)});assert.equal(accepted.status,200,await accepted.text());
 const ready=(await request('/api/blocks/'+created.id)).body;assert.equal(ready.evaluations.at(-1).goals[0].ready,true);
 const removed=await request('/api/blocks/'+created.id+'/exclude','POST',{revision:ready.revision,linkId:ready.links[0].id});assert.equal(removed.status,200);assert.equal(removed.body.evaluations.at(-1).goals[0].ready,false);
});
