import {id,now,requireValue} from './common.mjs';

const stateKind='record-sync-state',stateId='records';
const eventId=seq=>String(seq).padStart(16,'0');
const cursorOf=state=>`${state.epoch}:${state.seq}`;

// Lock before record writes: sequence allocation and content commit together,
// including across independent MySQL service replicas.
export async function lockRecordChanges(tx) {
  await tx.ensure(stateKind,{id:stateId,epoch:id(),seq:0});
  return tx.getForUpdate(stateKind,stateId);
}
export async function appendRecordChange(tx,record,state) {
  state??=await lockRecordChanges(tx);
  const next={...state,seq:state.seq+1};
  requireValue(Number.isSafeInteger(next.seq),'Record sequence exhausted',500);
  await tx.put('record-change',{id:eventId(next.seq),seq:next.seq,record});
  await tx.put(stateKind,next);
}
const withTasks=(record,tasks)=>({...record,tasks:tasks.filter(t=>t.recordId===record.id).map(({id,state,recordVersion,createdAt,events})=>({id,state,recordVersion,createdAt,events:(events??[]).slice(-1)}))});

export async function readRecordChanges({store,req,res,authenticate}) {
  const url=new URL(req.url,'http://localhost');
  const wait=Number(url.searchParams.get('wait')??0),limit=Number(url.searchParams.get('limit')??200);
  requireValue(Number.isInteger(wait)&&wait>=0&&wait<=25&&Number.isInteger(limit)&&limit>=1&&limit<=200,'Invalid sync parameters');
  const cursor=url.searchParams.get('cursor'),end=Date.now()+wait*1000;
  for(;;){
    if(res.destroyed)return;
    await authenticate(req);
    const result=await store.transaction(async tx=>{
      const state=await lockRecordChanges(tx),match=cursor?.match(/^([a-f0-9-]{36}):(\d+)$/),position=match?Number(match[2]):NaN;
      if(!match||match[1]!==state.epoch||!Number.isSafeInteger(position)||position>state.seq){
        const rows=await tx.list('capture'),tasks=await tx.list('task');
        return {protocol:1,mode:'snapshot',cursor:cursorOf(state),hasMore:false,
          records:rows.filter(r=>!r.deletedAt).map(r=>withTasks(r,tasks)),
          deleted:rows.filter(r=>r.deletedAt).map(({id,version,trashVersion,deletedAt})=>({id,version,trashVersion:trashVersion??0,deletedAt}))};
      }
      const events=await tx.listAfter('record-change',eventId(position),limit+1),page=events.slice(0,limit),tasks=page.length?await tx.list('task'):[];
      return {protocol:1,mode:'delta',changes:page.map(event=>({...event,record:withTasks(event.record,tasks)})),cursor:cursorOf({...state,seq:page.at(-1)?.seq??position}),hasMore:events.length>limit};
    });
    if(result.mode==='snapshot'||result.changes.length||Date.now()>=end){
      await authenticate(req);
      if(!res.destroyed){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({...result,checkedAt:now()}));}
      return;
    }
    await new Promise(resolve=>{const timer=setTimeout(done,Math.min(1000,Math.max(1,end-Date.now())));function done(){clearTimeout(timer);res.off('close',done);resolve();}res.once('close',done);});
  }
}
