import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {IndexedRecordStore} from '../src/records/data/store.ts';
import {RecordsService,newDraft} from '../src/records/data/service.ts';
import {sha256} from '../src/records/data/transport.ts';

const server='https://sync.example',epoch='00000000-0000-4000-8000-000000000001';
const cursor=n=>epoch+':'+n;
const record=(id='original')=>({id,text:'云端正文',attachments:[],version:1,trashVersion:0,deletedAt:null,createdAt:'2026-10-17T01:00:00Z'});
function fixture(){let response={records:[],deleted:[]};const calls=[];const service=new RecordsService(new IndexedRecordStore(new IDBFactory()),{status:async()=>({paired:true,server,deviceId:'one'}),request:async input=>{calls.push(input);if(input.route.endsWith('/capabilities'))return {status:200,json:{recordSyncProtocol:1}};if(input.method==='PUT')return {status:200,json:{...input.json,id:input.route.split('/').at(-1),version:input.json.baseVersion+1}};return {status:200,json:typeof response==='function'?await response(input):response};}});return {service,calls,set(value){response=value}};}

test('删除保存未确认上传与编辑草稿，旧响应不能复活；恢复原记录也不重放旧修改',async()=>{
 const f=fixture(),blob=new Blob(['private local file']),attachment={id:'file',name:'原件.txt',mime:'text/plain',bytes:blob.size,sha256:await sha256(blob),blob};
 f.set({records:[record()],deleted:[]});await f.service.refresh();let draft=await f.service.edit('original');
 await f.service.saveRecord({...draft,text:'待上传修改',attachments:[attachment]});let local=await f.service.store.get('original');
 local.payload={requestId:'unchanged-request',text:local.text,attachments:[],baseVersion:1,createdAt:local.createdAt};await f.service.store.put(local);
 draft={...await f.service.edit('original'),text:'还在输入的修改'};await f.service.saveDraft(draft);
 f.set({records:[],deleted:[{id:'original',version:1,trashVersion:1,deletedAt:'2026-10-17T02:00:00Z'}]});await f.service.refresh();
 local=await f.service.store.get('original');assert.equal((await f.service.load()).records.length,0);assert.equal(local.cancelledPayload.requestId,'unchanged-request');assert.equal(local.payload,undefined);assert.equal(local.recoveryDrafts.length,2);assert.equal(await local.recoveryDrafts[0].attachments[0].blob.text(),'private local file');assert.equal((await f.service.load()).draft.text,'还在输入的修改');assert.equal((await f.service.load()).draft.remoteDeleted,true);
 f.set({records:[{...record(),version:999}],deleted:[]});await f.service.refresh();assert.ok((await f.service.store.get('original')).deletedAt);
 f.set({records:[{...record(),trashVersion:2}],deleted:[]});await f.service.refresh();local=await f.service.store.get('original');assert.equal(local.deletedAt,null);assert.equal(local.text,'云端正文');assert.equal(local.payload,undefined);assert.equal(local.recoveryDrafts.length,2);
 const recovered=await f.service.saveRecoveryAsNew((await f.service.load()).draft);assert.notEqual(recovered.item.id,'original');assert.equal(recovered.item.text,'还在输入的修改');assert.equal((await f.service.store.get('original')).recoveryDrafts.length,1);assert.equal((await f.service.load()).draft.text,'');
});

test('未知删除也保留墓碑；更高内容版本不能撤销删除',async()=>{const f=fixture();f.set({deleted:[{id:'never-cached',version:1,trashVersion:3,deletedAt:'2026-10-17T02:00:00Z'}]});await f.service.refresh();f.set({records:[{...record('never-cached'),version:100,trashVersion:2}]});await f.service.refresh();assert.equal((await f.service.load()).records.length,0);assert.equal((await f.service.store.get('never-cached')).trashVersion,3);});

