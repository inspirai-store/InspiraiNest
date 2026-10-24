const allowed=new Set(['Page.enable','Runtime.enable','Runtime.addBinding','Page.addScriptToEvaluateOnNewDocument','Page.getFrameTree','Page.createIsolatedWorld','Runtime.evaluate','Page.captureScreenshot','Page.bringToFront']);
let current=null;
async function request(s,route,body,token=s.token){const response=await fetch(s.endpoint+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});const value=await response.json();if(!response.ok)throw Error(value.error||'连接失败');return value;}
async function stop(reason){const s=current;if(!s)return;current=null;s.closed=true;try{await request(s,`/browser-extension/${s.id}/poll`,{closed:true,reason});}catch{}try{await chrome.debugger.detach({tabId:s.tabId});}catch{}await chrome.storage.session.remove('connection');}
async function executeCommand(s,command){
 if(!allowed.has(command.method)||s.inflight>=4){s.results.push({id:command.id,error:'浏览器命令不可用或正在忙碌'});return;}s.inflight++;let timer;
 try{const result=await Promise.race([chrome.debugger.sendCommand({tabId:s.tabId},command.method,command.params??{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('浏览器响应超时')),8000);})]);if(current===s)s.results.push({id:command.id,result});}
 catch(error){if(current===s)s.results.push({id:command.id,error:error.message});if(error.message==='浏览器响应超时'&&command.method==='Runtime.evaluate')await stop('command_timeout');}
 finally{clearTimeout(timer);s.inflight--;}
}
async function loop(s){while(current===s&&!s.closed){try{const reply=await request(s,`/browser-extension/${s.id}/poll`,{results:s.results.splice(0),events:s.events.splice(0)});for(const command of reply.commands??[]){if(current!==s)break;void executeCommand(s,command);}}catch(error){s.error=error.message;await stop('connection_lost');}}}
chrome.debugger.onEvent.addListener((source,method,params)=>{const s=current;if(!s||source.tabId!==s.tabId)return;if(['Page.frameNavigated','Page.navigatedWithinDocument','Runtime.executionContextsCleared','Runtime.bindingCalled'].includes(method))s.events.push({method,params});});
chrome.debugger.onDetach.addListener((source,reason)=>{if(current?.tabId===source.tabId)void stop(reason);});
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{(async()=>{
 if(message.type==='status')return {connected:!!current,title:current?.title};
 if(message.type==='disconnect'){await stop('user');return {connected:false};}
 if(message.type!=='connect')throw Error('操作无效');if(current)throw Error('请先断开当前页面');
 const spec=JSON.parse(atob(message.code.trim().replace(/-/g,'+').replace(/_/g,'/'))),u=new URL(spec.endpoint);
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||!/^[a-f0-9]{64}$/.test(spec.token))throw Error('连接码无效');
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!/^https?:\/\//.test(tab.url??''))throw Error('请在网页标签中连接');
 const s={endpoint:u.origin,token:spec.token,tabId:tab.id,title:tab.title,results:[],events:[],inflight:0};await chrome.debugger.attach({tabId:tab.id},'1.3');
 try{const result=await request(s,'/browser-extension/pair',{tabId:tab.id,title:tab.title,url:tab.url,browser:navigator.userAgent.includes('Edg/')?'Edge':'Chrome'});Object.assign(s,result);current=s;await chrome.storage.session.set({connection:{endpoint:s.endpoint,token:s.token,id:s.id,tabId:s.tabId,title:s.title}});void loop(s);return {connected:true,title:s.title};}catch(error){await chrome.debugger.detach({tabId:tab.id});throw error;}
 })().then(reply,error=>reply({error:error.message}));return true;});
// A worker restart never silently attaches to another tab.
chrome.storage.session.get('connection').then(async({connection:s})=>{if(!s||current)return;try{await chrome.debugger.sendCommand({tabId:s.tabId},'Page.getFrameTree');current={...s,results:[],events:[],inflight:0};void loop(current);}catch{await chrome.storage.session.remove('connection');}});
