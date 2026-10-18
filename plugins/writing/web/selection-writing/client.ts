import {recordScope} from '../../../../packages/core/web/records/data/account-store.ts';
import {requestJson} from '../../../../packages/core/web/records/data/transport.ts';
import type {Connection,RecordTransport} from '../../../../packages/core/web/records/data/types.ts';
import type {WritingRemote,WritingRequest} from './model.ts';
export class WritingClient{
 private epoch=0;
 private transport:RecordTransport;
 readonly connection:Connection;
 constructor(transport:RecordTransport,connection:Connection){this.transport=transport;this.connection=connection;}
 invalidate(){this.epoch++;}
 private async request<T>(route:string,method:'GET'|'POST'='GET',json?:unknown){const epoch=this.epoch,before=await this.transport.status();if(!before.paired||recordScope(before)!==recordScope(this.connection))throw Error('资料空间已切换或未连接');const result=await requestJson<T>(this.transport,{route,method,json,server:before.server,deviceId:before.deviceId});const after=await this.transport.status();if(epoch!==this.epoch||recordScope(after)!==recordScope(before))throw Error('资料空间已切换');return result;}
 submit(input:WritingRequest){return this.request<WritingRemote>('/api/selection-writing/tasks','POST',input);}
 get(id:string){return this.request<WritingRemote>('/api/selection-writing/tasks/'+encodeURIComponent(id));}
 list(){return this.request<WritingRemote[]>('/api/selection-writing/tasks');}
 cancel(id:string){return this.request<WritingRemote>('/api/selection-writing/tasks/'+encodeURIComponent(id)+'/cancel','POST',{});}
}
