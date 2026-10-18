import {RecordsService} from '../../../../packages/core/web/records/data/service.ts';
import {IndexedRecordStore} from '../../../../packages/core/web/records/data/store.ts';
import {errorMessage} from '../../../../packages/core/web/shared/errors.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {EditorState} from '@tiptap/pm/state';
import {history,undo} from '@tiptap/pm/history';
import {Node} from '@tiptap/core';
import {IDBFactory} from 'fake-indexeddb';
import {MappedTarget,targetSnapshot,applyWriting,continuousText} from '../../../../plugins/writing/web/selection-writing/target.ts';
import {WritingStore} from '../../../../plugins/writing/web/selection-writing/store.ts';
import {WritingClient} from '../../../../plugins/writing/web/selection-writing/client.ts';
import {defaultForm,diffText,mergeRemote} from '../../../../plugins/writing/web/selection-writing/model.ts';
const Attachment=Node.create({name:'attachment',group:'block',atom:true,addAttributes(){return {id:{default:'media'}};}});
const schema=getSchema([StarterKit,Attachment]),source={kind:'draft',id:'draft-A',title:'回归',version:0};
const doc=(...texts)=>schema.node('doc',null,texts.map(text=>schema.node('paragraph',null,text?schema.text(text):undefined)));
test('mapped target follows outside edits and invalidates inside edits, marks, removal and stale document restoration',()=>{
 const start=doc('前文选区后文','下一段'),target=new MappedTarget(targetSnapshot(source,start,3,5));let state=EditorState.create({doc:start});let tr=state.tr.insertText('新增',1);target.map(tr);state=state.apply(tr);assert(target.validate(state.doc));assert.equal(target.snapshot.from,5);assert.equal(state.doc.textBetween(5,7),'选区');
 const restarted=new MappedTarget(structuredClone(target.snapshot));assert(restarted.validate(state.doc));assert(!restarted.validate(start));
 tr=state.tr.insertText('变化',6);target.map(tr);assert.equal(target.snapshot.valid,false);assert(!target.validate(tr.doc));
 const mark=new MappedTarget(targetSnapshot(source,start,3,5));mark.map(EditorState.create({doc:start}).tr.addMark(3,5,schema.marks.bold.create()));assert(!mark.snapshot.valid);
 const removed=new MappedTarget(targetSnapshot(source,start,3,5));removed.map(EditorState.create({doc:start}).tr.delete(2,6));assert(!removed.snapshot.valid);
});
test('replacement and insertion are a single undo and preserve outside marks, text and attachment nodes; HTML stays text',()=>{
 for(const mode of ['replace','insert']){
  const start=schema.node('doc',null,[schema.node('paragraph',null,[schema.text('前文',[schema.marks.bold.create()]),schema.text('选区后文')]),schema.node('attachment'),schema.node('paragraph',null,schema.text('尾段'))]);
  let state=EditorState.create({doc:start,plugins:[history()]});const editor={get state(){return state;},schema,isEditable:true,view:{dispatch:tr=>{state=state.apply(tr);},focus:()=>{}}};
  const tracker=new MappedTarget(targetSnapshot(source,start,3,5));applyWriting(editor,tracker,'新文字\n<b>纯文本</b>',mode);assert.equal(state.doc.child(0).child(0).marks[0].type.name,'bold');assert.equal(state.doc.lastChild.textContent,'尾段');let media=0;state.doc.descendants(node=>{if(node.type.name==='attachment')media++;});assert.equal(media,1);assert.match(state.doc.textContent,/<b>纯文本<\/b>/);assert.equal(state.doc.textContent.includes('选区'),mode==='insert');assert(undo(state,tr=>{state=state.apply(tr);}));assert(state.doc.eq(start));assert(!undo(state,()=>{}));
 }
 const media=schema.node('doc',null,[schema.node('paragraph',null,schema.text('文字')),schema.node('attachment'),schema.node('paragraph',null,schema.text('描述'))]);assert(!continuousText(media,1,media.content.size-1));
});
test('writing stores isolate accounts and preserve requirements, pending IDs and results across new instances',async()=>{
 const factory=new IDBFactory(),store=new WritingStore(factory);const selection={source,text:'选区',fullText:'仅本篇全文'};const job={id:'request-one',scope:'A',selection,form:defaultForm(),createdAt:new Date().toISOString(),request:{requestId:'request-one'},remote:{id:'remote-one',state:'completed',updatedAt:'2026',result:{protocol:1,text:'结果'}}};
 await store.put(job);await store.put({...job,id:'b',scope:'B',selection:{...selection,text:'B 私有'}});await store.put({...job,form:{...job.form,instructions:'保留要求'}});const restored=await new WritingStore(factory).load('A');assert.equal(restored.length,1);assert.equal(restored[0].form.instructions,'保留要求');assert.equal(restored[0].remote.result.text,'结果');assert.equal((await store.load('B'))[0].selection.text,'B 私有');
});
test('late replies and cancellation do not leak across account switches; diff preserves Unicode',async()=>{
 let connection={paired:true,server:'https://a.invalid',deviceId:'a'},finish;const transport={status:async()=>({...connection}),request:async()=>await new Promise(resolve=>{finish=resolve;})};const client=new WritingClient(transport,{...connection});const pending=client.get('task');while(!finish)await new Promise(r=>setImmediate(r));connection={paired:true,server:'https://b.invalid',deviceId:'b'};client.invalidate();finish({status:200,json:{id:'private-a'}});await assert.rejects(pending,/已切换/);
 const job={remote:{id:'x',state:'cancelled',updatedAt:'2026'}};assert.equal(mergeRemote(job,{state:'completed',updatedAt:'2027'}),job);assert.equal(errorMessage("Error invoking remote method 'library:capture': TypeError: fetch failed"),'连接失败，请重试');assert.deepEqual(diffText('甲😀旧乙','甲😀新乙'),{prefix:'甲😀',removed:'旧',added:'新',suffix:'乙'});
});

test('a stale result save cannot adopt the new account even before the next status request',async()=>{
 const service=new RecordsService(new IndexedRecordStore(new IDBFactory()),{status:async()=>({paired:true,server:'https://b.invalid',deviceId:'B'}),request:async()=>{throw Error('No network write expected');}});await assert.rejects(service.createFromSelection('A 私有结果','A 来源',undefined,false,JSON.stringify(['https://a.invalid','A'])),/已切换/);assert.equal((await service.load()).records.length,0);
});
