import type {MarketRequest,MarketPage,MarketItem,MarketImport} from './market.ts';
import type {SkillVersion} from './versions.ts';
import type {SkillOperation,SkillOperationInput} from './operations.ts';
import type {Connection} from '../records/data/types.ts';
export type SkillItem={id:string;name:string;hash:string|null;agent:string;[key:string]:unknown};
export type SkillEnvironment={schemaVersion:1;items:SkillItem[];agents:unknown[];total:number;nextOffset:number|null;snapshotId?:string;scannedAt:string|null;[key:string]:unknown};
export type SkillReadRequest={kind:'environment';deviceId:string;offset:number;snapshotId?:string}|{kind:'versions'}|{kind:'version';versionId:string}|{kind:'history';deviceId:string};
export type SkillRequest=SkillReadRequest|{kind:'operation';operationId:string}|{kind:'create';operation:SkillOperationInput};
export interface SkillReadBridge{status():Promise<Connection>;skills(input:SkillRequest):Promise<unknown>;market?(input:MarketRequest):Promise<unknown>;}
export class SkillClient{
 private epoch=0;
 private bridge:SkillReadBridge;
 constructor(bridge:SkillReadBridge){this.bridge=bridge;}
 invalidateSession(){this.epoch++;}
 private async request<T>(input:SkillRequest|{kind:'market';request:MarketRequest},epoch:number):Promise<T>{
  const before=await this.bridge.status();
  if(epoch!==this.epoch||!before.paired)throw Error('资料空间已切换或未连接');
  const result=await (input.kind==='market'?(this.bridge.market?this.bridge.market(input.request):Promise.reject(Error('技能市场接口不可用'))):this.bridge.skills(input)),after=await this.bridge.status();
  if(epoch!==this.epoch||!after.paired||before.server!==after.server||before.deviceId!==after.deviceId)throw Error('资料空间已切换');
  return result as T;
 }
 async environment(deviceId:string):Promise<SkillEnvironment>{
  const epoch=this.epoch;
  const first=await this.request<SkillEnvironment>({kind:'environment',deviceId,offset:0},epoch);
  const items=[...first.items],seen=new Set(items.map(item=>item.id));
  if(seen.size!==items.length)throw Error('技能清单包含重复条目');
  let next=first.nextOffset,offset=0;
  while(next!==null){
   if(!first.snapshotId||!Number.isSafeInteger(next)||next<=offset)throw Error('技能清单分页无效');
   offset=next;
   const page=await this.request<SkillEnvironment>({kind:'environment',deviceId,offset,snapshotId:first.snapshotId},epoch);
   if(page.snapshotId!==first.snapshotId||page.total!==first.total)throw Error('技能清单已更新，请刷新');
   for(const item of page.items){if(seen.has(item.id))throw Error('技能清单包含重复条目');seen.add(item.id);items.push(item);}
   next=page.nextOffset;
  }
  if(items.length!==first.total)throw Error('技能清单不完整，请刷新');
  return {...first,items,nextOffset:null};
 }
 marketSearch(input:Extract<MarketRequest,{kind:'search'}>){return this.request<MarketPage>({kind:'market',request:input},this.epoch);}
 marketCategories(provider:MarketRequest['provider']){return this.request<{items:{key:string;name:string}[]}>({kind:'market',request:{kind:'categories',provider}},this.epoch);}
 marketDetail(provider:MarketRequest['provider'],slug:string){return this.request<{item:MarketItem}>({kind:'market',request:{kind:'detail',provider,slug}},this.epoch);}
 marketImport(input:Extract<MarketRequest,{kind:'import'}>){return this.request<MarketImport>({kind:'market',request:input},this.epoch);}
 versions(){return this.request<{schemaVersion:1;versions:SkillVersion[]}>({kind:'versions'},this.epoch);}
 version(versionId:string){return this.request<SkillVersion>({kind:'version',versionId},this.epoch);}
 create(operation:SkillOperationInput){return this.request<SkillOperation>({kind:'create',operation},this.epoch);}
 operation(operationId:string){return this.request<SkillOperation>({kind:'operation',operationId},this.epoch);}
 history(deviceId:string){return this.request<{operations:SkillOperation[]}>({kind:'history',deviceId},this.epoch);}
}
