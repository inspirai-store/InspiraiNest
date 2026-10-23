import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {desktopVersion,compareDesktopVersions,updateChannels,versionChannel} from '../../packages/core/shared/desktop-release.mjs';

const blocked=['checking','downloading','waiting_save','waiting_worker','installing'];
const cleanNotes=value=>typeof value==='string'?value.slice(0,30000):Array.isArray(value)?value.map(n=>typeof n==='string'?n:n.note||'').join('\n').slice(0,30000):'';
const updateError=error=>{
 const message=error?.message||String(error);
 if(/404 Not Found|Cannot find channel/i.test(message))return '更新服务尚未提供此平台版本，请稍后重试或前往下载页。';
 if(/signature|sha512|checksum/i.test(message))return '更新包校验失败，请重新下载。';
 if(/ENOTFOUND|ECONN|ETIMEDOUT|ERR_NETWORK|fetch failed/i.test(message))return '暂时无法连接更新服务，请检查网络后重试。';
 return message.split('\n')[0].slice(0,180);
};
export class DesktopUpdater extends EventEmitter {
 constructor({app,manager,updater,version=app.getVersion(),platform=process.platform,arch=process.arch,pollMs=2000,beforeInstall=async()=>{},beforePrepare=async()=>{},stateFile,releaseNotes=[],releaseIndexLoader}={}){
  super();Object.assign(this,{app,manager,updater,pollMs,beforeInstall,beforePrepare,stateFile,platform,arch});
  this.supported=Boolean(app.isPackaged&&['win32','darwin'].includes(platform));this.workerTimer=null;this.busy=false;this.history=[];this.releaseHistory=releaseNotes;
  let saved={};try{saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{}
  this.history=Array.isArray(saved.history)?saved.history.slice(-100):[];
  this.state={version,platform,arch,channel:updateChannels.includes(saved.channel)?saved.channel:'stable',phase:this.supported?'idle':'unsupported',availableVersion:null,upstreamVersion:null,progress:null,error:null,supported:this.supported,lastCheckedAt:saved.lastCheckedAt||null,releaseNotes:'',publishedAt:null,downloadMode:'pending',transferred:null,total:null,fallbackReason:null};
  this.releaseIndexLoader=releaseIndexLoader|| (async()=>{const response=await fetch('https://library.inspirai.store/client-release.json',{signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)throw Error('无法读取发布说明');return response.json();});
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;this.applyChannel();
  const logger=updater.logger;
  updater.logger=Object.fromEntries(['info','warn','error','debug'].map(level=>[level,(...args)=>{logger?.[level]?.(...args);const message=args.filter(x=>typeof x==='string').join(' ');if(this.state.phase!=='downloading')return;if(/Download block maps/.test(message))this.set({downloadMode:'differential'});if(/falling back to full download|fallback to full download|No cached update available/i.test(message))this.set({downloadMode:'full',fallbackReason:'增量基线不可用，使用完整包'});} ]));
  updater.on('update-available',info=>this.receive(info));
  updater.on('update-not-available',info=>this.receive(info));
  updater.on('download-progress',info=>this.set({phase:'downloading',progress:Math.max(0,Math.min(100,Math.round(info.percent||0))),transferred:Number.isFinite(info.transferred)?info.transferred:null,total:Number.isFinite(info.total)?info.total:null}));
  updater.on('update-downloaded',info=>{this.record('downloaded',{version:info.version,mode:this.state.downloadMode});this.set({phase:'downloaded',availableVersion:info.version,progress:100,error:null});});
  updater.on('error',error=>{if(this.busy&&this.state.channel==='beta'&&/404|Cannot find channel/i.test(error.message||''))return;this.set({phase:'error',error:updateError(error)});});
 }
 applyChannel(){this.updater.channel=this.state.channel==='stable'?'latest':'beta';this.updater.allowPrerelease=this.state.channel==='beta';this.updater.allowDowngrade=false;}
 snapshot(){return {...this.state};}
 set(changes){Object.assign(this.state,changes);this.emit('changed',this.snapshot());return this.snapshot();}
 persist(){if(!this.stateFile)return;fs.mkdirSync(path.dirname(this.stateFile),{recursive:true});const temporary=this.stateFile+'.'+randomUUID()+'.tmp';fs.writeFileSync(temporary,JSON.stringify({schemaVersion:1,channel:this.state.channel,lastCheckedAt:this.state.lastCheckedAt,history:this.history}),{mode:0o600});fs.renameSync(temporary,this.stateFile);}
 record(action,details={}){this.history.push({id:randomUUID(),at:new Date().toISOString(),action,channel:this.state.channel,...details});this.history=this.history.slice(-100);this.persist();}
 receive(info){
  if(!desktopVersion(info?.version))return;
  const acceptable=this.state.channel==='beta'||versionChannel(info.version)==='stable';if(!acceptable)return this.set({phase:'error',error:'更新通道返回了不匹配的版本，请重试'});const newer=acceptable&&compareDesktopVersions(info.version,this.state.version)>0;
  return this.set({phase:newer?'available':'current',upstreamVersion:info.version,availableVersion:newer?info.version:null,error:null,progress:null,releaseNotes:cleanNotes(info.releaseNotes)||this.state.releaseNotes,publishedAt:info.releaseDate||this.state.publishedAt});
 }
 async check(){
  if(!this.supported)return this.set({phase:'unsupported',error:'当前运行方式不支持应用内更新，请安装正式版客户端'});
  if(this.busy||['downloading','downloaded','waiting_save','waiting_worker','installing'].includes(this.state.phase))return this.snapshot();
  this.busy=true;this.set({phase:'checking',error:null,availableVersion:null,upstreamVersion:null,progress:null,downloadMode:'pending',fallbackReason:null,releaseNotes:'',publishedAt:null});
  try{
   try{const index=await this.releaseIndexLoader();const releases=index.desktop?.history;if(Array.isArray(releases)){const local=this.releaseHistory;this.releaseHistory=[...releases,...local.filter(l=>!releases.some(r=>r.version===l.version))];}}catch{}
   const result=await this.updater.checkForUpdates();
   if(result?.updateInfo)this.receive(result.updateInfo);
   if(this.state.phase==='checking')this.set({phase:'current'});
   this.set({lastCheckedAt:new Date().toISOString()});this.record('checked',{version:this.state.upstreamVersion,phase:this.state.phase});
  }catch(error){const empty=this.state.channel==='beta'&&/404|Cannot find channel/i.test(error.message||'');this.set({phase:empty?'empty':'error',error:empty?null:updateError(error),lastCheckedAt:new Date().toISOString()});this.record(empty?'empty':'check_failed',{error:this.state.error});}
  finally{this.busy=false;}
  return this.snapshot();
 }
 async setChannel(input){
  if(!input||!updateChannels.includes(input.channel))throw Error('更新通道无效');
  if(this.busy||blocked.includes(this.state.phase))throw Error('更新进行中，暂不能切换通道');
  if(this.state.phase==='downloaded'&&input.discardDownloaded!==true)throw Error('请确认放弃已下载更新后切换通道');
  if(input.channel===this.state.channel)return this.snapshot();
  this.downloadedFiles=null;this.set({channel:input.channel,phase:'idle',availableVersion:null,error:null,progress:null,downloadMode:'pending'});this.applyChannel();this.record('channel_changed');return this.check();
 }
 notes(){return {items:this.releaseHistory.map(r=>({version:r.version,channel:r.channel||versionChannel(r.version),publishedAt:r.publishedAt||null,releaseNotes:cleanNotes(r.releaseNotes)}))};}
 records(){return {items:[...this.history].reverse()};}
 async download(input={}){
  if(this.state.phase!=='available')throw Error('当前没有可下载的客户端更新');
  if(input&&Object.keys(input).some(k=>k!=='full'))throw Error('下载参数无效');
  this.updater.disableDifferentialDownload=input.full===true;this.set({phase:'downloading',progress:0,error:null,downloadMode:input.full===true?'full':'pending',transferred:null,total:null,fallbackReason:null});this.record('download_started',{version:this.state.availableVersion,full:input.full===true});
  try{this.downloadedFiles=await this.updater.downloadUpdate();}catch(error){this.set({phase:'error',error:updateError(error)});this.record('download_failed',{error:this.state.error});}
  finally{this.updater.disableDifferentialDownload=false;}
  return this.snapshot();
 }
 async install(){
  if(this.state.phase!=='downloaded')throw Error('请先下载并校验客户端更新');
  this.set({phase:'waiting_save',error:null});
  try{await this.beforePrepare();}catch(error){this.set({phase:'downloaded',error:updateError(error)});this.record('save_blocked',{error:this.state.error});throw error;}
  const worker=this.manager.snapshot();
  if(worker.running){
   if(!worker.managed||worker.stale){this.set({phase:'downloaded'});throw Error('工作节点正在运行但无法安全控制，请先手动停止工作节点再安装');}
   try{await this.manager.control('drain');}catch(error){this.set({phase:'downloaded',error:updateError(error)});throw error;}
   this.set({phase:'waiting_worker'});this.workerTimer=setInterval(()=>this.installWhenStopped(),this.pollMs);void this.installWhenStopped();return this.snapshot();
  }
  await this.startInstall();return this.snapshot();
 }
 async installWhenStopped(){if(this.state.phase!=='waiting_worker'){this.stopWaiting();return;}if(!this.manager.snapshot().running)await this.startInstall().catch(()=>{});}
 async startInstall(){
  if(this.installStarting)return;this.installStarting=true;this.stopWaiting();
  try{await this.beforePrepare();await this.beforeInstall();this.record('installing',{version:this.state.availableVersion});this.set({phase:'installing'});this.updater.quitAndInstall(false,true);}catch(error){this.set({phase:'downloaded',error:updateError(error)});throw error;}finally{this.installStarting=false;}
 }
 stopWaiting(){if(this.workerTimer)clearInterval(this.workerTimer);this.workerTimer=null;}
 dispose(){this.stopWaiting();this.removeAllListeners();}
}
