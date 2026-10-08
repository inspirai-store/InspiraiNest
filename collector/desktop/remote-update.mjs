import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { atomicJson } from '../src/common.mjs';
import { readOptional } from '../src/worker-control.mjs';

export async function verifyUpdateFile(files,op) {
  const file=files?.find(file=>typeof file==='string' && (op.platform==='win32'?/\.exe$/i:/\.zip$/i).test(file));
  if(!file || fs.statSync(file).size!==op.size)throw Object.assign(new Error('安装包长度校验失败'),{code:'CHECKSUM'});
  const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
  if(hash.digest('hex')!==op.sha256)throw Object.assign(new Error('安装包哈希校验失败'),{code:'CHECKSUM'});
}

// Main-process only: official updater, fixed authenticated routes, no arbitrary executable/URL.
export class RemoteClientUpdate {
  constructor({file,version,platform=process.platform,arch=process.arch,updater,request,configuration,verify=verifyUpdateFile,onError=()=>{},recoverWorker=async()=>{}}) {
    Object.assign(this,{file,version,platform,arch,updater,request,configuration,verify,onError,recoverWorker});
    this.op=null;this.busy=false;this.stopped=false;this.receipt=readOptional(file);this.startedWithReceipt=Boolean(this.receipt);this.files=null;this.verified=false;
    this.binding=null;this.error=null;this.installOperation=null;this.recoveryPending=false;
    this.progressListener=state=>{
      if(this.op?.state!=='downloading' || state.phase!=='downloading' || Date.now()-(this.progressAt || 0)<3000)return;
      this.progressAt=Date.now();const id=this.op.id;
      if(this.binding===this.bind())void this.request(`/api/client-updates/operations/${id}/result`,'POST',{state:'downloading',progress:state.progress}).catch(()=>{});
    };
    updater.on('changed',this.progressListener);
  }
  runtime(){return {schemaVersion:1,version:this.version,platform:this.platform,arch:this.arch,remoteUpdate:this.updater.supported};}
  bind(){const c=this.configuration();return createHash('sha256').update(`${c.server}:${c.deviceId}`).digest('hex');}
  async result(state,extra={}) {
    if(!this.op || this.binding!==this.bind())throw new Error('节点连接已改变');
    const next=await this.request(`/api/client-updates/operations/${this.op.id}/result`,'POST',{state,...extra});this.op=next;return next;
  }
  async fail(code='UPDATE_FAILED') {
    try {await this.result('failed',{errorCode:code});}catch{}
    this.error=code;this.onError(code);
    if(this.installOperation)this.abandon();
  }
  abandon(){
    if(!this.installOperation)return;
    this.installOperation=null;this.updater.stopWaiting();this.updater.set({phase:'downloaded',error:'远程更新已停止，请确认节点授权与更新状态后重试。'});this.recoveryPending=true;
  }
  saveReceipt() {
    const value={operationId:this.op.id,targetVersion:this.op.targetVersion,fromVersion:this.version,binding:this.binding};
    atomicJson(this.file,value);this.receipt=value;
  }
  async beforeInstall() {
    const gate=this.installOperation;if(!gate)return;
    // Recheck authorization/cancellation and pinned bytes immediately before executing an installer.
    const {operations}=await this.request('/api/client-updates/inbox');
    const live=operations.find(o=>o.id===gate.id);
    if(!live || live.state!=='waiting_worker' || this.installOperation!==gate || this.binding!==this.bind() || !this.verified)throw new Error('远程更新已取消或节点连接已改变');
    await this.verify(this.files,live);
    this.saveReceipt();await this.result('installing');
  }
  async tick() {
    if(this.busy || this.stopped || !this.updater.supported)return;
    const config=this.configuration();if(!config.server || !config.token || !config.deviceId)return;
    this.busy=true;
    try {
      if(this.recoveryPending)this.recoveryPending=(await this.recoverWorker())===false;
      await this.request('/api/client-updates/runtime','POST',this.runtime());
      const {operations}=await this.request('/api/client-updates/inbox');
      const op=operations[0];
      if(!op){this.abandon();this.op=null;this.verified=false;return;}
      if(this.op?.id!==op.id){this.files=null;this.verified=false;}
      this.op=op;this.binding=this.bind();
      if(this.startedWithReceipt && this.receipt?.operationId===op.id && this.receipt.binding===this.binding && op.state==='installing') {
        if(this.version===op.targetVersion) {await this.result('succeeded',{version:this.version});fs.rmSync(this.file,{force:true});this.receipt=null;this.op=null;}
        else await this.fail('RESTART_MISMATCH');return;
      }
      if(op.platform!==this.platform || op.arch!==this.arch || op.fromVersion!==this.version){await this.fail('VERSION_CHANGED');return;}
      if(op.state==='installing'){if(this.updater.snapshot().phase==='downloaded' && this.updater.snapshot().error)await this.fail();return;}
      if(op.state==='queued' || op.state==='checking') {
        await this.result('checking');const state=await this.updater.check();
        if(state.phase==='error') {await this.fail();return;}
        if(state.availableVersion!==op.targetVersion){await this.fail('VERSION_CHANGED');return;}
        await this.result('downloading');
      }
      if(this.op.state==='downloading') {
        const state=this.updater.snapshot();
        if(state.phase==='error'){await this.fail();return;}
        if(state.phase==='available'){await this.updater.download();this.files=this.updater.downloadedFiles;}
        else if(state.phase==='downloaded')this.files ||= this.updater.downloadedFiles;
        else if(state.phase==='downloading')return;
        else {await this.fail('VERSION_CHANGED');return;}
        if(this.updater.snapshot().availableVersion!==op.targetVersion){await this.fail('VERSION_CHANGED');return;}
        await this.verify(this.files,op);this.verified=true;
        // Downloads may overlap tasks. Draining and installation begin only after server acknowledgement.
        await this.result('waiting_worker',{progress:100});
        this.installOperation={id:op.id};
        await this.updater.install();
      } else if(this.op.state==='waiting_worker') {
        const state=this.updater.snapshot();
        if(state.phase==='downloaded' && this.verified)await this.updater.install();
        else if(!['waiting_worker','installing'].includes(state.phase))await this.fail();
      }
    } catch(e) {
      if(e.code==='CHECKSUM'){await this.fail('CHECKSUM');}
      else if(e.status===409 && this.op?.state==='downloading'){ /* Environment maintenance is busy; retry without draining. */ }
      else if(e.status!==404){if([401,403].includes(e.status))this.abandon();this.onError('REMOTE_UPDATE_CONNECTION');}
    } finally {this.busy=false;}
  }
  dispose(){this.stopped=true;this.updater.off('changed',this.progressListener);}
}
