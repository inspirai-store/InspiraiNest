import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../src/server.mjs';
import {api} from '../src/worker.mjs';
import {secret,hash} from '../src/common.mjs';
import {CreationWorker} from '../src/creation-worker.mjs';
import {creationRoute} from '../src/creation-contract.mjs';

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'creation-')),key=secret(),app=createService({dataDir:root,masterKey:key});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const server='http://127.0.0.1:'+app.server.address().port;t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
 const owner={server,...await api({server},'/api/pair','POST',{key,name:'owner'})};
 const pair=async()=>{const p=await api(owner,'/api/pairings','POST',{role:'worker'}),w={server,...await api({server},'/api/pair','POST',{key:p.key,name:'creative worker'})};await api(w,'/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],creationRuntime:{version:1}});return w;};
 const node=await pair(),request=(route,method='GET',input,who=owner)=>api(who,'/api/creation/v1'+route,method,input);
 const mutate=(route,input={},method='POST')=>request(route,method,{...input,requestId:crypto.randomUUID()});
 const create=async()=>mutate('/sessions',{title:'电影与现实',executorDeviceId:node.device.id});
 return {root,app,owner,node,pair,request,mutate,create};
}
test('跨设备文稿版本冲突保留历史；请求重试不重复创建',async t=>{
 const f=await fixture(t),input={requestId:crypto.randomUUID(),title:'评论',executorDeviceId:f.node.device.id};
 const s=await f.request('/sessions','POST',input);assert.equal((await f.request('/sessions','POST',input)).id,s.id);
 await assert.rejects(f.request('/sessions','POST',{...input,title:'different'}),e=>e.status===409);
 const doc=await f.mutate('/sessions/'+s.id+'/document',{baseRevision:0,title:'评论',markdown:'第一稿'},'PUT');assert.equal(doc.revision,1);
 await assert.rejects(f.mutate('/sessions/'+s.id+'/document',{baseRevision:0,markdown:'过期内容'},'PUT'),e=>e.status===409);
 assert.equal((await f.request('/sessions/'+s.id+'/versions')).versions[0].markdown,'第一稿');
 await assert.rejects(f.request('/sessions','GET',undefined,f.node),e=>e.status===403);
});
test('龙餐馆别名联查同步记录，旧记录引用绑定原始版本',async t=>{
 const f=await fixture(t),s=await f.create(),recordId=crypto.randomUUID();
 await api(f.owner,'/api/records/'+recordId,'PUT',{requestId:crypto.randomUUID(),baseVersion:0,text:'有关于龙餐厅的一切，我想起一条关于普通人的记录。',attachments:[]});
 await api(f.owner,'/api/records/'+recordId,'PUT',{requestId:crypto.randomUUID(),baseVersion:1,text:'第二版仍讨论龙餐厅',attachments:[]});
 const found=await f.request('/sessions/'+s.id+'/search?q='+encodeURIComponent('欢迎来到龙餐厅'));assert.equal(found.items[0].id,recordId);assert(found.queries.includes('欢迎来龙餐馆'));assert.equal(found.coverage.records,'synced');
 const read=await f.request('/sessions/'+s.id+'/source?ref='+encodeURIComponent(JSON.stringify({kind:'record',id:recordId,version:1})));assert.match(read.sources[0].text,/普通人/);assert.equal(read.sources[0].version,1);
 assert.equal((await api(f.owner,'/api/records/'+recordId)).version,2);
});
test('跨轮旧引用编号不保存，模型按本轮已读版本纠正后成稿',async t=>{
 const f=await fixture(t),recordId=crypto.randomUUID();
 await api(f.owner,'/api/records/'+recordId,'PUT',{requestId:crypto.randomUUID(),baseVersion:0,text:'有关于龙餐厅的一切：好好吃饭，好好生活。',attachments:[]});
 const s=await f.mutate('/sessions',{title:'跨轮引用',executorDeviceId:f.node.device.id,contextRefs:[{kind:'record',id:recordId,version:1}]});
 await f.mutate('/sessions/'+s.id+'/turns',{instruction:'根据上一轮材料写草稿'});
 let step=0,readKey;const runtime={start:async()=>{},account:async()=>({account:{type:'chatgpt'}}),request:async()=>({thread:{id:'continued-thread'}}),close(){},turn:async(_id,input)=>{
   const data=JSON.parse(input);step++;if(step===1)readKey=data.attached[0].sourceKey;
   else {assert.match(data.error,/未保存/);assert.equal(data.readSources[0].sourceKey,readKey);assert.equal(data.readSources[0].version,1);}
   return JSON.stringify({action:'draft',reply:'已整理',title:'好好生活',markdown:'基于已读记录的待审草稿。',citationKeys:[step===1?'s2':readKey]});
 }};
 const worker=new CreationWorker({...f.node,dataDir:path.join(f.root,'worker')},{api:(...a)=>f.request(a[0].replace('/api/creation/v1',''),a[1],a[2],f.node),runtime});await worker.tick({});worker.close();
 const result=await f.request('/sessions/'+s.id);assert.equal(step,2);assert.equal(result.document.revision,1);assert.equal(result.document.citations[0].id,recordId);assert.equal(result.turns[0].state,'completed');
 assert.equal((await f.request('/sessions/'+s.id+'/versions')).versions.length,1);
});
test('会话固定电脑，停止与换机使旧分配失效，离线任务排队',async t=>{
 const f=await fixture(t),s=await f.create(),turn=await f.mutate('/sessions/'+s.id+'/turns',{instruction:'找材料讨论观点'}),other=await f.pair();
 assert.deepEqual(await f.request('/worker/claim','POST',{runtimeId:'other'},other),{});
 const claimed=await f.request('/worker/claim','POST',{runtimeId:'first'},f.node);assert.equal(claimed.turn.id,turn.id);
 const input={sessionId:s.id,turnId:turn.id,assignmentId:claimed.turn.assignmentId,type:'delta',text:'正在阅读'};
 await f.request('/worker/event','POST',input,f.node);
 await f.mutate('/sessions/'+s.id+'/stop');await assert.rejects(f.request('/worker/event','POST',input,f.node),e=>e.status===409);
 await f.mutate('/sessions/'+s.id+'/move',{executorDeviceId:other.device.id});await f.mutate('/sessions/'+s.id+'/turns',{instruction:'继续'});
 const resumed=await f.request('/worker/claim','POST',{runtimeId:'new'},other);assert.equal(resumed.session.generation,1);
 const events=(await f.request('/sessions/'+s.id+'/events?after=0')).events;assert.deepEqual(events.map(e=>e.sequence),[1,2,3,4,5,6,7,8]);
});
test('AI草稿遇到人工编辑时拒绝覆盖；完成结果可以幂等恢复',async t=>{
 const f=await fixture(t),s=await f.create();await f.mutate('/sessions/'+s.id+'/turns',{instruction:'写草稿'});const job=await f.request('/worker/claim','POST',{runtimeId:'one'},f.node),payload={sessionId:s.id,turnId:job.turn.id,assignmentId:job.turn.assignmentId,title:'文章',markdown:'AI稿',citations:[]};
 const first=await f.request('/worker/document','POST',payload,f.node);const retry=await f.request('/worker/document','POST',payload,f.node);assert.equal(first.revision,retry.revision);
 await f.request('/worker/event','POST',{...payload,type:'completed',text:'已起草'},f.node);await f.mutate('/sessions/'+s.id+'/turns',{instruction:'修改'});const j=await f.request('/worker/claim','POST',{runtimeId:'two'},f.node);
 await f.mutate('/sessions/'+s.id+'/document',{baseRevision:1,markdown:'人工编辑'},'PUT');
 await assert.rejects(f.request('/worker/document','POST',{...payload,turnId:j.turn.id,assignmentId:j.turn.assignmentId},f.node),e=>e.status===409);
 assert.equal((await f.request('/sessions/'+s.id)).document.markdown,'人工编辑');
});
test('固定版本发布仅接受owner批准；编辑后旧回执不可发布',async t=>{
 const f=await fixture(t),s=await f.create();await f.mutate('/sessions/'+s.id+'/document',{baseRevision:0,markdown:'待审阅正文'},'PUT');
 const p=await f.mutate('/sessions/'+s.id+'/prepare',{revision:1}),job=await f.request('/worker/claim','POST',{runtimeId:'one'},f.node);
 const preview={origin:'https://blog.example.test',article_id:crypto.randomUUID(),revision_id:crypto.randomUUID(),content_sha256:hash('body'),source:'test',locale:'zh',article:{title:'文章',markdown:'待审阅正文',media:[]}};
 await f.request('/worker/publication','POST',{sessionId:s.id,publicationId:p.id,assignmentId:job.publication.assignmentId,preview},f.node);
 let state=await f.request('/sessions/'+s.id);assert.equal(state.publication.state,'review');
 await assert.rejects(f.request('/sessions/'+s.id+'/approve','POST',{requestId:crypto.randomUUID(),publicationId:p.id,digest:state.publication.digest},f.node),e=>e.status===403);
 await f.mutate('/sessions/'+s.id+'/document',{baseRevision:1,markdown:'新版本'},'PUT');
 await assert.rejects(f.mutate('/sessions/'+s.id+'/approve',{publicationId:p.id,digest:state.publication.digest}),e=>e.status===409);
 assert.equal((await f.request('/sessions/'+s.id)).publication.state,'obsolete');
});
test('真正的远程执行管线联查并保存草稿，原记录不变',async t=>{
 const f=await fixture(t),s=await f.create(),recordId=crypto.randomUUID();await api(f.owner,'/api/records/'+recordId,'PUT',{requestId:crypto.randomUUID(),baseVersion:0,text:'欢迎来龙餐馆观影记录：普通人的生活。',attachments:[]});
 await f.mutate('/sessions/'+s.id+'/turns',{instruction:'从我的记录起草评论文章'});
 let step=0,readKey;const runtime={start:async()=>{},account:async()=>({account:{type:'chatgpt'}}),request:async()=>({thread:{id:'test-thread'}}),turn:async(_id,input,options)=>{step++;const output=step===1?{action:'search',query:'欢迎来到龙餐厅',expanded:[],reply:'先找记录'}:step===2?{action:'read',sourceKey:(readKey=JSON.parse(input).search.items[0].sourceKey),reply:'阅读原文'}:{action:'draft',title:'从一顿饭谈普通人的生活',markdown:'这是依据我的原始记录形成的草稿。',reply:'草稿已整理。',citationKeys:[readKey]};options.onDelta(JSON.stringify(output));return JSON.stringify(output);},close(){}};
 const worker=new CreationWorker({...f.node,dataDir:path.join(f.root,'worker')},{api:(...args)=>f.request(args[0].replace('/api/creation/v1',''),args[1],args[2],f.node),runtime});await worker.tick({});worker.close();
 const state=await f.request('/sessions/'+s.id);assert.equal(state.document.revision,1);assert.equal(state.document.citations[0].id,recordId);assert.equal(state.turns[0].state,'completed');assert.equal((await api(f.owner,'/api/records/'+recordId)).version,1);
});
test('原生桥拒绝管理及worker接口，仅开放创作交互路由',()=>{assert(creationRoute('/api/creation/v1/sessions'));assert(creationRoute('/api/creation/v1/sessions/'+crypto.randomUUID()+'/events?after=2'));assert(!creationRoute('/api/creation/v1/worker/claim','POST'));assert(!creationRoute('/api/security','POST'));});

test('检索途中撤销电脑授权后不交付已读取的私有结果',async t=>{
 const f=await fixture(t),s=await f.create();await f.mutate('/sessions/'+s.id+'/turns',{instruction:'找记录'});const job=await f.request('/worker/claim','POST',{runtimeId:'revocation'},f.node);
 const list=f.app.store.list.bind(f.app.store);let release,started;const gate=new Promise(r=>{release=r;}),reading=new Promise(r=>{started=r;});let once=true;
 f.app.store.list=async kind=>{const result=await list(kind);if(kind==='capture'&&once){once=false;started();await gate;}return result;};
 const pending=f.request('/worker/search','POST',{sessionId:s.id,turnId:job.turn.id,assignmentId:job.turn.assignmentId,query:'私人记录'},f.node);await reading;
 const device=await f.app.store.get('device',f.node.device.id);await f.app.store.put('device',{...device,revokedAt:new Date().toISOString()});release();
 await assert.rejects(pending,e=>e.status===401);
});

test('发布媒体只交给对应的执行电脑；上传、固定版本和撤销批准联动',async t=>{
 const f=await fixture(t),s=await f.create(),bytes=Buffer.from('89504e470d0a1a0a00000000','hex'),sha=hash(bytes);
 const uploaded=await fetch(f.owner.server+'/api/records/media/'+sha,{method:'PUT',headers:{Authorization:'Bearer '+f.owner.token,'Content-Type':'image/png'},body:bytes});assert.equal(uploaded.status,200);
 const media={kind:'local',sha256:sha,mime:'image/png',name:'原始图片',ref:'cover',alt:'验收',caption:'',attribution:''};
 await f.mutate('/sessions/'+s.id+'/document',{baseRevision:0,title:'含图片的文章',markdown:'正文\n\n::media[cover]',media:[media]},'PUT');
 const p=await f.mutate('/sessions/'+s.id+'/prepare',{revision:1}),job=await f.request('/worker/claim','POST',{runtimeId:'media'},f.node),input={sessionId:s.id,publicationId:p.id,assignmentId:job.publication.assignmentId,sha256:sha};
 const file=await f.request('/worker/media','POST',input,f.node);assert.deepEqual(Buffer.from(file.bytes,'base64'),bytes);
 const other=await f.pair();await assert.rejects(f.request('/worker/media','POST',input,other),e=>e.status===403);
 await assert.rejects(f.request('/worker/media','POST',{...input,sha256:hash('unknown')},f.node),e=>e.status===403);
 const text='这是完整中文稿件。'.repeat(6000);await f.mutate('/sessions/'+s.id+'/document',{baseRevision:1,markdown:text,media:[media]},'PUT');assert.equal((await f.request('/sessions/'+s.id)).document.markdown,text);
});
