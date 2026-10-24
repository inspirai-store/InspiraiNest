import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlockScheduler} from '../../plugins/blocks/server/scheduler.mjs';
import {createBlockMatching} from '../../plugins/blocks/server/matching.mjs';
import {fingerprint} from '../../plugins/blocks/protocol/matching.mjs';
import {rankSources} from '../../plugins/blocks/protocol/research.mjs';
import {supportsBlocksTask} from '../../packages/core/node/task-routing.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../../services/api/storage/store.mjs';
const block=()=>({id:'b',title:'REA 研究',revision:1,links:[],evaluations:[],goals:[{id:'g',title:'REA 能力与接入',output:'product',parts:[{id:'p',title:'REA 能力边界',conditions:['有依据的范围'],dependsOn:[]},{id:'q',title:'接入建议',conditions:['有依据的方案'],dependsOn:['p']}]}],collectionPlan:[{partId:'p',existing:['智能音箱案例'],external:['https://github.com/morluto/rea']}]});
function memory(){const rows=new Map();return{async get(k,id){return structuredClone(rows.get(k+':'+id)||null);},async getForUpdate(k,id){return this.get(k,id);},async list(k){return [...rows.entries()].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v));},async put(k,v){rows.set(k+':'+v.id,structuredClone(v));},async transaction(fn){return fn(this);}};}
const plugins={enabled:async()=>true,assertEnabled:async()=>{}};
const saveTask=(t,state,_m,tx)=>tx.put('task',{...t,state});
test('SQLite 宿主读取冻结来源不被积木事务锁住',{timeout:2000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blocks-sqlite-')),store=new Store(path.join(dir,'test.db'));t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 await store.put('block',block());await store.put('capture',{id:'r',text:'REA 本地笔记'});
 const scheduler=createBlockScheduler({store,plugins,saveTask,readSources:async()=>(await store.list('capture')).map(r=>({kind:'record',sourceId:r.id,version:'1',text:r.text,coverage:'full'}))});
 await scheduler.tick();assert.equal((await store.list('task'))[0].blockResearchSnapshot.sources[0].text,'REA 本地笔记');
});
test('相关来源优先且不遗漏无关资料，REA 不误命中 create',async()=>{
 const b=block(),sources=[{title:'create a page',text:'read about creation'},{title:'REA 智能音箱案例',text:'固件分析'},{title:'其他记录',text:'无关'}].map((s,i)=>({...s,kind:'entry',sourceId:String(i),version:'v'+i,key:'k'+i}));
 assert.equal(rankSources(b,sources)[0].sourceId,'1');assert.equal(rankSources(b,sources).length,3);
 const store=memory();await store.put('block',b);
 await createBlockMatching({store,plugins,saveTask,readSources:async()=>sources}).scan();assert.equal((await store.list('task'))[0].blockSnapshot.sources[0].sourceId,'1');
});
test('完成首批后研究不被旧匹配队列阻塞，冻结正文与计划且旧节点不得领取',async()=>{
 const store=memory(),b=block();await store.put('block',b);
 const match={id:'m',blockId:b.id,purpose:'blocks-match',state:'completed',blockSnapshot:{goalsHash:fingerprint([b.goals,0]),sources:[]}};await store.put('task',match);await store.put('task',{...match,id:'next',state:'queued'});
 const sources=[{kind:'entry',sourceId:'case',version:'v1',title:'REA 案例',text:'实际保存的正文',coverage:'full',sourceUrl:'https://example.org/case'}];
 const scheduler=createBlockScheduler({store,plugins,saveTask,readSources:async()=>sources,clock:()=>Date.parse('2026-10-25T00:00:00Z')});await scheduler.tick();await scheduler.tick();
 const task=(await store.list('task')).find(t=>t.purpose==='blocks-research');assert.ok(task);assert.equal((await store.list('task')).filter(t=>t.purpose==='blocks-research').length,1);
 assert.equal(task.blockResearchSnapshot.sources[0].text,'实际保存的正文');assert.match(task.content,/github.com\/morluto\/rea/);assert.deepEqual(task.blockResearchSnapshot.part.conditions,b.goals[0].parts[0].conditions);
 assert.equal(supportsBlocksTask(task,{blocksProtocol:1}),false);assert.equal(supportsBlocksTask(task,{blocksProtocol:1,blocksResearchProtocol:1}),true);
});
test('新资料经匹配取得进展后同日继续下一缺口，无进展则退避且不重复创建',async()=>{
 const store=memory(),b=block();await store.put('block',b);let time=Date.parse('2026-10-25T00:00:00Z');
 const scheduler=createBlockScheduler({store,plugins,saveTask,clock:()=>time});await scheduler.tick();const first=(await store.list('task'))[0];
 await store.put('archive',{id:'v1',entryId:'research',meta:{status:'archived'}});await store.put('task',{...first,state:'completed',archiveId:'v1'});await scheduler.tick();assert.equal((await store.list('task')).length,1);
 let live=await store.get('block','b');live.links=[{id:'proof',kind:'entry',sourceId:'research',version:'v1',partId:'p',relation:'support',coverage:'full',conditions:['有依据的范围']}];await store.put('block',live);
 await store.put('task',{id:'m',blockId:'b',purpose:'blocks-match',state:'completed',blockSnapshot:{goalsHash:fingerprint([b.goals,0]),sources:[{version:'v1'}]}});time+=1000;await scheduler.tick();
 const research=(await store.list('task')).filter(t=>t.purpose==='blocks-research');assert.equal(research.length,2);assert.equal(research[1].blockPartId,'q');assert.equal(research[1].blockResearchSnapshot.baselineConditions,1);
 await store.put('task',{...research[1],state:'failed'});await scheduler.tick();await scheduler.tick();assert.equal((await store.list('task')).filter(t=>t.purpose==='blocks-research').length,2);assert.ok(Date.parse((await store.get('block','b')).nextCheckAt)>time);
});

test('计划中的网址不能让无关链接排在 REA 原文前面',()=>{
 const b=block();b.title='REA 能力与可信度研究及灵藏接入参考';b.goals[0].parts[0].title='智能音箱案例复用梳理';b.collectionPlan=[{partId:'p',existing:['确认计划后优先匹配智能音箱案例的已有记录、附件、操作日志与结果材料'],external:['以 https://github.com/morluto/rea 为入口补充官方文档']}];
 const noise=Array.from({length:12},(_,i)=>({kind:'record',sourceId:'r'+i,title:'https://mp.weixin.qq.com/s/other'+i,text:'https://mp.weixin.qq.com/s/other'+i}));
 const original={kind:'entry',sourceId:'rea-case',title:'DeepSeek 搭配 Hermes 使用 REA 逆向智能音箱实现家庭助理贾维斯',text:'REA 分析固件及调用链。',sourceUrl:'https://mp.weixin.qq.com/s/case'};
 assert.equal(rankSources(b,[...noise,original])[0].sourceId,'rea-case');
 b.collectionPlan[0].external.push('https://[invalid','https://example.org/%zz');assert.doesNotThrow(()=>rankSources(b,[original]));
});