test('变化和游标同事务落盘，失败后重试同一页；乱序游标不回退',async()=>{
 const f=fixture();await f.service.sync();f.set({mode:'delta',cursor:cursor(1),changes:[{seq:1,record:record()}]});await f.service.refresh();
 f.set({mode:'delta',cursor:cursor(2),changes:[{seq:2,record:{...record('bad'),uncloneable:()=>{}}}]});await assert.rejects(f.service.refresh());assert.equal((await f.service.store.get('__record-sync__')).cursor,cursor(1));assert.equal(await f.service.store.get('bad'),undefined);
 f.set({mode:'delta',cursor:cursor(2),changes:[{seq:2,record:record('bad')}]});await f.service.refresh();assert.equal((await f.service.load()).records.length,2);
 f.set({mode:'snapshot',cursor:cursor(1),records:[{...record(),text:'过时响应'}]});await f.service.refresh();assert.equal((await f.service.store.get('__record-sync__')).cursor,cursor(2));assert.equal((await f.service.store.get('original')).text,'云端正文');
 const retry=f.calls.filter(x=>x.route.includes('/changes?')).slice(-2);assert.ok(retry[0].route.includes(encodeURIComponent(cursor(1))));
});

test('同步先拉删除再处理待上传，未发出 PUT；全量补漏使用一致快照',async()=>{
 const f=fixture();await f.service.saveRecord({...newDraft(),recordId:'original',text:'离线修改'});f.set({mode:'snapshot',cursor:cursor(3),records:[],deleted:[{id:'original',version:1,trashVersion:1,deletedAt:'2026-10-17T02:00:00Z'}]});await f.service.sync();assert.equal(f.calls.some(c=>c.method==='PUT'),false);assert.equal((await f.service.load()).recoveries.length,1);
 await f.service.sync(true);assert.ok(f.calls.at(-2).route.startsWith('/api/records/changes?wait=0'));
});

test('账号切换后迟到变化不能写入其他资料空间',async()=>{
 const f=fixture();let complete;f.set(()=>new Promise(resolve=>{complete=resolve}));const pending=f.service.refresh();while(!complete)await new Promise(r=>setTimeout(r,1));f.service.invalidateSession();complete({records:[record()],deleted:[]});await assert.rejects(pending,/登录状态/);assert.equal((await f.service.load()).records.length,0);
});

async function webFixture(){const context=vm.createContext({window:{},indexedDB:new IDBFactory(),console,Date,JSON,Map,Promise});vm.runInContext(await fs.readFile(new URL('../../../public/capture/store.js',import.meta.url),'utf8'),context);vm.runInContext(await fs.readFile(new URL('../../../public/capture/record-sync.js',import.meta.url),'utf8'),context);let response={records:[],deleted:[]};const store=context.window.captureStore,engine=new context.window.RecordSyncEngine({store,status:()=>({paired:true,server,deviceId:'web'}),api:async path=>path.endsWith('/capabilities')?{recordSyncProtocol:1}:response,changed:async()=>{}});return {store,engine,set(value){response=value}};}

test('Web/iOS 共享引擎保留原件与两份恢复草稿、禁止旧响应复活',async()=>{
 const f=await webFixture();const blob=new Blob(['原始附件']);await f.store.put({...record(),server,sync:'pending',remoteVersion:1,text:'本机待上传',attachments:[{id:'a',sha256:'hash',blob}],payload:{requestId:'same'},pendingProcess:{requestId:'stable-process'}});await f.store.put({id:'draft',recordId:'original',editingId:'original',text:'输入中',attachments:[]});
 f.set({mode:'snapshot',cursor:cursor(1),records:[],deleted:[{id:'original',trashVersion:1,deletedAt:'2026-10-17T02:00:00Z'}]});await f.engine.pull();let local=await f.store.get('original');assert.equal(local.recoveryDrafts.length,2);assert.equal(await local.recoveryDrafts[0].attachments[0].blob.text(),'原始附件');assert.equal(local.cancelledPayload.requestId,'same');assert.equal((await f.store.get('draft')).remoteDeleted,true);await f.engine.pull();assert.equal((await f.store.get('original')).cancelledProcess.requestId,'stable-process');
 f.set({mode:'snapshot',cursor:cursor(2),records:[{...record(),version:100,trashVersion:0}],deleted:[]});await f.engine.pull();assert.ok((await f.store.get('original')).deletedAt);
 f.set({mode:'snapshot',cursor:cursor(3),records:[{...record(),trashVersion:2}],deleted:[]});await f.engine.pull();local=await f.store.get('original');assert.equal(local.deletedAt,null);assert.equal(local.text,'云端正文');assert.equal(local.recoveryDrafts.length,2);
});

