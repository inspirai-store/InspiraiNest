import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../../services/api/server.mjs';
import { api,processTask } from '../../services/worker/worker.mjs';
import { hash,secret } from '../../packages/core/node/common.mjs';
import { prepareRecordInput,recordPrompt } from '../../packages/core/node/record-input.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';
import { captureRequest } from '../../apps/desktop/capture-client.mjs';

async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'capture-tests-')),key=secret();
  const store=process.env.CAPTURE_MYSQL_TEST==='1'?await mysqlFixture():undefined;
  const app=createService({pluginProfile:'legacy',dataDir:root,masterKey:key,store});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const server=`http://127.0.0.1:${app.server.address().port}`;t.after(()=>app.close());
  const owner={server,...await api({server},'/api/pair','POST',{key,name:'owner'})};
  async function request(route,method='GET',value,config=owner,mime) {const response=await fetch(server+route,{method,headers:{Authorization:`Bearer ${config.token}`,...(value===undefined?{}:{'Content-Type':mime||'application/json'})},body:value===undefined?undefined:Buffer.isBuffer(value)?value:JSON.stringify(value)});return {status:response.status,value:response.headers.get('content-type')?.startsWith('application/json')?await response.json():Buffer.from(await response.arrayBuffer())};}
  async function worker(protocol=1) {const code=await api(owner,'/api/pairings','POST',{role:'worker'}),device={server,...await api({server},'/api/pair','POST',{key:code.key,name:'worker'})};await api(device,'/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],...(protocol?{recordProtocol:protocol}:{})});return device;}
  const input=(extra={})=>({requestId:crypto.randomUUID(),baseVersion:0,text:'一条原始记录',attachments:[],createdAt:'2026-10-09T12:34:56+08:00',...extra});
  return {app,root,owner,server,request,worker,input};
}
test('sending a record creates no task; retry is idempotent even with reordered JSON keys',async t=>{
  const {request,input,owner}=await fixture(t),id=crypto.randomUUID(),payload=input();
  const first=await request('/api/records/'+id,'PUT',payload);assert.equal(first.status,200);assert.equal(first.value.version,1);
  const retry=await request('/api/records/'+id,'PUT',Object.fromEntries(Object.entries(payload).reverse()));assert.deepEqual(retry.value,first.value);
  assert.equal((await request('/api/state')).value.tasks.length,0);
  assert.equal((await request('/api/records/'+id,'PUT',{...payload,text:'other'})).status,409);
});
test('concurrent edits keep immutable snapshots and one winner; workers cannot manage records',async t=>{
  const {request,input,worker}=await fixture(t),id=crypto.randomUUID();await request('/api/records/'+id,'PUT',input());
  const responses=await Promise.all([request('/api/records/'+id,'PUT',input({baseVersion:1,text:'version two'})),request('/api/records/'+id,'PUT',input({baseVersion:1,text:'competing edit'}))]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const node=await worker();assert.equal((await request('/api/records','GET',undefined,node)).status,403);
});

test('record protocol announces rich documents and rejects destructive legacy writes without changing history',async t=>{
 const {request,input,app,worker}=await fixture(t),id=crypto.randomUUID();
 const capabilities=await request('/api/records/capabilities');assert.deepEqual(capabilities.value,{protocol:1,documentVersions:[1],structuredErrors:true,contentTrashProtocol:1,recordSyncProtocol:1});
 const document={version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'保留排版',marks:[{type:'bold'}]}]}]}};
 const original=input({text:'保留排版',document});const created=await request('/api/records/'+id,'PUT',original);assert.deepEqual(created.value.document,document);
 const legacy=await request('/api/records/'+id,'PUT',input({baseVersion:1,text:'旧客户端修改'}));assert.equal(legacy.status,422);assert.equal(legacy.value.code,'record_document_required');
 assert.deepEqual((await request('/api/records/'+id)).value.document,document);assert.equal((await request('/api/records/'+id)).value.version,1);
 const node=await worker();assert.equal((await request('/api/records/capabilities','GET',undefined,node)).status,403);
 const old=await request('/api/records/'+id,'PUT',input({baseVersion:0,text:'过期内容',document}));assert.equal(old.value.code,'record_version_conflict');
 const reused=await request('/api/records/'+id,'PUT',{...original,text:'不同请求'});assert.equal(reused.value.code,'record_request_reused');
 assert.equal((await app.store?.list?.('capture-version'))?.length??1,1);
});

