import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {IndexedRecordStore} from '../../../../packages/core/web/records/data/store.ts';
import {RecordsService} from '../../../../packages/core/web/records/data/service.ts';

test('excluding task inputs preserves cached originals, attachments, history and personal drafts across restart',async()=>{
 const base=new IndexedRecordStore(new IDBFactory()),status=async()=>({paired:true,server:'https://test.invalid',deviceId:'owner'});
 const personal={id:'personal',text:'我亲手写的碎片',attachments:[],version:1,createdAt:'2026-10-22T01:00:00Z'};
 const source={...personal,id:'task-source',text:'https://example.invalid/source',backups:[{at:'old',local:{text:'历史原件'}}]};
 let reply={records:[personal,source]};
 const transport={status,request:async()=>({status:200,json:structuredClone(reply)})};
 const service=new RecordsService(base,transport);await service.refresh();
 const cached=await service.store.get(source.id),blob=new Blob(['保留附件']);
 await service.store.put({...cached,attachments:[{id:'image',name:'source.txt',mime:'text/plain',blob,bytes:blob.size,sha256:'cached'}]});
 const draft=(await service.load()).draft;await service.saveDraft({...draft,text:'仍在写的个人草稿'});
 const before=await service.store.get(source.id),personalBefore=await service.store.get(personal.id);
 reply={records:[personal],excluded:[{id:source.id,origin:'collection_input'}]};await service.refresh();
 const after=await service.store.get(source.id);assert.equal(after.origin,'collection_input');
 const {origin,...unchanged}=after;assert.deepEqual(unchanged,before);
 assert.deepEqual(await service.store.get(personal.id),personalBefore);
 assert.equal(await after.attachments[0].blob.text(),'保留附件');assert.equal(after.deletedAt,before.deletedAt);
 assert.deepEqual((await service.load()).records.map(r=>r.id),[personal.id]);assert.equal((await service.load()).draft.text,'仍在写的个人草稿');
 // A stale response cannot put a classified input back into personal records.
 reply={records:[personal,source]};await service.refresh();
 assert.deepEqual((await service.load()).records.map(r=>r.id),[personal.id]);
 const restarted=new RecordsService(base,transport);assert.deepEqual((await restarted.load()).records.map(r=>r.id),[personal.id]);
 assert.equal((await restarted.load()).draft.text,'仍在写的个人草稿');assert.ok(await restarted.store.get(source.id));
});

test('new personal saves are explicitly user-origin and do not create a task',async()=>{
 let requests=0;
 const service=new RecordsService(new IndexedRecordStore(new IDBFactory()),{status:async()=>({paired:false,server:''}),request:async()=>{requests++;throw Error('offline');}});
 const {draft}=await service.load();const {item}=await service.saveRecord({...draft,text:'我写下的新想法'});
 assert.equal(item.origin,'user');assert.equal(requests,0);assert.equal((await service.load()).records[0].text,'我写下的新想法');
});


test('incremental exclusion wins over older content in the same page and advances the cursor',async()=>{
 const base=new IndexedRecordStore(new IDBFactory());
 const input={id:'old-input',text:'https://example.invalid/input',attachments:[],version:1,createdAt:'2026-10-22T01:00:00Z'};
 const epoch='11111111-1111-4111-8111-111111111111';let excluded=false;
 const service=new RecordsService(base,{status:async()=>({paired:true,server:'https://test.invalid',deviceId:'owner'}),request:async({route})=>{
  if(route==='/api/records/capabilities')return {status:200,json:{recordSyncProtocol:1}};
  return {status:200,json:excluded?{mode:'delta',cursor:epoch+':2',changes:[{seq:1,record:input}],excluded:[{id:input.id,origin:'collection_input'}]}:{mode:'snapshot',cursor:epoch+':1',records:[input]}};
 }});
 await service.sync();assert.equal((await service.load()).records.length,1);
 excluded=true;await service.refresh();assert.equal((await service.load()).records.length,0);
 assert.equal((await service.store.get(input.id)).text,input.text);assert.ok((await service.store.get(input.id)).deletedAt==null);
 assert.equal((await service.store.get('__record-sync__')).cursor,epoch+':2');
});
