import {canonicalJson,hash,id,now,requireValue} from './common.mjs';
const kinds={record:'capture',writing:'writing-session',task:'task','selection-writing':'task'};
const terminal=new Set(['completed','cancelled','failed','interrupted']);
export function createContentTrash({store,serialized,owner,authenticate,body,send,saveTask,refreshLibrary=async()=>{}}){
 const view=(type,row)=>({type,id:row.id,title:row.title||row.writing?.text?.split('\n')[0]||row.text?.trim().split('\n')[0]||row.content?.split?.('\n')[0]||row.writingInput?.text?.split('\n')[0]||'任务',version:row.version??0,trashVersion:row.trashVersion??0,deletedAt:row.deletedAt});
 return {async handle(req,res,route,device){
  if(!route.startsWith('/api/content-trash'))return false;
  owner(device);
  if(route==='/api/content-trash'&&req.method==='GET'){
   const items=[];for(const [type,kind] of Object.entries(kinds))for(const row of await store.list(kind)){if(row.deletedAt&&!row.deletedWithParent&&(kind!=='task'||(row.purpose==='selection-writing')===(type==='selection-writing')))items.push(view(type,row));}
   for(const row of await store.list('trash'))if(row.deletedAt)items.push({type:'library',id:row.archiveId,title:row.title,version:0,trashVersion:row.trashVersion??0,deletedAt:row.deletedAt});
   send(res,200,{protocol:1,items:items.sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt))});return true;
  }
  const metadata=route.match(/^\/api\/content-trash\/(record|writing|task|selection-writing|library)\/([a-zA-Z0-9-]+)$/);
  if(metadata&&req.method==='GET'){const [,type,targetId]=metadata,row=await store.get(type==='library'?'archive':kinds[type],targetId);requireValue(row,'内容不存在',404);const trash=type==='library'?await store.get('trash',row.entryId):null;send(res,200,view(type,{...row,...(type==='library'?{title:row.meta.title,trashVersion:trash?.trashVersion,deletedAt:trash?.deletedAt}:{})}));return true;}
  const match=route.match(/^\/api\/content-trash\/(record|writing|task|selection-writing|library)\/([a-zA-Z0-9-]+)\/(delete|restore)$/);
  requireValue(match&&req.method==='POST','删除接口不存在',404);
  const [,type,targetId,action]=match,input=await body(req);
  requireValue(typeof input.requestId==='string'&&/^[a-f0-9-]{36}$/i.test(input.requestId),'请求编号无效');
  requireValue(Number.isInteger(input.version)&&input.version>=0&&Number.isInteger(input.trashVersion)&&input.trashVersion>=0,'删除版本无效');
  const digest=hash(canonicalJson({type,targetId,action,input})),key=type+':'+targetId+':'+input.requestId;
  await authenticate(req);
  const result=await serialized('claim',()=>store.transaction(async tx=>{
   const credential=await tx.getForUpdate('device',device.credentialId||device.id);
   requireValue(credential&&!credential.revokedAt&&[credential.tokenHash,credential.ownerTokenHash].includes(device.credentialTokenHash||hash(req.authToken)),'授权已失效',401);
   const old=await tx.getForUpdate('content-operation',key);if(old){requireValue(old.hash===digest,'请求编号已用于其他操作',409);return old.result;}
   const row=await tx.getForUpdate(type==='library'?'archive':kinds[type],targetId);requireValue(row,'内容不存在',404);
   if(type==='task'||type==='selection-writing')requireValue((row.purpose==='selection-writing')===(type==='selection-writing'),'任务类型不匹配',404);
   const current=type==='library'?(await tx.getForUpdate('trash',row.entryId)||{id:row.entryId,archiveId:row.id,title:row.meta.title}):row;
   requireValue((row.version??0)===input.version&&(current.trashVersion??0)===input.trashVersion,'内容已更新，请刷新后重试',409);
   const deletedAt=action==='delete'?now():null,trashVersion=(current.trashVersion??0)+1;
   let next={...current,deletedAt,trashVersion};
   if(action==='delete'){
    const related=type==='task'?[row,...(await tx.list('task')).filter(t=>t.trial?.parentTaskId===row.id)]:type==='selection-writing'?[row]:type==='record'?(await tx.list('task')).filter(t=>t.recordId===targetId):type==='writing'?(await tx.list('task')).filter(t=>t.writingSessionId===targetId):[];
    for(const task of related){let live=task;if(!terminal.has(task.state)){
     const cancelled=await saveTask({...task,assignmentId:id()},'cancelled','已删除，执行已取消',tx);
     if((type==='task'||type==='selection-writing')&&task.id===row.id)next={...cancelled,deletedAt,trashVersion};live=cancelled;
    }if(type==='writing'&&!live.deletedAt)await tx.put('task',{...live,deletedAt,trashVersion:(live.trashVersion??0)+1,deletedWithParent:'writing:'+targetId});}
   }
   if(type==='task'&&action==='delete'&&row.codexTrial)next.codexTrialStopped=true;
   if(type==='writing'&&action==='restore')for(const task of await tx.list('task'))if(task.deletedWithParent==='writing:'+targetId)await tx.put('task',{...task,deletedAt:null,deletedWithParent:null,trashVersion:(task.trashVersion??0)+1});
   if(type==='writing'&&action==='restore'&&next.status==='processing')next.status='blocked';
   await tx.put(type==='library'?'trash':kinds[type],next);
   const value={...view(type,type==='library'?{...row,title:current.title,deletedAt,trashVersion}:next),deleted:!!deletedAt};
   await tx.put('content-operation',{id:key,hash:digest,result:value});return value;
  }));if(type==='library')await refreshLibrary();send(res,200,result);return true;
 }};
}
