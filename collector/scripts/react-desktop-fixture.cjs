// Packaged React client + real disposable REST services; no renderer/preload stubs.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {_electron}=require('playwright');
exports.until=async(fn,label,timeout=45000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw Error('Timed out: '+label);};
// Distinct page content makes the raster-change assertion meaningful.
function pageFixture(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 3 /Kids [3 0 R 5 0 R 7 0 R] >>'];
 for(let page=1;page<=3;page++){const content=`0.15 0.15 0.15 rg 30 40 ${70*page} 50 re f BT /F1 22 Tf 30 400 Td (Windows CI PDF - Page ${page}) Tj ET`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 380 468] /Resources << /Font << /F1 9 0 R >> >> /Contents ${objects.length+2} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);}
 objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);
}
exports.create=async(executable)=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'inspirainest-formal-settings-ci-'));
 const pdfFile=path.join(root,'itinerary.pdf');fs.writeFileSync(pdfFile,pageFixture());
 const output=path.resolve(__dirname,'../test-output/react-desktop');fs.mkdirSync(output,{recursive:true});
 const {createService}=await import('../src/server.mjs'),{api}=await import('../src/worker.mjs'),{WorkerManager}=await import('../desktop/manager.mjs');
 const {AGENT_CATALOG}=await import('../src/agent-catalog.mjs');const {zip,files}=await import('../test/fixtures/skill-market.mjs');
 const services=[],targets={},runners=[],checks=[],errors=[];let app,page,compact,timer;let ticking=false;
 const market={slug:'fixture-market',name:'市场示例',description:'隔离服务中的完整技能包',version:'1.0.0',source:'community',owner:'Fixture'};
 const skillHub={request:async input=>input.kind==='categories'?{items:[{key:'research',name:'资料整理'}]}:input.kind==='detail'?{item:market}:{page:1,pageSize:20,total:1,items:[market]}};
 try{
  for(const label of ['A','B']){
   const key=crypto.randomUUID();const service=createService({dataDir:path.join(root,'service-'+label),masterKey:key,skillHub,
    skillMarketFetch:async url=>url.startsWith('https://api.skillhub.cn/')?new Response('',{status:302,headers:{location:'https://skillhub-1388575217.cos.accelerate.myqcloud.com/skills/fixture-market/1.0.0.zip'}}):new Response(zip(files)),
    agentCatalog:{release:async id=>({package:AGENT_CATALOG.find(x=>x.id===id).package,version:'1.1.0',tarball:'https://registry.npmjs.org/'+AGENT_CATALOG.find(x=>x.id===id).package+'/-/'+AGENT_CATALOG.find(x=>x.id===id).package.split('/').at(-1)+'-1.1.0.tgz',integrity:'sha512-'+Buffer.alloc(64).toString('base64')})}});
   await new Promise(r=>service.server.listen(0,'127.0.0.1',r));services.push(service);
   const server='http://127.0.0.1:'+service.server.address().port;
   const owner={server,...await api({server},'/api/pair','POST',{key,name:'CI initializer '+label})};targets[label]={server,key,owner,service};
   if(label==='A'){
    await require('../desktop/frontend/scripts/library-qa-fixtures.cjs').seedLibrary((config,route,method,body)=>api({...config,token:owner.token},route,method,body),server,service.store);
    const pair=await api(owner,'/api/pairings','POST',{role:'worker'}),worker={server,...await api({server},'/api/pair','POST',{key:pair.key,name:'CI 远端节点',platform:'win32'})};worker.deviceId=worker.device.id;
    const probes=AGENT_CATALOG.map(d=>({id:d.id,installed:d.id==='codex',version:d.id==='codex'?'1.0.0':null,probeState:d.id==='codex'?'available':'not_found',source:'npm',originalSupported:d.id==='codex',custom:false,fingerprint:crypto.createHash('sha256').update('ci:'+d.id).digest('hex')}));
    const agent=await require('../desktop/frontend/scripts/agent-runtime-fixture.cjs').create({profile:root,configuration:worker,probes,api:(...args)=>api(worker,...args)});
    const skill=await require('../desktop/frontend/scripts/skill-runtime-fixture.cjs').create({profile:root,configuration:worker,api});runners.push(agent,skill);
    await api(worker,'/api/agents/environment','POST',{schemaVersion:1,platform:'win32',arch:'x64',agents:probes});
    targets.A.worker=worker;targets.A.agent=agent;targets.A.skill=skill;
    const heartbeat=()=>api(worker,'/api/heartbeat','POST',{capabilities:['article','note','webpage'],agents:['codex','codebuddy'],agentRuntime:{schemaVersion:1,busy:agent.busy},clientRuntime:{schemaVersion:1,version:'0.1.29',platform:'win32',arch:'x64',remoteUpdate:true}});
    await heartbeat();timer=setInterval(async()=>{if(ticking)return;ticking=true;try{await heartbeat();await skill.run();}catch(e){errors.push('runtime: '+e.message);}finally{ticking=false;}},1000);
   }
  }
  // A dedicated archive exercises registered links through production preview IPC.
  const assets=path.resolve(__dirname,'../desktop/frontend/src/records/fixtures');
  const archiveFiles=[['notes/summary.md','summary',Buffer.from('# 正文链接验证\n\n图片前的描述\n\n![引用图片](../images/引用%20图片.jpg)\n\n图片后的描述\n\n[阅读 PDF](../files/路线.pdf) · [查看文本](../files/笔记.txt) · [播放视频](../media/路线.mp4)\n\n[未登记文件](../missing.txt)')],['images/引用 图片.jpg','image',fs.readFileSync(path.join(assets,'lake-original.jpg'))],['files/路线.pdf','document',fs.readFileSync(pdfFile)],['files/笔记.txt','document',Buffer.from('正文链接中的 UTF-8 附件内容')],['media/路线.mp4','document',fs.readFileSync(path.join(assets,'route.mp4'))]].map(([name,role,bytes])=>({path:name,role,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),body:bytes.toString('base64')}));
  const meta={schema_version:1,id:'ci-body-links',title:'正文链接验证',summary:'真实归档附件预览',type:'article',status:'archived',verification_status:'source_only',coverage_note:'Disposable CI archive',mode:'general',scenario:null,tags:['CI'],aliases:[],related:[],published_at:null,collected_at:new Date().toISOString(),organized_at:new Date().toISOString(),verified_at:null,source_url:'https://example.com',canonical_url:null,files:archiveFiles.map(({path,role})=>({path,role}))};
  await api(targets.A.owner,'/api/archives','POST',{version:1,meta,files:archiveFiles,omitted:[]});
  const config=path.join(root,'worker.json');fs.writeFileSync(config,JSON.stringify({dataDir:path.join(root,'worker'),pollMs:200,capabilities:['article'],agents:{codex:{command:process.execPath,args:[path.resolve(__dirname,'../test/fixtures/fake-agent.mjs')],versionArgs:[path.resolve(__dirname,'../test/fixtures/fake-agent.mjs'),'--version']}}}));
  const manager=new WorkerManager(config,process.execPath);
  const env={...process.env,COLLECTOR_CONFIG:config,COLLECTOR_DESKTOP_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.COLLECTOR_DESKTOP_STORAGE_FIXTURE;delete env.COLLECTOR_DESKTOP_FRONTEND_QA_FILE;delete env.COLLECTOR_DESKTOP_FRONTEND_QA_ROUTE;
  async function launch(extra=[]){
   app=await _electron.launch({executablePath:path.resolve(executable),args:['--use-fake-device-for-media-stream',...extra],env});
   await exports.until(()=>{page=app.windows().find(p=>p.url().startsWith('file:')&&!p.url().includes('#/status'));compact=app.windows().find(p=>p.url().includes('#/status'));return page&&compact;},'React main and status windows');
   page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));compact.on('pageerror',e=>errors.push(e.message));
   await page.getByRole('navigation',{name:'主导航'}).waitFor();
   const prefs=await app.evaluate(()=>globalThis.workerDesktop().main.webContents.getLastWebPreferences());assert.equal(prefs.sandbox,true);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.nodeIntegration,false);
   assert.match(page.url(),/frontend\/dist\/index\.html.*#\/records\?data=local/);assert.equal(await app.evaluate(({app})=>app.isPackaged),true);
   return page;
  }
  async function close(){if(app){try{await app.evaluate(({app})=>app.quit());}catch{}await app.close().catch(()=>{});app=null;}}
  async function nav(label){await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:label,exact:true}).click();}
  async function settings(label){await nav('设置');await page.locator('[data-region="列表区"]').getByRole('button',{name:label,exact:true}).click();if(label==='账号'){await page.locator('[data-region=账号内容]').getByRole('button',{name:/^(登录|退出登录)$/}).waitFor();await exports.until(()=>page.locator('[data-region=账号内容]').getByRole('button',{name:/^(登录|退出登录)$/}).isEnabled(),'account read completed');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}}
  async function login(label,key=targets[label].key){await settings('账号');await page.getByLabel('资料库地址',{exact:true}).fill(targets[label].server);await page.getByLabel('设备名称',{exact:true}).fill('CI 桌面 '+label);await page.getByLabel('登录密码或配对码',{exact:true}).fill(key);assert.equal(await page.getByLabel('资料库地址',{exact:true}).inputValue(),targets[label].server);assert.equal(await page.getByLabel('设备名称',{exact:true}).inputValue(),'CI 桌面 '+label);await page.getByRole('button',{name:'登录',exact:true}).click();if(key===targets[label].key)await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();}
  async function logout(){await settings('账号');await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('dialog',{name:'退出登录',exact:true}).getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('button',{name:'登录',exact:true}).waitFor();}
  async function setupMfa(){
   const target=targets.A,key='  Windows CI MFA password  ';await api(target.owner,'/api/security/credential','POST',{key:target.key,newKey:key,confirmKey:key});
   const setup=await api(target.owner,'/api/security/totp/setup','POST',{key});const {TOTP}=await import('otpauth');const totp=new TOTP({issuer:'InspiraiNest',label:'Windows CI',secret:setup.secret,algorithm:'SHA1',digits:6,period:30});
   const confirmed=await api(target.owner,'/api/security/totp/confirm','POST',{key,otp:totp.generate()});return {key,totp,recoveryCode:confirmed.recoveryCodes[0]};
  }
  async function shot(name){await page.screenshot({path:path.join(output,name+'.png')});}
  async function check(name,fn){console.log('React desktop:',name);await fn();checks.push(name);fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify({checks,errors},null,2));}
  return {root,output,config,pdfFile,manager,targets,checks,errors,api,launch,close,nav,settings,login,logout,setupMfa,shot,check,get app(){return app;},get page(){return page;},get compact(){return compact;},async dispose(){clearInterval(timer);for(const r of runners)r.close();if(manager.snapshot().managed){await manager.control('drain');await exports.until(()=>!manager.snapshot().running,'fixture Worker shutdown');}await close();for(const s of services)await s.close();fs.rmSync(root,{recursive:true,force:true});}};
 }catch(error){clearInterval(timer);for(const r of runners)r.close();if(app)await app.close().catch(()=>{});for(const s of services)await s.close();throw error;}
};