test('a committed old receipt stays immutable after protocol upgrade; one new request restores document and retries exactly',async t=>{
 const {request,input,app}=await fixture(t),id=crypto.randomUUID(),requestId=crypto.randomUUID();
 const document={version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'恢复正文'}]}]}},payload=input({requestId,text:'恢复正文',document});
 const {canonicalJson:canonicalJSON}=await import('../../packages/core/node/common.mjs');
 const store=app.store;
 assert.ok(store,'test service exposes isolated store');
 const old={id,text:payload.text,attachments:[],createdAt:payload.createdAt,updatedAt:new Date().toISOString(),version:1};
 await store.put('capture',old);await store.put('capture-version',{...old,id:id+':1',recordId:id});await store.put('capture-operation',{id:id+':'+requestId,hash:hash(canonicalJSON({method:'PUT',input:payload})),result:old});
 const replay=await request('/api/records/'+id,'PUT',payload);assert.equal(replay.value.version,1);assert.equal(replay.value.document,undefined);
 const repair={...payload,requestId:crypto.randomUUID(),baseVersion:1};const fixed=await request('/api/records/'+id,'PUT',repair);assert.equal(fixed.value.version,2);assert.deepEqual(fixed.value.document,document);assert.deepEqual((await request('/api/records/'+id,'PUT',repair)).value,fixed.value);
 assert.equal((await store.get('capture-version',id+':1')).document,undefined);
});
test('media requires correct checksum and signature and all uploaded files before commit',async t=>{
  const {request,input}=await fixture(t),bytes=Buffer.from('89504e470d0a1a0a00000000','hex'),sha=hash(bytes),recordId=crypto.randomUUID(),attachment={id:crypto.randomUUID(),sha256:sha,name:'photo.png'};
  assert.equal((await request('/api/records/'+recordId,'PUT',input({attachments:[attachment]}))).status,409);
  assert.equal((await request('/api/records/media/'+sha,'PUT',Buffer.from('bad'),undefined,'image/png')).status,400);
  assert.equal((await request('/api/records/media/'+hash(Buffer.from('bad')),'PUT',Buffer.from('bad'),undefined,'image/png')).status,415);
  const uploaded=await request('/api/records/media/'+sha,'PUT',bytes,undefined,'image/png');assert.equal(uploaded.status,200);
  const repeated=await request('/api/records/media/'+sha,'PUT',bytes,undefined,'image/png');assert.deepEqual(repeated.value,uploaded.value);
  assert.equal((await request('/api/records/'+recordId,'PUT',input({attachments:[attachment]}))).status,200);
  assert.deepEqual((await request('/api/records/media/'+sha)).value,bytes);
});
test('processing is explicit, version-bound, review-only and fenced to capable assigned workers',async t=>{
  const {request,input,worker,root}=await fixture(t),recordId=crypto.randomUUID(),bytes=Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVEtest'),sha=hash(bytes);
  await request('/api/records/media/'+sha,'PUT',bytes,undefined,'audio/wav');await request('/api/records/'+recordId,'PUT',input({attachments:[{id:crypto.randomUUID(),sha256:sha,name:'voice.wav'}]}));
  const job={requestId:crypto.randomUUID(),baseVersion:1,preset:'summary'},created=await request('/api/records/'+recordId+'/process','POST',job);assert.equal(created.status,200);assert.equal(created.value.autoArchive,false);
  assert.equal((await request('/api/records/'+recordId+'/process','POST',job)).value.id,created.value.id);
  await request('/api/records/'+recordId,'PUT',input({baseVersion:1,text:'second version'}));
  const old=await worker(0);assert.equal((await api(old,'/api/claim','POST',{})).task,null);
  const node=await worker(),task=(await api(node,'/api/claim','POST',{assignmentProtocol:1})).task;assert.equal(task.recordSnapshot.text,'一条原始记录');assert.equal(task.recordVersion,1);
  const deny=await request(`/api/tasks/${task.id}/record-media/${sha}`,'GET',undefined,old);assert.equal(deny.status,403);
  const workspace=path.join(root,'input');fs.mkdirSync(workspace);await prepareRecordInput(node,task,workspace);assert.deepEqual(fs.readFileSync(path.join(workspace,'.record-input',sha+'.wav')),bytes);
  assert.match(recordPrompt(task),/先读取原始文字和全部附件/);const historical=await request('/api/records/'+recordId+'/process','POST',{...job,requestId:crypto.randomUUID()});assert.equal(historical.status,200);assert.equal(historical.value.recordVersion,1);assert.equal((await request('/api/records/'+recordId+'/process','POST',{...job,baseVersion:99,requestId:crypto.randomUUID()})).status,409);
});
test('desktop capture transport uses owner identity, pins origin and restricts routes',async()=>{
  let calls=0;const owner={identity:{server:'https://example.test',token:'owner-token'},fetcher:async()=>{calls++;return new Response(JSON.stringify({records:[]} ),{headers:{'content-type':'application/json'}});}};
  await captureRequest(owner,{route:'/api/records',server:'https://example.test'});assert.equal(calls,1);
  await assert.rejects(captureRequest(owner,{route:'/api/records',server:'https://other.test'}));await assert.rejects(captureRequest(owner,{route:'/api/pairings',method:'POST',json:{}}));assert.equal(calls,1);
  owner.identity=null;await assert.rejects(captureRequest(owner,{route:'/api/records'}));
});
test('record -> child Agent fixture -> private result -> explicit approval preserves original and history',async t=>{
 const {request,input,worker,root}=await fixture(t),id=crypto.randomUUID();await request('/api/records/'+id,'PUT',input({text:'必须完整保留的原始文字'}));
 const created=await request('/api/records/'+id+'/process','POST',{requestId:crypto.randomUUID(),baseVersion:1,preset:'summary'}),node=await worker(),task=(await api(node,'/api/claim','POST',{assignmentProtocol:1})).task;
 const fixturePath=fileURLToPath(new URL('./fixtures/fake-agent.mjs',import.meta.url));const config={...node,dataDir:path.join(root,'worker'),agents:{codex:{command:process.execPath,args:[fixturePath],versionArgs:['--version']},codebuddy:{enabled:false}}};
 await processTask(config,task,{codex:{available:true}},new AbortController().signal);
 const before=(await request('/api/records/'+id)).value;assert.equal(before.tasks[0].state,'awaiting_review');assert.equal((await request('/api/state')).value.archives.length,0);
 const draft=(await request('/api/tasks/'+task.id+'/draft')).value;const original=draft.files.find(file=>file.path===`record-${id}-v1.txt`);assert.equal(Buffer.from(original.body,'base64').toString('utf8'),'必须完整保留的原始文字');assert.equal(draft.meta.collected_at,'2026-10-09T12:34:56+08:00');
 await request('/api/tasks/'+task.id+'/approve','POST',{});assert.equal((await request('/api/state')).value.archives.length,1);
 assert.equal((await request('/api/records/'+id)).value.text,'必须完整保留的原始文字');
 await request('/api/records/'+id+'/process','POST',{requestId:crypto.randomUUID(),baseVersion:1,preset:'actions'});assert.equal((await request('/api/records/'+id)).value.tasks.length,2);
});

