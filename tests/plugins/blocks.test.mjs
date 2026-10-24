import test from 'node:test';
import assert from 'node:assert/strict';
import {structure,evaluate} from '../../plugins/blocks/protocol/model.mjs';
const fixture=()=>({...structure({title:'前沿文章',goals:[{id:'g',title:'文章',output:'article',parts:[{id:'p',title:'比较口径',conditions:['可比较'],dependsOn:[]}]}]}),revision:1,links:[]});
const link=(extra={})=>({id:'s',partId:'p',coverage:'full',relation:'support',conditions:['可比较'],...extra});
test('空材料与部分材料不能满足验收',()=>{const b=fixture();assert.equal(evaluate(b).goals[0].ready,false);b.links=[link({coverage:'partial'})];assert.equal(evaluate(b).goals[0].ready,false);});
test('完整证据满足条件，反证、过时与排除使评价回退',()=>{const b=fixture();b.links=[link()];assert.equal(evaluate(b).goals[0].ready,true);for(const extra of [{excluded:true},{expiresAt:'2000-01-01'},{relation:'contradiction'}]){b.links=[link(extra)];assert.equal(evaluate(b).goals[0].ready,false);}});
test('依赖未满足时不能提前搭建',()=>{const b=fixture();b.goals[0].parts.push({id:'q',title:'写作',conditions:['完成'],dependsOn:['p']});b.links=[link({partId:'q',conditions:['完成']})];assert.equal(evaluate(b).parts.find(p=>p.partId==='q').ready,false);});
test('拒绝依赖环与重复 ID',()=>{const b=fixture();b.goals[0].parts[0].dependsOn=['p'];assert.throws(()=>structure(b),/成环/);b.goals[0].parts[0].dependsOn=[];b.goals[0].parts.push(b.goals[0].parts[0]);assert.throws(()=>structure(b),/重复/);});

import {createBlockScheduler} from '../../plugins/blocks/server/scheduler.mjs';
test('持久化调度去重、暂停、每日额度及完成资料回流',async()=>{
 const rows=new Map();const store={async get(k,id){return structuredClone(rows.get(k+':'+id)||null);},async getForUpdate(k,id){return this.get(k,id);},async list(k){return [...rows.entries()].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v));},async put(k,v){rows.set(k+':'+v.id,structuredClone(v));return v;},async transaction(fn){return fn(this);}};
 const b={...fixture(),id:'b',paused:false,evaluations:[],dailyLimit:1};await store.put('block',b);
 let time=Date.parse('2026-10-24T00:00:00Z');const scheduler=createBlockScheduler({store,plugins:{enabled:async()=>true,assertEnabled:async()=>{}},clock:()=>time,saveTask:async(t,state,_m,tx)=>tx.put('task',{...t,state})});
 await scheduler.tick();await scheduler.tick();assert.equal((await store.list('task')).length,1);
 const task=(await store.list('task'))[0];assert.equal(task.type,'note');await store.put('archive',{id:'archive',entryId:'source',meta:{status:'archived'}});await store.put('task',{...task,state:'completed',archiveId:'archive'});
 await scheduler.tick();const linked=await store.get('block','b');assert.equal(linked.links.length,1);assert.equal(linked.links[0].relation,'lead');assert.equal(linked.evaluations.at(-1).goals[0].ready,false);
 await scheduler.tick();assert.equal((await store.get('block','b')).links.length,1);
 time+=86400000;await store.put('block',{...linked,paused:true});await scheduler.tick();assert.equal((await store.list('task')).length,1);
 await store.put('block',{...linked,paused:false});await scheduler.tick();assert.equal((await store.list('task')).length,2);
});

import {createBlockHandoff} from '../../plugins/blocks/server/handoff.mjs';
test('交接冻结版本、等待写作插件并避免重复创建',async()=>{
 const b={...fixture(),id:'b',links:[{...link(),kind:'entry',sourceId:'source',version:'v1'}]};const packets=new Map();let enabled=false,calls=0;
 const store={list:async()=>[structuredClone(b)],get:async(_k,id)=>packets.get(id),put:async(_k,p)=>{packets.set(p.id,p);}};
 const run=createBlockHandoff({store,plugins:{enabled:async id=>id==='blocks'||enabled},writeDraft:async packet=>{calls++;assert.equal(packet.sources[0].version,'v1');return{id:'draft'};}});
 await run();assert.equal([...packets.values()][0].state,'waiting_writing');assert.equal(calls,0);
 enabled=true;await run();await run();assert.equal(calls,1);assert.equal([...packets.values()][0].writingSessionId,'draft');
 b.links[0].excluded=true;await run();assert.equal(calls,1);assert.equal([...packets.values()][0].links[0].excluded,undefined);
});

