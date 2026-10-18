// Isolated fixtures; all actions, alternate-node authorization and claims use existing REST.
exports.seedTasks=async(store,{api,server,ownerToken,evidenceDir}={})=>{
 const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
 const drafts=await store.list('archive');
 for(const t of await store.list('task'))await store.delete('task',t.id);
 const workers=[];
 for(const [name,platform] of [['MacBook Pro','darwin'],['Windows PC','win32']]){
  const pairing=await api({server,token:ownerToken},'/api/pairings','POST',{role:'worker'});
  const paired=await api({server},'/api/pair','POST',{key:pairing.key,name,platform});
  const connection={server,token:paired.token};
  await api(connection,'/api/heartbeat','POST',{capabilities:['article'],agents:['codex']});
  workers.push({id:paired.device.id,name,connection});
 }
 const titles=['把阅读变成可积累的知识','如何做好读书笔记','建立自己的知识索引','从灵感到行动'];
 const messages=['结果已上传，等待确认归档。','正在整理来源与阅读笔记。','需要在工作节点完成授权。','网络中断，任务可以重试。'];
 const states=['awaiting_review','running','waiting_action','failed'];
 const draft=drafts.find(d=>d.meta?.title===titles[0])??drafts[0];
 if(draft){await store.put('draft',draft);await store.delete('archive',draft.id);}
 const ids=[],base=[];
 for(let i=0;i<4;i++){const id=crypto.randomUUID();ids.push(id);const record={id,content:titles[i],type:'article',state:states[i],deviceId:workers[0].id,preferredAgent:'codex',createdAt:new Date(Date.UTC(2026,9,12-i,4)).toISOString(),draftId:i===0?draft?.id:null,events:[{at:'2026-10-12T04:00:00Z',state:'assigned',message:'任务已分配给 MacBook Pro。'},{at:'2026-10-12T04:01:00Z',state:'running',message:'Codex 已开始处理任务。'},{at:'2026-10-12T04:03:00Z',state:states[i],message:messages[i]}]};base.push(record);await store.put('task',record);}
 const dir=evidenceDir||path.resolve(__dirname,'../../../../design-review/desktop-refactor/stage-06-tasks-v1/evidence');fs.mkdirSync(dir,{recursive:true});const events=[];let previous='';
 const timer=setInterval(async()=>{try{
   for(const worker of workers)await api(worker.connection,'/api/heartbeat','POST',{capabilities:['article'],agents:['codex']});
   const tasks=await store.list('task');
   // Only acquire manually reassigned work, not an ordinary queued retry.
   if(tasks.some(t=>t.state==='queued'&&!t.deviceId&&t.failedDeviceIds?.includes(workers[0].id))){const {task}=await api(workers[1].connection,'/api/claim','POST',{assignmentProtocol:1});if(task){events.push({kind:'claim',id:task.id,deviceId:workers[1].id,assignmentId:task.assignmentId});}}
   const archiveCount=(await store.list('archive')).length;const summary=tasks.map(t=>({id:t.id,state:t.state,deviceId:t.deviceId,archiveId:t.archiveId}));const signature=JSON.stringify([summary,archiveCount]);if(signature!==previous){previous=signature;events.push({kind:'snapshot',archiveCount,tasks:summary});}
   const snapshot={archiveCount,workers:workers.map(({id,name})=>({id,name})),taskIds:ids,events,tasks:(await store.list('task')).map(t=>({id:t.id,state:t.state,deviceId:t.deviceId,archiveId:t.archiveId,failedDeviceIds:t.failedDeviceIds}))};fs.writeFileSync(path.join(dir,'task-rest-observations.json'),JSON.stringify(snapshot,null,2));
 }catch(error){console.error('Task QA observer:',error.message);}},1000);
 return {taskIds:ids,close:()=>clearInterval(timer),mode:'review',failState:false,failDraft:false,failAction:false,delayState:0,reset:async function(mode){this.mode=mode;this.failState=mode==='list-error';this.failDraft=mode==='preview-error';this.failAction=mode==='action-error';this.delayState=mode==='loading'?15000:0;for(const t of await store.list('task'))await store.delete('task',t.id);if(mode!=='empty')for(const t of base)await store.put('task',structuredClone(t));if(mode==='completed'){await store.put('archive',draft);await store.put('task',{...base[0],state:'completed',archiveId:draft.id,events:[...base[0].events.slice(0,-1),{at:'2026-10-12T04:03:00Z',state:'completed',message:'用户已确认归档'}]});}else await store.delete('archive',draft.id);}};
};
