import test from 'node:test';import assert from 'node:assert/strict';import {IDBFactory} from 'fake-indexeddb';
import {IndexedRecordStore} from '../../../../packages/core/web/records/data/store.ts';import {RecordsService,newDraft} from '../../../../packages/core/web/records/data/service.ts';
const server='https://space.invalid';
function setup(base=new IndexedRecordStore(new IDBFactory())){let identity='A';const calls=[];const transport={status:async()=>({paired:identity!==null,server,deviceId:identity}),request:async input=>{calls.push({identity,input});return {status:200,json:{records:[],id:input.route.split('/').at(-1),version:input.json?.baseVersion+1}}}};const service=new RecordsService(base,transport);return {base,service,calls,switchTo(value){identity=value;service.invalidateSession();}};}
test('同一服务 A/B/A 的记录、未保存草稿与 Blob 分开，退出不暴露账号缓存',async()=>{
 const h=setup();let a=await h.service.load();const blob=new Blob(['A picture']);await h.service.saveDraft({...a.draft,text:'A 未保存',attachments:[{id:'image',name:'image',blob,mime:'image/png',bytes:blob.size,sha256:'test'}]});
 await h.service.saveRecord({...newDraft(),recordId:'same-id',text:'A 记录'});a=await h.service.load();await h.service.saveDraft({...a.draft,text:'A 下一条草稿'});
 h.switchTo('B');let b=await h.service.load();assert.equal(b.records.length,0);assert.equal(b.draft.text,'');await h.service.saveRecord({...newDraft(),recordId:'same-id',text:'B 记录'});b=await h.service.load();await h.service.saveDraft({...b.draft,text:'B 草稿'});
 await h.service.saveDraft({...a.draft,text:'A 迟到输入'});await assert.rejects(h.service.saveRecord({...a.draft,text:'A 迟到保存'}),/切换/);assert.equal((await h.service.load()).draft.text,'B 草稿');
 h.switchTo(null);const signedOut=await h.service.load();assert.equal(signedOut.records.length,0);assert.equal(signedOut.draft.text,'');
 h.switchTo('A');a=await h.service.load();assert.deepEqual(a.records.map(i=>i.text),['A 记录']);assert.equal(a.draft.text,'A 下一条草稿');
 h.switchTo('B');assert.deepEqual((await h.service.load()).records.map(i=>i.text),['B 记录']);
});
test('旧库首次归属迁移保留原条目、Blob、版本和请求 ID，另一账号不继承',async()=>{
 const base=new IndexedRecordStore(new IDBFactory()),blob=new Blob(['original']);const legacy={id:'legacy',text:'旧内容',server,sync:'failed',version:4,remoteVersion:3,createdAt:'2026-10-12',attachments:[{id:'a',name:'a',mime:'text/plain',blob,bytes:8,sha256:'original'}],payload:{requestId:'unchanged'}};
 const draft={...newDraft(),text:'旧草稿',attachments:legacy.attachments};await base.put(legacy);await base.put(draft);const h=setup(base);const a=await h.service.load();assert.equal(a.records[0].payload.requestId,'unchanged');assert.equal(a.records[0].remoteVersion,3);assert.equal(await a.records[0].attachments[0].blob.text(),'original');assert.equal(a.draft.text,'旧草稿');assert.deepEqual(await base.get('legacy'),legacy);assert.deepEqual(await base.get('draft'),draft);
 h.switchTo('B');assert.equal((await h.service.load()).records.length,0);assert.equal((await h.service.load()).draft.text,'');h.switchTo('A');assert.equal((await h.service.load()).records.length,1);
});
test('未登录创建的记录只归属首次登录账号，B 不会同步 A 的待同步记录',async()=>{
 const h=setup();h.switchTo(null);await h.service.saveRecord({...newDraft(),text:'未登录本机记录'});let local=await h.service.load();await h.service.saveDraft({...local.draft,text:'未登录草稿'});
 h.switchTo('A');const a=await h.service.load();assert.equal(a.records.length,1);assert.equal(a.draft.text,'未登录草稿');h.switchTo('B');await h.service.load();await h.service.flush();assert.equal(h.calls.length,0);h.switchTo('A');await h.service.flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].identity,'A');
});
test('A 的迟到同步响应不会覆盖 B 同 ID 条目，返回 A 可按原请求 ID 重试',async()=>{
 let account='A',resolve;const base=new IndexedRecordStore(new IDBFactory());const calls=[];const service=new RecordsService(base,{status:async()=>({paired:true,server,deviceId:account}),request:async input=>{calls.push(input);if(account==='A'&&!resolve)return new Promise(r=>resolve=r);return {status:200,json:{id:'shared',version:1}};}});
 await service.saveRecord({...newDraft(),recordId:'shared',text:'A'});const sending=service.flush();while(!resolve)await new Promise(r=>setImmediate(r));account='B';service.invalidateSession();await service.load();await service.saveRecord({...newDraft(),recordId:'shared',text:'B'});resolve({status:200,json:{id:'shared',version:1}});await assert.rejects(sending,/登录状态/);assert.equal((await service.load()).records[0].text,'B');account='A';service.invalidateSession();await service.load();await service.flush();assert.equal(calls[0].json.requestId,calls[1].json.requestId);
});

test('相同 server 的旧账号请求在主进程入口拒绝，不能写入新账号',async()=>{
 const {captureRequest}=await import('../../capture-client.mjs');let called=false;const owner={identity:{server,deviceId:'B',token:'synthetic'},fetcher:async()=>{called=true;throw Error('should not send');}};
 await assert.rejects(captureRequest(owner,{server,deviceId:'A',method:'PUT',route:'/api/records/test',json:{}}),/资料空间已切换/);assert.equal(called,false);
});
