import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {parse,stringify} from 'smol-toml';
import {agentExecution,execute} from './agents.mjs';
import {hash,requireValue,contained,atomicJson,readJson} from './common.mjs';

export const codexHome=env=>path.resolve(env.CODEX_HOME || path.join(os.homedir(),'.codex'));
const identifier=value=>typeof value==='string' && /^[\w./:+-]{1,150}$/.test(value)?value:null;
function configFile(file){try{return parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw Error('Codex 配置无法读取，请在 Agent 管理中检查配置');}}
export function profileSelection(args){
  let selected=null;const retained=[];
  for(let i=0;i<args.length;i++){
    if(['-p','--profile'].includes(args[i])){selected=args[++i];continue;}
    if(args[i].startsWith('--profile=')){selected=args[i].slice(10);continue;}
    retained.push(args[i]);
  }
  requireValue(!selected || /^[\w-]+$/.test(selected),'当前 Codex profile 名称不受支持');
  return {selected,args:retained};
}
export function localAgentContext(config){
  const execution=agentExecution('codex',config.agents || {}),home=codexHome(execution.env),selection=profileSelection(execution.args);
  const base=configFile(path.join(home,'config.toml')),overlay=selection.selected?configFile(path.join(home,selection.selected+'.config.toml')):{};
  const effective={...base,...overlay};
  for(let i=0;i<execution.args.length;i++){
    const arg=execution.args[i];
    if(arg==='-m'||arg==='--model')effective.model=execution.args[++i];
    else if(arg.startsWith('--model='))effective.model=arg.slice(8);
    else if(arg==='-c'||arg==='--config'){
      const raw=execution.args[++i];try{const item=parse(raw);for(const key of ['model','model_provider'])if(item[key]!==undefined)effective[key]=item[key];}catch{const m=/^(model|model_provider)=([\w./:+-]+)$/.exec(raw);if(m)effective[m[1]]=m[2];}
    }
  }
  const signature=hash(JSON.stringify({command:execution.command,args:execution.args,files:['config.toml','auth.json',...(selection.selected?[selection.selected+'.config.toml']:[])].map(name=>{try{const s=fs.statSync(path.join(home,name));return [name,s.size,s.mtimeMs];}catch{return [name];}}),keys:Object.entries(execution.env).filter(([k])=>/KEY|TOKEN|PROVIDER|OPENAI|CODEX_HOME/i.test(k)).map(([k,v])=>[k,hash(v)])}));
  return {...execution,home,selection,overlay,signature,metadata:{executionMode:'local-agent',version:null,model:identifier(effective.model),provider:identifier(effective.model_provider)||'openai'}};
}
export async function probeLocalAgent(config,{run=execute,failureFile}={}){
  let context;try{context=localAgentContext(config);}catch{return {login:'unavailable',reason:'configuration',executionMode:'local-agent'};}
  if(context.profile.enabled===false)return {login:'unavailable',reason:'disabled',executionMode:'local-agent'};
  const version=await run(context.command,context.profile.versionArgs || ['--version'],{env:context.env,timeoutMs:10000});
  if(version.code!==0)return {login:'unavailable',reason:version.spawnError?'program':'configuration',executionMode:'local-agent'};
  context.metadata.version=identifier(version.tail.trim().split('\n').at(-1)?.replace(/^codex-cli\s+/,''));
  let failure;try{failure=readJson(failureFile);}catch{}
  if(failure?.signature===context.signature)return {login:'required',reason:'authorization',...context.metadata};
  // Provider auth may use environment, keyring or provider-specific mechanisms. No auth-file test.
  const custom=context.metadata.provider!=='openai' || context.selection.selected || context.env.OPENAI_API_KEY || context.env.CODEX_API_KEY;
  if(!custom){
    const status=await run(context.command,['login','status'],{env:context.env,timeoutMs:10000});
    if(status.code!==0 && /not logged in|login required|token.{0,25}expired/i.test(status.tail))return {login:'required',reason:'authorization',...context.metadata};
  }
  return {login:'ready',reason:'available',...context.metadata};
}
export function rememberAuthFailure(context,file){atomicJson(file,{signature:context.signature});}
export function executedAgentMetadata(context,log){
  const metadata={...context.metadata};
  const thread=log.split('\n').flatMap(line=>{try{const e=JSON.parse(line);return e.type==='thread.started'&&/^[a-f0-9-]{36}$/.test(e.thread_id)?[e.thread_id]:[];}catch{return [];}})[0];
  if(!thread)return metadata;
  // Read only the session produced by this invocation; never upload a session/config dump.
  try{for(const relative of fs.globSync('**/*.jsonl',{cwd:path.join(context.home,'sessions')})){
    if(!path.basename(relative).endsWith(thread+'.jsonl'))continue;
    const fd=fs.openSync(path.join(context.home,'sessions',relative),'r');let text;try{const buffer=Buffer.alloc(512*1024);text=buffer.subarray(0,fs.readSync(fd,buffer,0,buffer.length,0)).toString('utf8');}finally{fs.closeSync(fd);}
    for(const line of text.split('\n')){try{const e=JSON.parse(line);if(e.type==='session_meta'&&e.payload?.id===thread)metadata.provider=identifier(e.payload.model_provider)||metadata.provider;if(e.type==='turn_context'){metadata.model=identifier(e.payload?.model)||metadata.model;return metadata;}}catch{}}
  }}catch{}
  return metadata;
}

// CLI 0.148 reads plugin enablement from a user/profile layer, not -c overrides.
// An unselected, task-named profile changes no normal settings. Existing profile values are retained.
export function taskPluginProfile(context,namespace,pluginId){
  const name='lingnest-trial-'+namespace,file=path.join(context.home,name+'.config.toml');
  requireValue(/^[a-f0-9]{32}$/.test(namespace),'实测命名空间无效');
  const value={...context.overlay,plugins:{...context.overlay.plugins,[pluginId]:{enabled:true}}};
  fs.mkdirSync(context.home,{recursive:true});
  // Owned by this task; safe to replace after an interrupted attempt.
  fs.writeFileSync(file,stringify(value),{mode:0o600});
  const profiles={codex:{...context.profile,args:context.selection.args}};
  return {profiles,name,extraArgs:['--profile',name],dispose:()=>{if(fs.existsSync(file))fs.unlinkSync(file);}};
}
export function publishTaskPlugin(context,installHome,installedPath,namespace,copyTree){
  const cache=path.join(installHome,'plugins','cache'),relative=path.relative(cache,installedPath);
  requireValue(contained(cache,fs.realpathSync(installedPath)) && relative.split(path.sep)[0]===namespace,'原生安装路径无效');
  const target=path.join(context.home,'plugins','cache',relative);
  requireValue(contained(path.join(context.home,'plugins','cache',namespace),target),'插件缓存路径无效');
  copyTree(installedPath,target);
  return target;
}
