import type {SkillAgent,SkillPolicy} from './policy.ts';
export type SkillOperationState='queued'|'running'|'succeeded'|'failed';
export type SkillOperationInput={deviceId:string;requestId:string}&(
 {action:'refresh'}|
 {action:'uninstall';cancelTaskIds:string[];skillId:string;expectedHash:string;agents:SkillAgent[];confirmShared:boolean}|
 {action:'configure-projects';projects:string[]}|
 {action:'prepare-publish';skillId:string;expectedHash:string}|
 {action:'publish';skillId:string;expectedHash:string;previewId:string;policy:SkillPolicy}|
 {action:'compare';versionId:string;agents:SkillAgent[]}|
 {action:'sync';versionId:string;agents:SkillAgent[];comparisonId:string;confirmShared:boolean}|
 {action:'verify';versionId:string;agent:'codex'|'codebuddy';sample:string;expectedText:string}|
 {action:'rollback';syncId:string});
export type SkillOperation={id:string;deviceId:string;action:SkillOperationInput['action'];state:SkillOperationState;createdAt:string;result?:{error?:string;preview?:{name:string;hash:string;files?:{path:string;bytes:number}[];skillMarkdown?:string;texts?:{path:string;content:string}[];omitted?:unknown[]};comparison?:{compatible:boolean;problems:string[];targets:SkillTarget[]};[key:string]:unknown};[key:string]:unknown};
export type SkillTarget={agent:SkillAgent;sharedAgents:SkillAgent[];directory:string;hash:string|null;changes?:{path:string;state:'modified'|'missing'|'removed'}[];[key:string]:unknown};
export const skillOperationLabels:Record<SkillOperationState,string>={queued:'等待节点',running:'执行中',succeeded:'已完成',failed:'失败'};
export function syncInput(comparison:SkillOperation,versionId:string,agents:SkillAgent[],confirmShared:boolean,requestId:string):SkillOperationInput{
 if(comparison.action!=='compare'||comparison.state!=='succeeded'||!comparison.result?.comparison?.compatible||comparison.versionId!==versionId||JSON.stringify(comparison.agents)!==JSON.stringify(agents))throw Error('请重新比较目标');
 if(comparison.result.comparison.targets.some(target=>target.sharedAgents.length>1)&&!confirmShared)throw Error('请确认全部共享 Agent');
 return {action:'sync',deviceId:comparison.deviceId,versionId,agents:[...agents],comparisonId:comparison.id,confirmShared,requestId};
}
export function rollbackInput(sync:SkillOperation,requestId:string):SkillOperationInput{
 if(sync.action!=='sync'||sync.state!=='succeeded')throw Error('同步尚未完成');
 return {action:'rollback',deviceId:sync.deviceId,syncId:sync.id,requestId};
}
