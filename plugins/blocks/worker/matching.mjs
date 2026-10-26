import fs from 'node:fs';
import path from 'node:path';
import {atomicJson,hash,requireValue} from '../../../packages/core/node/common.mjs';
import {agentOrder,runAgent,unavailableBeforeWork,describeAgentFailure} from '../../ai-assistant/api/agents.mjs';
import {matchingPrompt,validateMatches} from '../protocol/matching.mjs';
export async function processMatching({config,task,available,signal,onProgress,api}){
 const cwd=path.join(path.resolve(config.dataDir),'blocks-tasks',task.id);fs.mkdirSync(cwd,{recursive:true,mode:0o700});
 const checkpoint=path.join(cwd,'matching-result.json'),stamp=path.join(cwd,'input.sha256'),digest=hash(JSON.stringify(task.blockSnapshot));
 requireValue(!fs.existsSync(stamp)||fs.readFileSync(stamp,'utf8')===digest,'匹配输入已变化');fs.writeFileSync(stamp,digest,{mode:0o600});atomicJson(path.join(cwd,'input.json'),task.blockSnapshot);
 const progress=async(state,message,agent)=>{onProgress({state,message,agent});await api(config,`/api/tasks/${task.id}/progress`,'POST',{state,message,agent},task.assignmentId);};
 let value,validationError;
 for(let round=0;round<3;round++){
  if(fs.existsSync(checkpoint)){
   const stat=fs.lstatSync(checkpoint);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<1000000,'匹配结果文件无效');
   try{value=validateMatches(JSON.parse(fs.readFileSync(checkpoint,'utf8')),task.blockSnapshot);break;}
   catch(error){validationError=error;fs.copyFileSync(checkpoint,path.join(cwd,`matching-result.invalid-${Date.now()}-${round}.json`));}
  }
  const names=agentOrder(config,task,available);requireValue(names.length,'没有可用的匹配 Agent');
  for(const name of names){
   await progress('running',validationError?'正在校正关联结果的引用和格式':'正在判断资料与积木目标的关联',name);
   const feedback=validationError?`\n上次结果未通过严格校验：${validationError.message}。可以读取当前 matching-result.json 以修订格式，但旧结果不是证据。请依据同一 input.json 逐项检查并覆盖 matching-result.json；保持未满足条件和真实反证，不得修改输入、目标或来源。`:'';
   const result=await runAgent(name,config.agents,{cwd,prompt:matchingPrompt(task.blockSnapshot)+feedback,signal,timeoutMs:config.taskTimeoutMs||180000});
   if(signal?.aborted||result.aborted)return;
   if(unavailableBeforeWork(result)&&name!==names.at(-1))continue;
   if(result.code!==0||result.timedOut||result.permissionBlocked||result.applicationError){await progress('waiting_action',describeAgentFailure(name,result).message,name);return;}
   break;
  }
 }
 if(!value){
  const stat=fs.lstatSync(checkpoint);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<1000000,'匹配结果文件无效');
  value=validateMatches(JSON.parse(fs.readFileSync(checkpoint,'utf8')),task.blockSnapshot);
 }
 if(signal?.aborted)return;
 await api(config,`/api/blocks/matches/${task.id}`,'POST',value,task.assignmentId);onProgress({state:'completed',message:'语义匹配完成'});
}
