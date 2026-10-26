import fs from 'node:fs';
import path from 'node:path';
import {atomicJson,hash,requireValue} from '../../../packages/core/node/common.mjs';
import {agentOrder,runAgent,unavailableBeforeWork,describeAgentFailure} from '../../ai-assistant/api/agents.mjs';
import {planningPrompt,validatePlanResult} from '../protocol/planning.mjs';
export async function processPlanning({config,task,available,signal,onProgress,api}){
 const cwd=path.join(path.resolve(config.dataDir),'blocks-plans',task.id);fs.mkdirSync(cwd,{recursive:true,mode:0o700});
 const file=path.join(cwd,'plan-result.json'),stamp=path.join(cwd,'input.sha256'),digest=hash(JSON.stringify(task.blockPlanSnapshot));requireValue(!fs.existsSync(stamp)||fs.readFileSync(stamp,'utf8')===digest,'计划输入已变化');fs.writeFileSync(stamp,digest,{mode:0o600});atomicJson(path.join(cwd,'input.json'),task.blockPlanSnapshot);
 const progress=async(state,message,agent)=>{onProgress({state,message,agent});await api(config,`/api/tasks/${task.id}/progress`,'POST',{state,message,agent},task.assignmentId);};
 if(!fs.existsSync(file)){
  const names=agentOrder(config,task,available);requireValue(names.length,'没有可用的规划 Agent');
  for(const name of names){await progress('running','正在理解想法并组织积木',name);const result=await runAgent(name,config.agents,{cwd,prompt:planningPrompt(task.blockPlanSnapshot),signal,timeoutMs:config.taskTimeoutMs||180000});if(signal?.aborted||result.aborted)return;if(unavailableBeforeWork(result)&&name!==names.at(-1))continue;if(result.code!==0||result.timedOut||result.permissionBlocked||result.applicationError){await progress('waiting_action',describeAgentFailure(name,result).message,name);return;}break;}
 }
 const stat=fs.lstatSync(file);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<1000000,'计划结果文件无效');const value=validatePlanResult(JSON.parse(fs.readFileSync(file,'utf8')),task.blockPlanSnapshot);if(signal?.aborted)return;
 await api(config,`/api/blocks/plans/results/${task.id}`,'POST',value,task.assignmentId);onProgress({state:'completed',message:value.question?'等待回答关键问题':'积木计划已生成'});
}
