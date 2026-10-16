import type {CaptureBridge} from '../records/data/transport';
import type {Connection} from '../records/data/types';
export type SourceInput={kind:'text'|'record'|'entry';role:'material'|'exemplar';id?:string;version?:number;text?:string;label?:string};
export type WritingFile={id:string;path:string;role?:string;mime?:string;bytes:number;sha256:string};
export type Source={id:string;role:string;kind:string;label:string;text:string;version?:number|string;ref?:string;files:WritingFile[]};
export type Question={id:string;key:string;dimension:string;title:string;reason:string;mode:'single'|'multiple'|'text';options:{id:string;label:string;impact:string}[];recommendedOptionId?:string;exploratory?:boolean};
export type Answer={questionId:string;selected:string[];text:string;uncertain:boolean};
export type Direction={id:string;title:string;thesis:string;readerValue:string;support:string;missing:string};
export type StyleCandidate={id:string;name:string;appliesTo:string;rules:{id:string;instruction:string;sourceId?:string;example?:string}[];sample?:string};
export type Style=StyleCandidate&{version:number;createdAt:string;parentId?:string|null};
export type Plan={thesis:string;audience:string;scope:string;evidence:string;outline:string[];visuals:string;unresolvedHandling:string};
export type WorkingPlan={thesis:string;outline:string[];materials:string[];openIssues:string[]};
export type Turn={id:string;roundId:string|null;answers:Answer[];message:string;at:string};
export type Round={id:string;answeredAt?:string;supersededAt?:string;result:{schemaVersion?:number;understanding:string;changeSummary:string;suggestedTitle?:string;workingPlan?:WorkingPlan;directions:Direction[];questions:Question[];ready:boolean;plan?:Plan;openIssues:string[]}};
export type WritingSession={protocolVersion?:number;brief?:string;turns?:Turn[];workingPlan?:WorkingPlan|null;titleSource?:string;id:string;title:string;version:number;status:string;createdAt:string;updatedAt:string;sources:Source[];answers:(Answer&{key:string;title:string;labels:string[];roundId:string})[];rounds:Round[];runs:{taskId:string;mode:string;state:string;message:string;planVersion:number;styleVersion:string|null;draftId:string|null;archiveId:string|null}[];ready:boolean;plan:Plan|null;planVersion:number;style:Style|null;styleCandidates:StyleCandidate[];understanding?:string;directions?:Direction[]};
export type WritingDraft={meta:{title:string};files:WritingFile[];article:string;references:string};
class WritingError extends Error {readonly status:number;constructor(message:string,status:number){super(message);this.status=status;}}
const intent=(input:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.entries(input).filter(([key])=>key!=='baseVersion')));
export class WritingClient {
 private epoch=0;
 private bridge:CaptureBridge;private storage:Storage;
 constructor(bridge:CaptureBridge,storage:Storage){this.bridge=bridge;this.storage=storage;}
 invalidate(){this.epoch++;}
 async connection(){const connection=await this.bridge.status();if(!connection.paired)throw Error('请先登录资料空间');return connection;}
 async request<T>(route:string,method:'GET'|'POST'='GET',json?:unknown,expected?:Connection):Promise<T>{
  const epoch=this.epoch,connection=await this.connection();if(epoch!==this.epoch)throw Error('资料空间已切换');
  if(expected&&(connection.server!==expected.server||connection.deviceId!==expected.deviceId))throw Error('资料空间已切换，本机输入仍保留');
  const reply=await this.bridge.capture({route,method,json,server:connection.server,deviceId:connection.deviceId});
  const after=await this.bridge.status();if(epoch!==this.epoch||!after.paired||connection.server!==after.server||connection.deviceId!==after.deviceId)throw Error('资料空间已切换，本机输入仍保留');
  if(reply.status<200||reply.status>=300)throw new WritingError((reply.json as {error?:string})?.error||`写作请求失败（${reply.status}）`,reply.status);
  return (reply.bytes!==undefined?reply:reply.json) as T;
 }
 async mutate(route:string,input:Record<string,unknown>){
  const epoch=this.epoch,connection=await this.connection();if(epoch!==this.epoch)throw Error('资料空间已切换，本机输入仍保留');
  const payload=JSON.stringify(input),key=`writing:pending:${connection.server}:${connection.deviceId}:${route}`,old=this.storage.getItem(key);let pending:{payload:string;requestId:string}|null=null;
  if(old){try{pending=JSON.parse(old);}catch{pending=null;}}
  if(!pending||intent(JSON.parse(pending.payload))!==intent(input))pending={payload,requestId:crypto.randomUUID()};
  this.storage.setItem(key,JSON.stringify(pending));
  try{const result=await this.request<{id:string;version:number}>(route,'POST',{...JSON.parse(pending.payload),requestId:pending.requestId},connection);if(this.storage.getItem(key)===JSON.stringify(pending))this.storage.removeItem(key);return result;}
  catch(error){if(error instanceof WritingError&&error.status>=400&&error.status<500&&this.storage.getItem(key)===JSON.stringify(pending))this.storage.removeItem(key);throw error;}
 }
 async file(sessionId:string,taskId:string,file:WritingFile){
  const result=await this.request<{bytes:string;mime:string}>(`/api/writing/sessions/${sessionId}/drafts/${taskId}/files/${file.id}`);
  const bytes=Uint8Array.from(atob(result.bytes),c=>c.charCodeAt(0));const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==file.bytes||digest!==file.sha256)throw Error('稿件附件校验失败');return {bytes,mime:result.mime};
 }
}
