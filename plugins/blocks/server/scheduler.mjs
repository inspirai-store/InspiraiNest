import {randomUUID} from 'node:crypto';
import {evaluate} from '../protocol/model.mjs';
import {fingerprint} from '../protocol/matching.mjs';
import {rankSources} from '../protocol/research.mjs';
const dayKey=at=>new Date(new Date(at).getTime()+8*3600000).toISOString().slice(0,10);
const pending=new Set(['queued','assigned','running','uploading']);
// Scheduling is durable: the block and its new queue item commit together.
export function createBlockScheduler({store,plugins,saveTask,readSources=async()=>[],clock=Date.now}){
 async function tick(){
  if(!await plugins.enabled('blocks'))return;
  const items=await store.list('block');
  // Read through the host before taking a block transaction (also supports SQLite).
  const sources=items.some(b=>!b.paused&&b.researchEnabled!==false)?await readSources():[];
  for(const item of items)await store.transaction(async tx=>{
   await plugins.assertEnabled('blocks',tx,true);
   const b=await tx.getForUpdate('block',item.id),time=clock();
   if(!b||b.paused)return;
   const tasks=(await tx.list('task')).filter(t=>t.blockId===b.id);
   let changed=false;
   for(const task of tasks.filter(t=>t.state==='completed'&&t.archiveId)){
    const archive=await tx.get('archive',task.archiveId);
    if(!archive||b.links.some(l=>l.taskId===task.id||l.partId===task.blockPartId&&l.sourceId===archive.entryId&&l.version===archive.id))continue;
    if(!b.goals.some(g=>g.parts.some(p=>p.id===task.blockPartId)))continue;
    b.links.push({id:randomUUID(),partId:task.blockPartId,kind:'entry',sourceId:archive.entryId,version:archive.id,reason:'由此部件的缺口采集任务取得',relation:'lead',coverage:archive.meta?.status==='archived'?'full':'partial',conditions:[],excluded:false,taskId:task.id});changed=true;
   }
   if(changed){b.revision++;b.updatedAt=new Date(time).toISOString();b.evaluations.push(evaluate(b,b.updatedAt));await tx.put('block',b);}
   if(b.researchEnabled===false)return;
   if(tasks.some(t=>t.purpose==='blocks-research'&&pending.has(t.state)))return;
   const matches=tasks.filter(t=>t.purpose==='blocks-match'),goalsHash=fingerprint([b.goals,b.matchEpoch||0]);
   // Let the first relevant batch finish; unrelated backlog must not starve research.
   if(matches.length&&!matches.some(t=>t.state==='completed'&&t.blockSnapshot?.goalsHash===goalsHash))return;
   const assessment=evaluate(b,new Date(time).toISOString());
   const covered=assessment.parts.reduce((n,p)=>n+b.goals.flatMap(g=>g.parts).find(x=>x.id===p.partId).conditions.length-p.missing.length,0);
   const last=tasks.filter(t=>t.purpose==='blocks-research').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
   if(last&&b.researchSettledTaskId!==last.id&&!pending.has(last.state)){
    if(last.state==='completed'&&last.archiveId&&!matches.some(t=>t.state==='completed'&&t.blockSnapshot?.goalsHash===goalsHash&&t.blockSnapshot.sources.some(s=>s.version===last.archiveId)))return;
    const progressed=last.state==='completed'&&covered>(last.blockResearchSnapshot?.baselineConditions||0);
    const waiting=['waiting_action','awaiting_review','cancelled'].includes(last.state);
    b.emptyRounds=progressed||waiting?0:Math.min((b.emptyRounds||0)+1,5);
    b.nextCheckAt=progressed||waiting?null:new Date(time+Math.min(7*86400000,86400000*2**(b.emptyRounds-1))).toISOString();
    b.researchSettledTaskId=last.id;await tx.put('block',b);
   }
   if(Date.parse(b.nextCheckAt||0)>time)return;
   const day=dayKey(time),used=tasks.filter(t=>t.purpose==='blocks-research'&&t.createdAt&&dayKey(t.createdAt)===day).length;
   if(used>=(b.dailyLimit||5))return;
   const blockedParts=new Set(tasks.filter(t=>['waiting_action','awaiting_review'].includes(t.state)).map(t=>t.blockPartId));
   const gap=assessment.parts.find(p=>!p.ready&&!p.dependencies.length&&!blockedParts.has(p.partId));
   if(!gap)return;
   const part=b.goals.flatMap(g=>g.parts).find(p=>p.id===gap.partId);
   const at=new Date(time).toISOString(),arrangement=b.collectionPlan?.find(p=>p.partId===part.id);
   const selected=rankSources(b,sources,{part}).slice(0,8);
   const task={id:randomUUID(),pluginId:'blocks',purpose:'blocks-research',blockId:b.id,blockPartId:part.id,blockRevision:b.revision,createdAt:at,deviceId:null,archiveId:null,type:'note',url:null,autoArchive:true,tags:[],blockResearchSnapshot:{protocol:1,blockId:b.id,revision:b.revision,title:b.title,goals:b.goals,part,missing:gap.missing,conflicts:gap.conflicts,collectionPlan:arrangement||null,assumptions:b.assumptions||[],sources:selected,baselineConditions:covered},content:`围绕长期积木「${b.title}」补齐部件「${part.title}」。逐项处理本部件尚缺的验收条件：${JSON.stringify(gap.missing)}。先阅读随任务提供的冻结资料与资料安排，再针对缺口搜索公开原始来源；本轮最多新增一个外部来源，不重复已有材料。需要归纳或方案时基于证据完成部件研究笔记，保留引用和未知事项。资料安排：${JSON.stringify(arrangement||{})}`};
   await saveTask(task,'queued','积木按缺口安排增量收集',tx);
   await tx.put('block',{...b,nextCheckAt:new Date(time+86400000).toISOString(),lastTaskId:task.id});
  });
 }
 return {tick};
}
