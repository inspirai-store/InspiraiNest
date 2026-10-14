// Production Agent runtime with a held, profile-local installer for native UI QA.
// No registry download, real CLI installation, or user-home writes occur here.
const fs=require('node:fs'),path=require('node:path');
exports.create=async({profile,configuration,probes,api})=>{
 if(!path.basename(profile).startsWith('inspirainest-formal-settings-'))throw Error('Expected disposable formal QA profile');
 const {createAgentRuntime}=await import('../../../src/agent-runtime.mjs');
 const {hash,atomicJson}=await import('../../../src/common.mjs');
 const config={...configuration,dataDir:path.join(profile,'fixture-agent-worker',configuration.deviceId)};
 const root=path.join(config.dataDir,'installer');fs.mkdirSync(root,{recursive:true});
 let inventory=structuredClone(probes),job=null,running=null,lastError=null;
 const installer={root,scan:async()=>({schemaVersion:1,platform:'win32',arch:'x64',agents:structuredClone(inventory)}),install:async(operation,{signal,beforeCommit})=>{
  const probe=inventory.find(value=>value.id===operation.agent);
  if(probe?.fingerprint!==operation.expectedFingerprint)throw Error('安装状态已变化，请刷新');
  let resolveGate,rejectGate;const gate=new Promise((resolve,reject)=>{resolveGate=resolve;rejectGate=reject;});
  const active={id:operation.id,signal,resolve:resolveGate,reject:rejectGate};job=active;
  try{
   await gate;
   if(signal.aborted)throw Error('操作已取消');
   await beforeCommit();
   inventory=inventory.map(value=>value.id===operation.agent?{...value,installed:true,version:operation.release.version,probeState:'available',source:operation.method==='managed'?'managed':value.source,originalSupported:operation.method==='original'&&value.originalSupported,fingerprint:hash(operation.deviceId+':'+value.id+':'+operation.release.version+':'+operation.method)}:value);
   let current={};try{current=JSON.parse(fs.readFileSync(path.join(root,'current.json'),'utf8'));}catch{}
   atomicJson(path.join(root,'current.json'),{...current,[operation.agent]:{operationId:operation.id,version:operation.release.version}});
   return {version:operation.release.version};
  }finally{if(job===active)job=null;}
 }};
 const runtime=createAgentRuntime(config,{api,installer});
 return {
  get busy(){return runtime.busy;},
  get activeOperationId(){return job?.id??null;},
  get lastError(){return lastError;},
  async start(){if(running)return running;lastError=null;running=(async()=>{const {operations}=await api('/api/agents/operations');await runtime.tick({idle:true,operationIds:operations.map(operation=>operation.id)});})().catch(error=>{lastError=String(error.message).replaceAll(configuration.token,'[授权]');throw error;}).finally(()=>{running=null;});return running;},
  finish(){job?.resolve();},
  fail(){job?.reject(Error('网络连接失败'));},
  close(){runtime.close();job?.reject(Error('操作已取消'));},
 };
};
