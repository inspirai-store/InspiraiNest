import {createHash} from 'node:crypto';
import {evaluate} from '../protocol/model.mjs';
export function createBlockHandoff({store,plugins,writeDraft}){
 return async function handoff(){
  if(!await plugins.enabled('blocks'))return;
  for(const b of await store.list('block')){
   if(b.paused)continue;
   const assessment=evaluate(b);
   for(const goal of b.goals){
    if(!assessment.goals.find(g=>g.goalId===goal.id)?.ready)continue;
    const links=b.links.filter(l=>!l.excluded&&goal.parts.some(p=>p.id===l.partId));
    const content={blockId:b.id,goal,links:links.map(l=>({partId:l.partId,kind:l.kind,sourceId:l.sourceId,version:l.version,relation:l.relation,conditions:l.conditions,evidence:l.evidence})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};const id=createHash('sha256').update(JSON.stringify(content)).digest('hex');
    let packet=await store.get('block-handoff',id);
    if(packet?.state==='completed')continue;
    packet ||= {id,blockId:b.id,goalId:goal.id,title:goal.title,output:goal.output,parts:goal.parts,links,sources:[...new Map(links.filter(l=>l.relation==='support').map(l=>[l.kind+':'+l.sourceId+':'+l.version,{kind:l.kind,id:l.sourceId,version:l.kind==='record'?Number(l.version):l.version,role:'material'}])).values()],assessment,createdAt:new Date().toISOString(),state:'prepared'};
    await store.put('block-handoff',packet);
    try{
     if(goal.output==='article'){
      if(!await plugins.enabled('writing')){await store.put('block-handoff',{...packet,state:'waiting_writing'});continue;}
      const draft=await writeDraft(packet);packet={...packet,writingSessionId:draft.id};
     }
     await store.put('block-handoff',{...packet,state:'completed',completedAt:new Date().toISOString()});
    }catch(error){await store.put('block-handoff',{...packet,state:'failed',error:error.message});}
   }
  }
 };
}
