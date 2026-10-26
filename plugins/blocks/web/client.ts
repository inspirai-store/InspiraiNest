import type {CaptureBridge} from '../../../packages/core/web/records/data/transport';
import type {Connection} from '../../../packages/core/web/records/data/types';
export type Part={id:string;title:string;conditions:string[];dependsOn:string[]};
export type Goal={id:string;title:string;output:'article'|'product';parts:Part[]};
export type Proposal={title:string;goals:Goal[];collectionPlan:{partId:string;existing:string[];external:string[]}[];assumptions:string[]};
export type PlanQuestion={id:string;title:string;options:{id:string;label:string}[]};
export type Plan={id:string;revision:number;brief:string;status:'processing'|'question'|'ready'|'blocked'|'confirmed';blockId:string|null;proposal:Proposal|null;turns:{id:string;role:'user'|'assistant';text?:string;reply?:string;question?:PlanQuestion;answer?:{label?:string;uncertain:boolean}}[];run:{id:string;state:string;message:string}|null};
class RequestError extends Error{readonly status:number;constructor(message:string,status:number){super(message);this.status=status;}}
export class BlocksClient{
 private epoch=0;
 private bridge:CaptureBridge|undefined;private storage:Storage;
 constructor(bridge:CaptureBridge|undefined,storage:Storage){this.bridge=bridge;this.storage=storage;}
 invalidate(){this.epoch++;}
 async connection(){const connection=await this.bridge?.status();if(!connection?.paired)throw Error('请先登录资料空间');return connection;}
 async scope(){const c=await this.connection();return `blocks:${c.server}:${c.deviceId}`;}
 async request<T>(route:string,json?:unknown,expected?:Connection):Promise<T>{
  const epoch=this.epoch,before=await this.connection();if(epoch!==this.epoch||expected&&(before.server!==expected.server||before.deviceId!==expected.deviceId))throw Error('资料空间已切换，本机输入保留');
  const reply=await this.bridge!.capture({route,method:json===undefined?'GET':'POST',json,server:before.server,deviceId:before.deviceId}),after=await this.connection();
  if(epoch!==this.epoch||after.server!==before.server||after.deviceId!==before.deviceId)throw Error('资料空间已切换，本机输入保留');
  if(reply.status<200||reply.status>=300)throw new RequestError((reply.json as {error?:string})?.error||'请求失败',reply.status);return reply.json as T;
 }
 async mutate<T>(route:string,input:Record<string,unknown>):Promise<T>{
  const epoch=this.epoch,connection=await this.connection();if(epoch!==this.epoch)throw Error('资料空间已切换，本机输入保留');
  const key=`blocks:pending:${connection.server}:${connection.deviceId}:${route}`,old=this.storage.getItem(key),intent=(x:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k])=>k!=='revision')));
  let pending:{payload:Record<string,unknown>;requestId:string}|undefined;try{pending=old?JSON.parse(old):undefined;}catch{}
  if(!pending||intent(pending.payload)!==intent(input))pending={payload:input,requestId:crypto.randomUUID()};const serialized=JSON.stringify(pending);this.storage.setItem(key,serialized);
  try{const result=await this.request<T>(route,{...pending.payload,requestId:pending.requestId},connection);if(this.storage.getItem(key)===serialized)this.storage.removeItem(key);return result;}
  catch(error){if(error instanceof RequestError&&error.status>=400&&error.status<500&&this.storage.getItem(key)===serialized)this.storage.removeItem(key);throw error;}
 }
}
