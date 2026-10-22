import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson,hash} from './common.mjs';

export const diagnosticScope='diagnostics:read';
export function diagnosticText(value,limit=1000){
  return String(value??'').replace(/(?:set-cookie|cookie)\s*:\s*[^\r\n]+/gi,'Cookie: [redacted]').replace(/((?:token|password|secret|authorization|连接码|配对码)\s*[=:：]\s*)[\"'][^\"']*[\"']/gi,'$1[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/((?:token|password|secret|cookie|authorization|连接码|配对码)\s*[=:：]\s*)[^\s,;]+/gi,'$1[redacted]')
    .replace(/https?:\/\/[^\s<>"']+/g,value=>{try{const u=new URL(value);return u.origin+u.pathname;}catch{return '[url]';}})
    .replace(/(?:\/Users\/|\/home\/)[^/\s]+/g,'[home]').replace(/[A-Za-z]:\\Users\\[^\\\s]+/g,'[home]')
    .slice(0,limit);
}
const safeKeys=['exitCode','spawnError','timeoutMs','expectedFile','field','status','code','operation','executable','characters','expectedImages','savedImages','missingImages','sessionId','checkpoint','revision','omittedEvents'];
export function diagnosticDetails(value={}){
  return Object.fromEntries(safeKeys.filter(k=>['string','number','boolean'].includes(typeof value?.[k])).map(k=>[k,typeof value[k]==='string'?diagnosticText(value[k],300):value[k]]));
}
export function diagnosticCategory(code='',state=''){
  if(code==='BROWSER_WAITING')return 'manual';
  if(/LOGIN|PERMISSION|AUTH/.test(code))return /SOURCE/.test(code)?'source':'authorization';
  if(/BROWSER|PAGE/.test(code))return 'browser';
  if(/SOURCE|CHALLENGE/.test(code))return 'source';
  if(/QUALITY|COVERAGE|MISSING_IMAGE/.test(code))return 'coverage';
  if(/UPLOAD|NETWORK|REMOTE|HTTP/.test(code))return 'transport';
  if(/RESULT|VALIDAT|ENCODING|REPORT/.test(code))return 'validation';
  if(/VERSION|PROTOCOL|DEPENDENCY|ENVIRONMENT|START/.test(code))return 'environment';
  if(code==='AGENT_TIMEOUT')return 'timeout';
  return ['completed','awaiting_review','cancelled'].includes(state)?'normal':'unknown';
}

// A separate outbox survives log rotation and process restarts. No private source
// text, Agent stdout, prompt, arbitrary diagnostics object or credentials enter it.
export function createDiagnosticOutbox(dataDir,{deviceId,token,runId=randomUUID(),api}={}){
  const root=path.join(dataDir,'diagnostic-outbox');let flushing,omittedEvents=0;try{fs.mkdirSync(root,{recursive:true,mode:0o700});}catch{omittedEvents++;}
  const clean=value=>diagnosticText(token?String(value??'').split(token).join('[redacted]'):value);
  function record(task,patch){
    if(!task.attemptId)return null;
    const code=String(patch.diagnostic?.code||patch.code||'TASK_'+String(patch.state||'running').toUpperCase()).slice(0,100);
    const event={id:randomUUID(),taskId:task.id,attemptId:task.attemptId,runId,at:new Date().toISOString(),deviceId,
      state:patch.state||'running',stage:String(patch.logStage||patch.stage||patch.state||'running').slice(0,100),agent:patch.agent||task.agent||null,
      code,category:diagnosticCategory(code,patch.state),message:clean(patch.message),reportedBy:patch.diagnostic?.reportedBy==='agent'||patch.logStage?'agent':'worker',
      details:diagnosticDetails(patch.diagnostic?.details||patch.details)};
    if(Array.isArray(patch.artifacts))event.artifacts=patch.artifacts;
    if(omittedEvents)event.details.omittedEvents=omittedEvents;
    try{fs.mkdirSync(root,{recursive:true,mode:0o700});atomicJson(path.join(root,event.id+'.json'),event);omittedEvents=0;return event;}
    catch{omittedEvents++;return null;}
  }
  async function sendPending(){
    if(!fs.existsSync(root))return {pending:0};
    const files=fs.readdirSync(root).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n));
    const groups=new Map();for(const name of files){const file=path.join(root,name);const e=JSON.parse(fs.readFileSync(file,'utf8'));const key=e.taskId+':'+e.attemptId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({file,e});}
    for(const group of groups.values())for(let i=0;i<group.length;i+=30){const batch=group.slice(i,i+30),first=batch[0].e;
      const result=await api(`/api/tasks/${first.taskId}/diagnostics`,'POST',{schemaVersion:1,attemptId:first.attemptId,events:batch.map(x=>x.e)});
      if(result.accepted!==true)throw Error('Diagnostic batch not acknowledged');
      for(const {file}of batch)fs.unlinkSync(file);
    }
    return {pending:fs.readdirSync(root).filter(n=>n.endsWith('.json')).length};
  }
  return {runId,record,flush(){if(!flushing)flushing=(async()=>{let result;do{result=await sendPending();}while(result.pending>0);return result;})().finally(()=>{flushing=null;});return flushing;}};
}

export function capabilityKey(task){return task.purpose==='selection-writing'?'writing.selection':task.writingSessionId?'writing.materials':task.capture?.kind==='page'?'capture.browser':task.type==='video'?'capture.media':'capture.article';}
export function taskEnvironmentFingerprint(device,agent,skillHash){return hash(JSON.stringify({version:device.clientRuntime?.version,platform:device.platform,agent,environment:device.environment?.digest,skillHash}));}

export function checkpointEvidence(dataDir,task){
  const workspace=path.join(dataDir,task.purpose==='selection-writing'?'writing-tasks':'tasks',task.id,...(task.purpose==='selection-writing'?[]:['library']));
  if(!fs.existsSync(workspace))return [];
  const realRoot=fs.realpathSync(workspace),artifacts=[];
  function read(relative){const file=path.join(workspace,relative),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024||!fs.realpathSync(file).startsWith(realRoot+path.sep))throw Error('Invalid checkpoint metadata');return JSON.parse(fs.readFileSync(file,'utf8'));}
  function inspect(relative){
    if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>p==='..'))return;
    const file=path.join(workspace,relative);try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())return;const real=fs.realpathSync(file);if(!real.startsWith(realRoot+path.sep))return;
      artifacts.push({path:diagnosticText(relative,300),bytes:stat.size,state:'saved',sha256:stat.size<=16*1024*1024?hash(fs.readFileSync(real)):null});
    }catch{}
  }
  for(const file of ['collector-result.json','writing-result.json','.capture-input/page.json','.capture-input/initial.txt','.capture-runtime/capture-cli.mjs','.capture-runtime/manifest.json','.capture-runtime/toolchain.json'])inspect(file);
  try{const checkpoint=read(task.writingSessionId||task.purpose==='selection-writing'?'writing-result.json':'collector-result.json');
    if(typeof checkpoint.entry==='string'&&!path.isAbsolute(checkpoint.entry)&&!checkpoint.entry.split(/[\\/]/).includes('..')){
      const meta=read(path.join(checkpoint.entry,'source.json'));
      for(const item of (meta.files||[]).slice(0,40))inspect(path.join(checkpoint.entry,item.path));
    }
  }catch{}
  return artifacts;
}
