const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron,chromium}=require('playwright');
const {showSettings}=require('./desktop-test-helpers.cjs');
(async()=>{
 const {createService}=await import('../src/server.mjs'),{api}=await import('../src/worker.mjs'),{createSkillRuntime}=await import('../src/skill-runtime.mjs'),{scanSkillInventory,globalSkillRoots}=await import('../src/skill-inventory.mjs'),{zip,files}=await import('../test/fixtures/skill-market.mjs');
 const web=process.argv.includes('--web'),root=fs.mkdtempSync(path.join(os.tmpdir(),'market-install-ui-')),key=crypto.randomUUID(),calls=[];
 const skill={slug:'fixture-market',name:'市场示例',description:'完整文件安装预览 · 隔离测试',version:'1.0.0',owner:'Fixture',downloads:1};
 const skillHub={request:async input=>input.kind==='categories'?{items:[]}:input.kind==='detail'?{item:skill}:{page:1,pageSize:20,total:1,items:[skill]}};
 const service=createService({dataDir:path.join(root,'service'),masterKey:key,skillHub,skillMarketFetch:async(url,options)=>{calls.push(url);return url.startsWith('https://api.skillhub.cn/')?new Response('',{status:302,headers:{location:'https://skillhub-1388575217.cos.accelerate.myqcloud.com/skills/fixture-market/1.0.0.zip'}}):new Response(zip(files));}});
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));const server='http://127.0.0.1:'+service.server.address().port;
 const owner={server,...await api({server},'/api/pair','POST',{key,name:'Fixture'})},pairing=await api(owner,'/api/pairings','POST',{role:'worker'});
 const target={server,...await api({server},'/api/pair','POST',{key:pairing.key,name:'测试节点',platform:process.platform})};target.deviceId=target.device.id;target.dataDir=path.join(root,'worker');
 await api(target,'/api/heartbeat','POST',{agents:['codex','codebuddy'],capabilities:['article']});
 const home=path.join(root,'home');fs.mkdirSync(home);
 const runtime=createSkillRuntime(target,{home,cwd:home,api:(...args)=>api(target,...args),scan:(config,options)=>scanSkillInventory(config,{...options,env:{...process.env,CODEX_HOME:path.join(home,'.codex')},versionProbe:async()=>({code:0,tail:'fixture 1'}),nativeCodex:async()=>null})});
 await runtime.report();let ticking=false;
 const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{const {operations}=await api(target,'/api/skills/operations');await runtime.tick({idle:true,operationIds:operations.map(o=>o.id)});}catch(e){console.error(e.message);}finally{ticking=false;}},100);
 const output=path.resolve(__dirname,'../test-output/market-install-'+(web?'web':'desktop'));fs.mkdirSync(output,{recursive:true});
 let app,page;const errors=[];
 try{
  if(web){app=await chromium.launch({channel:'chrome',headless:true});page=await app.newPage({viewport:{width:1240,height:820}});await page.goto(server);await page.locator('#login-form [name=key]').fill(key);await page.locator('#login-form button[type=submit]').click();await page.locator('#app').waitFor({state:'visible'});}
  else{
   const config=path.join(root,'worker.json');fs.writeFileSync(config,JSON.stringify({server,dataDir:path.join(root,'desktop')}));
   const env={...process.env,COLLECTOR_CONFIG:config,COLLECTOR_NODE:process.execPath,COLLECTOR_DESKTOP_TEST:'1',COLLECTOR_DESKTOP_STORAGE_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;
   const binary=process.argv[2];app=await _electron.launch({executablePath:binary||require('electron'),args:[...(binary?[]:[path.resolve(__dirname,'../desktop')]),...(process.platform==='linux'?['--no-sandbox']:[])],env});
   for(let i=0;i<150&&!page;i++){page=app.windows().find(p=>p.url().startsWith('file:')&&!p.url().includes('compact=1'));if(!page)await new Promise(r=>setTimeout(r,100));}
   await app.evaluate(()=>{globalThis.workerDesktop().skillHub.request=async input=>{const item={slug:'fixture-market',name:'市场示例',description:'完整文件安装预览 · 隔离测试',version:'1.0.0'};return input.kind==='categories'?{items:[]}:input.kind==='detail'?{item}:{total:1,page:1,pageSize:20,items:[item]};};});
   await showSettings(page,'devices');const pair=await api(owner,'/api/pairings','POST',{});await page.locator('#owner-pair [name=server]').fill(server);await page.locator('#owner-pair [name=key]').fill(pair.key);await page.locator('#owner-pair button[type=submit]').click();await page.locator('#overview-data').waitFor({state:'visible'});
  }
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  if(web){let first=true;await page.route('**/api/skills/operations',async route=>{const req=route.request();if(first&&req.method()==='POST'&&req.postDataJSON()?.action==='compare'){first=false;await route.fetch();await route.fulfill({status:504,contentType:'application/json',body:JSON.stringify({error:'模拟响应超时'})});}else await route.continue();});}
  else await app.evaluate(()=>{const owner=globalThis.workerDesktop().owner,original=owner.fetcher;let first=true;owner.fetcher=async(url,options)=>{if(first&&url.endsWith('/api/skills/operations')&&options?.method==='POST'&&JSON.parse(options.body).action==='compare'){first=false;await (await original(url,options)).arrayBuffer();return new Response(JSON.stringify({error:'模拟响应超时'}),{status:504,headers:{'content-type':'application/json'}});}return original(url,options);};});
  await page.locator('nav [data-view=skill-market]').click();await page.locator('[data-detail]').first().click();
  const dialog=page.locator('.market-dialog');
  await dialog.locator('[data-install-node] option[value="'+target.deviceId+'"]').waitFor({state:'attached'});
  await dialog.locator('[data-install-node]').selectOption(target.deviceId);await dialog.locator('[data-install-agent][value=claude]').check();await dialog.locator('[data-install-agent][value=codebuddy]').check();await dialog.locator('[data-install-agent][value=gemini]').check();await dialog.locator('[data-install-agent][value=opencode]').check();
  await dialog.locator('[data-install-compare]').click();
  await dialog.locator('[data-install-status]').filter({hasText:'模拟响应超时'}).waitFor();
  await dialog.locator('[data-install-compare]').click();
  await dialog.locator('.market-paths').waitFor();assert.match(await dialog.innerText(),/fixture-market/);
  for(const directory of Object.values(globalSkillRoots(home)))assert.ok((await dialog.innerText()).includes(path.join(directory,'fixture-market')));
  assert.equal(await dialog.locator('[data-install-submit]').isEnabled(),false);
  assert.equal((await api(owner,'/api/skills/operations?deviceId='+target.deviceId)).operations.filter(o=>o.action==='compare').length,1,'Lost response retry reuses comparison ID');
  await dialog.screenshot({path:path.join(output,'preview.png')});await dialog.locator('[data-install-confirm]').check();await dialog.locator('[data-install-submit]').click();
  await dialog.locator('[data-install-status]').filter({hasText:'在「已安装」'}).waitFor();
  for(const directory of Object.values(globalSkillRoots(home)))assert.equal(fs.existsSync(path.join(directory,'fixture-market','SKILL.md')),true);
  await dialog.locator('[data-close]').click();await page.locator('[data-market-provider=installed]').click();
  await page.locator('[data-installed-rows] tr').filter({hasText:'fixture-market'}).first().waitFor();assert.equal(await page.locator('[data-installed-rows] tr').count(),8);
  assert.match(await page.locator('[data-installed-rows]').innerText(),/已配置|加载未确认/);assert.match(await page.locator('[data-installed-rows]').innerText(),/依赖待确认/);
  await page.locator('[data-install-schemes] summary').click();assert.match(await page.locator('[data-install-schemes]').innerText(),/当前|Codex/);
  for(const width of [1240,740,390]){
   if(web)await page.setViewportSize({width,height:820});
   else await app.evaluate(({BrowserWindow},width)=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('compact=1'));main.setMinimumSize(320,580);main.setSize(width,820);},width);
   await page.screenshot({path:path.join(output,'installed-'+width+'.png')});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow '+width);
  }
  await page.locator('[data-market-provider=lingnest]').click();await page.locator('.market-card h2').filter({hasText:'fixture-market'}).waitFor();
  await page.locator('[data-detail]').click();await dialog.locator('[data-install-compare]').waitFor({state:'visible'});
  await dialog.locator('[data-install-agent][value=codex]').check();await dialog.locator('[data-install-compare]').click();await dialog.locator('.market-paths').waitFor();
  assert.match(await dialog.innerText(),/已有同名技能/);assert.equal(calls.length,2,'Private reuse never redownloads SkillHub');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  const sync=(await api(owner,'/api/skills/operations?deviceId='+target.deviceId)).operations.find(o=>o.action==='sync'&&o.state==='succeeded');
  await api(owner,'/api/skills/operations','POST',{deviceId:target.deviceId,action:'rollback',requestId:crypto.randomUUID(),syncId:sync.id});
  for(let i=0;i<100&&fs.existsSync(path.join(globalSkillRoots(home).codex,'fixture-market'));i++)await new Promise(r=>setTimeout(r,100));
  for(const directory of Object.values(globalSkillRoots(home)))assert.equal(fs.existsSync(path.join(directory,'fixture-market')),false);
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-detail]').click();await dialog.waitFor();assert.equal(await dialog.evaluate(e=>getComputedStyle(e).animationName),'none');await page.keyboard.press('Escape');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,synthetic:true,checks:['real service and scoped IPC','five Agent target directories','timeout retry retains same request ID','explicit preview confirmation','installation and refreshed inventory','private market reuse','3 sizes no overflow','keyboard close','rollback isolated homes'],errors},null,2));console.log('Skill market installation '+(web?'Web':'desktop')+': passed');
 }catch(e){if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
 finally{clearInterval(timer);while(ticking)await new Promise(r=>setTimeout(r,50));runtime.close();if(app)await app.close();await service.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
})().catch(error=>{console.error(error);process.exitCode=1;});

