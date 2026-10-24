import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {bindExternalPage} from './capture-external.mjs';

const methods=new Set(['Page.enable','Runtime.enable','Runtime.addBinding','Page.addScriptToEvaluateOnNewDocument','Page.getFrameTree','Page.createIsolatedWorld','Runtime.evaluate','Page.captureScreenshot','Page.bringToFront']);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class CaptureExtensionBridge {
 constructor(browser){this.browser=browser;this.clients=new Map();this.pair=null;this.timer=setInterval(()=>{for(const c of this.clients.values())if(Date.now()-c.seen>15000)this.drop(c,'浏览器连接已断开');},5000);this.timer.unref();}
 async pairing(){await this.browser.ready;this.pair={token:randomBytes(32).toString('hex'),expires:Date.now()+120000};return {code:Buffer.from(JSON.stringify({endpoint:'http://127.0.0.1:'+this.browser.http.address().port,token:this.pair.token})).toString('base64url'),expiresAt:new Date(this.pair.expires).toISOString()};}
 pages(){return [...this.clients.values()].filter(c=>!c.bound).map(c=>({id:c.id,title:c.title,url:c.url,endpoint:'extension',browser:c.browser}));}
 drop(c,reason){if(!this.clients.has(c.id))return;this.clients.delete(c.id);for(const p of c.pending.values()){clearTimeout(p.timer);p.reject(Error(reason));}c.pending.clear();for(const cb of c.disconnects)cb(reason);c.wake?.();}
 async connect({targetId,reconnectId}){const c=this.clients.get(targetId);if(!c||c.bound)throw Error('扩展页面连接已失效');c.bound=true;return bindExternalPage(this.browser,{target:c,reconnectId,kind:'extension',transport:{
  send:(method,params)=>new Promise((resolve,reject)=>{if(!methods.has(method)||!this.clients.has(c.id))return reject(Error('浏览器命令不可用'));const id=randomUUID(),timer=setTimeout(()=>{c.pending.delete(id);c.queue=c.queue.filter(x=>x.id!==id);reject(Error('浏览器响应超时'));},10000);c.pending.set(id,{resolve,reject,timer});c.queue.push({id,method,params});c.wake?.();}),
  onEvent:cb=>c.events.push(cb),onDisconnect:cb=>c.disconnects.push(cb),close:()=>this.drop(c,'连接已结束'),
 }});}
 async handle(req,res){
  const reply=(status,value)=>{if(res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const origin=req.headers.origin;if(origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return reply(403,{error:'连接来源无效'});
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');}
  if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host??''))return reply(403,{error:'连接地址无效'});
  if(req.method==='OPTIONS')return reply(204,{});
  if(req.method!=='POST')return reply(405,{error:'连接方法无效'});
  try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8*1024*1024)throw Error('连接消息过大');}const body=JSON.parse(raw||'{}'),token=req.headers.authorization?.replace(/^Bearer /,'');
   if(req.url==='/browser-extension/pair'){
    if(!this.pair||this.pair.expires<Date.now()||!equal(token,this.pair.token))return reply(403,{error:'连接码已失效'});
    if(!/^https?:\/\//.test(body.url??'')||!Number.isSafeInteger(body.tabId))throw Error('请选择网页');
    this.pair=null;const c={id:randomUUID(),token:randomBytes(32).toString('hex'),url:body.url,title:String(body.title??'').slice(0,500),browser:String(body.browser??'Chrome').slice(0,30),seen:Date.now(),queue:[],pending:new Map(),events:[],disconnects:[],bound:false};this.clients.set(c.id,c);return reply(200,{id:c.id,token:c.token});
   }
   const match=req.url.match(/^\/browser-extension\/([a-f0-9-]{36})\/poll$/),c=match&&this.clients.get(match[1]);
   if(!c||!equal(token,c.token))return reply(403,{error:'浏览器连接已失效'});c.seen=Date.now();
   if(body.closed){this.drop(c,body.reason==='target_closed'?'页面已关闭':'浏览器连接已断开');return reply(200,{closed:true});}
   if(c.polling)return reply(409,{error:'浏览器请求尚未完成'});
   for(const result of (Array.isArray(body.results)?body.results:[]).slice(0,50)){const p=c.pending.get(result.id);if(p){clearTimeout(p.timer);c.pending.delete(result.id);result.error?p.reject(Error(String(result.error))):p.resolve(result.result);}}
   for(const event of (Array.isArray(body.events)?body.events:[]).slice(0,100))if(['Page.frameNavigated','Page.navigatedWithinDocument','Runtime.executionContextsCleared','Runtime.bindingCalled'].includes(event.method))for(const cb of c.events)cb(event.method,event.params??{});
   c.polling=true;try{if(!c.queue.length)await new Promise(resolve=>{const timer=setTimeout(()=>{c.wake=null;resolve();},250);c.wake=()=>{clearTimeout(timer);c.wake=null;resolve();};});reply(200,{commands:c.queue.splice(0,20)});}finally{c.polling=false;}
  }catch(error){reply(400,{error:error.message});}
 }
 reset(){this.pair=null;for(const c of this.clients.values())this.drop(c,'连接已结束');}
 dispose(){this.reset();clearInterval(this.timer);}
}
