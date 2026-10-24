import {localCaptureTask} from '../../packages/core/node/capture-local.mjs';
import {EventEmitter} from 'node:events';
import {randomUUID,randomBytes,timingSafeEqual} from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {captureURL,canonicalCaptureURL,validateCaptureContext} from '../../packages/core/node/capture-contract.mjs';
import {CaptureExtensionBridge} from './capture-extension.mjs';
import {atomicJson} from '../../packages/core/node/common.mjs';
import {capturePageScript,parseCaptureDocument} from '../../packages/core/node/capture-document.mjs';
import {createCaptureSurface} from './capture-surface.mjs';

// Page content is untrusted data. Form values, scripts and browser storage never
// cross this boundary; actions execute only against the selected page.
export const pageSnapshotScript=capturePageScript;
const failure=(message,code)=>Object.assign(Error(message),{code});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export class CaptureGate {
  constructor(){this.mode='manual';this.tail=Promise.resolve();this.revision=0;}
  async run(action){const revision=this.revision;if(this.mode!=='agent')throw failure('页面已由用户接管','BROWSER_WAITING');const next=this.tail.then(()=>{if(this.mode!=='agent'||revision!==this.revision)throw failure('页面已由用户接管','BROWSER_WAITING');return action();});this.tail=next.catch(()=>{});return next;}
  async take(){this.mode='taking';this.revision++;await this.tail;this.mode='manual';}
  resume(){this.mode='agent';this.revision++;}
}

