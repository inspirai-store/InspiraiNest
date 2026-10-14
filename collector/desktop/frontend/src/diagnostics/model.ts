export type DiagnosticEvent={id:string;at:string;domain:'collection'|'system';message:string;level?:string;stage?:string;status?:string;taskId?:string;agent?:string;code?:string;count?:number;details?:Record<string,unknown>};
export type DiagnosticActivity={events:DiagnosticEvent[];activeIssues:number;truncated:boolean};
export interface DiagnosticBridge{activity(taskId?:string):Promise<unknown>;logs(taskId?:string):Promise<unknown>;}
export function diagnosticActivity(value:unknown):DiagnosticActivity{
 if(!value||typeof value!=='object')throw Error('诊断响应无效');const input=value as Record<string,unknown>;
 if(!Array.isArray(input.events)||input.events.some(e=>!e||typeof e.id!=='string'||typeof e.message!=='string'||!Number.isFinite(Date.parse(e.at))||!['collection','system'].includes(e.domain)))throw Error('诊断事件无效');
 return {events:input.events as DiagnosticEvent[],activeIssues:typeof input.activeIssues==='number'?input.activeIssues:0,truncated:input.truncated===true};
}
export function diagnosticText(event:DiagnosticEvent){return [`描述: ${event.message}`,`时间: ${new Date(event.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`,...Object.entries({事件:event.code,任务:event.taskId,Agent:event.agent,...event.details}).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>`${k}: ${typeof v==='object'?JSON.stringify(v):v}`)].join('\n');}
