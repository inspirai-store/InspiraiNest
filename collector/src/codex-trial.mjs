import { id, hash, now, requireValue, safePath, canonicalJson } from './common.mjs';
import { workerAuthorized } from './device-metadata.mjs';

export function cleanTrialTarget(value) {
  requireValue(value && ['skill','plugin','mcp'].includes(value.kind),'请选择 Skill、插件或 MCP');
  let url;try {url=new URL(value.repository);}catch{}
  requireValue(url?.protocol==='https:' && url.hostname==='github.com' && !url.username && !url.password && /^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname) && !url.search && !url.hash,'请输入 GitHub 仓库地址');
  const repository='https://github.com'+url.pathname.replace(/\/$/,'').replace(/\.git$/,'');
  const directory=value.directory || '';if(directory)safePath(directory);
  const ref=value.ref || 'HEAD';requireValue(typeof ref==='string' && /^[\w./-]{1,120}$/.test(ref) && !ref.startsWith('-') && !ref.includes('..'),'版本无效');
  const name=String(value.name || repository.split('/').at(-1)).slice(0,100);
  return {kind:value.kind,repository,directory,ref,name,id:hash(canonicalJson({kind:value.kind,repository,directory,ref})).slice(0,32)};
}
export function trialEnvironment(value) {
  if(value===undefined)return null;
  requireValue(value?.protocol===1 && ['ready','required','unavailable'].includes(value.login) && Array.isArray(value.projects) && value.projects.length<=10,'实测环境无效');
  const projects=value.projects.map(p=>{requireValue(/^[a-f0-9]{32}$/.test(p.id) && typeof p.name==='string' && p.name.length<=100,'项目无效');return {id:p.id,name:p.name};});
  requireValue(value.executionMode===undefined || value.executionMode==='local-agent','实测执行模式无效');
  return {protocol:1,login:value.login,projects,...(value.executionMode?{executionMode:value.executionMode}:{})};
}
export function createCodexTrials({store,serialized,saveTask,owner,assigned,body,send,authenticate}) {
  async function request(input,{validate=true}={}) {
    if(input===undefined || input===null || input===false)return null;
    requireValue(input && typeof input.deviceId==='string','请选择实测电脑');
    requireValue(!input.projectId || /^[a-f0-9]{32}$/.test(input.projectId),'项目无效');
    if(validate){const node=await store.get('device',input.deviceId);requireValue(node && workerAuthorized(node),'实测电脑未授权');if(input.projectId)requireValue(node.trialEnvironment?.projects.some(p=>p.id===input.projectId),'项目已移除，请重新选择');}
    return {deviceId:input.deviceId,projectId:input.projectId || null};
  }
  async function sync() {
    await serialized('claim',()=>store.transaction(async tx=>{
      const tasks=await tx.list('task');
      for(const parent of tasks) {
        if(parent.deletedAt||parent.codexTrialStopped||!parent.codexTrial || !['completed','awaiting_review'].includes(parent.state) || tasks.some(t=>t.trial?.parentTaskId===parent.id))continue;
        const candidates=parent.trialCandidates || [];
        const trial={...parent.codexTrial,parentTaskId:parent.id,sourceArchiveId:parent.archiveId || parent.draftId,candidates,target:candidates.length===1?candidates[0]:null};
        await saveTask({id:id(),purpose:'codex-trial',trial,title:'Codex 实测 · '+String(parent.content || parent.url || '附件').slice(0,160),content:parent.content || parent.url || '附件资料',type:'auto',tags:parent.tags || [],preferredAgent:'codex',preferredDeviceId:trial.deviceId,deviceId:null,createdAt:now(),actionRequired:trial.target?null:{kind:'choose_target',label:'选择测试对象',candidates}},trial.target?'queued':'waiting_action',trial.target?'等待指定电脑实测':'选择要实测的插件、Skill 或 MCP',tx);
      }
      for(const task of tasks.filter(t=>t.purpose==='codex-trial'&&!t.deletedAt && t.state==='waiting_action' && t.actionRequired?.kind==='trial_login')) {
        const device=await tx.get('device',task.trial.deviceId);
        if(workerAuthorized(device || {}) && device.trialEnvironment?.login==='ready')await saveTask({...task,actionRequired:null},'queued','本机 Codex Agent 已就绪，等待原电脑继续',tx);
      }
    }));
  }
  async function handle(req,res,route,actor) {
    const match=route.match(/^\/api\/tasks\/([^/]+)\/(trial-targets|trial-choice|trial-report|trial-rerun)$/);
    if(!match)return false;
    const [,taskId,action]=match;
    if(action==='trial-report' && req.method==='GET') {owner(actor);const task=await store.get('task',taskId);requireValue(task?.report&&!task.deletedAt,'报告尚未生成',404);send(res,200,{...task.report,parentTaskId:task.trial.parentTaskId,sourceArchiveId:task.trial.sourceArchiveId});return true;}
    requireValue(req.method==='POST','Not found',404);const input=await body(req);
    if(action==='trial-targets') {
      await assigned(actor,taskId,req);requireValue(Array.isArray(input.candidates) && input.candidates.length<=20,'候选对象无效');
      const candidates=[...new Map(input.candidates.map(cleanTrialTarget).map(t=>[t.id,t])).values()];
      await serialized('claim',()=>store.transaction(async tx=>{const liveDevice=await tx.get('device',actor.id);requireValue(workerAuthorized(liveDevice || {})&&liveDevice.tokenHash===actor.tokenHash,'设备授权已失效',401);const task=await tx.getForUpdate('task',taskId);requireValue(task?.codexTrial && ['assigned','running','uploading'].includes(task.state) && task.deviceId===actor.id && task.assignmentId===req.headers['x-task-assignment'],'任务已改变',409);await tx.put('task',{...task,trialCandidates:candidates});}));
      send(res,200,{accepted:true});return true;
    }
    if(action==='trial-report') {
      await assigned(actor,taskId,req);
      requireValue(input.protocol===1 && ['passed','failed','partial'].includes(input.verdict) && typeof input.markdown==='string' && input.markdown.length>0 && input.markdown.length<=150000 && typeof input.commit==='string' && /^[a-f0-9]{40,64}$/.test(input.commit),'报告无效');
      requireValue(Array.isArray(input.evidence) && input.evidence.length<=50 && input.evidence.every(e=>e && ['install','load','invoke'].includes(e.stage) && typeof e.detail==='string' && e.detail.length<=4000),'证据无效');
      requireValue(input.verdict!=='passed' || ['install','load','invoke'].every(s=>input.evidence.some(e=>e.stage===s && e.verified===true)),'实测通过须具备安装、加载和调用证据');
      let agent;
      if(input.agent!==undefined){requireValue(input.agent?.executionMode==='local-agent' && ['version','model','provider'].every(k=>input.agent[k]===null || typeof input.agent[k]==='string' && /^[\w./:+-]{1,150}$/.test(input.agent[k])),'Agent 环境标识无效');agent={executionMode:'local-agent',...Object.fromEntries(['version','model','provider'].map(k=>[k,input.agent[k]]))};}
      const report={protocol:1,...(agent?{agent}:{}),title:String(input.title || 'Codex 实测报告').slice(0,180),verdict:input.verdict,commit:input.commit,projectCommit:input.projectCommit || null,markdown:input.markdown,evidence:input.evidence,createdAt:now()};
      report.digest=hash(canonicalJson({...report,createdAt:undefined}));
      await authenticate(req);
      const result=await serialized('claim',()=>store.transaction(async tx=>{const liveDevice=await tx.get('device',actor.id);requireValue(workerAuthorized(liveDevice || {})&&liveDevice.tokenHash===actor.tokenHash,'设备授权已失效',401);const task=await tx.getForUpdate('task',taskId);requireValue(task?.purpose==='codex-trial' && task.deviceId===actor.id && task.assignmentId===req.headers['x-task-assignment'],'任务已改变',409);if(task.state==='completed' && task.report?.digest===report.digest)return task;requireValue(['assigned','running','uploading'].includes(task.state),'任务已结束',409);return saveTask({...task,report,actionRequired:null},'completed','实测报告已生成',tx);}));
      send(res,200,result);return true;
    }
    owner(actor);
    const result=await serialized('claim',()=>store.transaction(async tx=>{
      const task=await tx.getForUpdate('task',taskId);requireValue(task?.purpose==='codex-trial'&&!task.deletedAt,'实测任务不存在',404);
      if(action==='trial-rerun') {requireValue(typeof input.requestId==='string' && /^[\w-]{1,100}$/.test(input.requestId),'重试编号无效');const existing=(await tx.list('task')).find(t=>t.rerunRequestId===input.requestId);if(existing){requireValue(existing.rerunOf===task.id,'编号已使用',409);return existing;}requireValue(['completed','failed','cancelled'].includes(task.state),'任务尚未结束',409);const pending=(await tx.list('task')).find(t=>t.rerunOf===task.id&&!['completed','failed','cancelled'].includes(t.state));if(pending)return pending;return saveTask({...task,id:id(),rerunOf:task.id,rerunRequestId:input.requestId,report:null,deviceId:null,assignmentId:null,createdAt:now(),events:[],actionRequired:null},task.trial.target?'queued':'waiting_action','重新实测',tx);}
      const target=input.targetId ? task.trial.candidates.find(c=>c.id===input.targetId) : cleanTrialTarget(input.target);
      requireValue(target,'请选择测试对象');
      if(task.trial.target){requireValue(task.trial.target.id===target.id,'测试对象已固定',409);return task;}
      requireValue(task.state==='waiting_action' && task.actionRequired?.kind==='choose_target','任务已更新',409);
      return saveTask({...task,trial:{...task.trial,target},actionRequired:null},'queued','等待指定电脑实测',tx);
    }));send(res,200,result);return true;
  }
  return {request,sync,handle};
}
