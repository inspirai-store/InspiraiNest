import {id,now,hash,requireValue} from '../node/common.mjs';
import {workerAuthorized,workerOnline} from '../node/device-metadata.mjs';
import {diagnosticScope,diagnosticText,diagnosticDetails,diagnosticCategory,capabilityKey} from '../node/task-diagnostics.mjs';
import {evaluateCapability} from '../node/capabilities.mjs';
import {capabilityBlock} from '../node/capabilities.mjs';

const capabilityNames={'capture.article':'网页正文与配图','capture.media':'音视频分析','capture.browser':'外部浏览器','writing.materials':'资料写作','writing.selection':'选区改写','writing.creation':'文稿创作'};

function recoveryCondition(code){
 const action=code==='BROWSER_WAITING'?'在采集页交还页面控制后继续原任务':/PERMISSION/.test(code)?'在对应客户端完成执行工具授权并检测能力，再继续原任务':/VERSION|PROTOCOL/.test(code)?'在原节点安装兼容的客户端和固定技能版本后继续原任务':/NETWORK|UPLOAD|HTTP|REMOTE/.test(code)?'恢复对应执行工具或服务连接后，复用已保存成果继续原任务':/SOURCE|LOGIN|CHALLENGE/.test(code)?'查看原来源页面，完成所需登录或验证后继续原任务':/QUALITY|COVERAGE|MISSING|VALIDAT|RESULT/.test(code)?'按本次证据补齐缺失内容或修复结果，再继续原任务':/BROWSER|PAGE/.test(code)?'恢复原来源页面连接后继续原任务':/TIMEOUT/.test(code)?'检查本机执行日志与保留成果，处理超时条件后继续原任务':'核对本次证据并处理已确认的阻塞条件，再继续原任务';
 return {code,action,same_task:true};
}

