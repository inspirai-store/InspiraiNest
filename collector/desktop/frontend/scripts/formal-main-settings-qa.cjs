// Actual desktop main/preload with disposable appData and an immutable frontend.
const {app,Menu,MenuItem}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');const {fileURLToPath}=require('node:url');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'inspirainest-formal-settings-'));
const appData=path.join(profile,'app-data');fs.mkdirSync(appData);
app.setPath('appData',appData);
const build=path.join(profile,'frontend');fs.cpSync(path.resolve(__dirname,'../dist'),build,{recursive:true});
const index=path.join(build,'index.html'),hash=crypto.createHash('sha256').update(fs.readFileSync(index)).digest('hex');
const config=path.join(profile,'worker.json');fs.writeFileSync(config,JSON.stringify({dataDir:path.join(profile,'worker')}));
process.env.COLLECTOR_CONFIG=config;
process.env.COLLECTOR_DESKTOP_TEST='1';
if(process.env.FORMAL_REPLACEMENT_QA==='3')delete process.env.COLLECTOR_DESKTOP_FRONTEND_QA_FILE;else process.env.COLLECTOR_DESKTOP_FRONTEND_QA_FILE=index;
process.env.COLLECTOR_DESKTOP_TRACE=path.join(profile,'trace.jsonl');
const evidence=path.resolve(__dirname,'../../../../design-review/desktop-refactor/'+(process.env.FORMAL_REPLACEMENT_QA==='3'?'ui-replacement-v3':process.env.FORMAL_REPLACEMENT_QA==='2'?'ui-replacement-v2':process.env.FORMAL_REPLACEMENT_QA==='1'?'ui-replacement-v1':process.env.FORMAL_UPDATES_QA==='1'?'stage-06-updates-v1':process.env.FORMAL_SKILLS_QA==='1'?'stage-06-skills-v1':process.env.FORMAL_AGENTS_QA==='1'?'stage-06-agents-v1':process.env.FORMAL_NODES_QA==='1'?'stage-06-nodes-v1':'stage-06-settings-v1')+'/evidence');
fs.mkdirSync(evidence,{recursive:true});
const readPreferences=()=>{try{return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'desktop-settings.json')));}catch{return null;}};
const services=[],agentRunners=[],skillRunners=[],taskControls=[];let localWorker;
const releaseDir=path.join(profile,'releases');
if(['2','3'].includes(process.env.FORMAL_REPLACEMENT_QA)){
 fs.mkdirSync(releaseDir);const bytes=Buffer.from('Disposable QA manifest fixture, never installed');const filename='InspiraiNest-v0.2.0-Windows-x64.exe';
 fs.writeFileSync(path.join(releaseDir,filename),bytes);fs.writeFileSync(path.join(releaseDir,'worker-release.json'),JSON.stringify({windows_x64:{version:'0.2.0',filename,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}}));
}
app.on('will-quit',()=>{
 const trace=fs.existsSync(process.env.COLLECTOR_DESKTOP_TRACE)?fs.readFileSync(process.env.COLLECTOR_DESKTOP_TRACE,'utf8'):'';
 fs.writeFileSync(path.join(evidence,'formal-main-lifecycle-final.json'),JSON.stringify({build:hash,preferences:readPreferences(),trace:trace.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)),scope:'Actual desktop/main.mjs and native preload; isolated appData; no production identity or running user worker'},null,2));
});
app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
(async()=>{
 if(process.env.FORMAL_ACCOUNT_QA==='1'||process.env.FORMAL_NODES_QA==='1'||process.env.FORMAL_AGENTS_QA==='1'){
  const {createService}=await import('../../../src/server.mjs');
  const {secret,hash:pairingHash}=await import('../../../src/common.mjs');
  const {api}=await import('../../../src/worker.mjs');
  const origins={};
  for(const label of ['A','B']){
   const definitions=(await import('../../../src/agent-catalog.mjs')).AGENT_CATALOG;
   const agentCatalog=process.env.FORMAL_AGENTS_QA==='1'?{release:async id=>{const definition=definitions.find(agent=>agent.id===id),version=id==='codex'?'1.1.0':id==='codebuddy'?'2.1.0':'1.0.0';return {package:definition.package,version,tarball:'https://registry.npmjs.org/'+definition.package+'/-/'+definition.package.split('/').at(-1)+'-'+version+'.tgz',integrity:'sha512-'+Buffer.alloc(64).toString('base64')};}}:undefined;
   const key=secret(),service=createService({dataDir:path.join(profile,'service-'+label),masterKey:key,...(['2','3'].includes(process.env.FORMAL_REPLACEMENT_QA)?{releaseDir}:{}),...(agentCatalog?{agentCatalog}:{})});
   await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));services.push(service);
   const server='http://127.0.0.1:'+service.server.address().port;origins[label]=server;
   const initialized=await api({server},'/api/pair','POST',{key,name:'Formal QA initializer '+label});
   if((process.env.FORMAL_NODES_QA==='1'||process.env.FORMAL_AGENTS_QA==='1')&&label==='A'){
    for(const [name,online,agents] of [['工作电脑',true,['codex','codebuddy']],['家庭电脑',false,['codex']]]){
     const enrolled=await api({server},'/api/pair','POST',{key,name,clientType:'worker',platform:'win32',system:'Windows 11',deviceInfo:{os:{family:'Windows',version:'11'},client:{type:'worker',name:'灵藏',version:'0.1.25'}}});
     const configuration={server,token:enrolled.token,deviceId:enrolled.device.id};let fixtureRunner=null;
     const heartbeat=()=>api(configuration,'/api/heartbeat','POST',{capabilities:['article','webpage','video','note'],agents,...(process.env.FORMAL_AGENTS_QA==='1'?{agentRuntime:{schemaVersion:1,busy:fixtureRunner?.busy??false}}:{}),clientRuntime:{schemaVersion:1,version:'0.1.25',platform:'win32',arch:'x64',remoteUpdate:true}});
     await heartbeat();
     if(['2','3'].includes(process.env.FORMAL_REPLACEMENT_QA))await api(configuration,'/api/client-updates/runtime','POST',{schemaVersion:1,version:'0.1.25',platform:'win32',arch:'x64',remoteUpdate:true});
     if(online&&process.env.FORMAL_SKILLS_RUNTIME_QA==='1')skillRunners.push(await require('./skill-runtime-fixture.cjs').create({profile,configuration,api}));
     if(process.env.FORMAL_SKILLS_QA==='1'&&!(online&&process.env.FORMAL_SKILLS_RUNTIME_QA==='1'))await require('./skills-inventory-fixture.cjs').seed({profile,configuration,api});
     if(process.env.FORMAL_AGENTS_QA==='1'){
      const probes=definitions.map(definition=>({id:definition.id,installed:['codex','codebuddy'].includes(definition.id),version:definition.id==='codex'?'1.0.0':definition.id==='codebuddy'?'2.0.0':null,probeState:['codex','codebuddy'].includes(definition.id)?'available':'not_found',source:'npm',originalSupported:definition.id==='codex',custom:false,fingerprint:pairingHash(name+':'+definition.id+':initial')}));
      await api(configuration,'/api/agents/environment','POST',{schemaVersion:1,platform:'win32',arch:'x64',agents:probes});
      if(online){fixtureRunner=await require('./agent-runtime-fixture.cjs').create({profile,configuration,probes,api:(...args)=>api(configuration,...args)});agentRunners.push(fixtureRunner);}
     }
     if(online){const timer=setInterval(()=>void heartbeat().catch(()=>{}),10000);app.on('will-quit',()=>clearInterval(timer));}
     else{const record=await service.store.get('device',enrolled.device.id);await service.store.put('device',{...record,lastHeartbeatAt:new Date(Date.now()-120000).toISOString()});}
    }
   }
   await require('./library-qa-fixtures.cjs').seedLibrary((configuration,route,method,body)=>api({...configuration,token:initialized.token},route,method,route==='/api/archives'&&method==='POST'?{...body,meta:{...body.meta,title:'空间 '+label+' · '+body.meta.title}}:body),server,service.store);
   if(process.env.FORMAL_REPLACEMENT_QA==='3'&&label==='A')taskControls.push(await require('./tasks-qa-fixtures.cjs').seedTasks(service.store,{api,server,ownerToken:initialized.token,evidenceDir:evidence}));
   if(process.env.FORMAL_REPLACEMENT_QA==='3'&&label==='A'&&skillRunners[0]){
    const runner=skillRunners[0],{packageSkill}=await import('../../../src/skill-package.mjs');const bundle=packageSkill(runner.directory),configuration={server,token:initialized.token};
    const preview=await api(configuration,'/api/skills/operations','POST',{deviceId:runner.deviceId,action:'prepare-publish',skillId:runner.skillId,expectedHash:bundle.hash,requestId:crypto.randomUUID()});await runner.run();
    await api(configuration,'/api/skills/operations','POST',{deviceId:runner.deviceId,action:'publish',skillId:runner.skillId,expectedHash:bundle.hash,previewId:preview.id,policy:{agents:['codex'],systems:['darwin','win32','linux'],capabilities:[],requirements:{commands:[],env:[],mcp:[],pythonModules:[],browser:false}},requestId:crypto.randomUUID()});await runner.run();
   }
   const creator=(await service.store.list('device')).find(d=>d.role==='owner'&&!d.revokedAt);
   await service.store.put('pairing',{id:pairingHash('desktop-formal-qa-login'),creatorId:creator.id,expiresAt:new Date(Date.now()+15*60*1000).toISOString(),usedAt:null});
  }
  fs.writeFileSync(path.join(profile,'account-services.json'),JSON.stringify(origins));
  app.on('will-quit',()=>{for(const runner of [...agentRunners,...skillRunners,...taskControls])runner.close();for(const service of services)void service.close();});
 }
 await import('../../../desktop/main.mjs');await app.whenReady();
 const deadline=Date.now()+10000;
 while(!globalThis.workerDesktop?.().main&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
 const main=globalThis.workerDesktop?.().main;if(!main)throw Error('Formal main window missing');
 if(process.env.FORMAL_REPLACEMENT_QA==='3')main.setTitle('灵藏 · UI 回归');
 main.setContentSize(1240,820);
 const capture=async(window=main)=>{
  const htmlFile=fileURLToPath(window.webContents.getURL());const html=fs.readFileSync(htmlFile,'utf8');const currentHash=crypto.createHash('sha256').update(html).digest('hex');
  const loaded=await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('script[src],link[rel=stylesheet]')).map(e=>e.src||e.href)`);
  const declared=[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map(match=>new URL(match[1],window.webContents.getURL()).href);if(!declared.every(url=>loaded.includes(url)))throw Error('Loaded assets differ from current build; reload before capture');
  await window.webContents.executeJavaScript('document.fonts.ready');
  const audit=await require('./tasks-layout-audit.cjs').read(window,currentHash);
  const moduleContent=await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-region="内容区"] > div, [data-region="托盘状态"], [data-overlay]')).map(e=>({region:e.dataset.region||e.dataset.overlay,text:e.innerText,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}))`);
  const controls=await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=radio],input[type=checkbox]')).map(e=>({text:e.textContent,checked:e.checked??e.getAttribute('aria-checked'),disabled:e.matches(':disabled')}))`);
  const prefs=window.webContents.getLastWebPreferences();
  const owner=globalThis.workerDesktop().owner,connection=owner.status();
  const savedOwner=fs.existsSync(owner.file)?JSON.parse(fs.readFileSync(owner.file)):null;
  const workerConfiguration=JSON.parse(fs.readFileSync(config));
  const authorization={exists:Boolean(savedOwner),hasEncryptedToken:Boolean(savedOwner?.encryptedToken),plainTokenAbsent:!savedOwner||!JSON.stringify(savedOwner).includes(owner.identity?.token||'"token"')};
  const prefix='client-'+Date.now();
  fs.writeFileSync(path.join(evidence,prefix+'.png'),(await window.capturePage()).toPNG({scaleFactor:2}));
  fs.writeFileSync(path.join(evidence,prefix+'.json'),JSON.stringify({...audit,windowTitle:window.getTitle(),pageURL:window.webContents.getURL(),entryMode:process.env.FORMAL_REPLACEMENT_QA==='3'?(path.dirname(htmlFile)===path.resolve(__dirname,'../dist')?'default-built-frontend':'isolated-build-copy'):'QA-override',moduleContent,controls,settings:readPreferences(),connection,authorization,workerIdentity:{server:workerConfiguration.server,deviceId:workerConfiguration.deviceId,installationId:workerConfiguration.installationId},nativeSecurity:{sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration,preload:path.basename(prefs.preload||prefs.preloadURL||''),lastWebPreferences:prefs},scope:'Actual desktop main and preload; production IPC and safeStorage; default frontend entry; disposable appData'},null,2));
  fs.writeFileSync(path.join(evidence,'latest-client-capture.json'),JSON.stringify({prefix,build:currentHash}));
  console.log('Formal capture saved',prefix);
 };
 const menu=Menu.getApplicationMenu();menu.append(new MenuItem({label:'Formal Settings QA',submenu:[{label:'保存正式客户端截图',accelerator:'CmdOrCtrl+Alt+Shift+S',click:()=>void capture(main)},...[1240,900,740].map((width,index)=>({label:width+'px',accelerator:'CmdOrCtrl+Alt+Shift+'+(index+1),click:()=>main.setContentSize(width,width===1240?820:740)}))]}));Menu.setApplicationMenu(menu);
 if(['2','3'].includes(process.env.FORMAL_REPLACEMENT_QA)){
  const {createWorkerEvents}=await import('../../../src/worker-events.mjs');const dataDir=path.join(profile,'worker'),journal=path.join(dataDir,'worker-events.jsonl');fs.mkdirSync(dataDir,{recursive:true});
  const seed=()=>{if(fs.existsSync(journal)&&fs.lstatSync(journal).isSymbolicLink())fs.unlinkSync(journal);const token=JSON.parse(fs.readFileSync(config)).token;const writer=createWorkerEvents(dataDir,{token});for(const id of ['qa-web-archive','qa-reading-notes']){const dir=path.join(dataDir,'tasks',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'codex.log'),'任务执行输出：'+id+'\n');}writer.event({stage:'completed',taskId:'qa-web-archive',message:'网页正文与附件已归档',details:{files:3}});writer.event({stage:'awaiting_review',taskId:'qa-reading-notes',message:'阅读笔记加工完成，等待确认'});writer.fault('qa-network',{message:'同步连接中断',code:'NETWORK',details:{message:'request failed'}});writer.fault('qa-recovered',{message:'下载连接中断',taskId:'qa-web-archive'});writer.recover('qa-recovered','下载连接已恢复');fs.writeFileSync(path.join(dataDir,'worker.stdout.log'),'本机日志读取检查\n'+(token?'token='+token:'无凭据')+'\n');};
  const empty=()=>{for(const f of [journal,path.join(dataDir,'worker.stdout.log')])if(fs.existsSync(f))fs.unlinkSync(f);};
  menu.append(new MenuItem({label:'Diagnostics Runtime QA',submenu:[{label:'写入本机事件与日志',click:seed},{label:'清空隔离事件',click:empty},{label:'模拟日志路径错误',click:()=>{if(fs.existsSync(journal))fs.unlinkSync(journal);fs.symlinkSync(path.join(profile,'worker.json'),journal);}},{label:'恢复日志读取',click:seed}]}));Menu.setApplicationMenu(menu);
 }

 if(process.env.FORMAL_REPLACEMENT_QA==='3'){
  const {spawn}=require('node:child_process');const popover=globalThis.workerDesktop().popover;
  menu.append(new MenuItem({label:'Remaining UI QA',submenu:[
   {label:'重新加载当前界面',click:()=>{main.webContents.reloadIgnoringCache();popover.webContents.reloadIgnoringCache();}},
   {label:'组件展示',click:()=>void main.loadFile(path.resolve(__dirname,'../dist/index.html'),{query:{platform:process.platform},hash:'/components'})},
   {label:'打开状态小窗',click:()=>{popover.show();popover.focus();}},
   {label:'保存状态小窗截图',click:()=>void capture(popover)},
   {label:'启动隔离控制进程',click:()=>{if(localWorker&&!localWorker.killed)return;localWorker=spawn(process.execPath,[path.join(__dirname,'worker-control-fixture.mjs'),path.join(profile,'worker')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'ignore'});localWorker.once('exit',()=>{localWorker=null;});}},
   {label:'恢复任务测试数据',click:()=>void taskControls[0]?.reset('review')},
  ]}));Menu.setApplicationMenu(menu);
  app.on('will-quit',()=>{if(localWorker&&!localWorker.killed)localWorker.kill('SIGTERM');});
  const hub=globalThis.workerDesktop().skillHub;hub.request=async input=>input.kind==='categories'?{items:[{key:'research',name:'资料整理'}]}:input.kind==='detail'?{item:{slug:'web-archive',name:'网页归档',description:'保存网页正文、图片与来源信息。',version:'1.0.0',source:'community',category:'research'}}:{items:[{slug:'web-archive',name:'网页归档',description:'保存网页正文、图片与来源信息。',version:'1.0.0',source:'community',category:'research'}],total:1,page:1,pageSize:20};
 }
 if(agentRunners.length){menu.append(new MenuItem({label:'Agent Runtime QA',submenu:[{label:'开始下一操作',click:()=>void agentRunners[0].start().catch(error=>console.error('QA Agent runtime:',error.message))},{label:'完成操作／确认取消',click:()=>agentRunners[0].finish()},{label:'模拟操作失败',click:()=>agentRunners[0].fail()}]}));Menu.setApplicationMenu(menu);}
 if(skillRunners.length){menu.append(new MenuItem({label:'Skill Runtime QA',submenu:[{label:'执行技能操作',click:()=>void skillRunners[0].run().catch(error=>console.error('QA Skill runtime:',error.message))},{label:'重新上报技能',click:()=>void skillRunners[0].report().catch(error=>console.error('QA Skill report:',error.message))}]}));Menu.setApplicationMenu(menu);}
 console.log('Formal settings QA ready',hash,profile);
})().catch(error=>{console.error(error.message);app.exit(1);});
