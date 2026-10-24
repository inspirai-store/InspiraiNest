import {randomUUID} from 'node:crypto';
import {structure,evaluate} from '../protocol/model.mjs';
export function createBlocks({store,plugins,owner,body,send,onChanged=()=>{},saveTask}){
 const error=(message,status)=>{throw Object.assign(new Error(message),{status});};
 return {async handle(req,res,url,device){
  if(url.pathname!=='/api/blocks'&&!url.pathname.startsWith('/api/blocks/'))return false;
  owner(device);const segments=url.pathname.split('/').filter(Boolean),id=segments[2],action=segments[3];
  if(req.method==='GET'){
   if(id==='materials'){
    const records=(await store.list('capture')).filter(r=>!r.deletedAt).map(r=>({kind:'record',sourceId:r.id,title:r.text?.slice(0,100)||'媒体记录',version:String(r.version)}));
    const latest=new Map();for(const a of await store.list('archive')){if((await store.get('trash',a.entryId))?.deletedAt)continue;const old=latest.get(a.entryId);if(!old||old.createdAt<a.createdAt)latest.set(a.entryId,a);}
    send(res,200,{items:[...records,...[...latest.values()].map(a=>({kind:'entry',sourceId:a.entryId,title:a.meta.title,version:a.id}))]});return true;
   }
   if(!id){send(res,200,{items:await store.list('block')});return true;}
   if(action==='handoffs'){send(res,200,{items:(await store.list('block-handoff')).filter(p=>p.blockId===id)});return true;}
   const value=await store.get('block',id);if(!value)error('积木不存在',404);send(res,200,value);return true;
  }
  if(req.method!=='POST')error('不支持的操作',405);
  const input=await body(req);
  const result=await store.transaction(async tx=>{
   await plugins.assertEnabled('blocks',tx,true);
   if(!id){const value={...structure(input),id:randomUUID(),revision:1,paused:false,links:[],evaluations:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await tx.put('block',value);return value;}
   const current=await tx.getForUpdate('block',id);if(!current)error('积木不存在',404);
   if(input.revision!==current.revision)error('积木已更新，请刷新后重试',409);
   const next=structuredClone(current);
   if(action==='structure'){Object.assign(next,structure(input));const valid=new Set(next.goals.flatMap(g=>g.parts.map(p=>p.id)));next.links=next.links.map(l=>valid.has(l.partId)?l:{...l,excluded:true});}
   else if(action==='pause'){if(typeof input.paused!=='boolean')error('暂停状态错误',400);next.paused=input.paused;}
   else if(action==='join'){
    const part=next.goals.flatMap(g=>g.parts).find(p=>p.id===input.partId);
    if(!part||!['record','entry'].includes(input.kind)||typeof input.sourceId!=='string')error('请选择资料和目标部件',400);
    let version,title;
    if(input.kind==='record'){const r=await tx.get('capture',input.sourceId);if(!r||r.deletedAt)error('请先同步记录后再加入',409);version=String(r.version);title=r.text?.slice(0,100)||'媒体记录';}
    else{const r=(await tx.list('archive')).filter(a=>a.entryId===input.sourceId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];if(!r||(await tx.get('trash',input.sourceId))?.deletedAt)error('资料不存在',404);version=r.id;title=r.meta.title;}
    const existing=next.links.find(l=>l.partId===part.id&&l.kind===input.kind&&l.sourceId===input.sourceId&&l.version===version);
    if(existing){existing.excluded=false;}
    else next.links.push({id:randomUUID(),partId:part.id,kind:input.kind,sourceId:input.sourceId,version,title,reason:'手动加入，等待语义判断',relation:'lead',coverage:'partial',conditions:[],origin:'joined',excluded:false});
    // Reconsider explicitly joined materials even if an earlier scan found them irrelevant.
    next.matchEpoch=(next.matchEpoch||0)+1;
   }
   else if(action==='link'){
    const part=next.goals.flatMap(g=>g.parts).find(p=>p.id===input.partId);
    if(!part||!['record','entry'].includes(input.kind)||typeof input.sourceId!=='string'||!input.sourceId||typeof input.version!=='string'||!input.version||!input.reason?.trim())error('材料关联信息不完整',400);
    if(!['support','contradiction','background','lead'].includes(input.relation)||!['full','partial','pending'].includes(input.coverage))error('材料状态错误',400);
    if(!Array.isArray(input.conditions)||input.conditions.some(c=>!part.conditions.includes(c)))error('验收条件不存在',400);
    if(input.expiresAt&&!Number.isFinite(Date.parse(input.expiresAt)))error('失效时间错误',400);
    if(input.kind==='record'){
     const source=await tx.get('capture',input.sourceId);
     if(!source||source.deletedAt||String(source.version)!==input.version)error('记录不存在或版本已变化',409);
    }else{
     const source=await tx.get('archive',input.version),trash=await tx.get('trash',input.sourceId);
     if(!source||source.entryId!==input.sourceId||trash?.deletedAt)error('资料不存在或已删除',404);
     if(input.coverage==='full'&&source.meta?.status!=='archived')error('资料尚未完整归档',400);
    }
    const existing=next.links.find(l=>l.partId===part.id&&l.kind===input.kind&&l.sourceId===input.sourceId&&l.version===input.version);
    if(existing&&!existing.excluded)Object.assign(existing,{reason:input.reason,relation:input.relation,coverage:input.coverage,conditions:input.conditions,origin:'manual'});
    if(!existing)next.links.push({id:randomUUID(),partId:part.id,kind:input.kind,sourceId:input.sourceId,version:input.version,reason:input.reason,relation:input.relation,coverage:input.coverage,conditions:input.conditions,expiresAt:input.expiresAt||null,origin:'manual',excluded:false});
   }else if(action==='exclude'){const link=next.links.find(l=>l.id===input.linkId);if(!link)error('关联不存在',404);link.excluded=true;}
   else if(action!=='evaluate')error('操作不存在',404);
   if(saveTask&&(['join','structure'].includes(action)||action==='pause'&&next.paused)){
    for(const task of await tx.list('task'))if(task.blockId===next.id&&task.purpose==='blocks-match'&&['queued','assigned','running','uploading','waiting_action'].includes(task.state))await saveTask({...task,assignmentId:randomUUID()},'cancelled','目标或材料选择已变化，等待重新匹配',tx);
   }
   next.revision++;next.updatedAt=new Date().toISOString();next.evaluations.push(evaluate(next,next.updatedAt));await tx.put('block',next);return next;
  });send(res,200,result);onChanged();return true;
 }};
}
