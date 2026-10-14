import type {Connection} from '../records/data/types.ts';
export const remoteUpdateStates=['queued','checking','downloading','waiting_worker','installing','succeeded','failed','expired','cancelled'] as const;
export type RemoteUpdateOperation={id:string;deviceId:string;state:typeof remoteUpdateStates[number];fromVersion:string;targetVersion:string;progress:number;message?:string;createdAt:string;updatedAt:string};
export type RemoteUpdateHistory={runtime:{version?:string;remoteUpdate?:boolean;platform?:string;arch?:string}|null;target:{version:string;sha256:string;size:number}|null;operations:RemoteUpdateOperation[]};
export type RemoteUpdateInput={kind:'history'|'create'|'cancel';deviceId?:string;targetVersion?:string;requestId?:string;operationId?:string};
export interface RemoteUpdateBridge{status():Promise<Connection>;clientUpdates(input:RemoteUpdateInput):Promise<unknown>;}
export function newerVersion(a?:string,b?:string){if(!/^\d+\.\d+\.\d+$/.test(a??'')||!/^\d+\.\d+\.\d+$/.test(b??''))return false;const x=a!.split('.').map(Number),y=b!.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]!>y[i]!;return false;}
export function updatePending(op:RemoteUpdateOperation){return ['queued','checking','downloading','waiting_worker','installing'].includes(op.state);}
export function updateCancellable(op:RemoteUpdateOperation){return ['queued','checking','downloading'].includes(op.state);}
function operation(value:unknown,deviceId?:string):RemoteUpdateOperation{const v=value as RemoteUpdateOperation;if(!v||typeof v.id!=='string'||typeof v.deviceId!=='string'||deviceId&&v.deviceId!==deviceId||!remoteUpdateStates.includes(v.state)||typeof v.targetVersion!=='string'||typeof v.progress!=='number'||!Number.isFinite(v.progress)||v.progress<0||v.progress>100)throw Error('更新任务响应无效');return v;}
export function remoteHistory(value:unknown,deviceId:string):RemoteUpdateHistory{const v=value as RemoteUpdateHistory;if(!v||!Array.isArray(v.operations)||v.runtime!==null&&(!v.runtime||typeof v.runtime!=='object')||v.target!==null&&(!v.target||typeof v.target.version!=='string'||typeof v.target.sha256!=='string'||!Number.isSafeInteger(v.target.size)))throw Error('节点更新响应无效');return {...v,operations:v.operations.map(op=>operation(op,deviceId))};}
export class RemoteUpdateClient{
 private epoch=0;private bridge:RemoteUpdateBridge;constructor(bridge:RemoteUpdateBridge){this.bridge=bridge;}
 invalidateSession(){this.epoch++;}
 private async read<T>(action:()=>Promise<T>){const epoch=this.epoch,before=await this.bridge.status();if(epoch!==this.epoch||!before.paired)throw Error('资料空间已切换或未连接');const result=await action(),after=await this.bridge.status();if(epoch!==this.epoch||!after.paired||before.server!==after.server||before.deviceId!==after.deviceId)throw Error('资料空间已切换');return result;}
 history(deviceId:string){return this.read(async()=>remoteHistory(await this.bridge.clientUpdates({kind:'history',deviceId}),deviceId));}
 create(deviceId:string,targetVersion:string,requestId:string){return this.read(async()=>operation(await this.bridge.clientUpdates({kind:'create',deviceId,targetVersion,requestId}),deviceId));}
 cancel(operationId:string){return this.read(async()=>operation(await this.bridge.clientUpdates({kind:'cancel',operationId})));}
}
