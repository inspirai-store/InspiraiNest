import {randomUUID} from 'node:crypto';
import {fingerprint,sourceKey,validateMatches} from '../protocol/matching.mjs';
import {evaluate} from '../protocol/model.mjs';
import {rankSources} from '../protocol/research.mjs';
const active=new Set(['queued','assigned','running','uploading','waiting_action']);
export function createBlockMatching({store,plugins,saveTask,readSources,assigned,authenticate,checkAssignment,body,send,onChanged=()=>{},clock=Date.now}){
 async function scan(){
  if(!await plugins.enabled('blocks'))return;
  const blocks=(await store.list('block')).filter(b=>!b.paused);if(!blocks.length)return;
  const sources=await readSources();
  for(const row of blocks)await store.transaction(async tx=>{
   await plugins.assertEnabled('blocks',tx,true);const b=await tx.getForUpdate('block',row.id);if(!b||b.paused)return;
   const keys=new Set(sources.map(s=>s.key));let invalidated=false;
   for(const l of b.links){const stale=!keys.has(sourceKey(l));if(Boolean(l.stale)!==stale){l.stale=stale;invalidated=true;}}
   if(invalidated){b.revision++;b.updatedAt=new Date(clock()).toISOString();b.evaluations.push(evaluate(b,b.updatedAt));await tx.put('block',b);}
   const goalsHash=fingerprint([b.goals,b.matchEpoch||0]),tasks=(await tx.list('task')).filter(t=>t.blockId===b.id&&t.purpose==='blocks-match');
   if(tasks.some(t=>active.has(t.state)))return;
   const done=new Set(tasks.filter(t=>t.state==='completed'&&t.blockSnapshot.goalsHash===goalsHash).flatMap(t=>t.blockSnapshot.sources.map(s=>s.key)));
   const preferred=(await tx.list('task')).filter(t=>t.blockId===b.id&&t.purpose==='blocks-research'&&t.state==='completed'&&t.archiveId).map(t=>t.archiveId);
   const batch=rankSources(b,sources.filter(s=>!done.has(s.key)),{preferred}).slice(0,8);if(!batch.length)return;
   const task={id:randomUUID(),pluginId:'blocks',purpose:'blocks-match',blockId:b.id,type:'note',url:null,autoArchive:false,createdAt:new Date(clock()).toISOString(),deviceId:null,archiveId:null,content:`积木语义匹配：${b.title}`,blockSnapshot:{goalsHash,goals:b.goals,sources:batch}};
   await saveTask(task,'queued','等待电脑匹配已有资料与记录',tx);
  });
 }
 async function handle(req,res,url,device){
  const match=url.pathname.match(/^\/api\/blocks\/matches\/([a-f0-9-]{36})$/);if(!match||req.method!=='POST')return false;
  const task=await assigned(device,match[1],req);if(task.purpose!=='blocks-match')throw Object.assign(Error('匹配任务无效'),{status:409});const result=validateMatches(await body(req),task.blockSnapshot);await authenticate(req);
  await store.transaction(async tx=>{
   await plugins.assertEnabled('blocks',tx,true);const node=await tx.getForUpdate('device',device.id);if(!node||node.revokedAt||node.tokenHash!==device.tokenHash)throw Object.assign(Error('节点授权已撤销'),{status:401});
   const live=await tx.getForUpdate('task',task.id);checkAssignment(device,live,req);
   if(live.state==='completed'){if(fingerprint(live.blockMatchResult)!==fingerprint(result))throw Object.assign(Error('匹配结果已提交'),{status:409});return;}
   if(live.purpose!=='blocks-match'||!['assigned','running','uploading'].includes(live.state))throw Object.assign(Error('匹配任务已停止'),{status:409});
   const b=await tx.getForUpdate('block',live.blockId);
   if(!b||b.paused||fingerprint([b.goals,b.matchEpoch||0])!==live.blockSnapshot.goalsHash)throw Object.assign(Error('目标已变化或暂停，请重新匹配'),{status:409});
   for(const m of result.matches){
    const source=live.blockSnapshot.sources.find(s=>s.key===m.sourceKey);
    const current=await tx.get(source.kind==='record'?'capture':'archive',source.kind==='record'?source.sourceId:source.version);
    if(!current||current.deletedAt||source.kind==='record'&&String(current.version)!==source.version||(await tx.get('trash',source.sourceId))?.deletedAt)continue;
    const existing=b.links.find(l=>l.partId===m.partId&&sourceKey(l)===source.key);
    if(existing?.excluded||existing?.origin==='manual')continue;
    const link={id:existing?.id||randomUUID(),kind:source.kind,sourceId:source.sourceId,version:source.version,title:source.title,partId:m.partId,reason:m.reason,relation:source.coverage!=='full'&&m.relation==='support'?'lead':m.relation,coverage:source.coverage,conditions:m.evidence.map(e=>e.condition),evidence:m.evidence,origin:'semantic',excluded:false};
    if(existing)Object.assign(existing,link);else b.links.push(link);
   }
   b.revision++;b.updatedAt=new Date(clock()).toISOString();b.evaluations.push(evaluate(b,b.updatedAt));await tx.put('block',b);await saveTask({...live,blockMatchResult:result},'completed','语义关联与评价已更新',tx);
  });onChanged();send(res,200,{saved:true});return true;
 }
 return {scan,handle};
}