test('Web 批次失败回滚游标与所有记录，未知墓碑能阻止晚到正文',async()=>{
 const f=await webFixture();f.set({cursor:cursor(1),records:[{...record(),bad:()=>{}}]});await assert.rejects(f.engine.pull());assert.equal(await f.store.get('original'),undefined);assert.equal((await f.store.all()).length,0);
 f.set({cursor:cursor(1),deleted:[{id:'original',trashVersion:1,deletedAt:'2026-10-17T02:00:00Z'}]});await f.engine.pull();f.set({cursor:cursor(2),records:[record()]});await f.engine.pull();assert.ok((await f.store.get('original')).deletedAt);assert.equal((await f.store.all()).filter(row=>!row.id.startsWith('__record-')).length,1);
});

test('真实双客户端：长轮询接收删除和恢复，保留当前编辑且不生成重复记录',async t=>{
 const os=await import('node:os'),path=await import('node:path'),{createService}=await import('../../../src/server.mjs'),{secret}=await import('../../../src/common.mjs'),{api}=await import('../../../src/worker.mjs'),{captureRequest}=await import('../../../desktop/capture-client.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'record-sync-loop-')),key=secret(),app=createService({dataDir:root,masterKey:key});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();await fs.rm(root,{recursive:true,force:true})});const url='http://127.0.0.1:'+app.server.address().port;
 const devices=await Promise.all(['电脑','手机'].map(name=>api({server:url},'/api/pair','POST',{key,name})));
 const clients=devices.map(device=>new RecordsService(new IndexedRecordStore(new IDBFactory()),{status:async()=>({paired:true,server:url,deviceId:device.device.id}),request:input=>captureRequest({identity:{server:url,token:device.token,deviceId:device.device.id},fetcher:fetch},input)}));
 const original=(await clients[0].saveRecord({...newDraft(),text:'需要跨端删除'})).item;await clients[0].sync();await clients[1].sync();const draft=await clients[0].edit(original.id);await clients[0].saveDraft({...draft,text:'尚未保存的补充'});
 const waiting=clients[0].watch(),start=Date.now();await clients[1].setDeleted(original.id,true);await clients[1].sync();await waiting;assert.ok(Date.now()-start<3000);assert.equal((await clients[0].load()).records.length,0);assert.equal((await clients[0].load()).draft.text,'尚未保存的补充');
 const restoring=clients[0].watch();await clients[1].setDeleted(original.id,false);await clients[1].sync();await restoring;assert.equal((await clients[0].load()).records.length,1);assert.equal((await clients[0].load()).recoveries.length,1);const remote=await api({server:url,token:devices[0].token},'/api/records');assert.equal(remote.records.length,1);assert.equal(remote.records[0].id,original.id);
});


test('启动时本机读取与后台同步共享连接检查，不互相误判账号切换',async()=>{const f=fixture();f.set({records:[record()],deleted:[]});await Promise.all([f.service.load(),f.service.sync(),f.service.load()]);assert.equal((await f.service.load()).records.length,1);});


test('上传回执晚于远端删除和恢复时，不能覆盖新的删除状态版本与恢复正文',async()=>{
 let reply,phase={records:[record()],deleted:[]};const service=new RecordsService(new IndexedRecordStore(new IDBFactory()),{status:async()=>({paired:true,server}),request:async input=>input.method==='PUT'?new Promise(resolve=>{reply=()=>resolve({status:200,json:{...input.json,id:'original',version:2}})}):({status:200,json:phase})});
 await service.refresh();const draft=await service.edit('original');await service.saveRecord({...draft,text:'旧上传中的正文'});const upload=service.flush();while(!reply)await new Promise(r=>setTimeout(r,1));
 phase={deleted:[{id:'original',trashVersion:1,deletedAt:'2026-10-17T02:00:00Z'}],records:[]};await service.refresh();phase={records:[{...record(),trashVersion:2}],deleted:[]};await service.refresh();reply();await upload;
 const current=await service.store.get('original');assert.equal(current.trashVersion,2);assert.equal(current.text,'云端正文');assert.equal(current.deletedAt,null);assert.equal(current.recoveryDrafts.length,1);
});


test('桌面与 Web/iOS 重放同一跨端契约：内容版本不能推翻删除状态版本',async()=>{
 const contract=JSON.parse(await fs.readFile(new URL('../../../test/fixtures/record-sync-v1.json',import.meta.url),'utf8')),desktop=fixture(),web=await webFixture();
 for(const entry of contract.cases){const page={records:entry.record.deletedAt?[]:[entry.record],deleted:entry.record.deletedAt?[entry.record]:[]};desktop.set(page);web.set(page);await desktop.service.refresh();await web.engine.pull();const a=await desktop.service.store.get(entry.record.id),b=await web.store.get(entry.record.id);assert.equal(!a.deletedAt,entry.active,entry.name);assert.equal(!b.deletedAt,entry.active,entry.name);}
});


test('前台协调器响应生命周期，隐藏时暂停；401 后联网事件不重复发送请求',async()=>{
 const {coordinateRecords}=await import('../src/records/data/coordinator.ts');
 class Surface extends EventTarget {hidden=true;next=0;timers=new Map();setTimeout(fn){this.timers.set(++this.next,fn);return this.next}clearTimeout(id){this.timers.delete(id)}setInterval(fn){return this.setTimeout(fn)}clearInterval(id){this.clearTimeout(id)}}
 const target=new Surface(),doc=new Surface();let syncs=0,watches=0,denied=false;const stop=coordinateRecords({target,document:doc,sync:async()=>{syncs++;if(denied)throw Object.assign(Error('reauthorize'),{status:401})},watch:async()=>{watches++;return false},changed:async()=>{},error:()=>{}});
 const settle=()=>new Promise(r=>setImmediate(r));await settle();assert.equal(syncs,0);doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(syncs,1);assert.equal(watches,1);
 doc.hidden=true;target.dispatchEvent(new Event('focus'));await settle();assert.equal(syncs,1);doc.hidden=false;denied=true;target.dispatchEvent(new Event('focus'));await settle();assert.equal(syncs,2);target.dispatchEvent(new Event('online'));doc.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(syncs,2);stop();assert.equal(target.timers.size,0);
});


test('重复删除后的继续输入只更新本轮恢复草稿，保留上次删除的编辑版本',async()=>{
 const f=fixture();f.set({records:[record()]});await f.service.refresh();let draft=await f.service.edit('original');await f.service.saveDraft({...draft,text:'上次删除前的编辑'});
 f.set({deleted:[{id:'original',trashVersion:1,deletedAt:'2026-10-17T02:00:00Z'}]});await f.service.refresh();
 f.set({records:[{...record(),trashVersion:2}]});await f.service.refresh();draft=await f.service.edit('original');await f.service.saveDraft({...draft,text:'本轮删除前的编辑'});
 f.set({deleted:[{id:'original',trashVersion:3,deletedAt:'2026-10-17T03:00:00Z'}]});await f.service.refresh();await f.service.saveDraft({...draft,text:'删除后继续输入'});
 const versions=(await f.service.store.get('original')).recoveryDrafts.map(row=>row.text);assert.deepEqual(versions,['上次删除前的编辑','删除后继续输入']);assert.equal((await f.service.load()).records.length,0);
});
