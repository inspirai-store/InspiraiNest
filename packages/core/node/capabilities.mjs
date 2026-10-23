// Shared by task routing and presentation; capabilities are supplied as facts,
// without importing any concrete plugin implementation.
export function taskCapabilityId(task){return task.creationSessionId?'writing.creation':task.purpose==='selection-writing'?'writing.selection':task.writingSessionId?'writing.materials':task.capture?.kind==='page'?'capture.browser':task.type==='video'?'capture.media':'capture.article';}
export function evaluateCapability(device,capability,{online=true,busy=false,proofs=[],facts=[]}={}){
  const fact=facts.find(f=>f.id===capability),reasons=[];
  if(!fact)reasons.push({code:'NOT_REPORTED',message:'客户端未上报检测结果'});
  else if(fact.enabled===false)reasons.push({code:'NOT_ENABLED',message:'能力未启用'});
  if(fact?.missing?.length)for(const name of fact.missing)reasons.push({code:'DEPENDENCY_MISSING',message:'缺少 '+name});
  if(fact?.permission==='blocked')reasons.push({code:'AGENT_PERMISSION',message:'执行工具需要授权'});
  if(fact?.available===false&&!reasons.length)reasons.push({code:'UNAVAILABLE',message:'执行入口不可用'});
  const compatible=proofs.filter(p=>p.capabilityId===capability&&p.fingerprint===fact?.fingerprint);
  const verification=compatible.some(p=>p.passed===true)?'passed':proofs.some(p=>p.capabilityId===capability)?'changed':'untested';
  let state=!fact?'unknown':fact.enabled===false?'disabled':fact.permission==='blocked'?'authorization':reasons.length?'configuration':fact.available!==true?'unknown':!online?'offline':busy?'queued':'ready';
  if(capability==='capture.browser'&&state==='ready'&&fact.connected!==true)state='connection';
  return {id:capability,state,verification,reasons,fingerprint:fact?.fingerprint||null,agent:fact?.agent||null,skill:fact?.skill||null,checkedAt:fact?.checkedAt||null};
}
export function capabilityBlock(task,device){
  const id=taskCapabilityId(task),facts=device.capabilityFacts;
  if(!Array.isArray(facts))return null; // Older clients retain their existing protocol.
  const match=facts.filter(f=>f.id===id&&(!task.preferredAgent||f.agent===task.preferredAgent));
  if(!match.length)return 'NOT_REPORTED';
  if(id==='capture.browser'&&match.length&&match.every(f=>f.connected!==true))return 'BROWSER_NOT_CONNECTED';
  if(match.some(f=>f.enabled!==false&&f.available===true&&f.permission!=='blocked'&&!f.missing?.length))return null;
  return match.some(f=>f.permission==='blocked')?'AGENT_PERMISSION':'CAPABILITY_UNAVAILABLE';
}

export function rankExecutionAgents(task,names,{facts=[],proofs=[]}={}){
  const id=taskCapabilityId(task);
  const eligible=names.filter(agent=>{const f=facts.find(f=>f.id===id&&f.agent===agent);return !f||f.enabled!==false&&f.available===true&&f.permission!=='blocked'&&!f.missing?.length;});
  if(task.agent||task.preferredAgent)return eligible;
  return eligible.map((agent,index)=>{const f=facts.find(f=>f.id===id&&f.agent===agent);const verified=proofs.some(p=>p.capabilityId===id&&p.agent===agent&&p.fingerprint===f?.fingerprint&&p.passed===true);return {agent,index,verified};}).sort((a,b)=>Number(b.verified)-Number(a.verified)||a.index-b.index).map(x=>x.agent);
}
