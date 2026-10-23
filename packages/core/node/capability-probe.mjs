import fs from 'node:fs';
import path from 'node:path';
import {hash,atomicJson} from './common.mjs';
export function capabilityFacts(config,available,{version='unknown',skills={},tools={},observations={},enabled={},browser={},runtime=null}={}){
  const checkedAt=new Date().toISOString(),result=[];
  for(const [agent,probe]of Object.entries(available))for(const id of ['capture.article','capture.media','capture.browser','writing.materials','writing.selection','writing.creation']){
    if(id==='writing.creation'&&agent!=='codex')continue;
    const fingerprint=hash(JSON.stringify({agent,profile:config.agents?.[agent]||null,version,agentVersion:probe.version||null,skill:skills[id]||null,platform:process.platform,runtime,tools:id==='capture.media'?tools:null}));
    const observed=observations[agent+':'+(id.startsWith('capture.')?'capture':'writing')],matching=observed?.profileHash===hash(JSON.stringify(config.agents?.[agent]||null));
    const missing=id==='capture.media'?['ffmpeg','yt-dlp','whisper'].filter(name=>tools[name]!==true):[];
    result.push({id,agent,available:probe.available===true&&(id!=='capture.browser'||browser.available===true),enabled:enabled[id]!==false,permission:matching?observed.permission:'unknown',missing,connected:id==='capture.browser'&&browser.connected===true,fingerprint,skill:skills[id]||null,checkedAt});
  }
  return result;
}
export async function probeCapabilityTools(run){
  const values=await Promise.all([['ffmpeg',['-version']],['yt-dlp',['--version']],['whisper',['--help']]].map(async([name,args])=>{
    let executable=name;
    for(const directory of process.platform==='darwin'?['/opt/homebrew/bin','/usr/local/bin']:[])if(fs.existsSync(path.join(directory,name))){executable=path.join(directory,name);break;}
    const result=await run(executable,args,{timeoutMs:5000});return [name,result.code===0];
  }));return Object.fromEntries(values);
}
export async function runCapabilityProbe(config,agent,run,{signal,mode='capture'}={}){
  if(!['codex','codebuddy'].includes(agent))throw Error('Unsupported execution tool');
  const workspace=fs.mkdtempSync(path.join(config.dataDir,'capability-probe-'));
  fs.writeFileSync(path.join(workspace,'AGENTS.md'),'仅在本目录完成权限样例。不得访问其他文件、联网、读取凭据或创建后台任务。\n');
  const output=path.join(workspace,'capability-ready.json');
  const execution=await run(agent,config.agents||{},{cwd:workspace,signal,collection:mode==='capture',timeoutMs:120000,prompt:'执行灵藏非交互权限样例。只在当前目录写 capability-ready.json，内容为 {"ready":true}。不读取本目录外文件、不联网、不改配置、不打开浏览器或窗口。完成后退出。'});
  let proof=false;try{const stat=fs.lstatSync(output);proof=stat.isFile()&&!stat.isSymbolicLink()&&stat.size<1000&&JSON.parse(fs.readFileSync(output,'utf8')).ready===true;}catch{}
  const result={agent,mode,profileHash:hash(JSON.stringify(config.agents?.[agent]||null)),permission:execution.permissionBlocked?'blocked':execution.code===0&&proof?'ready':'unknown',passed:execution.code===0&&proof,code:execution.permissionBlocked?'AGENT_PERMISSION':execution.timedOut?'AGENT_TIMEOUT':proof?'PROBE_PASSED':'PROBE_NO_RESULT',at:new Date().toISOString()};
  const file=path.join(config.dataDir,'capability-observations.json');let old={};try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}atomicJson(file,{...old,[agent+':'+mode]:result});return result;
}

export function observeTaskPermission(config,task,agent,{blocked=false,passed=false}={}){
  if(!['codex','codebuddy'].includes(agent)||!blocked&&!passed)return;
  const file=path.join(config.dataDir,'capability-observations.json'),mode=task.writingSessionId||task.purpose==='selection-writing'?'writing':'capture';
  let old={};try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  try{atomicJson(file,{...old,[agent+':'+mode]:{agent,mode,profileHash:hash(JSON.stringify(config.agents?.[agent]||null)),permission:blocked?'blocked':'ready',code:blocked?'AGENT_PERMISSION':'TASK_PASSED',at:new Date().toISOString()}});}catch{}
}
