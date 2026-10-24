import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './writing-fixture.mjs';
import {validatePlanResult} from '../../plugins/blocks/protocol/planning.mjs';
import {supportsBlocksTask,canRunTask} from '../../packages/core/node/task-routing.mjs';
import {validateCaptureRequest} from '../../packages/core/node/capture-request.mjs';
import {api} from '../../services/worker/worker.mjs';
import {mysqlFixture} from './mysql-fixture.mjs';
const question={protocol:1,stage:'question',reply:'先确定这件事最重要的产物。',question:{title:'你想先验证什么？',options:[{id:'mvp',label:'最小可用产品'},{id:'feasibility',label:'可行性'}]},proposal:null};
export const proposal={protocol:1,stage:'proposal',reply:'先明确流程，再逐步补齐证据。',question:null,proposal:{title:'AI 运营账号',goals:[{id:'g',title:'运营方案',output:'product',parts:[{id:'p',title:'运营流程',conditions:['明确选题、制作、发布和复盘流程'],dependsOn:[]}]}],collectionPlan:[{partId:'p',existing:['查找已有运营记录'],external:['补充公开平台规则与案例']}],assumptions:['具体执行频率待验证']}};
async function setup(t,options){
 const f=await fixture(t,options);let plugin=(await f.request('/api/plugins')).value;await f.request('/api/plugins/blocks','PUT',{revision:plugin.revision,enabled:true});
 const worker=await f.worker();await api(worker,'/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],blocksProtocol:1,blocksPlanningProtocol:1,recordProtocol:1});
 const create=async(brief='我要做一个 AI 运营 B 站账号的产品',extra={})=>f.request('/api/blocks/plans','POST',{brief,requestId:randomUUID(),...extra});
 const read=async id=>(await f.request('/api/blocks/plans/'+id)).value;
 const change=(p,action,input={})=>f.request(`/api/blocks/plans/${p.id}/${action}`,'POST',{revision:p.revision,requestId:randomUUID(),...input});
 const submit=(task,value)=>f.request('/api/blocks/plans/results/'+task.id,'POST',value,worker,task.assignmentId);
 const ready=async()=>{let p=(await create()).value;let task=await f.claim(worker);assert.equal(task.purpose,'blocks-plan');assert.equal((await submit(task,question)).status,200);p=await read(p.id);assert.equal((await change(p,'turns',{answer:{questionId:p.turns.at(-1).question.id,optionId:'mvp'}})).status,200);task=await f.claim(worker);assert.equal((await submit(task,proposal)).status,200);return read(p.id);};
 return{...f,worker,create,read,change,submit,ready};
}
test('一句话讨论先问问题，确认前只保存计划，确认后先匹配旧资料',async t=>{
 const f=await setup(t),createId=randomUUID();const initial=await f.create(undefined,{requestId:createId});assert.equal(initial.status,200,JSON.stringify(initial.value));
 const replay=await f.create(undefined,{requestId:createId});assert.equal(initial.value.id,replay.value.id);assert.equal((await f.app.store.list('block-plan')).length,1);assert.equal((await f.app.store.list('block')).length,0);
 let p=initial.value;const task=await f.claim(f.worker);assert.equal(task.blockPlanSnapshot.questionCount,0);assert.equal((await f.change(p,'confirm')).status,409);assert.equal((await f.submit(task,proposal)).status,400);assert.equal((await f.submit(task,question)).status,200);assert.equal((await f.submit(task,question)).status,200,'result replay');
 p=await f.read(p.id);assert.equal(p.status,'question');assert.equal(p.turns.at(-1).question.options.length,2);
 assert.equal((await f.change(p,'turns',{answer:{questionId:'old',optionId:'mvp'}})).status,409);
 const answered=await f.change(p,'turns',{answer:{questionId:p.turns.at(-1).question.id,uncertain:true},message:'先把最小闭环组织出来'});assert.equal(answered.status,200);const next=await f.claim(f.worker);assert.equal((await f.submit(next,proposal)).status,200);
 p=await f.read(p.id);assert.equal(p.status,'ready');assert.equal(p.proposal.goals[0].parts[0].title,'运营流程');
 const at=new Date().toISOString(),rid=randomUUID();await f.app.store.put('capture',{id:rid,text:'运营流程有选题、制作、发布和复盘。',version:1,attachments:[],createdAt:at,updatedAt:at});
 const requestId=randomUUID(),confirm=await f.change(p,'confirm',{requestId});assert.equal(confirm.status,200);const again=await f.change(p,'confirm',{requestId});assert.equal(again.value.blockId,confirm.value.blockId);assert.equal((await f.app.store.list('block')).length,1);
 await new Promise(r=>setTimeout(r,80));const b=await f.app.store.get('block',confirm.value.blockId);assert.equal(b.researchEnabled,false);assert.equal(b.planId,p.id);assert.equal(b.collectionPlan[0].partId,'p');
 const tasks=await f.app.store.list('task');assert.ok(tasks.some(t=>t.purpose==='blocks-match'));assert.ok(!tasks.some(t=>t.purpose==='blocks-research'));assert.equal((await f.app.store.list('block-handoff')).length,0);
 const match=await f.claim(f.worker);assert.equal(match.purpose,'blocks-match');assert.equal((await f.request('/api/blocks/matches/'+match.id,'POST',{protocol:1,matches:[]},f.worker,match.assignmentId)).status,200);
 const matched=await f.app.store.get('block',b.id);const enabled=await f.request('/api/blocks/'+b.id+'/research','POST',{revision:matched.revision,enabled:true});assert.equal(enabled.status,200);await new Promise(r=>setTimeout(r,80));assert.equal((await f.app.store.list('task')).filter(t=>t.purpose==='blocks-research').length,1);
 const current=await f.app.store.get('block',b.id);const stopped=await f.request('/api/blocks/'+b.id+'/research','POST',{revision:current.revision,enabled:false});assert.equal(stopped.status,200);assert.equal((await f.app.store.list('task')).find(t=>t.purpose==='blocks-research').state,'cancelled');
});
test('调整计划使旧轮次失效，版本冲突、重试和手动精修保留结构',async t=>{
 const f=await setup(t);let p=(await f.create()).value;const old=await f.claim(f.worker);const edited=await f.change(p,'turns',{message:'先缩小到一个月内能验证的范围'});assert.equal(edited.status,200);assert.equal((await f.submit(old,question)).status,409);
 assert.equal((await f.change(p,'turns',{message:'过时要求'})).status,409);const current=await f.claim(f.worker);assert.equal((await f.submit(current,question)).status,200);
 p=await f.read(p.id);await f.change(p,'turns',{message:'做最小产品'});const task=await f.claim(f.worker);assert.equal((await f.request(`/api/tasks/${task.id}/progress`,'POST',{state:'waiting_action',message:'等待 Agent 登录'},f.worker,task.assignmentId)).status,200);
 p=await f.read(p.id);assert.equal(p.status,'blocked');assert.equal((await f.change(p,'retry')).status,200);const retried=await f.claim(f.worker);assert.notEqual(retried.id,task.id);assert.equal((await f.submit(retried,proposal)).status,200);
 p=await f.read(p.id);const manual=structuredClone(p.proposal);manual.title='用户精修后的名称';const done=await f.change(p,'confirm',{proposal:manual});assert.equal(done.status,200);assert.equal((await f.app.store.get('block',done.value.blockId)).title,manual.title);
});
test('计划结果不得无限追问、捏造材料关联或提交错误依赖',()=>{
 assert.throws(()=>validatePlanResult(proposal,{questionCount:0}),/先通过/);assert.throws(()=>validatePlanResult(question,{questionCount:3}),/不再追加/);
 const bad=structuredClone(proposal);bad.proposal.goals[0].parts[0].dependsOn=['p'];assert.throws(()=>validatePlanResult(bad,{questionCount:1}),/成环/);
 const incomplete=structuredClone(proposal);incomplete.proposal.collectionPlan=[];assert.throws(()=>validatePlanResult(incomplete,{questionCount:1}),/每个部件/);
 const value=validatePlanResult({...proposal,links:[{relation:'support'}]},{questionCount:1});assert.equal(value.links,undefined);assert.equal(value.proposal.links,undefined);
});
test('新规划协议筛选覆盖旧 Worker 与 capture 入口白名单',()=>{
 const task={pluginId:'blocks',purpose:'blocks-plan',type:'note'};assert.equal(supportsBlocksTask(task,{blocksProtocol:1}),false);assert.equal(supportsBlocksTask(task,{blocksProtocol:1,blocksPlanningProtocol:1}),true);assert.equal(supportsBlocksTask({...task,purpose:'blocks-match'},{blocksProtocol:1}),true);
 assert.equal(canRunTask(task,{role:'worker',blocksProtocol:1,agents:['codex'],capabilities:['note']}),false);
 const id=randomUUID();for(const input of [{route:'/api/blocks/plans'},{route:'/api/blocks/plans',method:'POST'},{route:'/api/blocks/plans/'+id},{route:'/api/blocks/plans/'+id+'/turns',method:'POST'},{route:'/api/blocks/'+id+'/research',method:'POST'}])assert.doesNotThrow(()=>validateCaptureRequest(input));
 assert.throws(()=>validateCaptureRequest({route:'/api/blocks/plans/results/'+id,method:'POST'}),/not allowed/);
});
test('关闭插件保留计划，拒绝继续规划但可恢复读取',async t=>{
 const f=await setup(t),p=(await f.create()).value;await f.request('/api/tasks/'+p.taskId+'/cancel','POST',{});const config=(await f.request('/api/plugins')).value;assert.equal((await f.request('/api/plugins/blocks','PUT',{revision:config.revision,enabled:false})).status,200);assert.equal((await f.read(p.id)).brief,p.brief);assert.equal((await f.change(await f.read(p.id),'turns',{message:'继续'})).status,409);assert.ok(await f.app.store.get('block-plan',p.id));
});
test('MySQL 实际事务保存逐题计划，并发确认只生成一个积木',{skip:!process.env.MYSQL_URL},async t=>{
 const f=await setup(t,{store:await mysqlFixture()}),p=await f.ready(),requestId=randomUUID();const replies=await Promise.all([f.change(p,'confirm',{requestId}),f.change(p,'confirm',{requestId})]);assert.ok(replies.every(r=>r.status===200));assert.equal(replies[0].value.blockId,replies[1].value.blockId);assert.equal((await f.app.store.list('block')).length,1);const saved=await f.app.store.transaction(tx=>tx.getForUpdate('block-plan',p.id));assert.equal(saved.turns.filter(t=>t.role==='assistant').length,2);assert.equal(saved.blockId,replies[0].value.blockId);assert.equal((await f.app.store.get('block',saved.blockId)).researchEnabled,false);
});