import {createWriting} from '../../plugins/writing/server/writing.mjs';
test('写作交接创建一次实际草稿任务并固定记录版本',async()=>{
 const rows=new Map();const store={async get(k,id){return structuredClone(rows.get(k+':'+id)||null);},async getForUpdate(k,id){return this.get(k,id);},async put(k,v){rows.set(k+':'+v.id,structuredClone(v));return v;},async transaction(fn){return fn(this);}};
 await store.put('capture',{id:'record',version:2,text:'更新后',attachments:[]});await store.put('capture-version',{id:'record:1',version:1,text:'冻结的原文',attachments:[]});
 let queued=0;const writing=createWriting({store,serialized:async(_k,fn)=>fn(),saveTask:async(task,state,_message,tx)=>{queued++;assert.equal(task.writingMode,'draft');assert.equal(task.writingSnapshot.sources[0].text,'冻结的原文');await tx.put('task',{...task,state});}});
 const packet={id:'packet',title:'文章',parts:[{title:'章节'}],sources:[{kind:'record',id:'record',version:1,role:'material'}]};
 const a=await writing.acceptHandoff(packet),b=await writing.acceptHandoff(packet);assert.equal(a.id,b.id);assert.equal(queued,1);assert.equal((await store.get('writing-session',a.id)).blockHandoffId,'packet');
});

import {validateMatches,sourceKey,fingerprint} from '../../plugins/blocks/protocol/matching.mjs';
import {createBlockMatching} from '../../plugins/blocks/server/matching.mjs';
import {canRunTask} from '../../packages/core/node/task-routing.mjs';
test('语义支持必须引用输入正文，拒绝虚构引句与未知条件',()=>{
 const snapshot={goals:fixture().goals,sources:[{key:'k',text:'本文统一比较口径，可比较的基准需要相同任务。'}]};
 const value={protocol:1,matches:[{sourceKey:'k',partId:'p',relation:'support',reason:'明确约束比较口径',evidence:[{condition:'可比较',quote:'可比较的基准需要相同任务'}]}]};
 assert.equal(validateMatches(value,snapshot).matches.length,1);
 const bad=structuredClone(value);bad.matches[0].evidence[0].quote='未出现在原文的说法';assert.throws(()=>validateMatches(bad,snapshot),/来源定位/);
 bad.matches[0].evidence[0]={condition:'未知条件',quote:'可比较的基准需要相同任务'};assert.throws(()=>validateMatches(bad,snapshot));
});
test('语义扫描按内容版本增量推进，暂停和目标变化影响任务',async()=>{
 const rows=new Map();const store={async get(k,id){return structuredClone(rows.get(k+':'+id)||null);},async getForUpdate(k,id){return this.get(k,id);},async list(k){return [...rows.entries()].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v));},async put(k,v){rows.set(k+':'+v.id,structuredClone(v));return v;},async transaction(fn){return fn(this);}};
 const b={...fixture(),id:'b',links:[],evaluations:[]};await store.put('block',b);
 let sources=[{kind:'record',sourceId:'r',version:'1',text:'比较任务',coverage:'full'}].map(s=>({...s,key:sourceKey(s)}));
 const matching=createBlockMatching({store,plugins:{enabled:async()=>true,assertEnabled:async()=>{}},readSources:async()=>sources,saveTask:async(t,state,_m,tx)=>tx.put('task',{...t,state})});
 await matching.scan();await matching.scan();assert.equal((await store.list('task')).length,1);
 const t=(await store.list('task'))[0];await store.put('task',{...t,state:'completed'});await matching.scan();assert.equal((await store.list('task')).length,1);
 sources=[{...sources[0],version:'2'}].map(s=>({...s,key:sourceKey(s)}));await matching.scan();assert.equal((await store.list('task')).length,2);
 const t2=(await store.list('task'))[1];assert.equal(t2.blockSnapshot.sources[0].version,'2');
});

test('过时来源不参与成熟度评价',()=>{const b=fixture();b.links=[link({stale:true})];assert.equal(evaluate(b).goals[0].ready,false);});
test('关联理由改写不重复创建同一版本成果',async()=>{
 const b={...fixture(),id:'b',links:[{...link(),kind:'entry',sourceId:'source',version:'v1',reason:'第一种表述'}]};const packets=new Map();let calls=0;
 const run=createBlockHandoff({store:{list:async()=>[structuredClone(b)],get:async(_k,id)=>packets.get(id),put:async(_k,p)=>packets.set(p.id,p)},plugins:{enabled:async()=>true},writeDraft:async()=>{calls++;return{id:'draft'};}});
 await run();b.links[0].reason='第二种表述';await run();assert.equal(calls,1);
});

test('一个部件等待人工处理时仍可收集其他部件',async()=>{
 const b={...fixture(),id:'b',evaluations:[]};b.goals[0].parts.push({id:'second',title:'制作',conditions:['明确制作流程'],dependsOn:[]});
 const tasks=[{id:'waiting',blockId:'b',blockPartId:'p',purpose:'blocks-research',state:'waiting_action',createdAt:'2026-10-23T00:00:00Z'}];
 const store={getForUpdate:async()=>structuredClone(b),list:async k=>k==='block'?[b]:tasks,put:async()=>{},transaction:async fn=>fn(store)};
 const scheduler=createBlockScheduler({store,plugins:{enabled:async()=>true,assertEnabled:async()=>{}},clock:()=>Date.parse('2026-10-24T00:00:00Z'),saveTask:async task=>tasks.push(task)});
 await scheduler.tick();assert.equal(tasks.length,2);assert.equal(tasks[1].blockPartId,'second');
});
