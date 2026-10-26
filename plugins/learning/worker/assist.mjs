import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {Readability} from '@mozilla/readability';
import {agentOrder,runAgent,unavailableBeforeWork,describeAgentFailure} from '../../ai-assistant/api/agents.mjs';
import {atomicJson,hash,requireValue} from '../../../packages/core/node/common.mjs';
import {taskPrompt,validateResult} from '../protocol/model.mjs';

export async function verifyResearch(sources,fetcher=fetch){
  requireValue(Array.isArray(sources)&&sources.length>0&&sources.length<=6,'请提供已读取的前沿来源');
  const verified=[];
  for(const source of sources){
    const url=new URL(source.url);
    requireValue(url.protocol==='https:'&&!url.username&&!url.password&&!/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(url.hostname),'前沿来源链接无效');
    const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(25000)});requireValue(response.ok,'前沿来源正文无法取得');
    const type=response.headers.get('content-type')||'';requireValue(/text\/|json/.test(type),'请使用可读取的官方文档或论文摘要页面');
    const reader=response.body.getReader();const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4*1024*1024){await reader.cancel();throw Error('前沿来源正文过大');}chunks.push(Buffer.from(value));}
    const raw=Buffer.concat(chunks).toString('utf8');let text=raw,title=source.title;
    if(type.includes('html')){const {document}=parseHTML(raw);Object.defineProperty(document,'documentURI',{value:url.href});const article=new Readability(document).parse();text=article?.textContent||document.body.textContent;title=article?.title||title;}
    requireValue(text?.trim(),'前沿来源正文为空');
    verified.push({kind:'research',sourceId:url.href,version:'1',url:url.href,title:title||url.hostname,text:text.trim().slice(0,60000),coverage:'partial',checkedAt:new Date().toISOString()});
  }
  return verified;
}
export async function processLearning({config,task,available,signal,onProgress,api}){
  const cwd=path.join(path.resolve(config.dataDir),'learning-tasks',task.id);fs.mkdirSync(cwd,{recursive:true,mode:0o700});
  const snapshot=task.learningSnapshot,digest=hash(JSON.stringify(snapshot)),stamp=path.join(cwd,'input.sha256'),file=path.join(cwd,'learning-result.json'),verifiedFile=path.join(cwd,'verified-result.json');
  requireValue(!fs.existsSync(stamp)||fs.readFileSync(stamp,'utf8')===digest,'学习输入版本已变化');fs.writeFileSync(stamp,digest,{mode:0o600});atomicJson(path.join(cwd,'input.json'),snapshot);
  const progress=async(state,message,agent)=>{onProgress({state,message,agent});await api(config,`/api/tasks/${task.id}/progress`,'POST',{state,message,agent},task.assignmentId);};
  if(!fs.existsSync(file)){
    const agents=agentOrder(config,task,available);requireValue(agents.length,'没有可用的学习 Agent');
    for(const name of agents){
      await progress('running','正在处理学习目标与知识节点',name);
      const result=await runAgent(name,config.agents,{cwd,prompt:taskPrompt(snapshot),signal,timeoutMs:config.taskTimeoutMs||300000});
      if(signal?.aborted||result.aborted)return;
      if(unavailableBeforeWork(result)&&name!==agents.at(-1))continue;
      if(result.code!==0||result.timedOut||result.permissionBlocked||result.applicationError){await progress('waiting_action',describeAgentFailure(name,result).message,name);return;}
      break;
    }
  }
  const stat=fs.lstatSync(file);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<1800000,'学习结果文件无效');
  let value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(snapshot.operation==='frontier'){
    if(fs.existsSync(verifiedFile))value=JSON.parse(fs.readFileSync(verifiedFile,'utf8'));
    else{value.researchSources=await verifyResearch(value.researchSources);validateResult(value,snapshot);atomicJson(verifiedFile,value);}
  }
  value=validateResult(value,snapshot);if(signal?.aborted)return;
  await api(config,`/api/learning/runs/${task.id}/result`,'POST',value,task.assignmentId);onProgress({state:'completed',message:'学习结果已保存'});
}
