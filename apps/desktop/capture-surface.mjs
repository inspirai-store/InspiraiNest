import {randomUUID} from 'node:crypto';

// Runs in a named isolated world. The page cannot alter the observation map.
const world='lingnest-capture-v2';
const bootstrap=`(()=>{if(globalThis.__lingnest)return;const s=globalThis.__lingnest={revision:0,input:0,elements:new Map()};s.observer=new MutationObserver(()=>s.revision++);s.observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});for(const type of ['pointerdown','keydown','wheel'])addEventListener(type,e=>{if(e.isTrusted){s.input++;s.observation=null;try{globalThis.lingnestUserInput('{}');}catch{}}},true);})()`;
const visible=`e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return e.isConnected&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&c.visibility!=='hidden'&&c.display!=='none'&&r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth}`;
const permitted=`e=>{if(e.closest('form,[contenteditable=true]')||e.matches('input,textarea,select'))return false;const label=(e.innerText||e.getAttribute('aria-label')||'').trim();if(/购买|支付|删除|提交|发送|退出|登录|注册|buy|pay|delete|submit|send|sign.?in/i.test(label))return false;if(e.matches('a[href]')){const u=new URL(e.href,location.href),here=new URL(location.href);u.hash='';here.hash='';return u.href===here.href;}return e.matches('summary,[aria-expanded]')||/展开|更多|全文|继续阅读|下一页|show more|read more|expand|next page/i.test(label);}`;

export function createCaptureSurface({send,evaluate:isolatedEvaluate,onEvent,onDisconnect,onUserInput,onPageChanged,close,focus}){
 let context=null,observation=null,closed=false;
 const invalidate=()=>{observation=null;};
 onEvent?.((method,params)=>{
  if(method==='Runtime.bindingCalled'&&params.name==='lingnestUserInput'){invalidate();onUserInput?.();}
  if(method==='Page.frameNavigated'&&!params.frame.parentId){context=null;invalidate();onPageChanged?.(params.frame.url);}
  if(method==='Page.navigatedWithinDocument'){invalidate();onPageChanged?.(params.url);}
  if(method==='Runtime.executionContextsCleared'){context=null;invalidate();}
 });
 onDisconnect?.(reason=>{closed=true;context=null;invalidate();onPageChanged?.(null,reason||'浏览器连接已断开');});
 async function evaluate(expression,retry=true){
  if(closed)throw Error('浏览器连接已断开');
  if(isolatedEvaluate)return isolatedEvaluate(expression);
  if(!context){const {frameTree}=await send('Page.getFrameTree');const result=await send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:world});context=result.executionContextId;}
  let result;try{result=await send('Runtime.evaluate',{expression,contextId:context,returnByValue:true,awaitPromise:true});}catch(error){if(/Cannot find context|Execution context.*destroyed|Cannot find.*context|context.*not found/i.test(error.message)){context=null;invalidate();if(retry)return evaluate(expression,false);throw Error('页面已变化，请重新观察');}throw error;}
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description?.split('\n')[0]||'页面读取失败');
  return result.result?.value;
 }
 const ready=(async()=>{if(!isolatedEvaluate){await send('Page.enable');await send('Runtime.enable');await send('Runtime.addBinding',{name:'lingnestUserInput',executionContextName:world});await send('Page.addScriptToEvaluateOnNewDocument',{source:bootstrap,worldName:world});}await evaluate(bootstrap);})();
 return {
  ready,invalidate,evaluate:async expression=>{await ready;return evaluate(expression);},
  focus:focus??(()=>send('Page.bringToFront')),
  close(){closed=true;invalidate();close();},
  async preview(){await ready;const meta=await evaluate('({url:location.href,title:document.title,width:innerWidth,height:innerHeight})');const {data}=await send('Page.captureScreenshot',{format:'jpeg',quality:75,captureBeyondViewport:false,fromSurface:true});return {...meta,dataUrl:'data:image/jpeg;base64,'+data,capturedAt:new Date().toISOString()};},
  async observe(){await ready;const id=randomUUID();const result=await evaluate(`(()=>{${bootstrap};const s=globalThis.__lingnest;if(s.observer.takeRecords().length)s.revision++;s.elements.clear();const root=document.querySelector('article,main,[role=main]')||document.body;const nodes=Array.from(root?.querySelectorAll('button,a[href],summary,[role=button],[aria-expanded]')||[]).filter(${visible}).filter(${permitted}).slice(0,100);const elements=nodes.map((e,i)=>{const id=String(i+1),r=e.getBoundingClientRect();s.elements.set(id,e);return {id,role:e.getAttribute('role')||e.tagName.toLowerCase(),name:(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,200),bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};});s.observation={id:${JSON.stringify(id)},revision:s.revision,input:s.input,url:location.href,x:scrollX,y:scrollY};return {observationId:s.observation.id,url:location.href,title:document.title,viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},elements};})()`);observation=id;return result;},
  async act(operation,input){
   await ready;if(!input.observationId||input.observationId!==observation)throw Error('页面观察已失效，请重新观察');invalidate();
   const y=Math.max(-2000,Math.min(2000,Number(input.y)||0));
   return evaluate(`(()=>{const s=globalThis.__lingnest,o=s?.observation;if(s?.observer.takeRecords().length)s.revision++;if(!o||o.id!==${JSON.stringify(input.observationId)}||o.revision!==s.revision||o.input!==s.input||o.url!==location.href||o.x!==scrollX||o.y!==scrollY)throw Error('页面观察已失效，请重新观察');s.observation=null;${operation==='scroll'?`scrollBy({top:${y},behavior:'instant'});return {ok:true};`:`const e=s.elements.get(${JSON.stringify(String(input.elementId??''))});if(!e||!(${visible})(e)||!(${permitted})(e))throw Error('页面操作目标已失效');const r=e.getBoundingClientRect(),x=Math.max(0,r.left)+Math.min(r.width,innerWidth-Math.max(0,r.left))/2,y=Math.max(0,r.top)+Math.min(r.height,innerHeight-Math.max(0,r.top))/2,hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw Error('页面操作目标被遮挡');e.click();return {ok:true};`}})()`,false);
  },
 };
}
