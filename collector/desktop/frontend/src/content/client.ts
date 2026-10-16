import {requestJson} from '../records/data/transport.ts';
import {recordScope} from '../records/data/account-store.ts';
import type {RecordTransport} from '../records/data/types.ts';
export type ContentType='record'|'library'|'writing'|'task'|'selection-writing';
export type TrashItem={type:ContentType;id:string;title:string;version:number;trashVersion:number;deletedAt?:string|null;local?:boolean;localJob?:string;error?:string};
export const contentLabels:Record<ContentType,string>={record:'记录',library:'资料',writing:'写作',task:'任务','selection-writing':'AI 写作'};
export class ContentClient{
 private transport:RecordTransport;
 constructor(transport:RecordTransport){this.transport=transport;}
 async request<T>(route:string,method:'GET'|'POST'='GET',json?:unknown){const status=await this.transport.status();if(!status.paired)throw Error('请先连接资料空间');const result=await requestJson<T>(this.transport,{route,method,json,server:status.server,deviceId:status.deviceId});const after=await this.transport.status();if(recordScope(after)!==recordScope(status))throw Error('资料空间已切换');return result;}
 list(){return this.request<{protocol:1;items:TrashItem[]}>('/api/content-trash');}
 metadata(item:Pick<TrashItem,'type'|'id'>){return this.request<TrashItem>('/api/content-trash/'+item.type+'/'+encodeURIComponent(item.id));}
 change(item:TrashItem,action:'delete'|'restore',requestId:string){return this.request<TrashItem>('/api/content-trash/'+item.type+'/'+encodeURIComponent(item.id)+'/'+action,'POST',{requestId,version:item.version,trashVersion:item.trashVersion});}
}