test('photo derivatives are separate checked files and never replace original bytes',async t=>{
 const {request,input}=await fixture(t),original=Buffer.from('89504e470d0a1a0a00000000','hex'),preview=Buffer.from('ffd8ffe00001','hex'),sha=hash(original),thumbnailSha256=hash(preview),id=crypto.randomUUID(),attachment={id:crypto.randomUUID(),name:'original.png',sha256:sha,thumbnailSha256};
 await request('/api/records/media/'+sha,'PUT',original,undefined,'image/png');
 assert.equal((await request('/api/records/'+id,'PUT',input({attachments:[attachment]}))).status,409);
 await request('/api/records/media/'+thumbnailSha256,'PUT',preview,undefined,'image/jpeg');
 const saved=await request('/api/records/'+id,'PUT',input({attachments:[attachment]}));assert.equal(saved.status,200);assert.equal(saved.value.attachments[0].thumbnailSha256,thumbnailSha256);assert.deepEqual((await request('/api/records/media/'+sha)).value,original);
});
test('视频、PDF、UTF8文本与通用附件校验后可同步，错误签名仍拒绝',async t=>{const {request}=await fixture(t);for(const [mime,bytes] of [['video/mp4',Buffer.from('0000ftypisom')],['video/webm',Buffer.from('1a45dfa30000','hex')],['application/pdf',Buffer.from('%PDF-1.4\nfixture')],['text/plain',Buffer.from('路线说明')],['application/json',Buffer.from('{"route":"lake"}')],['application/octet-stream',Buffer.from([1,2,3])]]){const sha=hash(bytes);const uploaded=await request('/api/records/media/'+sha,'PUT',bytes,undefined,mime);assert.equal(uploaded.status,200,mime);const read=await request('/api/records/media/'+sha);if(mime==='application/json')assert.deepEqual(read.value,{route:'lake'});else assert.deepEqual(read.value,bytes);}const invalid=Buffer.from('not a pdf');assert.equal((await request('/api/records/media/'+hash(invalid),'PUT',invalid,undefined,'application/pdf')).status,415);});


