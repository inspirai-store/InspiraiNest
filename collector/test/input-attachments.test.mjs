import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createService } from '../../services/api/server.mjs';
import { api,processTask,prepareWorkspace } from '../../services/worker/worker.mjs';
import { hash,secret } from '../../packages/core/node/common.mjs';
import { validDocument,decodeInputText,resolveInputAttachments,INPUT_TOTAL_LIMIT } from '../../packages/core/node/input-attachments.mjs';
import { prepareTaskInput,verifyInputCoverage } from '../../packages/core/node/task-input.mjs';
const docx=Buffer.from('UEsDBBQAAAAIALBzTV2sbhJanQAAANwAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbF2PMQ7CMAxFr1JlRdSIgQG1XdiBgQtYqdtGxHaUGCi3RwWpA/PXe0+/ub0TlWrmKKV1k1k6AhQ/EWOpNZHMHAfNjFZqzSMk9HccCfa73QG8ipHY1haH65rLk3IOPVVXzHZGptbBS3MPvfoHk1g9c3TV6Yct5dZhSjF4tKACT+n/mlsdhuBp5RdbyuqplCAjx3pdGINsFj10DXxPdR9QSwMEFAAAAAgAsHNNXfvvWA6kAAAAFgEAABEAAAB3b3JkL2RvY3VtZW50LnhtbHWQyw6CMBBFf4VAwpJiVSwFWRhd+hFQKpD0lbam9e9NS4yycHPPLM48Mq3DoyRPToVNPGfCYHdOZ2sVBsCQmfLeFFJR4Tl7SM17awqpJ+CkHpWWhBqziIkzAMuyArxfRNq1Dg9yfAWqELbLM3+4wWuTZ746olMkKiNrVKOmBcEKuTYMLELHJD+D9jC5L5eNHuqobMQdRP/MAL0i7AGfa8H3E90bUEsBAhQAFAAAAAgAsHNNXaxuElqdAAAA3AAAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACACwc01d++9YDqQAAAAWAQAAEQAAAAAAAAAAAAAAgAHOAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAIAAgCAAAAAoQEAAAAA','base64');

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'task-input-')),key=secret(),app=createService({pluginProfile:'legacy',dataDir:root,masterKey:key});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const server=`http://127.0.0.1:${app.server.address().port}`;
 t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
 const owner={server,...await api({server},'/api/pair','POST',{key,name:'owner'})};
 async function request(route,method='GET',value,who=owner,mime='application/json',assignment){const response=await fetch(server+route,{method,headers:{Authorization:`Bearer ${who.token}`,'Content-Type':mime,...(assignment?{'X-Task-Assignment':assignment}:{})},body:value===undefined?undefined:Buffer.isBuffer(value)?value:JSON.stringify(value)});return {status:response.status,headers:response.headers,value:method==='HEAD'?null:response.headers.get('content-type')?.startsWith('application/json')?await response.json():Buffer.from(await response.arrayBuffer())};}
 async function worker(protocol=1){const code=await api(owner,'/api/pairings','POST',{role:'worker'}),who={server,...await api({server},'/api/pair','POST',{key:code.key,name:'worker'})};await api(who,'/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],...(protocol?{inputAttachmentProtocol:protocol}:{})});return who;}
 async function upload(body=Buffer.from('中文材料：附件全文必须保留。\n第二段说明。'),name='同名.txt',mime='text/plain'){const sha256=hash(body);assert.equal((await request('/api/records/media/'+sha256,'PUT',body,owner,mime)).status,200);return {id:randomUUID(),name,sha256};}
 return {root,app,server,owner,request,worker,upload};
}
test('document signatures, BOM encodings and invalid binary inputs',async()=>{
 assert.equal(decodeInputText(Buffer.from('fffe2d4e8765','hex')),'中文');
 assert.equal(await validDocument(Buffer.from('中文内容'),'text/plain'),true);
 assert.equal(await validDocument(Buffer.from([0,1,2,3]),'text/plain'),false);
 assert.equal(await validDocument(Buffer.from('%PDF-1.7\n'),'application/pdf'),true);
 assert.equal(await validDocument(Buffer.from('not a zip'),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),false);
});
test('input limits and immutable references count duplicates separately',async()=>{
 const item={id:randomUUID(),name:'x.txt',sha256:'a'.repeat(64)},store={get:async()=>({id:item.sha256,mime:'text/plain',bytes:32*1024*1024})};
 assert.equal((await resolveInputAttachments(store,[item])).length,1);
 await assert.rejects(resolveInputAttachments(store,[item,item]),/Duplicate/);
 await assert.rejects(resolveInputAttachments(store,Array.from({length:5},()=>({...item,id:randomUUID()}))),/128 MiB/);
 await assert.rejects(resolveInputAttachments(store,Array.from({length:21},()=>({...item,id:randomUUID()}))),/20/);
 assert.equal(INPUT_TOTAL_LIMIT,128*1024*1024);
});
test('DOCX headings/tables pre-extract in UTF8; recognizable encrypted originals stay available',async t=>{
 const {request,upload,worker,root}=await fixture(t),mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 assert.equal(await validDocument(docx,mime),true);const file=await upload(docx,'中文表格.docx',mime);await request('/api/tasks','POST',{submissionId:randomUUID(),attachments:[file]});const who=await worker(),task=(await api(who,'/api/claim','POST',{assignmentProtocol:1})).task,workspace=prepareWorkspace(task,path.join(root,'worker'));
 await prepareTaskInput(who,task,workspace);const manifest=JSON.parse(fs.readFileSync(path.join(workspace,'.task-input/manifest.json')));const preview=fs.readFileSync(path.join(workspace,manifest.attachments[0].extractedPath),'utf8');assert.match(preview,/中文标题/);assert.match(preview,/32 MiB\n\t128 MiB/);
 const encrypted=Buffer.concat([Buffer.from('d0cf11e0a1b11ae1','hex'),Buffer.from('EncryptedPackage\0EncryptionInfo','utf16le')]);assert.equal(await validDocument(encrypted,mime),true);
});
test('attachment-only tasks freeze server metadata, exact retries and changed-file conflicts',async t=>{
 const {request,upload}=await fixture(t),file=await upload(),input={submissionId:randomUUID(),content:'',attachments:[{...file,mime:'fake',bytes:1}]};
 const first=await request('/api/tasks','POST',input);assert.equal(first.status,201);assert.equal(first.value.inputAttachments[0].mime,'text/plain');assert.ok(first.value.inputAttachments[0].bytes>1);
 assert.equal((await request('/api/tasks','POST',input)).value.id,first.value.id);
 assert.equal((await request('/api/tasks','POST',{...input,attachments:[{...file,name:'changed.txt'}]})).status,409);
 assert.equal((await request('/api/tasks','POST',{submissionId:randomUUID(),content:''})).status,400);
 assert.equal((await request('/api/tasks','POST',{submissionId:randomUUID(),attachments:[{...file,sha256:'b'.repeat(64)}]})).status,409);
 const head=await request('/api/records/media/'+file.sha256,'HEAD');assert.equal(head.status,200);assert.equal(head.headers.get('x-content-sha256'),file.sha256);
});
test('capability, assignment, foreign hash, cancellation and revocation fence originals',async t=>{
 const {request,upload,worker,owner,root}=await fixture(t),file=await upload(),other=await upload(Buffer.from('其他文件'));
 await request('/api/tasks','POST',{submissionId:randomUUID(),content:'',attachments:[file]});const old=await worker(0);assert.equal((await api(old,'/api/claim','POST',{assignmentProtocol:1})).task,null);
 const who=await worker(),task=(await api(who,'/api/claim','POST',{assignmentProtocol:1})).task,route=`/api/tasks/${task.id}/input-files/`;
 assert.equal((await request(route+file.sha256,'GET',undefined,old)).status,403);
 assert.equal((await request(route+file.sha256,'GET',undefined,who,'application/json',randomUUID())).status,409);
 assert.equal((await request(route+other.sha256,'GET',undefined,who,'application/json',task.assignmentId)).status,403);
 const workspace=prepareWorkspace(task,path.join(root,'worker'));await prepareTaskInput(who,task,workspace);const local=path.join(workspace,'.task-input',file.id+'.txt');assert.equal(hash(fs.readFileSync(local)),file.sha256);
 fs.writeFileSync(local,'corrupted');await prepareTaskInput(who,task,workspace);assert.equal(hash(fs.readFileSync(local)),file.sha256);
 await request('/api/tasks/'+task.id+'/cancel','POST',{});assert.equal((await request(route+file.sha256,'GET',undefined,who,'application/json',task.assignmentId)).status,403);
 await api(owner,`/api/devices/${who.device.id}/revoke`,'POST',{});assert.equal((await request(route+file.sha256,'GET',undefined,who,'application/json',task.assignmentId)).status,401);
});
test('incomplete per-file coverage pauses, retry retains files, approval exposes originals',async t=>{
 const {request,upload,worker,root}=await fixture(t),a=await upload(),b=await upload(Buffer.from('第二份中文全文，使用同名文件区分输入。'));
 await request('/api/tasks','POST',{submissionId:randomUUID(),content:'比较两份材料',autoArchive:false,attachments:[a,b]});const who=await worker(),task=(await api(who,'/api/claim','POST',{assignmentProtocol:1})).task;
 const agent=fileURLToPath(new URL('./fixtures/input-agent.mjs',import.meta.url)),config={...who,dataDir:path.join(root,'worker'),agents:{codex:{command:process.execPath,args:[agent,'--omit-one'],versionArgs:['--version']},codebuddy:{enabled:false}}};
 await processTask(config,task,{codex:{available:true}},new AbortController().signal);let state=(await request('/api/state')).value;assert.equal(state.tasks[0].state,'waiting_action');assert.equal(state.archives.length,0);
 const retained=path.join(config.dataDir,'tasks',task.id,'library','.task-input',a.id+'.txt');assert.equal(hash(fs.readFileSync(retained)),a.sha256);
 await request('/api/tasks/'+task.id+'/retry','POST',{});const next=(await api(who,'/api/claim','POST',{assignmentProtocol:1})).task;assert.equal(next.id,task.id);config.agents.codex.args=[agent];
 await processTask(config,next,{codex:{available:true}},new AbortController().signal);state=(await request('/api/state')).value;assert.equal(state.tasks[0].state,'awaiting_review');assert.equal(state.archives.length,0);
 const draft=(await request(`/api/tasks/${task.id}/draft`)).value;assert.deepEqual(draft.inputAttachments.map(f=>f.id),[a.id,b.id]);assert.ok(Buffer.from(draft.files.find(f=>f.path===a.id+'.txt').body,'base64').toString().includes('中文材料'));
 await request(`/api/tasks/${task.id}/approve`,'POST',{});state=(await request('/api/state')).value;assert.equal(state.archives.length,1);const archive=state.archives[0].id;
 assert.equal((await request(`/api/archives/${archive}`)).value.inputAttachments.length,2);
 const raw=await request(`/api/archives/${archive}/input-files/${a.sha256}`);assert.equal(hash(raw.value),a.sha256);
 const browser=(await request('/library/data')).value;assert.equal(browser.entries[0].inputAttachments.length,2);
});
