import fs from 'node:fs';
import path from 'node:path';
import { hash, atomicJson, remoteURL } from './common.mjs';
import { createAgentInstaller } from './agent-install.mjs';
import { acquireEnvironmentLock } from './agent-lock.mjs';

export function createAgentRuntime(config, { api, installer = createAgentInstaller(config), signal } = {}) {
  const scope = hash(remoteURL(config.server) + ':' + config.deviceId + ':' + hash(config.token));
  const file = path.join(config.dataDir, 'agents', scope, 'receipts.json');
  let receipts; try { receipts = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { receipts = {}; }
  let closed = false, active = null, lastReport = 0, environment = null, namespace = null;
  const redact = error => String(error.message || error).replaceAll(config.token, '[授权]').replaceAll(installer.root, '[安装目录]').slice(0,500);
  async function report() {
    environment = await installer.scan();
    await api('/api/agents/environment', 'POST', { ...environment, agents:environment.agents.map(({command,original,...entry}) => entry) });
    lastReport = Date.now(); return environment;
  }
  async function tick({ idle = false, operationIds = [] } = {}) {
    if (closed || active) return;
    if (!lastReport || Date.now()-lastReport>=60000) await report();
    if (!idle || !operationIds.length) return;
    namespace ||= (await api('/api/device-policy')).namespace;
    const { operations } = await api('/api/agents/operations');
    for (const op of [...operations].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))) {
      if (closed || signal?.aborted) return;
      if (op.deviceId !== config.deviceId || op.deploymentId !== namespace || op.schemaVersion !== 1) continue;
      if (receipts[op.id]) { await api('/api/agents/operations/'+op.id+'/result','POST',receipts[op.id]); continue; }
      const release = acquireEnvironmentLock(installer.root); if(!release)return;
      const controller = new AbortController(); active = controller;
      const abort = () => controller.abort(); signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
      let timedOut=false;
      const timeout = setTimeout(()=>{timedOut=true;abort();},15*60000);
      let poll;
      try {
        const claimed = await api('/api/agents/operations/'+op.id+'/result','POST',{state:'running'});
        if (claimed.state !== 'running') continue;
        const check = async () => {
          const latest = await api('/api/agents/operations/'+op.id);
          if (latest.state !== 'running') { abort(); throw new Error('操作已取消'); }
          if (controller.signal.aborted || closed) throw new Error('操作已取消或超时');
        };
        let checking = false;
        poll = setInterval(async()=> { if(checking)return;checking=true;try{await check();}catch(error){if([401,403].includes(error.status) || /取消/.test(error.message))abort();}finally{checking=false;} },2000);
        let result;
        let state;try{state=JSON.parse(fs.readFileSync(path.join(installer.root,'current.json'),'utf8'));}catch{state={};}
        if (op.action === 'refresh') { await report(); result = {}; }
        else if (state[op.agent]?.operationId === op.id) result = { version:state[op.agent].version };
        else result = await installer.install(op,{signal:controller.signal,beforeCommit:check});
        const receipt = { state:result.waiting ? 'waiting' : 'succeeded', result };
        if (!result.waiting) { receipts[op.id]=receipt;atomicJson(file,receipts); }
        await api('/api/agents/operations/'+op.id+'/result','POST',receipt);
        await report();
      } catch(error) {
        if([401,403].includes(error.status)) { abort(); throw error; }
        if(receipts[op.id]?.state==='succeeded')throw error;
        const receipt={state:controller.signal.aborted&&!timedOut?'cancelled':'failed',result:{error:timedOut?'安装超时':redact(error)}};
        receipts[op.id]=receipt;atomicJson(file,receipts);
        await api('/api/agents/operations/'+op.id+'/result','POST',receipt);
      } finally { clearTimeout(timeout);clearInterval(poll);signal?.removeEventListener('abort',abort);active=null;release(); }
    }
  }
  return { tick, report, get environment(){return environment;}, get busy(){return Boolean(active);}, get operationLock(){return fs.existsSync(path.join(installer.root,'operation.lock'));}, close(){closed=true;active?.abort();} };
}
