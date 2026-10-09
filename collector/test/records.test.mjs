import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../src/server.mjs';
import { api,processTask } from '../src/worker.mjs';
import { hash,secret } from '../src/common.mjs';
import { prepareRecordInput,recordPrompt } from '../src/record-input.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';
import { captureRequest } from '../desktop/capture-client.mjs';

async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'capture-tests-')),key=secret();
  const store=process.env.CAPTURE_MYSQL_TEST==='1'?await mysqlFixture():undefined;
  const app=createService({dataDir:root,masterKey:key,store});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
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
