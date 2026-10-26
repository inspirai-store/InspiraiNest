import {randomUUID} from 'node:crypto';
import {hash,canonicalJson,requireValue} from '../../../packages/core/node/common.mjs';
import {structure} from '../protocol/model.mjs';
import {validatePlanResult} from '../protocol/planning.mjs';
const active=new Set(['queued','assigned','running','uploading']);
const uuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
export function createBlockPlanning({store,plugins,owner,body,send,serialized,saveTask,assigned,authenticate,checkAssignment,onChanged=()=>{},clock=Date.now}){
 const now=()=>new Date(clock()).toISOString();
 async function view(plan){const task=plan.taskId?await store.get('task',plan.taskId):null;return{...plan,status:plan.blockId?'confirmed':active.has(task?.state)?'processing':['failed','waiting_action','interrupted','cancelled'].includes(task?.state)?'blocked':plan.proposal?'ready':'question',run:task?{id:task.id,state:task.state,message:task.events?.at(-1)?.message||''}:null};}
 async function queue(plan,tx){
  const task={id:randomUUID(),pluginId:'blocks',purpose:'blocks-plan',blockPlanId:plan.id,type:'note',url:null,autoArchive:false,deviceId:null,archiveId:null,createdAt:now(),content:'规划积木：'+plan.brief.slice(0,120),blockPlanSnapshot:{protocol:1,planId:plan.id,revision:plan.revision,brief:plan.brief,turns:plan.turns,questionCount:plan.questionCount}};
  await saveTask(task,'queued','等待电脑组织积木计划',tx);plan.taskId=task.id;
 }
 async function result(req,res,device,taskId){
  const task=await assigned(device,taskId,req);requireValue(task.purpose==='blocks-plan','计划任务无效',409);
  const value=validatePlanResult(await body(req),task.blockPlanSnapshot);await authenticate(req);
  await serialized('claim',()=>store.transaction(async tx=>{
   await plugins.assertEnabled('blocks',tx,true);
   const node=await tx.getForUpdate('device',device.id);requireValue(node&&!node.revokedAt&&node.tokenHash===device.tokenHash,'节点授权已撤销',401);
   const live=await tx.getForUpdate('task',task.id);checkAssignment(device,live,req);
   if(live.state==='completed'){requireValue(hash(canonicalJson(live.blockPlanResult))===hash(canonicalJson(value)),'计划结果已提交',409);return;}
   requireValue(['assigned','running','uploading'].includes(live.state),'计划任务已停止',409);
   const plan=await tx.getForUpdate('block-plan',live.blockPlanId);
   requireValue(plan&&!plan.blockId&&plan.taskId===live.id&&plan.revision===live.blockPlanSnapshot.revision,'讨论已更新，请使用新一轮结果',409);
   plan.turns.push({id:live.id,role:'assistant',at:now(),...value,...(value.question?{question:{...value.question,id:live.id}}:{})});
   if(value.question)plan.questionCount++;
   plan.proposal=value.proposal;plan.revision++;plan.updatedAt=now();await tx.put('block-plan',plan);
   await saveTask({...live,blockPlanResult:value},'completed',value.question?'等待回答关键问题':'积木计划已生成',tx);
  }));send(res,200,{saved:true});return true;
 }
 return {async handle(req,res,url,device){
  const callback=url.pathname.match(/^\/api\/blocks\/plans\/results\/([a-f0-9-]{36})$/);
  if(callback&&req.method==='POST')return result(req,res,device,callback[1]);
  if(url.pathname!=='/api/blocks/plans'&&!url.pathname.startsWith('/api/blocks/plans/'))return false;
  owner(device);const route=url.pathname.match(/^\/api\/blocks\/plans(?:\/([a-f0-9-]{36})(?:\/(turns|confirm|retry))?)?$/);requireValue(route,'计划接口不存在',404);
  const [,planId,operation]=route;
  if(req.method==='GET'&&!operation){if(!planId){send(res,200,{items:await Promise.all((await store.list('block-plan')).map(view))});return true;}const plan=await store.get('block-plan',planId);requireValue(plan,'计划不存在',404);send(res,200,await view(plan));return true;}
  requireValue(req.method==='POST'&&(!planId||operation),'不支持的计划操作',405);
  const input=await body(req);requireValue(uuid(input.requestId),'缺少稳定请求编号');const action=operation||'create',receiptId=(planId||'new')+':'+input.requestId,requestHash=hash(canonicalJson({action,input}));await authenticate(req);
  const savedId=await serialized('claim',()=>store.transaction(async tx=>{
   await plugins.assertEnabled('blocks',tx,true);
   const credential=await tx.getForUpdate('device',device.credentialId||device.id);requireValue(credential&&!credential.revokedAt&&(credential.tokenHash===device.credentialTokenHash||credential.ownerTokenHash===device.credentialTokenHash),'Device authorization required',401);
   const receipt=await tx.getForUpdate('block-plan-receipt',receiptId);if(receipt){requireValue(receipt.hash===requestHash,'请求编号已用于其他内容',409);return receipt.planId;}
   let plan;
   if(action==='create'){
    requireValue(typeof input.brief==='string'&&input.brief.trim()&&input.brief.length<=10000,'请说一句积木想法');
    plan={id:randomUUID(),revision:1,brief:input.brief.trim(),turns:[],questionCount:0,proposal:null,blockId:null,createdAt:now(),updatedAt:now()};await queue(plan,tx);
   }else{
    plan=await tx.getForUpdate('block-plan',planId);requireValue(plan,'计划不存在',404);requireValue(plan.revision===input.revision,'计划已更新，本机输入保留，请刷新后继续',409);requireValue(!plan.blockId,'计划已创建积木',409);
    const task=await tx.getForUpdate('task',plan.taskId);
    if(input.proposal){requireValue(plan.proposal,'请先生成候选计划',409);plan.proposal=validatePlanResult({protocol:1,stage:'proposal',reply:'手动调整计划',proposal:input.proposal},{questionCount:plan.questionCount}).proposal;}
    if(action==='confirm'){
     requireValue(!active.has(task?.state)&&task?.state==='completed'&&plan.proposal,'请先完成计划讨论',409);
     const block={...structure(plan.proposal),id:randomUUID(),revision:1,paused:false,researchEnabled:false,planId:plan.id,collectionPlan:plan.proposal.collectionPlan,assumptions:plan.proposal.assumptions,links:[],evaluations:[],createdAt:now(),updatedAt:now()};await tx.put('block',block);plan.blockId=block.id;
    }else{
     if(action==='retry'){requireValue(['failed','waiting_action','interrupted','cancelled'].includes(task?.state),'当前计划不需要重试',409);}
     else{
      requireValue(typeof(input.message??'')==='string'&&(input.message||'').length<=10000,'回答过长或无效');
      const question=plan.turns.at(-1)?.question;const answer=input.answer;
      if(answer){requireValue(question&&answer.questionId===question.id,'问题已更新，请刷新',409);requireValue(answer.optionId===undefined||question.options.some(o=>o.id===answer.optionId),'答案选项无效');requireValue(answer.uncertain===undefined||typeof answer.uncertain==='boolean','回答状态无效');}
      requireValue(input.message?.trim()||answer?.optionId||answer?.uncertain,'请选择答案或补充一句想法');
      if(active.has(task?.state)||task?.state==='waiting_action')await saveTask({...task,assignmentId:randomUUID()},'cancelled','讨论已更新，等待重新规划',tx);
      plan.turns.push({id:input.requestId,role:'user',text:(input.message||'').trim(),...(input.proposal?{editedProposal:plan.proposal}:{}),...(answer?{answer:{questionId:question.id,...(answer.optionId?{optionId:answer.optionId,label:question.options.find(o=>o.id===answer.optionId).label}:{}),uncertain:answer.uncertain===true}}:{}),at:now()});
     }
     plan.revision++;plan.proposal=null;await queue(plan,tx);
    }
    if(action==='confirm')plan.revision++;plan.updatedAt=now();
   }
   await tx.put('block-plan',plan);await tx.put('block-plan-receipt',{id:receiptId,planId:plan.id,hash:requestHash});return plan.id;
  }));const plan=await store.get('block-plan',savedId);send(res,200,await view(plan));if(plan.blockId)onChanged();return true;
 }};
}
