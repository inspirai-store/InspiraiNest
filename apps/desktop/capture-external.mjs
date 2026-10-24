import {randomUUID} from 'node:crypto';
import {CaptureGate} from './capture-browser.mjs';
import {canonicalCaptureURL} from '../../packages/core/node/capture-contract.mjs';
import {createCaptureSurface} from './capture-surface.mjs';

function localEndpoint(value,protocols=['http:']){const u=new URL(value);if(!protocols.includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('请使用本机浏览器调试地址');return u;}
export async function listExternalPages(endpoint){const origin=localEndpoint(endpoint).origin;const res=await fetch(origin+'/json/list',{signal:AbortSignal.timeout(5000),redirect:'error'});if(!res.ok)throw Error('无法连接外部浏览器');const pages=await res.json();if(!Array.isArray(pages))throw Error('浏览器页面列表无效');return pages.filter(p=>p.type==='page'&&/^https?:\/\//.test(p.url)).slice(0,100).map(p=>({id:p.id,title:String(p.title??''),url:p.url,endpoint:origin}));}

export async function bindExternalPage(browser,{target,transport,reconnectId,kind='cdp'}){
 const old=reconnectId?browser.page(reconnectId):null;
 if(old&&!old.external){transport.close();throw Error('请选择外部浏览器页面');}
 const source=old&&[...browser.sessions.values()].find(s=>s.pageId===old.id)?.source;
 if(source&&canonicalCaptureURL(source)!==canonicalCaptureURL(target.url)){transport.close();throw Error('选择的页面与原任务来源不匹配');}
 if(old)await old.gate.take();
 const id=old?.id??randomUUID(),p=old??{id,gate:new CaptureGate(),taskId:null};
 const previous=p.external;
 let surface;
 surface=createCaptureSurface({...transport,
  onUserInput:()=>{if(p.external!==surface)return;if(p.gate.mode==='agent'){p.controlReason='已在浏览器中操作';void browser.take(id).catch(()=>{});}},
  onPageChanged:(url,error)=>{if(p.external!==surface)return;if(url)p.url=url;if(error){p.error=error;void browser.take(id).catch(()=>{});}else if(url&&[...browser.sessions.values()].some(s=>s.pageId===id&&s.source&&canonicalCaptureURL(url)!==canonicalCaptureURL(s.source))){p.error='页面来源已变化';void browser.take(id).catch(()=>{});}browser.changed();},
 });
 try{await surface.ready;const meta=await surface.evaluate('({url:location.href,title:document.title})');if(canonicalCaptureURL(meta.url)!==canonicalCaptureURL(target.url))throw Error('页面已变化，请重新选择页面');if(source&&canonicalCaptureURL(meta.url)!==canonicalCaptureURL(source))throw Error('选择的页面与原任务来源不匹配');Object.assign(p,{url:meta.url,title:meta.title,loading:false,error:null,controlReason:null,external:surface,connection:{kind,targetId:target.id,endpoint:target.endpoint}});previous?.close();browser.pages.set(id,p);browser.selected=id;browser.render();browser.changed();return browser.snapshot();}catch(error){surface.close();throw error;}
}

export async function connectExternalPage(browser,{endpoint,targetId,reconnectId}){
 const origin=localEndpoint(endpoint).origin;
 const res=await fetch(origin+'/json/list',{signal:AbortSignal.timeout(5000),redirect:'error'});if(!res.ok)throw Error('浏览器连接已失效');
 const target=(await res.json()).find(p=>p.type==='page'&&p.id===targetId&&/^https?:\/\//.test(p.url));if(!target)throw Error('选择的页面已关闭');
 const socketURL=localEndpoint(target.webSocketDebuggerUrl,['ws:']);if(socketURL.port!==new URL(origin).port)throw Error('浏览器调试地址不匹配');
 const socket=new WebSocket(socketURL);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error('浏览器连接超时'));},5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('浏览器连接失败'));},{once:true});});
 let sequence=0,retired=false;const pending=new Map(),events=[],disconnects=[];
 socket.addEventListener('message',event=>{let value;try{value=JSON.parse(event.data);}catch{return;}const waiter=pending.get(value.id);if(waiter){pending.delete(value.id);clearTimeout(waiter.timer);value.error?waiter.reject(Error(value.error.message)):waiter.resolve(value.result);}else if(value.method)for(const cb of events)cb(value.method,value.params??{});});
 const send=(method,params={})=>new Promise((resolve,reject)=>{if(socket.readyState!==1)return reject(Error('浏览器连接已断开'));const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);if(method==='Runtime.evaluate')socket.close();reject(Error('浏览器响应超时'));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 socket.addEventListener('close',async()=>{for(const {reject,timer}of pending.values()){clearTimeout(timer);reject(Error('浏览器连接已断开'));}pending.clear();if(retired)return;let reason='浏览器连接已断开';try{const pages=await listExternalPages(origin);if(!pages.some(t=>t.id===targetId))reason='页面已关闭';}catch{}for(const cb of disconnects)cb(reason);});
 return bindExternalPage(browser,{target:{...target,endpoint:origin},reconnectId,transport:{send,onEvent:cb=>events.push(cb),onDisconnect:cb=>disconnects.push(cb),close(){retired=true;socket.close();}}});
}