const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(x);
export function cleanCapabilityFacts(input){
  if(input===undefined)return undefined;
  requireValue(Array.isArray(input)&&input.length<=20,'Invalid capability facts');
  return input.map(f=>{requireValue(f&&capabilityNames[f.id]&&['codex','codebuddy'].includes(f.agent)&&typeof f.available==='boolean'&&/^[a-f0-9]{64}$/.test(f.fingerprint)&&Number.isFinite(Date.parse(f.checkedAt)),'Invalid capability fact');
    return {id:f.id,agent:f.agent,available:f.available,enabled:f.enabled!==false,permission:['ready','blocked'].includes(f.permission)?f.permission:'unknown',missing:Array.isArray(f.missing)?f.missing.slice(0,20).map(x=>diagnosticText(x,120)):[],connected:f.connected===true,fingerprint:f.fingerprint,skill:diagnosticText(f.skill,120),checkedAt:f.checkedAt};});
}
const publicTask=t=>({id:t.id,state:t.state,created_at:t.createdAt,updated_at:t.updatedAt,device_id:t.deviceId||null,attempt_id:t.attemptId||null,session_id:t.creationSessionId||null,kind:t.creationSessionId||t.writingSessionId||t.purpose==='selection-writing'?'writing':'collection',has_result:Boolean(t.archiveId||t.draftId)});
export function createTaskDiagnostics({store,body,send,serialized,clock=Date.now}){
  const readable=d=>requireValue(d.role==='owner'||d.role==='reader'&&d.scope===diagnosticScope,'Diagnostics read permission required',403);
  async function taskFor(taskId){requireValue(validId(taskId),'Invalid task ID');let t=await store.get('task',taskId);if(!t){const turn=await store.get('creation-turn',taskId);if(turn)t=await creationTask(turn);}requireValue(t&&!t.deletedAt,'Task not found',404);return t;}
  async function creationTask(turn,target=store){
    const session=await target.get('creation-session',turn.sessionId)||{};
    return {id:turn.id,creationSessionId:turn.sessionId,state:turn.state==='interrupted'?'cancelled':turn.state,createdAt:turn.createdAt,updatedAt:turn.updatedAt||turn.createdAt,deviceId:turn.deviceId||session.executorDeviceId,attemptId:turn.attemptId||null,executionDeviceIds:turn.executionDeviceIds||[],draftId:turn.state==='completed'?turn.sessionId:null,events:[]};
  }
  async function creationClaim(turn,session,device,tx){
    const previous=turn.attemptId,task=await creationTask(turn,tx);
    task.agent='codex';task.preferredAgent='codex';task.selectedSkills=[{name:'lingnest-creation',hash:device.creationRuntime?.fingerprint||null,versionId:'creation-v1',agent:'codex'}];
    await recordState(task,'assigned','创作轮次开始执行',tx);
    Object.assign(turn,{attemptId:task.attemptId,deviceId:device.id,executionDeviceIds:task.executionDeviceIds,updatedAt:now()});
    const attempt=await tx.get('task-attempt',task.attemptId);
    await tx.put('task-attempt',{...attempt,state:'running',runId:turn.runtimeId,parentAttemptId:previous||null,capabilityId:'writing.creation'});
  }
  async function creationEvent(turn,type,tx){
    if(!turn.attemptId)return;
    const task=await creationTask(turn,tx);
    if(['completed','failed','interrupted'].includes(type)){
      await recordState(task,type==='interrupted'?'cancelled':type,type==='completed'?'本轮创作已完成':type==='interrupted'?'用户停止本轮创作':'创作执行失败，查看程序证据',tx);
    }
  }
  async function recordState(task,state,message,tx){
    if(state==='queued')await tx.put('task-routing',{id:id(),taskId:task.id,at:now(),evaluations:await routingEvaluations(task,tx)});
    if(state==='assigned'){
      const device=await tx.get('device',task.deviceId)||{},parent=task.attemptId||null;
      task.executionDeviceIds=[...new Set([...(task.executionDeviceIds||[]),task.deviceId].filter(Boolean))];
      task.attemptId=id();
      await tx.put('task-attempt',{id:task.attemptId,taskId:task.id,deviceId:task.deviceId,deviceName:device.name||task.deviceId,createdAt:now(),parentAttemptId:parent,
        clientVersion:device.workerRuntime?.version||device.clientRuntime?.version||null,system:device.system||null,agent:task.preferredAgent||task.agent||null,
        skillVersions:(task.selectedSkills||[]).map(({name,hash,versionId,agent})=>({name,hash,versionId,agent})),writingSkill:task.writingSnapshot?.skill?{hash:task.writingSnapshot.skill.hash,version:task.writingSnapshot.protocolVersion}:null,
        environmentDigest:task.environmentDigest||device.environment?.digest||null,capabilityId:capabilityKey(task),state});
    }
    if(task.attemptId){
      const attempt=await tx.get('task-attempt',task.attemptId);
      if(attempt){const device=await tx.get('device',attempt.deviceId)||{},agent=task.agent||attempt.agent;
        const fact=device.capabilityFacts?.find(f=>f.id===attempt.capabilityId&&f.agent===agent);
        const matchesSkill=!task.writingSessionId||task.writingSnapshot?.skill?.hash===fact?.skill;
        const skillVersions=(task.executionSkills?.length?task.executionSkills:task.selectedSkills||[]).map(({name,hash,versionId,agent})=>({name,hash,versionId,agent}));
        await tx.put('task-attempt',{...attempt,state:state==='queued'?attempt.state:state,...(state==='queued'?{endedAt:now()}:{}),agent,skillVersions,capabilityFingerprint:matchesSkill?(fact?.fingerprint||attempt.capabilityFingerprint||null):null,...(['completed','awaiting_review'].includes(state)?{resultValidatedAt:now()}:{}),updatedAt:now()});
        await tx.put('task-diagnostic',{id:id(),taskId:task.id,attemptId:attempt.id,deviceId:attempt.deviceId,at:now(),state,stage:state,code:'TASK_'+state.toUpperCase(),category:diagnosticCategory('',state),reportedBy:'server',message:diagnosticText(message),details:{}});}
    }
  }
  async function data(taskId){
    const task=await taskFor(taskId),attempts=(await store.list('task-attempt')).filter(a=>a.taskId===taskId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    const events=(await store.list('task-diagnostic')).filter(e=>e.taskId===taskId).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
    const legacy=!attempts.length;
    if(legacy)for(let i=0;i<(task.events||[]).length;i++){const e=task.events[i];events.push({id:'legacy-'+hash(taskId+':'+i+':'+e.at).slice(0,24),taskId,attemptId:null,deviceId:null,at:e.at,state:e.state,stage:e.state,code:'LEGACY_EVENT',category:'unknown',reportedBy:'legacy',message:diagnosticText(e.message),details:{}});}
    const blocking=events.filter(e=>['waiting_action','failed','interrupted'].includes(e.state)&&!['manual','normal'].includes(e.category)&&!['ATTEMPT_STARTED','ATTEMPT_FINISHED'].includes(e.code));
    const relevant=blocking.filter(e=>!task.attemptId||e.attemptId===task.attemptId);const specific=relevant.filter(e=>!e.code.startsWith('TASK_'));
    const latest=['waiting_action','failed','interrupted'].includes(task.state)?(specific.at(-1)||relevant.at(-1)):null,resolved=['completed','awaiting_review'].includes(task.state);
    const control=events.filter(e=>['BROWSER_WAITING','BROWSER_RESUMED'].includes(e.code)&&e.attemptId===task.attemptId).at(-1);
    const issue=!resolved&&control?.code==='BROWSER_WAITING'?control:latest;
    const pending=attempts.some(a=>!events.some(e=>e.attemptId===a.id&&e.code==='ATTEMPT_FINISHED'));
    return {schema_version:1,task:publicTask(task),attempts,events,diagnosis:{status:task.state==='cancelled'?'cancelled':resolved?'resolved':control?.code==='BROWSER_WAITING'?'manual':latest?'blocked':'undetermined',reason:issue?.message||null,code:issue?.code||null,category:issue?.category||null,evidence_ids:issue?[issue.id]:[],recovery_conditions:issue?[recoveryCondition(issue.code)]:[],reported_by:issue?.reportedBy||null,certainty:issue?.reportedBy==='worker'?'observed':'reported'},
      completeness:{complete:!legacy&&!pending&&!events.some(e=>e.details?.omittedEvents),legacy,local_evidence_may_be_pending:pending,truncated:events.some(e=>Boolean(e.details?.omittedEvents))},routing_evaluations:(await store.list('task-routing')).filter(r=>r.taskId===task.id),current_routing_evaluation:await routingEvaluations(task)};
  }
  async function routingEvaluations(task,target=store){
    const devices=(await target.list('device')).filter(workerAuthorized);
    return devices.map(d=>{let reason=null;if(task.preferredDeviceId&&task.preferredDeviceId!==d.id)reason='OTHER_NODE_SELECTED';else if(!workerOnline(d,clock()))reason='NODE_OFFLINE';else if(task.preferredAgent&&!d.agents?.includes(task.preferredAgent))reason='AGENT_UNAVAILABLE';else if(task.writingSnapshot?.skill&&!d.writingSkills?.some(s=>s.hash===task.writingSnapshot.skill.hash))reason='SKILL_VERSION_MISMATCH';else if(!d.agents?.length)reason='AGENT_UNAVAILABLE';
      reason ||= capabilityBlock(task,d);
      return {device_id:d.id,device_name:d.name,eligible:!reason,reason,evaluated_at:new Date(clock()).toISOString()};});
  }
  async function capabilities(deviceId){
    const device=await store.get('device',deviceId);requireValue(device&&!device.revokedAt,'Device not found',404);
    const attempts=(await store.list('task-attempt')).filter(a=>a.deviceId===deviceId),facts=device.capabilityFacts||[];
    const proofs=attempts.filter(a=>a.resultValidatedAt).map(a=>({capabilityId:a.capabilityId,fingerprint:a.capabilityFingerprint,passed:true}));
    return {schema_version:1,device_id:deviceId,online:workerOnline(device,clock()),execution_role:workerAuthorized(device)?'local':'dispatch',tooling:device.lingnestTools||null,checks:(await store.list('capability-check')).filter(c=>c.deviceId===deviceId).slice(-10),capabilities:Object.entries(capabilityNames).map(([key,label])=>{
      const routes=facts.filter(f=>f.id===key).map(f=>evaluateCapability(device,key,{online:workerOnline(device,clock()),busy:device.skillRuntime?.idle===false,proofs,facts:[f]}));
      const rank=['ready','queued','connection','authorization','configuration','offline','unknown','disabled'];
      const best=routes.toSorted((a,b)=>rank.indexOf(a.state)-rank.indexOf(b.state))[0]||evaluateCapability(device,key,{facts:[],proofs});return {...best,label,routes};})};
  }
  async function handle(req,res,url,device){
    const route=url.pathname,ingest=route.match(/^\/api\/tasks\/([\w-]+)\/diagnostics$/);
    const check=route.match(/^\/api\/devices\/([\w-]+)\/capabilities\/check$/);
    if(check&&req.method==='POST'){
      requireValue(device.role==='owner','Owner permission required',403);const target=await store.get('device',check[1]);requireValue(target&&workerAuthorized(target),'Worker not found',404);
      const input=await body(req);requireValue(!input.action||['probe','install-tools'].includes(input.action),'Invalid capability action');
      if(input.action==='install-tools'){const checks=[await store.put('capability-check',{id:id(),deviceId:target.id,agent:'codex',mode:'writing',action:'install-tools',state:'queued',createdAt:now()})];send(res,200,{checks});return true;}
      const queued=[];await serialized('capability-check:'+target.id,async()=>{for(const agent of target.agents||[])for(const mode of ['capture','writing']){const previous=(await store.list('capability-check')).find(c=>c.deviceId===target.id&&c.agent===agent&&c.mode===mode&&c.state==='queued');queued.push(previous||await store.put('capability-check',{id:id(),deviceId:target.id,agent,mode,state:'queued',createdAt:now()}));}});
      send(res,200,{checks:queued});return true;
    }
    const checkResult=route.match(/^\/api\/capability-checks\/([\w-]+)\/result$/);
    if(checkResult&&req.method==='POST'){
      requireValue(workerAuthorized(device),'Worker permission required',403);const item=await store.get('capability-check',checkResult[1]);requireValue(item?.deviceId===device.id,'Check binding mismatch',403);const input=await body(req);
      requireValue(input.agent===item.agent&&input.mode===item.mode&&['ready','blocked','unknown'].includes(input.permission)&&typeof input.passed==='boolean','Invalid check result');
      await store.put('capability-check',{...item,state:'completed',completedAt:now(),permission:input.permission,passed:input.passed,code:diagnosticText(input.code,100)});send(res,200,{accepted:true});return true;
    }
    if(ingest&&req.method==='POST'){
      requireValue(workerAuthorized(device),'Worker permission required',403);const task=await taskFor(ingest[1]),input=await body(req);
      requireValue(input.schemaVersion===1&&validId(input.attemptId)&&Array.isArray(input.events)&&input.events.length<=30,'Invalid diagnostic batch');
      const attempt=await store.get('task-attempt',input.attemptId);requireValue(attempt&&attempt.taskId===task.id&&attempt.deviceId===device.id,'Execution binding mismatch',403);
      await serialized('diagnostics:'+input.attemptId,()=>store.transaction(async tx=>{
        for(const e of input.events){requireValue(validId(e.id)&&e.taskId===task.id&&e.attemptId===attempt.id&&e.deviceId===device.id&&Number.isFinite(Date.parse(e.at)),'Invalid execution event');
          const event={id:e.id,taskId:task.id,attemptId:attempt.id,deviceId:device.id,runId:validId(e.runId)?e.runId:null,at:e.at,state:diagnosticText(e.state,40),stage:diagnosticText(e.stage,100),agent:['codex','codebuddy'].includes(e.agent)?e.agent:null,code:diagnosticText(e.code,100),category:diagnosticCategory(e.code,e.state),reportedBy:e.reportedBy==='agent'?'agent':'worker',message:diagnosticText(e.message),details:diagnosticDetails(e.details)};
          if(Array.isArray(e.artifacts))event.artifacts=e.artifacts.slice(0,50).filter(a=>typeof a.path==='string'&&a.state==='saved'&&Number.isSafeInteger(a.bytes)&&a.bytes>=0).map(a=>({path:diagnosticText(a.path,300),bytes:a.bytes,state:'saved',sha256:/^[a-f0-9]{64}$/.test(a.sha256)?a.sha256:null}));
          const old=await tx.get('task-diagnostic',event.id);requireValue(!old||JSON.stringify(old)===JSON.stringify(event),'Diagnostic ID conflict',409);if(!old)await tx.put('task-diagnostic',event);
        }
      }));send(res,200,{accepted:true});return true;
    }
    const cap=route.match(/^\/api\/devices\/([\w-]+)\/capabilities$/);
    if(cap&&req.method==='GET'){readable(device);send(res,200,await capabilities(cap[1]));return true;}
    if(!route.startsWith('/api/read/v1/tasks'))return false;
    readable(device);requireValue(req.method==='GET','Read-only diagnostics',403);
    if(route==='/api/read/v1/tasks'){
      const tasks=[...await store.list('task'),...await Promise.all((await store.list('creation-turn')).map(t=>creationTask(t)))];
      const items=tasks.filter(t=>!t.deletedAt&&(!url.searchParams.get('state')||t.state===url.searchParams.get('state'))&&(!url.searchParams.get('device')||t.deviceId===url.searchParams.get('device')||t.executionDeviceIds?.includes(url.searchParams.get('device')))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).map(publicTask);
      send(res,200,page(items,url));return true;
    }
    const m=route.match(/^\/api\/read\/v1\/tasks\/([\w-]+)(?:\/(diagnostics|events|evidence)(?:\/([\w-]+))?)?$/);requireValue(m,'Not found',404);
    const report=await data(m[1]);
    if(m[2]==='events'){const events=report.events.filter(e=>!url.searchParams.get('attempt')||e.attemptId===url.searchParams.get('attempt'));send(res,200,{...page(events,url),completeness:report.completeness});}
    else if(m[2]==='evidence'){const e=report.events.find(e=>e.id===m[3]);requireValue(e,'Evidence not found',404);send(res,200,{schema_version:1,task_id:m[1],evidence:e,location:{event_id:e.id,attempt_id:e.attemptId},complete:true});}
    else send(res,200,m[2]==='diagnostics'?report:{schema_version:1,...report.task,attempts:report.attempts,completeness:report.completeness});
    return true;
  }
  function page(items,url){const raw=url.searchParams.get('limit')||'50',cursor=url.searchParams.get('cursor')||'0';requireValue(/^\d+$/.test(raw)&&/^\d+$/.test(cursor)&&Number(raw)>=1&&Number(raw)<=100&&Number.isSafeInteger(Number(cursor)),'Invalid pagination');const offset=Number(cursor),limit=Number(raw);return {schema_version:1,items:items.slice(offset,offset+limit),next_cursor:offset+limit<items.length?String(offset+limit):null,complete:offset+limit>=items.length};}
  async function workerProofs(deviceId){return (await store.list('task-attempt')).filter(a=>a.deviceId===deviceId&&a.resultValidatedAt&&a.capabilityFingerprint&&a.agent).map(a=>({capabilityId:a.capabilityId,fingerprint:a.capabilityFingerprint,agent:a.agent,passed:true}));}
  return {handle,recordState,capabilities,data,workerProofs,creationClaim,creationEvent};
}
