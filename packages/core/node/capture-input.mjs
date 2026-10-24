import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {atomicJson,safePath,contained,hash} from './common.mjs';
import {validateCaptureContext,captureURL} from './capture-contract.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');

export function prepareCaptureInput(task,workspace,dataDir){
  const runtime=path.join(workspace,'.capture-runtime');
  if(!fs.existsSync(runtime)){
    const stage=path.join(workspace,'.capture-runtime-stage-'+randomUUID());
    fs.mkdirSync(stage);
    try{
      fs.copyFileSync(path.join(project,'resources/capture-runtime/capture-cli.mjs'),path.join(stage,'capture-cli.mjs'));
      fs.copyFileSync(path.join(project,'resources/skills/lingnest-collect/SKILL.md'),path.join(stage,'SKILL.md'));
      atomicJson(path.join(stage,'manifest.json'),{version:1,files:Object.fromEntries(['capture-cli.mjs','SKILL.md'].map(name=>[name,hash(fs.readFileSync(path.join(stage,name)))]))});
      fs.renameSync(stage,runtime);
    }catch(error){fs.rmSync(stage,{recursive:true,force:true});throw error;}
  }
  const manifest=path.join(runtime,'manifest.json');
  if(fs.existsSync(manifest))for(const [name,digest]of Object.entries(readRuntimeManifest(manifest)))if(hash(fs.readFileSync(path.join(runtime,safePath(name))))!==digest)throw Error('本任务固定采集工具已变化，请恢复原版本后继续');
  if(!task.capture)return '\n读取本任务固定的 .capture-runtime/SKILL.md，使用 node .capture-runtime/capture-cli.mjs 提取给定来源并记录证据覆盖。\n';
  const context=validateCaptureContext(task.capture),source=path.join(dataDir,'capture-sessions',context.sessionId);
  if(!fs.existsSync(source))throw Error('采集会话不在本机，请恢复原节点连接');
  const root=path.join(workspace,'.capture-input');fs.mkdirSync(root,{recursive:true});
  if(context.kind==='file'){
    const meta=JSON.parse(fs.readFileSync(path.join(source,'input.json'),'utf8')),relative=safePath(meta.relative),original=path.join(source,relative);
    if(!contained(fs.realpathSync(source),fs.realpathSync(original))||fs.lstatSync(original).isSymbolicLink())throw Error('本地文件路径无效');
    const file=path.join(root,relative);if(!fs.existsSync(file))fs.copyFileSync(original,file,fs.constants.COPYFILE_EXCL);
    atomicJson(path.join(root,'input.json'),{...meta,sha256:hash(fs.readFileSync(file))});
  }else{
    const snapshot=JSON.parse(fs.readFileSync(path.join(source,'snapshot.json'),'utf8'));
    if(!fs.existsSync(path.join(root,'initial.txt')))fs.writeFileSync(path.join(root,'initial.txt'),snapshot.text,'utf8');
    atomicJson(path.join(root,'page.json'),{url:snapshot.url,title:snapshot.title,capturedAt:snapshot.capturedAt,images:snapshot.images,truncated:snapshot.truncated===true,characters:snapshot.characters,imageCount:snapshot.imageCount});
    fs.copyFileSync(path.join(source,'connection.json'),path.join(root,'connection.json'));fs.chmodSync(path.join(root,'connection.json'),0o600);
  }
  // A versioned, task-local runtime and skill keeps a retry on exactly the same
  // implementation even if the installed application changes in the meantime.
  return `\n当前页面/文件采集：读取 .capture-runtime/SKILL.md，使用 node .capture-runtime/capture-cli.mjs。输入在 .capture-input 中，凭据文件只用于本机桥接，不能读取后写入输出或资料。采集类型 ${context.kind}，用户要求 ${JSON.stringify(task.scenario??null)}。从已有证据和缺失步骤继续。\n`;
}

function readRuntimeManifest(file){const manifest=JSON.parse(fs.readFileSync(file,'utf8'));if(manifest.version!==1||!manifest.files?.['capture-cli.mjs']||!manifest.files?.['SKILL.md'])throw Error('固定采集工具清单无效');return manifest.files;}

export async function attachCaptureBrowser(task,workspace,dataDir,deviceId){
  if(task.capture)return;
  const file=path.join(dataDir,'capture-bridge.json');if(!fs.existsSync(file))return;
  const sources=[...new Set((String(task.content||task.url||'').match(/https?:\/\/[^\s<>"'`]+/g)||[]).map(s=>s.replace(/[）)\]】。，；、]+$/g,'')).map(s=>{try{return captureURL(s);}catch{return null;}}).filter(Boolean))];
  if(!sources.length)return;
  const bridge=JSON.parse(fs.readFileSync(file,'utf8')),endpoint=new URL(bridge.endpoint);
  if(bridge.version!==2||bridge.deviceId!==deviceId||endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1')return;
  try{
    const response=await fetch(endpoint.origin+'/tasks/bind',{method:'POST',headers:{Authorization:'Bearer '+bridge.token,'Content-Type':'application/json'},body:JSON.stringify({taskId:task.id,sources,deviceId}),signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!response.ok)return;const descriptor=await response.json(),folder=path.join(workspace,'.capture-input');
    if(descriptor.taskId!==task.id||descriptor.endpoint!==bridge.endpoint)throw Error('任务浏览器连接不匹配');
    atomicJson(path.join(folder,'connection.json'),descriptor);fs.chmodSync(path.join(folder,'connection.json'),0o600);
  }catch{ /* Direct extraction remains available when the desktop is closed. */ }
}

export function cleanCaptureCache(workspace,bundle,receipt){
  // Only explicit generated cache entries qualify; never glob or delete source
  // files, user originals, legacy archives or partial/resumable workspaces.
  if(!receipt||bundle.meta.status!=='archived'||!bundle.meta.coverage?.items.length||bundle.meta.coverage.items.some(i=>i.state!=='analyzed'))return [];
  const file=path.join(workspace,'.capture-cache','manifest.json');if(!fs.existsSync(file))return [];
  const cache=fs.realpathSync(path.dirname(file)),manifest=JSON.parse(fs.readFileSync(file,'utf8')),removed=[];
  for(const item of manifest.files??[]){
    if(item.origin!=='downloaded'||item.state!=='temporary'||!/^[-a-f0-9]{64}$/i.test(item.sha256??''))continue;
    const target=path.join(cache,safePath(item.path));if(!fs.existsSync(target)||fs.lstatSync(target).isSymbolicLink()||!contained(cache,fs.realpathSync(target)))continue;
    if(hash(fs.readFileSync(target))!==item.sha256)continue;
    fs.unlinkSync(target);removed.push(item.path);
  }
  atomicJson(path.join(cache,'cleanup.json'),{at:new Date().toISOString(),receipt,removed});return removed;
}
