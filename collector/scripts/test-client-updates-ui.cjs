const {chromium}=require('playwright'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {createService}=await import('../src/server.mjs'),{hash,secret,atomicJson}=await import('../src/common.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'client-update-ui-')),releaseDir=path.join(root,'releases');fs.mkdirSync(releaseDir);
 const filename='InspiraiNest-v0.2.0-Windows-x64.exe',bytes=Buffer.from('UI fixture, never executed');fs.writeFileSync(path.join(releaseDir,filename),bytes);
 atomicJson(path.join(releaseDir,'worker-release.json'),{windows_x64:{version:'0.2.0',filename,size:bytes.length,sha256:hash(bytes)}});
 const key=secret(),app=createService({dataDir:root,masterKey:key,releaseDir}),now=new Date().toISOString(),identity={version:2,namespace:crypto.randomUUID(),source:'smbios',digest:hash('one-physical-computer')};
 const worker={id:crypto.randomUUID(),name:'Home <script>unsafe</script>',role:'worker',tokenHash:hash(secret()),identity,category:'desktop',agents:['codex'],capabilities:['article'],lastSeen:now,lastHeartbeatAt:now,
  deviceInfo:{os:{family:'Windows',version:'11'},client:{type:'worker',version:'0.1.0'},model:'Test PC'},workerRuntime:{schemaVersion:1,version:'0.1.0',platform:'win32',arch:'x64',remoteUpdate:true},clientRuntime:{schemaVersion:1,version:'0.1.0',platform:'win32',arch:'x64',remoteUpdate:true}};
 await app.store.put('device',{...worker,clientType:'desktop',clientIdentityVersion:1});const management={...worker,id:crypto.randomUUID(),role:'owner',name:'桌面工作台',canonicalDeviceId:worker.id,clientRuntime:null,workerRuntime:null,lastHeartbeatAt:null,tokenHash:hash(secret())};await app.store.put('device',management);
 await app.store.put('device',{...worker,id:crypto.randomUUID(),name:'旧版 MacBook',identity:{...identity,digest:hash('mac')},clientRuntime:null,workerRuntime:null,platform:'darwin',deviceInfo:{os:{family:'macOS'},client:{type:'desktop',version:'0.1.20'}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true}),output=path.resolve(__dirname,'../test-output/client-updates');fs.mkdirSync(output,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:1240,height:820}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('#login-form [name=key]').fill(key);await page.locator('#login-form [type=submit]').click();await page.locator('#app').waitFor({state:'visible'});
  await page.locator('[data-view=devices]').click();assert.equal(await page.locator('[data-category=desktop] .row').count(),2);
  assert.equal(await page.locator('.device-grants').count(),0);assert.equal(await page.locator(`[data-revoke="${management.id}"]`).count(),0);
  assert.equal(await page.locator(`[data-revoke="${worker.id}"]`).count(),1);assert.doesNotMatch(await page.locator('#devices').innerText(),/独立授权|管理端|采集端/);await page.screenshot({path:path.join(output,'unified-clients.png')});
  await page.locator('#worker-nodes-toggle').click();const card=page.locator(`[data-node-id="${worker.id}"]`);assert.match(await card.innerText(),/客户端 v0.1.0/);assert.match(await card.innerText(),/Worker v0.1.0/);
  await card.locator('[data-node-update]').click();const dialog=page.locator('.client-update-manager');await dialog.locator('[data-update-target]').filter({hasText:'v0.2.0'}).waitFor();
  assert.equal(await dialog.locator('[data-update-start]').isEnabled(),true);await dialog.locator('[data-update-start]').click();await dialog.locator('[data-update-status]').filter({hasText:'等待节点接收'}).waitFor();assert.equal((await app.store.list('client-update')).length,1);
  await dialog.locator('[data-update-refresh]').click();assert.equal(await dialog.locator('[data-update-start]').isEnabled(),false);
  for(const width of [1240,740,390,320]){await page.setViewportSize({width,height:820});await page.screenshot({path:path.join(output,`update-${width}.png`)});assert.equal(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth),true,'dialog overflow');}
  await dialog.locator('[data-update-cancel]').click();await dialog.locator('[data-update-status]').filter({hasText:'已取消'}).waitFor();await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);
  await page.locator('#worker-nodes-dialog [data-close]').click();await page.locator('#worker-nodes-toggle').click();await page.locator('.node-card').filter({hasText:'旧版 MacBook'}).locator('[data-node-update]').click();await dialog.locator('[data-update-status]').filter({hasText:'本机升级'}).waitFor();assert.equal(await dialog.locator('[data-update-start]').isEnabled(),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'passed',oneClientIdentity:true,wholeClientRevocation:true,nodeVersions:true,queuedUpdateAndCancellation:true,legacyBootstrap:true,widths:[1240,740,390,320],productionWrites:false}));
 }finally{await browser.close();await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
