import {zipFiles} from '../../../packages/plugin-sdk/zip.ts';
import type {TeachingHandoff} from './types';
type Bridge={status:()=>Promise<{paired:boolean;server:string;deviceId?:string|null}>;capture:(input:{route:string;method?:'GET'|'POST'|'PUT';json?:unknown;server?:string;deviceId?:string|null;bytes?:string;mime?:string})=>Promise<{status:number;json?:unknown;bytes?:string;mime?:string}>};
const base64=(bytes:Uint8Array)=>{let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result);};
export class LearningClient {
  private scope='';
  private bridge:Bridge;
  constructor(bridge:Bridge){this.bridge=bridge;}
  async previewURL(path:string){
    if(!/^\/api\/learning\/previews\/[a-f0-9-]{36}$/.test(path))throw Error('演示预览地址无效');
    const current=await this.bridge.status();if(!current.paired||JSON.stringify([current.server,current.deviceId])!==this.scope)throw Error('资料空间已切换');return new URL(path,current.server).href;
  }
  async request<T>(route:string,json?:unknown,method:'GET'|'POST'|'PUT'=json===undefined?'GET':'POST',binary?:{bytes:string;mime:string}):Promise<T>{
    const before=await this.bridge.status(),scope=JSON.stringify([before.server,before.deviceId]);
    if(!before.paired)throw Error('请先登录资料空间');
    if(this.scope&&this.scope!==scope)throw Error('资料空间已切换');this.scope=scope;
    const result=await this.bridge.capture({route,method,json,...binary,server:before.server,deviceId:before.deviceId});
    const after=await this.bridge.status();if(!after.paired||JSON.stringify([after.server,after.deviceId])!==scope)throw Error('资料空间已切换');
    if(result.status<200||result.status>=300)throw Error((result.json as {error?:string})?.error||'请求失败');
    return result.json as T;
  }
  async upload(file:File){
    if(file.size>32*1024*1024)throw Error('单个文件不能超过 32 MiB');
    const bytes=new Uint8Array(await file.arrayBuffer()),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const mime=file.type==='text/html'||!/^(image|video|audio)\//.test(file.type)&&!['application/pdf','text/plain','text/markdown','application/json','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type)?'application/octet-stream':file.type;
    await this.request('/api/records/media/'+sha256,undefined,'PUT',{bytes:base64(bytes),mime});
    return {id:crypto.randomUUID(),name:file.name,mime,sha256,bytes:file.size};
  }
}
export function downloadBytes(name:string,bytes:Uint8Array,mime:string){
  const blob=new Blob([new Uint8Array(bytes)],{type:mime}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function downloadPacket(packet:TeachingHandoff){downloadBytes(packet.title+'-'+packet.format+'.zip',zipFiles(packet.files.map(f=>({name:f.name,bytes:new TextEncoder().encode(f.text)}))),'application/zip');}
