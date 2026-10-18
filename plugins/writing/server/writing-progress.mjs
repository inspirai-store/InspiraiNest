import {now,requireValue} from '../../../packages/core/node/common.mjs';
export const writingPhases=['preparing','organizing','validating','saving'];
export function writingProgress(value,previous){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&writingPhases.includes(value.phase),'Invalid writing progress');
  const result={phase:value.phase};
  for(const key of ['sourceCount','fileCount','preparedFiles','toolCount']){
    const count=value[key]??0;requireValue(Number.isSafeInteger(count)&&count>=0&&count<=100000,'Invalid writing progress count');result[key]=count;
  }
  requireValue(result.preparedFiles<=result.fileCount,'Invalid prepared file count');
  const at=now(),reset=value.phase==='preparing'&&previous?.phase!=='preparing';
  result.startedAt=reset?at:previous?.startedAt||at;result.updatedAt=at;
  result.history=reset?[]:(previous?.history||[]).slice(-7);
  if(result.history.at(-1)?.phase!==result.phase)result.history.push({phase:result.phase,at});
  return result;
}
