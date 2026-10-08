import { hash, requireValue } from './common.mjs';
import { workerAuthorized, clientRuntime } from './device-metadata.mjs';

export const updatePending = op => ['queued','checking','downloading','waiting_worker','installing'].includes(op.state);
export const updateBlocksTasks = op => ['waiting_worker','installing'].includes(op.state);
export const newerVersion = (a,b) => {
  if (!/^\d+\.\d+\.\d+$/.test(a || '') || !/^\d+\.\d+\.\d+$/.test(b || '')) return false;
  const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;
};
export function createClientUpdateService({store,serialized,worker,owner,body,send,clock,releases}) {
  const at=()=>new Date(clock()).toISOString();
  const key='client-update';
  const publicOp=({creatorId,requestId,...op})=>op;
  const platformKey=d=>d.clientRuntime?.platform==='win32' && d.clientRuntime.arch==='x64' ? 'windows_x64'
    : d.clientRuntime?.platform==='darwin' ? `macos_${d.clientRuntime.arch}` : null;
  async function settle(deviceId) {
    return serialized(`device:${deviceId}`,()=>store.transaction(async tx=>{
      const d=await tx.getForUpdate('device',deviceId);
      for(const op of await tx.list(key))if(op.deviceId===deviceId && updatePending(op)) {
        const timeout=op.state==='queued'?86400000:op.state==='installing'?15*60000:2*3600000;
        if(!d || !workerAuthorized(d) || clock()-Date.parse(op.updatedAt)>timeout)
          await tx.put(key,{...op,state:!d || !workerAuthorized(d)?'cancelled':'expired',message:!d || !workerAuthorized(d)?'节点授权已撤销':'节点未在期限内完成更新，请检查本机后重试',updatedAt:at()});
      }
    }));
  }
  async function operations(deviceId) {await settle(deviceId);return (await store.list(key)).filter(o=>o.deviceId===deviceId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  return {
    async inbox(deviceId){return (await operations(deviceId)).filter(updatePending).map(publicOp);},
    async cancelDevice(tx,deviceId){for(const op of await tx.list(key))if(op.deviceId===deviceId && updatePending(op))await tx.put(key,{...op,state:'cancelled',message:'节点授权已撤销',updatedAt:at()});},
    async handle(req,res,route,actor){
      if(!route.startsWith('/api/client-updates/'))return false;
      const respond=(code,value)=>{send(res,code,value);return true;};
      if(route==='/api/client-updates/runtime' && req.method==='POST') {
        worker(actor);const runtime=clientRuntime(await body(req));requireValue(runtime,'缺少客户端运行信息');
        await serialized(`device:${actor.id}`,()=>store.transaction(async tx=>{
          const d=await tx.getForUpdate('device',actor.id);requireValue(d && workerAuthorized(d) && d.tokenHash===actor.tokenHash,'节点授权已失效',401);
          await tx.put('device',{...d,clientRuntime:runtime,clientRuntimeAt:at()});
        }));return respond(200,{reported:true});
      }
      if(route==='/api/client-updates/inbox' && req.method==='GET') {worker(actor);return respond(200,{operations:await this.inbox(actor.id)});}
      if(route==='/api/client-updates/operations' && req.method==='GET') {
        owner(actor);const deviceId=new URL(req.url,'http://localhost').searchParams.get('deviceId');
        const d=await store.get('device',deviceId);requireValue(d && workerAuthorized(d),'工作节点不存在',404);
        const release=(await releases())[platformKey(d)];
        return respond(200,{runtime:d.clientRuntime || null,target:release?{version:release.version,sha256:release.sha256,size:release.size}:null,operations:(await operations(deviceId)).slice(0,20).map(publicOp)});
      }
      if(route==='/api/client-updates/operations' && req.method==='POST') {
        owner(actor);const input=await body(req);
        requireValue(input && Object.keys(input).every(k=>['deviceId','requestId','targetVersion'].includes(k)) && typeof input.deviceId==='string'
          && /^[a-f0-9-]{36}$/i.test(input.requestId || '') && /^\d+\.\d+\.\d+$/.test(input.targetVersion || ''),'更新请求无效');
        const opId=hash(`${actor.credentialId || actor.id}:${input.requestId}`),fingerprint=hash(JSON.stringify([input.deviceId,input.targetVersion]));
        await settle(input.deviceId);
        const op=await serialized(`device:${input.deviceId}`,()=>store.transaction(async tx=>{
          const d=await tx.getForUpdate('device',input.deviceId);requireValue(d && workerAuthorized(d),'工作节点不存在或授权已撤销',404);
          const existing=await tx.getForUpdate(key,opId);if(existing){requireValue(existing.fingerprint===fingerprint,'请求编号已用于另一次更新',409);return existing;}
          requireValue(d.clientRuntime?.remoteUpdate,'该节点需先在本机升级一次，才能启用远程更新',409);
          const release=(await releases())[platformKey(d)];
          requireValue(release && release.version===input.targetVersion && /^[a-f0-9]{64}$/.test(release.sha256) && Number.isSafeInteger(release.size),'该平台尚无对应正式更新包',409);
          requireValue(newerVersion(release.version,d.clientRuntime.version),'节点已是此版本或更高版本',409);
          requireValue(!(await tx.list(key)).some(o=>o.deviceId===d.id && updatePending(o)),'该节点已有更新任务',409);
          return tx.put(key,{id:opId,fingerprint,deviceId:d.id,creatorId:actor.id,requestId:input.requestId,state:'queued',
            fromVersion:d.clientRuntime.version,targetVersion:release.version,sha256:release.sha256,size:release.size,
            platform:d.clientRuntime.platform,arch:d.clientRuntime.arch,progress:0,message:'等待节点接收更新',createdAt:at(),updatedAt:at()});
        }));return respond(201,publicOp(op));
      }
      const match=route.match(/^\/api\/client-updates\/operations\/([a-f0-9]{64})\/(cancel|result)$/);
      if(match && req.method==='POST') {
        const [,opId,action]=match;action==='cancel'?owner(actor):worker(actor);const input=await body(req);
        const existing=await store.get(key,opId);requireValue(existing,'更新任务不存在',404);
        const op=await serialized(`device:${existing.deviceId}`,()=>store.transaction(async tx=>{
          const d=await tx.getForUpdate('device',existing.deviceId),o=await tx.getForUpdate(key,opId);
          requireValue(d && workerAuthorized(d),'节点授权已撤销',401);
          if(action==='cancel') {requireValue(['queued','checking','downloading','cancelled'].includes(o.state),'已进入安全停止或安装阶段，不能取消',409);return tx.put(key,{...o,state:'cancelled',message:'用户已取消更新',updatedAt:at()});}
          requireValue(actor.id===o.deviceId && actor.tokenHash===d.tokenHash,'只能上报本机更新',403);
          const transitions={queued:['checking','failed'],checking:['checking','downloading','failed'],downloading:['downloading','waiting_worker','failed'],waiting_worker:['waiting_worker','installing','failed'],installing:['succeeded','failed'],succeeded:['succeeded']};
          requireValue(transitions[o.state]?.includes(input.state),'更新状态不匹配',409);
          if(input.state==='succeeded')requireValue(d.clientRuntime?.version===o.targetVersion && input.version===o.targetVersion,'新版本尚未启动，不能报告成功',409);
          if(['waiting_worker','installing'].includes(input.state))requireValue(!d.agentRuntime?.busy
            && !(await tx.list('agent-operation')).some(s=>s.deviceId===d.id && ['running','cancel_requested'].includes(s.state))
            && !(await tx.list('skill-operation')).some(s=>s.deviceId===d.id && s.state==='running'),'节点正在更新 Agent 或技能，稍后重试',409);
          if(input.state==='installing')requireValue(!(await tx.list('task')).some(t=>t.deviceId===d.id && ['assigned','running','uploading'].includes(t.state)),'节点当前任务尚未完成',409);
          const messages={checking:'正在检查正式更新',downloading:'正在下载并校验安装包',waiting_worker:'等待当前任务完成后安装',installing:'安装中，等待新版本重新上线',succeeded:'新版本已启动并确认',failed:'更新失败，请查看本机系统日志'};
          const progress=Number(input.progress);return tx.put(key,{...o,state:input.state,progress:Number.isFinite(progress)?Math.max(o.progress,Math.min(100,Math.max(0,Math.round(progress)))):o.progress,
            message:messages[input.state],...(input.state==='failed'?{errorCode:['VERSION_CHANGED','CHECKSUM','UPDATE_FAILED','RESTART_MISMATCH'].includes(input.errorCode)?input.errorCode:'UPDATE_FAILED'}:{}),updatedAt:at()});
        }));return respond(200,publicOp(op));
      }
      return respond(404,{error:'更新接口不存在'});
    }
  };
}
