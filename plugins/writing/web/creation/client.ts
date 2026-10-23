export type ContextRef={kind:'record'|'entry'|'text';id?:string;version?:number;archiveId?:string;title?:string;selectedText?:string;text?:string;file?:string;startLine?:number;[key:string]:unknown};
export type CreationDocument={id:string;revision:number;title:string;markdown:string;citations:ContextRef[];media:any[];updatedAt:string};
export type CreationEvent={sequence:number;type:string;at:string;data:{turnId?:string;instruction?:string;text?:string;value?:{items?:ContextRef[];coverage?:unknown;candidateDocument?:{title:string;markdown:string}}}};
export type Publication={id:string;state:string;documentRevision:number;digest:string;error?:string;preview?:{origin:string;article_id:string;revision_id:string;content_sha256:string;source:string;locale:string;article:{title:string;markdown:string;media?:unknown[];[key:string]:unknown};published?:unknown};published?:{url:string;revisionId:string}};
export type CreationSession={id:string;title:string;executorDeviceId:string;contextRefs:ContextRef[];sequence:number;document:CreationDocument;turns:{id:string;state:string;instruction:string}[];publication:Publication|null};
type NativeBridge={call(action:string,input?:unknown):Promise<any>};
declare global {interface Window {creation?:{request(input:unknown):Promise<{status:number;json:any}>;account():Promise<any>;login():Promise<{loginId:string}>;cancel(input:unknown):Promise<unknown>};captureBridge?:NativeBridge}}
export class CreationClient {
  epoch=0;private pending=new Map<string,string>();
  invalidate(){this.epoch++;this.pending.clear();}
  async status(){return window.captureBridge?window.captureBridge.call('status'):window.library?.status();}
  async request<T>(route:string,method='GET',json?:unknown):Promise<T>{
    const epoch=this.epoch,before=await this.status();if(!before?.paired)throw Error('请先登录资料空间');
    const input={route:'/api/creation/v1'+route,method,json,server:before.server};
    const response=window.creation?await window.creation.request(input):await window.captureBridge!.call('request',input);
    const after=await this.status();if(epoch!==this.epoch||!after?.paired||before.server!==after.server||before.deviceId!==after.deviceId)throw Error('资料空间已切换');
    if(response.status>=400)throw Object.assign(Error(response.json?.error||'创作请求失败'),{status:response.status});return response.json;
  }
  async mutate<T>(route:string,input:Record<string,unknown>,method='POST'):Promise<T>{
    const key=route+JSON.stringify(input),requestId=this.pending.get(key)||crypto.randomUUID();this.pending.set(key,requestId);
    try{const result=await this.request<T>(route,method,{...input,requestId});this.pending.delete(key);return result;}catch(e){if((e as {status?:number}).status)this.pending.delete(key);throw e;}
  }
  async upload(file:File){
    const before=await this.status();if(!before?.paired)throw Error('请先登录资料空间');if(file.size>32*1024*1024)throw Error('媒体不能超过32 MiB');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const bytes=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});
    const input={route:'/api/records/media/'+hash,method:'PUT' as const,server:before.server,bytes,mime:file.type};
    const result=window.captureBridge?await window.captureBridge.call('request',input):await window.library!.capture(input);
    const after=await this.status();if(after?.server!==before.server||after?.deviceId!==before.deviceId)throw Error('资料空间已切换');if(result.status>=400)throw Error(result.json?.error||'媒体上传失败');return {kind:'local',sha256:hash,name:file.name,mime:file.type,ref:'media'+hash.slice(0,12),alt:file.name,caption:'',attribution:''};
  }
  async media(sha256:string){
    const status=await this.status(),input={route:'/api/records/media/'+sha256,server:status?.server};
    const result=window.captureBridge?await window.captureBridge.call('request',input):await window.library!.capture(input);
    if(result.status>=400||!result.bytes)throw Error('媒体读取失败');const raw=atob(result.bytes),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');if(hash!==sha256)throw Error('媒体校验失败');
    const after=await this.status();if(after?.server!==status.server||after?.deviceId!==status.deviceId)throw Error('资料空间已切换');return URL.createObjectURL(new Blob([bytes],{type:result.mime}));
  }
}
export const openCreation=(context?:ContextRef)=>{
  if(!context){
    const selected=window.getSelection()?.toString().trim(),editor=document.querySelector<HTMLElement>('[aria-label="记录正文"]');
    const current=editor instanceof HTMLTextAreaElement?editor.value:editor?.innerText;
    const text=selected||current;
    if(text?.trim())context={kind:'text',title:selected?'选中文字':'当前记录',text:text.slice(0,50000)};
  }
  window.dispatchEvent(new CustomEvent('creation:open',{detail:context}));
};