export class CaptureBrowser extends EventEmitter {
  constructor({window,WebContentsView,session,dataDir,owner,configuration,dialog}){
    super();Object.assign(this,{window,WebContentsView,session,dataDir,owner,configuration,dialog});this.pages=new Map();this.sessions=new Map();this.selected=null;this.bounds=null;this.visible=false;this.autoArchive=false;
    this.submissions=new Map();this.root=path.join(dataDir,'capture-sessions');fs.mkdirSync(this.root,{recursive:true});
    this.preference=path.join(this.root,'preferences.json');try{this.autoArchive=JSON.parse(fs.readFileSync(this.preference)).autoArchive===true;}catch{}
    this.http=http.createServer((req,res)=>void this.handle(req,res));
    this.bridgeToken=randomBytes(32).toString('hex');this.ready=new Promise(resolve=>this.http.listen(0,'127.0.0.1',resolve)).then(()=>this.publishBridge());this.http.unref();this.extension=new CaptureExtensionBridge(this);
    window.on('closed',()=>this.dispose());window.on('hide',()=>this.render());window.on('show',()=>this.render());
  }
  snapshot(){return {tabs:[...this.pages.values()].map(p=>({id:p.id,url:p.url,title:p.title,loading:p.loading,error:p.error,external:!!p.external,controlReason:p.controlReason??null,connectionKind:p.connection?.kind??null,taskId:p.taskId??null,mode:p.gate.mode,canGoBack:p.view?.webContents.navigationHistory.canGoBack()??false,canGoForward:p.view?.webContents.navigationHistory.canGoForward()??false})),selected:this.selected,autoArchive:this.autoArchive};}
  publishBridge(){const config=this.configuration(),folder=path.resolve(config.dataDir||this.dataDir);const file=path.join(folder,'capture-bridge.json');atomicJson(file,{version:2,endpoint:'http://127.0.0.1:'+this.http.address().port,token:this.bridgeToken,deviceId:config.deviceId});fs.chmodSync(file,0o600);this.changed();}
  async syncScope(){const folder=path.resolve(this.configuration().dataDir||this.dataDir);if(folder===this.dataDir)return;await this.reset();this.dataDir=folder;this.root=path.join(folder,'capture-sessions');fs.mkdirSync(this.root,{recursive:true});this.preference=path.join(this.root,'preferences.json');this.autoArchive=false;try{this.autoArchive=JSON.parse(fs.readFileSync(this.preference)).autoArchive===true;}catch{}this.publishBridge();}
  changed(){try{atomicJson(path.join(path.resolve(this.configuration().dataDir||this.dataDir),'capture-capability.json'),{available:true,connected:[...this.pages.values()].some(p=>p.external&&!p.error&&!p.closed),at:new Date().toISOString()});}catch{}this.emit('changed',this.snapshot());}
  page(id){const p=this.pages.get(id);if(!p||p.closed)throw failure('采集页面已关闭','BROWSER_CLOSED');return p;}
  async add(url,{background=false}={}){
    const id=randomUUID(),partition='persist:capture-'+this.configuration().deviceId;
    const browserSession=this.session.fromPartition(partition);
    browserSession.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));browserSession.setPermissionCheckHandler(()=>false);
    const view=new this.WebContentsView({webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
    const p={id,view,url:'',title:'新标签页',loading:false,error:null,gate:new CaptureGate(),background};this.pages.set(id,p);this.window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1200,height:820});view.setVisible(false);
    const wc=view.webContents;wc.setWindowOpenHandler(({url})=>{if(p.gate.mode==='manual')try{captureURL(url);void this.add(url);}catch{}return {action:'deny'};});
    wc.on('before-input-event',event=>{if(p.gate.mode!=='manual')event.preventDefault();});
    wc.on('before-mouse-event',event=>{if(p.gate.mode!=='manual')event.preventDefault();});
    wc.on('will-navigate',(e,url)=>{try{captureURL(url);if(p.gate.mode==='agent')e.preventDefault();}catch{e.preventDefault();}});
    wc.on('will-redirect',(e,url)=>{try{captureURL(url);}catch{e.preventDefault();}});
    wc.on('did-start-loading',()=>{p.loading=true;p.error=null;this.changed();});
    wc.on('did-stop-loading',()=>{p.loading=false;this.changed();});
    const update=()=>{p.url=wc.getURL();p.title=wc.getTitle()||p.url;this.changed();};
    wc.on('page-title-updated',update);wc.on('did-navigate',update);wc.on('did-navigate-in-page',update);
    wc.on('did-fail-load',(_e,code,description,_url,mainFrame)=>{if(mainFrame&&code!==-3){p.error=description;p.loading=false;this.changed();}});
    wc.on('render-process-gone',()=>{p.error='页面进程已退出';this.changed();});
    if(!background)this.selected=id;this.render();this.changed();if(url){if(background){let timer;await Promise.race([this.navigate({id,url}),new Promise(resolve=>timer=setTimeout(()=>{wc.stop();resolve();},15000))]).finally(()=>clearTimeout(timer));}else await this.navigate({id,url});}return background?p:this.snapshot();
  }
  render(){if(this.window.isDestroyed())return;for(const p of this.pages.values())if(p.view){const show=this.visible&&this.window.isVisible()&&p.id===this.selected&&this.bounds&&this.bounds.width>0&&this.bounds.height>0;p.view.setVisible(!!show);if(show)p.view.setBounds(this.bounds);}}
  viewport({bounds,visible,selected}){
    if(selected&&this.pages.has(selected))this.selected=selected;
    if(bounds){const [w,h]=this.window.getContentSize();const x=Math.max(0,Math.min(w,Math.round(bounds.x))),y=Math.max(0,Math.min(h,Math.round(bounds.y)));this.bounds={x,y,width:Math.max(0,Math.min(w-x,Math.round(bounds.width))),height:Math.max(0,Math.min(h-y,Math.round(bounds.height)))};}
    this.visible=visible===true;this.render();return this.snapshot();
  }
  async navigate({id,url,action}){const p=this.page(id);if(p.gate.mode!=='manual')throw Error('请先接管页面');if(p.external)throw Error('请在外部浏览器操作页面');const wc=p.view.webContents;
    if(action==='back'&&wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();else if(action==='forward'&&wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();else if(action==='reload')wc.reload();else if(url)await wc.loadURL(captureURL(url));return this.snapshot();}
  async close(id){const p=this.page(id),wc=p.view?.webContents;await p.gate.take();p.closed=true;if(p.view){if(!this.window.isDestroyed())this.window.contentView.removeChildView(p.view);if(wc&&!wc.isDestroyed())wc.close();}p.external?.close();this.pages.delete(id);if(this.selected===id)this.selected=this.pages.keys().next().value??null;this.render();this.changed();return this.snapshot();}
  async take(id){const p=this.page(id);(p.external||p.surface)?.invalidate?.();const pending=p.gate.take();this.changed();await pending;this.emit('execution-event',{taskId:p.taskId,code:'BROWSER_WAITING',state:'waiting_action',stage:'browser',message:'用户已接管页面，Agent 页面操作已停止'});this.changed();return this.snapshot();}
  async resume(id){const p=this.page(id);if(p.gate.mode==='taking')throw Error('正在交还控制，请稍后继续');const snapshot=await this.read(p),s=[...this.sessions.values()].find(s=>s.pageId===id&&s.taskId===p.taskId);if(s?.source&&canonicalCaptureURL(snapshot.url)!==canonicalCaptureURL(s.source))throw Error('页面来源已变化，请恢复原来源页面后继续');p.external?.invalidate?.();p.error=null;p.controlReason=null;p.gate.resume();this.emit('execution-event',{taskId:p.taskId,code:'BROWSER_RESUMED',state:'running',stage:'browser',message:'用户已交还页面，继续原任务'});this.changed();return this.snapshot();}
  async preview(id){const p=this.page(id);if(!p.external?.preview)throw Error('外部页面未连接');if(p.error&&p.error!=='页面来源已变化')throw Error(p.error);const frame=await p.external.preview();p.url=frame.url;p.title=frame.title;return frame;}
  surface(p){if(p.external)return p.external;if(!p.surface){const wc=p.view.webContents;p.surface=createCaptureSurface({evaluate:async code=>{const r=await wc.executeJavaScriptInIsolatedWorld(999,[{code:`(async()=>{try{return {value:await (${code})};}catch(error){return {failure:String(error.message)};}})()`}]);if(r?.failure)throw failure(r.failure,/观察.*失效|操作目标.*失效/.test(r.failure)?'BROWSER_STALE':'BROWSER_ERROR');return r?.value;},close(){},focus:()=>{},onEvent:callback=>{wc.on('did-navigate',(_e,url)=>callback('Page.frameNavigated',{frame:{id:String(wc.id),url}}));}});}return p.surface;}
  async read(p){
    const raw=await this.surface(p).evaluate(pageSnapshotScript);
    // Older bridge extensions can still return text-only snapshots.
    if(!raw.html)return raw;
    try{const doc=parseCaptureDocument(raw.html,{url:raw.url,title:raw.title,selected:raw.selected});p.assetURLs=new Set(doc.images.flatMap(i=>i.candidates));return {...raw,...doc,characters:doc.text.length,imageCount:doc.images.length};}
    catch(error){if(!error.code)throw error;return {...raw,text:'',html:undefined,images:[],characters:0,imageCount:0,access:{kind:error.access?.kind||'empty',code:error.code,reason:error.message},quality:{version:2,status:'blocked',warnings:[{code:error.code,reason:error.message}]}};}
  }
  async registerTask({taskId,sources,deviceId}){
    if(!/^[-a-f0-9]{36}$/i.test(taskId)||deviceId!==this.configuration().deviceId||!Array.isArray(sources)||!sources.length||sources.length>100)throw failure('任务浏览器范围无效','BROWSER_SCOPE');
    const allowed=[...new Set(sources.map(canonicalCaptureURL))],existing=[...this.sessions.entries()].find(([,s])=>s.automatic&&s.taskId===taskId);
    const sessionId=existing?.[0]||randomUUID(),token=existing?.[1].token||randomBytes(32).toString('hex');
    if(existing&&JSON.stringify(existing[1].allowed)!==JSON.stringify(allowed))throw failure('任务来源已变化','BROWSER_SCOPE');
    if(!existing)this.sessions.set(sessionId,{token,taskId,allowed,automatic:true,pageId:null,source:null});
    return {version:2,sessionId,taskId,endpoint:'http://127.0.0.1:'+this.http.address().port,token};
  }
  async acquire(s,input){
    const url=captureURL(input.url);
    if(s.automatic&&!s.allowed.includes(canonicalCaptureURL(url)))throw failure('此链接不属于当前任务','BROWSER_SCOPE');
    let p=s.pageId?this.page(s.pageId):null;
    if(p&&s.source&&![s.source,s.requestedSource].filter(Boolean).some(v=>canonicalCaptureURL(url)===canonicalCaptureURL(v)))throw failure('请为不同来源使用独立任务','BROWSER_SCOPE');
    if(!p){p=await this.add(url,{background:true});p.taskId=s.taskId;p.gate.resume();s.pageId=p.id;s.requestedSource=url;s.source=p.view.webContents.getURL()||url;const context=validateCaptureContext({version:1,kind:'page',sessionId:[...this.sessions.entries()].find(([,v])=>v===s)[0],title:p.title.slice(0,500),source:s.source});const folder=path.join(this.root,context.sessionId);atomicJson(path.join(folder,'task.json'),{taskId:s.taskId,context,deviceId:this.configuration().deviceId,automatic:true});this.changed();}
    return p.gate.run(async()=>{
      let snapshot,stable=0,previous='',complete=false,scrolls=0,expanded=0;
      const surface=this.surface(p),started=Date.now();
      const act=async(operation,input)=>{try{await surface.act(operation,input);return true;}catch(error){if(/观察.*失效|操作目标.*失效/.test(error.message)){await delay(150);return false;}throw error;}};
      const position=await surface.evaluate('({x:scrollX,y:scrollY})');
      try{
        for(let attempt=0;attempt<40&&Date.now()-started<42000;attempt++){
          if(p.gate.mode!=='agent')throw failure('页面已由用户接管','BROWSER_WAITING');
          snapshot=await this.read(p);
          if(snapshot.access?.kind&&snapshot.access.kind!=='article'){
            if(attempt<4&&['BROWSER_REQUIRED'].includes(snapshot.access.code)){await delay(700);continue;}
            throw failure(snapshot.access.reason,snapshot.access.code);
          }
          if(s.source&&canonicalCaptureURL(snapshot.url)!==canonicalCaptureURL(s.source))throw failure('页面来源已变化，请恢复原来源页面后继续','BROWSER_SOURCE_CHANGED');
          const observation=await surface.observe();
          const expand=observation.elements.find(e=>/^(?:展开全文|展开剩余全文|阅读全文|继续阅读|read more|show more|expand)$/i.test(e.name));
          if(expand&&expanded<5){if(await act('click',{observationId:observation.observationId,elementId:expand.id}))expanded++;await delay(500);continue;}
          const metrics=await surface.evaluate(`(()=>{const e=${JSON.stringify('#js_content,#content_views,#article-body,.article-viewer.markdown-body,.article-body,.article__body,.article-content,.Post-RichText,article.markdown-body,main#content,article,main,[role=main]')}.split(',').map(s=>document.querySelector(s)).find(Boolean)||document.body;return {y:scrollY,height:innerHeight,bottom:Math.min(Math.max(document.body.scrollHeight,document.documentElement.scrollHeight),e.getBoundingClientRect().bottom+scrollY)};})()`);
          const fingerprint=snapshot.text.length+':'+snapshot.images.map(i=>i.url).join('|')+':'+metrics.bottom;
          stable=fingerprint===previous?stable+1:0;previous=fingerprint;
          if(metrics.y+metrics.height>=metrics.bottom-4&&stable>=2){complete=true;break;}
          if(await act('scroll',{observationId:observation.observationId,y:Math.min(1600,Math.max(500,metrics.height-100))}))scrolls++;await delay(400);
        }
      }finally{if(p.gate.mode==='agent')await surface.evaluate(`scrollTo({left:${Number(position.x)||0},top:${Number(position.y)||0},behavior:'instant'})`).catch(()=>{});}
      if(!snapshot||snapshot.access?.code)throw failure(snapshot?.access?.reason||'页面正文未加载','BROWSER_REQUIRED');
      return {...snapshot,acquisition:{complete,scrolls,expanded,durationMs:Date.now()-started}};
    });
  }
  async asset(p,url,svgBytes){
    captureURL(url);if(!p.assetURLs?.has(url))throw failure('图片不属于当前页面正文','BROWSER_SCOPE');
    let bytes,mime;
    if(svgBytes){bytes=Buffer.from(svgBytes,'base64');if(bytes.length>16*1024*1024||!/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(bytes.toString('utf8')))throw failure('SVG 内容无效','IMAGE_FORMAT');mime='image/svg+xml';}
    else{
      const fetcher=p.view?.webContents.session?.fetch?.bind(p.view.webContents.session)||fetch;
      const response=await fetcher(url,{headers:{Referer:p.url},signal:AbortSignal.timeout(15000)});if(!response.ok)throw failure('配图返回 HTTP '+response.status,'IMAGE_ACCESS');
      const parts=[];let size=0;for await(const b of response.body){size+=b.length;if(size>16*1024*1024)throw failure('图片超过 16 MiB','IMAGE_LIMIT');parts.push(Buffer.from(b));}
      bytes=Buffer.concat(parts);mime=(response.headers.get('content-type')||'').split(';')[0].trim();
    }
    if(mime!=='image/svg+xml')return {mime,bytes:bytes.toString('base64')};
    const svg=bytes.toString('utf8');
    // SVG originals stay local. A passive image decoder produces the PNG
    // attached to the reading result; SVG markup is never inserted as DOM.
    const png=await this.window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const image=new Image();const timer=setTimeout(()=>reject(Error('SVG 渲染超时')),10000);image.onload=()=>{clearTimeout(timer);try{const canvas=document.createElement('canvas'),scale=Math.min(1,2048/Math.max(image.naturalWidth||300,image.naturalHeight||150));canvas.width=Math.max(1,Math.round((image.naturalWidth||300)*scale));canvas.height=Math.max(1,Math.round((image.naturalHeight||150)*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/png').split(',')[1]);}catch(e){reject(e);}};image.onerror=()=>{clearTimeout(timer);reject(Error('SVG 无法渲染'));};image.src=${JSON.stringify('data:image/svg+xml;base64,'+bytes.toString('base64'))};})`);
    return {mime:'image/png',bytes:png,original:bytes.toString('base64')};
  }
  async action(sessionId,operation,input={}){
    const s=this.sessions.get(sessionId);if(!s)throw failure('采集连接已失效','BROWSER_DISCONNECTED');
    if(operation==='acquire'){try{return await this.acquire(s,input);}catch(error){if(s.pageId&&['SOURCE_CHALLENGE','SOURCE_LOGIN'].includes(error.code)){const p=this.page(s.pageId);p.controlReason=error.message;if(s.automatic&&s.requestedSource){s.source=s.requestedSource;const file=path.join(this.root,sessionId,'task.json');if(fs.existsSync(file)){const saved=JSON.parse(fs.readFileSync(file,'utf8'));saved.context.source=s.requestedSource;atomicJson(file,saved);}}await this.take(p.id);}throw error;}}
    if(!s.pageId)throw failure('请先打开当前任务来源','BROWSER_NOT_OPEN');
    const p=this.page(s.pageId);if(p.taskId!==s.taskId)throw failure('此页面已绑定其他任务','BROWSER_SCOPE');
    return p.gate.run(async()=>{
      const actual=p.external?(await p.external.evaluate('({url:location.href})')).url:p.view.webContents.getURL();
      if(s.source&&canonicalCaptureURL(actual)!==canonicalCaptureURL(s.source))throw failure('页面来源已变化，请恢复原来源页面后继续','BROWSER_SOURCE_CHANGED');
      if(operation==='asset')return this.asset(p,input.url,input.svg);
      if(operation==='observe'){const observation=await this.surface(p).observe(),snapshot=await this.read(p);if(snapshot.url!==observation.url)throw failure('页面已变化，请重新观察','BROWSER_STALE');return {...snapshot,html:undefined,markdown:undefined,...observation};}
      if(['scroll','click'].includes(operation)&&input.observationId)return this.surface(p).act(operation,input);
      if(!p.external&&s.source&&canonicalCaptureURL(p.view.webContents.getURL())!==canonicalCaptureURL(s.source))throw Error('页面来源已变化，请恢复原来源页面后继续');
      if(p.external){const meta=await p.external.evaluate('({url:location.href})');if(s.source&&canonicalCaptureURL(meta.url)!==canonicalCaptureURL(s.source)){p.error='页面来源已变化';void this.take(p.id);throw Error('页面来源已变化，请恢复原来源页面后继续');}if(operation==='observe'){const observation=await p.external.observe(),snapshot=await this.read(p);if(snapshot.url!==observation.url){p.external.invalidate();throw Error('页面已变化，请重新观察');}return {...snapshot,...observation};}if(['scroll','click'].includes(operation))return p.external.act(operation,input);}
      if(operation==='snapshot'){const snapshot=await this.read(p);if(s.source&&canonicalCaptureURL(snapshot.url)!==canonicalCaptureURL(s.source))throw Error('页面来源已变化，请恢复原来源页面后继续');return snapshot;}
      if(p.external)throw Error('不支持的页面操作');
      if(operation==='scroll'){const y=Math.max(-2000,Math.min(2000,Number(input.y)||0));return p.external?p.external.evaluate(`window.scrollBy(0,${y})`):p.view.webContents.executeJavaScript(`window.scrollBy(0,${y})`);}
      if(operation==='click'){
        if(typeof input.selector!=='string'||input.selector.length>500)throw Error('页面操作目标无效');
        const script=`(()=>{const e=document.querySelector(${JSON.stringify(input.selector)});if(!e||e.closest('form')||e.matches('input,textarea,[contenteditable=true]'))throw Error('无法操作此元素');e.click();return true;})()`;
        return p.external?p.external.evaluate(script):p.view.webContents.executeJavaScript(script);
      }
      throw Error('不支持的页面操作');
    });
  }
  async createTask(input){
    const config=this.configuration();if(!config.deviceId)throw Error('请先连接本机工作节点');
    if(!input||input.sessionId&&!/^[-a-f0-9]{36}$/i.test(input.sessionId))throw Error('采集会话无效');
    const sessionId=input.sessionId??this.submissions.get(input.submissionId)??randomUUID(),folder=path.join(this.root,sessionId);this.submissions.set(input.submissionId,sessionId);let context,manifest,p;
    if(input.fileSession){manifest=JSON.parse(fs.readFileSync(path.join(folder,'input.json'),'utf8'));context=validateCaptureContext({version:1,sessionId,kind:'file',title:manifest.name});}
    else{p=this.page(input.id);context=validateCaptureContext({version:1,sessionId,kind:'page',title:p.title,source:p.url});fs.mkdirSync(folder,{recursive:true});const snapshot=await this.read(p);atomicJson(path.join(folder,'snapshot.json'),snapshot);}
    await this.ready;const token=randomBytes(32).toString('hex');
    const descriptor={version:1,sessionId,endpoint:'http://127.0.0.1:'+this.http.address().port,token};
    atomicJson(path.join(folder,'connection.json'),descriptor);fs.chmodSync(path.join(folder,'connection.json'),0o600);
    const settings={autoArchive:input.autoArchive===true};atomicJson(this.preference,settings);this.autoArchive=settings.autoArchive;
    atomicJson(path.join(folder,'binding.json'),{context,submissionId:input.submissionId,deviceId:config.deviceId,external:!!p?.external});
    const task=await this.owner.createTask({content:context.kind==='page'?context.source:'采集本地文件：'+context.title,scenario:input.instructions??'',submissionId:input.submissionId,autoArchive:this.autoArchive,tags:[],deviceId:config.deviceId,agent:input.agent??'',capture:context});
    if(task.capture&&task.capture.sessionId!==sessionId)throw Error('采集会话不匹配');task.capture=context;
    if(p){this.sessions.set(sessionId,{pageId:p.id,token,taskId:task.id,source:context.source});p.taskId=task.id;p.gate.resume();}
    atomicJson(path.join(folder,'task.json'),{taskId:task.id,context,submissionId:input.submissionId,deviceId:config.deviceId,external:!!p?.external});this.changed();return task;
  }
  async recover(taskId){
    const live=[...this.pages.values()].find(p=>p.taskId===taskId);if(live){this.selected=live.id;this.render();this.changed();return this.snapshot();}
    const original=(await this.owner.state()).tasks.find(t=>t.id===taskId),task=localCaptureTask(original,this.dataDir,this.configuration().deviceId),context=validateCaptureContext(task?.capture);
    if(!context||task.preferredDeviceId!==this.configuration().deviceId)throw Error('请在原采集节点恢复任务');
    const existing=[...this.pages.values()].find(p=>p.taskId===taskId);if(existing){this.selected=existing.id;this.render();return this.snapshot();}
    if(context.kind==='file')throw Error('本地文件保留在原任务目录，请从任务中心继续');
    let saved;try{saved=JSON.parse(fs.readFileSync(path.join(this.root,context.sessionId,'task.json'),'utf8'));}catch{}
    let p;if(saved?.external){const id=randomUUID();p={id,url:context.source,title:context.title,taskId,gate:new CaptureGate(),external:{close(){},invalidate(){},evaluate(){throw Error('浏览器连接已断开');}},error:'浏览器连接已断开'};this.pages.set(id,p);this.selected=id;this.render();}else{await this.add(context.source);p=this.page(this.selected);p.taskId=taskId;}await this.ready;
    const token=randomBytes(32).toString('hex'),folder=path.join(this.root,context.sessionId);
    atomicJson(path.join(folder,'connection.json'),{version:1,sessionId:context.sessionId,endpoint:'http://127.0.0.1:'+this.http.address().port,token});fs.chmodSync(path.join(folder,'connection.json'),0o600);
    this.sessions.set(context.sessionId,{pageId:p.id,token,taskId,source:context.source});this.changed();return this.snapshot();
  }
  async chooseFile(){const result=await this.dialog.showOpenDialog(this.window,{properties:['openFile'],title:'选择采集文件'});if(result.canceled)return null;const file=result.filePaths[0],stat=fs.statSync(file);if(!stat.isFile())throw Error('请选择文件');const sessionId=randomUUID(),folder=path.join(this.root,sessionId);fs.mkdirSync(folder,{recursive:true});const name=path.basename(file);fs.copyFileSync(file,path.join(folder,'input'+path.extname(name)));const manifest={name,relative:'input'+path.extname(name),bytes:stat.size,selectedAt:new Date().toISOString()};atomicJson(path.join(folder,'input.json'),manifest);return {sessionId,...manifest};}
  async handle(req,res){
    const fail=(status,message,code='BROWSER_ERROR')=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error:message,code}));};
    if(req.url?.startsWith('/browser-extension/'))return this.extension.handle(req,res);
    try{
      if(req.method!=='POST'||req.headers.origin||!/^127\.0\.0\.1:\d+$/.test(req.headers.host??''))return fail(403,'采集连接拒绝请求','BROWSER_SCOPE');
      const bind=req.url==='/tasks/bind',match=req.url.match(/^\/sessions\/([-a-f0-9]{36})\/(snapshot|observe|scroll|click|acquire|asset)$/);
      if(!bind&&!match)return fail(404,'采集连接不存在','BROWSER_DISCONNECTED');
      const s=bind?{token:this.bridgeToken}:this.sessions.get(match[1]),token=Buffer.from(req.headers.authorization?.replace(/^Bearer /,'')??'');
      if(!s||token.length!==s.token.length||!timingSafeEqual(token,Buffer.from(s.token)))return fail(403,'采集连接已失效','BROWSER_DISCONNECTED');
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>(match?.[2]==='asset'?23*1024*1024:32768))throw Error('请求过大');}
      const input=raw?JSON.parse(raw):{};if(bind)await this.syncScope();
      const result=bind?await this.registerTask(input):await this.action(match[1],match[2],input);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result??{ok:true}));
    }catch(error){fail(409,error.message,error.code||(/已失效|已变化/.test(error.message)?'BROWSER_STALE':'BROWSER_ERROR'));}
  }
  async reset(){this.extension.reset();for(const p of [...this.pages.values()])await this.close(p.id);this.sessions.clear();this.submissions.clear();}
  dispose(){this.extension.dispose();void this.reset().catch(()=>{});this.http.close();}
}
