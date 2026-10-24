import {randomUUID} from 'node:crypto';
import {evaluate} from '../protocol/model.mjs';
const dayKey=at=>new Date(new Date(at).getTime()+8*3600000).toISOString().slice(0,10);
const pending=new Set(['queued','assigned','running','uploading']);
// Scheduling is durable: the block and its new queue item commit together.
export function createBlockScheduler({store,plugins,saveTask,clock=Date.now}){
 async function tick(){
  if(!await plugins.enabled('blocks'))return;
  for(const item of await store.list('block'))await store.transaction(async tx=>{
   await plugins.assertEnabled('blocks',tx,true);
   const b=await tx.getForUpdate('block',item.id),time=clock();
   if(!b||b.paused)return;
   const tasks=(await tx.list('task')).filter(t=>t.blockId===b.id);
   let changed=false;
   for(const task of tasks.filter(t=>t.state==='completed'&&t.archiveId)){
    const archive=await tx.get('archive',task.archiveId);
    if(!archive||b.links.some(l=>l.taskId===task.id))continue;
    if(!b.goals.some(g=>g.parts.some(p=>p.id===task.blockPartId)))continue;
    b.links.push({id:randomUUID(),partId:task.blockPartId,kind:'entry',sourceId:archive.entryId,version:archive.id,reason:'由此部件的缺口采集任务取得',relation:'lead',coverage:archive.meta?.status==='archived'?'full':'partial',conditions:[],excluded:false,taskId:task.id});changed=true;
   }
   if(changed){b.revision++;b.updatedAt=new Date(time).toISOString();b.evaluations.push(evaluate(b,b.updatedAt));await tx.put('block',b);}
   if(b.researchEnabled===false)return;
   if(Date.parse(b.nextCheckAt||0)>time||tasks.some(t=>pending.has(t.state)))return;
   const day=dayKey(time),used=tasks.filter(t=>t.purpose==='blocks-research'&&t.createdAt&&dayKey(t.createdAt)===day).length;
   if(used>=(b.dailyLimit||5))return;
   const assessment=evaluate(b,new Date(time).toISOString());
   const blockedParts=new Set(tasks.filter(t=>['waiting_action','awaiting_review'].includes(t.state)).map(t=>t.blockPartId));
   const gap=assessment.parts.find(p=>!p.ready&&!blockedParts.has(p.partId));
   if(!gap)return;
   const part=b.goals.flatMap(g=>g.parts).find(p=>p.id===gap.partId);
   const at=new Date(time).toISOString(),last=tasks.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
   const failures=last&&['failed','interrupted'].includes(last.state)?Math.min((b.emptyRounds||0)+1,5):0;
   const task={id:randomUUID(),pluginId:'blocks',purpose:'blocks-research',blockId:b.id,blockPartId:part.id,blockRevision:b.revision,createdAt:at,deviceId:null,archiveId:null,type:'note',url:null,autoArchive:true,tags:[],content:`围绕长期积木「${b.title}」补齐部件「${part.title}」。本轮只处理一个关键缺口：${gap.missing[0]||'核查反对证据或依赖部件'}。先检索已有资料与记录，再针对缺口搜索公开来源；本轮最多收集一个新来源，不重复已有材料。保留正文和来源定位，区分事实、推断与反例。已有材料：${JSON.stringify(b.links.filter(l=>!l.excluded).map(l=>({kind:l.kind,id:l.sourceId,version:l.version})))}`};
   await saveTask(task,'queued','积木按缺口安排增量收集',tx);
   await tx.put('block',{...b,emptyRounds:failures,nextCheckAt:new Date(time+Math.min(7*86400000,86400000*2**failures)).toISOString(),lastTaskId:task.id});
  });
 }
 return {tick};
}