test('record changes snapshot, paged deltas, deletion and explicit restore preserve a durable cursor',async t=>{
 const {request,input}=await fixture(t),id=crypto.randomUUID();
 const initial=(await request('/api/records/changes?wait=0&limit=1')).value;
 assert.equal(initial.mode,'snapshot');assert.equal(initial.records.length,0);
 const record=(await request('/api/records/'+id,'PUT',input())).value;
 const deletion={requestId:crypto.randomUUID(),version:1,trashVersion:0};
 assert.equal((await request('/api/content-trash/record/'+id+'/delete','POST',deletion)).status,200);
 assert.equal((await request('/api/content-trash/record/'+id+'/delete','POST',deletion)).status,200);
 assert.equal((await request('/api/content-trash/record/'+id+'/restore','POST',{...deletion,requestId:crypto.randomUUID(),trashVersion:1})).status,200);
 let cursor=initial.cursor;const events=[];
 do{const page=await request('/api/records/changes?cursor='+encodeURIComponent(cursor)+'&wait=0&limit=1');assert.equal(page.status,200);events.push(...page.value.changes);cursor=page.value.cursor;if(!page.value.hasMore)break;}while(events.length<10);
 assert.equal(events.length,3);assert.deepEqual(events.map(e=>e.seq),[1,2,3]);assert.deepEqual(events.map(e=>e.record.trashVersion),[0,1,2]);assert.ok(events[1].record.deletedAt);assert.equal(events[2].record.deletedAt,null);
 const snapshot=(await request('/api/records/changes?cursor='+crypto.randomUUID()+':0&wait=0')).value;
 assert.equal(snapshot.mode,'snapshot');assert.equal(snapshot.cursor,cursor);assert.equal(snapshot.records[0].id,record.id);
 const legacy=(await request('/api/records')).value;assert.equal(legacy.records.length,1);assert.equal(legacy.deleted.length,0);
});

test('an online second client receives a deletion within three seconds without restarting',async t=>{
 const {request,input}=await fixture(t),id=crypto.randomUUID();await request('/api/records/'+id,'PUT',input());
 const before=(await request('/api/records/changes?wait=0')).value;
 const started=Date.now(),pending=request('/api/records/changes?cursor='+encodeURIComponent(before.cursor)+'&wait=3');
 await new Promise(resolve=>setTimeout(resolve,50));
 await request('/api/content-trash/record/'+id+'/delete','POST',{requestId:crypto.randomUUID(),version:1,trashVersion:0});
 const page=await pending;assert.equal(page.status,200);assert.equal(page.value.changes[0].record.id,id);assert.ok(page.value.changes[0].record.deletedAt);assert.ok(Date.now()-started<3000);
});

test('record change sequence rolls back with content and rejects worker and invalid waits',async t=>{
 const {request,input,worker,app}=await fixture(t),node=await worker();
 assert.equal((await request('/api/records/changes?wait=0','GET',undefined,node)).status,403);
 assert.equal((await request('/api/records/changes?wait=26')).status,400);
 const before=(await request('/api/records/changes?wait=0')).value;
 const {lockRecordChanges,appendRecordChange}=await import('../../packages/core/node/record-changes.mjs');
 await assert.rejects(app.store.transaction(async tx=>{const state=await lockRecordChanges(tx);await appendRecordChange(tx,{id:crypto.randomUUID(),text:'must roll back'},state);throw Error('rollback');}),/rollback/);
 const after=(await request('/api/records/changes?cursor='+encodeURIComponent(before.cursor)+'&wait=0')).value;
 assert.equal(after.cursor,before.cursor);assert.equal(after.changes.length,0);
});

test('long poll stops after device revocation and never returns queued record bodies',async t=>{
 const {request,owner,server}=await fixture(t),code=await api(owner,'/api/pairings','POST',{role:'owner'}),other={server,...await api({server},'/api/pair','POST',{key:code.key,name:'another owner'})};
 const snapshot=(await request('/api/records/changes?wait=0')).value;
 const pending=request('/api/records/changes?cursor='+encodeURIComponent(snapshot.cursor)+'&wait=3');await new Promise(r=>setTimeout(r,50));
 await api(other,'/api/devices/'+owner.device.id+'/revoke','POST',{});const response=await pending;assert.equal(response.status,401);assert.equal(response.value.changes,undefined);assert.equal(response.value.records,undefined);
});

test('concurrent writes commit a contiguous sequence and snapshots share the durable cursor',async t=>{
 const {request,input,app}=await fixture(t);const before=(await request('/api/records/changes?wait=0')).value;
 const ids=Array.from({length:8},()=>crypto.randomUUID());const saved=await Promise.all(ids.map(id=>request('/api/records/'+id,'PUT',input())));assert.ok(saved.every(r=>r.status===200));
 const page=(await request('/api/records/changes?cursor='+encodeURIComponent(before.cursor)+'&wait=0')).value;assert.deepEqual(page.changes.map(e=>e.seq),[1,2,3,4,5,6,7,8]);assert.deepEqual(new Set(page.changes.map(e=>e.record.id)),new Set(ids));
 const snapshot=(await request('/api/records/changes?wait=0')).value;assert.equal(snapshot.cursor,page.cursor);assert.equal(snapshot.records.length,8);assert.equal((await app.store.list('record-change')).length,8);
});
