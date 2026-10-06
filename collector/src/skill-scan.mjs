import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { scanSkillInventory } from './skill-inventory.mjs';
import { agentEnvironment } from './agents.mjs';

if (!isMainThread && workerData?.skillInventory === true) {
  try { parentPort.postMessage({result:await scanSkillInventory(workerData.config,workerData.options)}); }
  catch { parentPort.postMessage({error:'技能盘点失败，请刷新后重试'}); }
}

export function createInventoryScanner() {
  const active=new Set();let closed=false;
  function scan(config,options) {
    if(closed)return Promise.reject(Object.assign(new Error('技能盘点已停止'),{code:'SKILL_SCAN_STOPPED'}));
    // Keep the execution user, profile and cwd without blocking Worker control.
    // Do not include service/device credentials in thread input or output.
    const env=agentEnvironment(options.env);
    const worker=new Worker(new URL('./skill-scan.mjs',import.meta.url),{
      execArgv:[],env,
      workerData:{skillInventory:true,config:{agents:config.agents,skillProjects:config.skillProjects},options:{...options,env}}
    });
    active.add(worker);
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;active.delete(worker);void worker.terminate();error?reject(error):resolve(result);};
      worker.once('message',message=>finish(message.error?new Error(message.error):null,message.result));
      worker.once('error',()=>finish(new Error('技能盘点失败，请刷新后重试')));
      worker.once('exit',()=>finish(Object.assign(new Error('技能盘点已停止'),{code:'SKILL_SCAN_STOPPED'})));
    });
  }
  scan.close=()=>{closed=true;for(const worker of active)void worker.terminate();};
  return scan;
}
