import {remoteOperations} from '../../packages/core/node/remote-operations.mjs';
const events=new EventTarget();
const encode=encodeURIComponent;
const params=input=>new URLSearchParams(Object.entries(input||{}).filter(([,v])=>v!==undefined&&v!==null&&v!==''));
export function createBrowserBridge(){
 const request=async(route,method='GET',input,binary=false)=>{
  if(!route.startsWith('/api/'))throw Error('接口不可用');
  const response=await fetch(route,{method,credentials:'same-origin',redirect:'error',headers:input===undefined?{}:{'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});
  if(!response.ok){let error;try{error=await response.json();}catch{}throw Object.assign(Error(error?.error||'请求失败'),{status:response.status,code:error?.code,details:error?.details});}
  return binary?response:response.json();
 };
 const status=async()=>{try{const device=await request('/api/browser-session');return {paired:true,server:location.origin,deviceId:device.id};}catch(error){if(error.status===401)return {paired:false,server:location.origin,deviceId:null};throw error;}};
 const file=async input=>{const meta=await request('/api/read/v1/entry?id='+encode(input.id));const item=meta.files.find(f=>f.path===input.file);if(!item?.sha256)throw Error('附件未登记');const response=await request('/api/read/v1/file?'+params(input),'GET',undefined,true);const bytes=new Uint8Array(await response.arrayBuffer());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==item.sha256)throw Error('附件校验失败');return {bytes,blob:new Blob([bytes],{type:response.headers.get('Content-Type')||'application/octet-stream'}),name:input.file.split('/').at(-1)};};
 const base64=bytes=>{let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);};
 const change=()=>events.dispatchEvent(new Event('changed'));
 return Object.assign({
 status,onChanged:callback=>{events.addEventListener('changed',callback);return()=>events.removeEventListener('changed',callback);},
 async pair(input){if(new URL(input.server||location.origin).origin!==location.origin)throw Error('请在目标资料空间的网址登录');const result=await request('/api/pair','POST',{...input,server:undefined,...await window.browserDevice.metadata()});if(!result.device)throw Error('登录未完成');change();return status();},
 async logout(){await request('/api/browser-session/logout','POST',{});change();return status();},
 cancelLogin:async()=>{},
 state:()=>request('/api/state'),
 plugins:input=>request(input?.id?'/api/plugins/'+encode(input.id):'/api/plugins',input?.id?'PUT':'GET',input?.id?{enabled:input.enabled,revision:input.revision}:undefined),
 async capture(input){if(input.server&&input.server!==location.origin)throw Error('资料空间已切换');const allowed=/^\/api\/(?:blocks|plugins|records|writing|selection-writing|content)(?:\/|$)/;if(!allowed.test(input.route))throw Error('接口不可用');let body=input.json,headers={};if(input.bytes!==undefined){body=Uint8Array.from(atob(input.bytes),c=>c.charCodeAt(0));headers['Content-Type']=input.mime;}else if(body!==undefined){body=JSON.stringify(body);headers['Content-Type']='application/json';}const response=await fetch(input.route,{method:input.method||'GET',credentials:'same-origin',redirect:'error',headers,body});return response.headers.get('Content-Type')?.includes('json')?{status:response.status,json:await response.json()}:{status:response.status,bytes:base64(new Uint8Array(await response.arrayBuffer())),mime:response.headers.get('Content-Type')};},
 entries:input=>request('/api/read/v1/'+(input?.q?'search':'entries')+'?'+params(input)),entry:id=>request('/api/read/v1/entry?id='+encode(id)),
 content:input=>request('/api/read/v1/content?'+params({id:input.id,file:input.file,start_line:input.startLine||1,start_column:input.startColumn||0,max_lines:200})),
 async preview(input){const value=await file(input);return {name:value.name,dataUrl:'data:'+value.blob.type+';base64,'+base64(value.bytes)};},
 async download(input){const value=await file(input),url=URL.createObjectURL(value.blob),link=document.createElement('a');link.href=url;link.download=value.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {saved:true};},
 async taskFile(input){const value=await file(input);return {name:value.name,bytes:base64(value.bytes)};},
 diagnosticTasks:(input={})=>request('/api/read/v1/tasks?'+new URLSearchParams({cursor:input.cursor||'0',limit:'50',...(input.deviceId?{device:input.deviceId}:{})})),taskDiagnostics:id=>request('/api/read/v1/tasks/'+encode(id)+'/diagnostics'),capabilities:id=>request('/api/devices/'+encode(id)+'/capabilities'),checkCapabilities:input=>request('/api/devices/'+encode(typeof input==='string'?input:input.deviceId)+'/capabilities/check','POST',typeof input==='string'?{}:{action:input.action}),
 task:input=>{const {account,...payload}=input;return request('/api/tasks','POST',payload);},taskAction:input=>request('/api/tasks/'+encode(input.id)+'/'+encode(input.action),'POST',{}),
 async draft(id){const bundle=await request('/api/tasks/'+encode(id)+'/draft');const report=bundle.files.find(f=>/summary|analysis_report/.test(f.path));return {title:bundle.meta.title,markdown:report?new TextDecoder().decode(Uint8Array.from(atob(report.body),c=>c.charCodeAt(0))):''};},
 pairing:()=>request('/api/pairings','POST',{}),revoke:id=>request('/api/devices/'+encode(id)+'/revoke','POST',{}),removeNode:id=>request('/api/devices/'+encode(id)+'/remove-node','POST',{}),renameNode:input=>request('/api/devices/'+encode(input.id)+'/name','POST',{name:input.name}),
 trash:()=>request('/api/trash'),remove:id=>request('/api/archives/'+encode(id),'DELETE'),restore:id=>request('/api/archives/'+encode(id)+'/restore','POST',{}),
 openUrl:url=>{const value=new URL(url);if(!['http:','https:'].includes(value.protocol))throw Error('链接不可用');window.open(value.href,'_blank','noopener,noreferrer');},
 },Object.fromEntries(Object.keys(remoteOperations).map(name=>[name,input=>remoteOperations[name].call({api:request},input)])));
}
export function browserSettings(){const listeners=new Set();const read=()=>{let saved={};try{saved=JSON.parse(localStorage.getItem('inspirainest:appearance')||'{}');}catch{}const themeMode=saved.themeMode||'system';return {themeMode,resolvedTheme:themeMode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):themeMode,revision:saved.revision||0,closeBehavior:'quit',launchAtLogin:false,loginItem:{supported:false,status:'unsupported'},loginError:null};};return {get:async()=>read(),update:async input=>{const value={...read(),themeMode:input.themeMode||read().themeMode,revision:read().revision+1};localStorage.setItem('inspirainest:appearance',JSON.stringify(value));const next=read();listeners.forEach(fn=>fn(next));return next;},onChanged:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};}
