const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const { _electron }=require('playwright');
const {setTheme,showSettings}=require('./desktop-test-helpers.cjs');

(async()=>{
  const {createService}=await import('../src/server.mjs'),{api}=await import('../src/worker.mjs'),{WorkerManager}=await import('../desktop/manager.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'settings-nodes-')), master=crypto.randomUUID();
  const service=createService({dataDir:path.join(root,'service'),masterKey:master});
  await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
  const server=`http://127.0.0.1:${service.server.address().port}`;
  const owner={server,...await api({server},'/api/pair','POST',{key:master,name:'fixture-owner'})};
  const file=path.join(root,'worker.json'),dataDir=path.join(root,'worker');
  const config={server,dataDir,name:'本机设置验收',pollMs:200,capabilities:['article'],agents:{codex:{command:process.execPath,args:[path.resolve(__dirname,'../test/fixtures/slow-agent.mjs')],versionArgs:[path.resolve(__dirname,'../test/fixtures/slow-agent.mjs'),'--version']}}};
  fs.writeFileSync(file,JSON.stringify(config));
  const manager=new WorkerManager(file,process.execPath),output=path.resolve(__dirname,'../test-output/settings-nodes');fs.mkdirSync(output,{recursive:true});
  const executable=process.argv[2] || (()=>{try{return require('../desktop/node_modules/electron');}catch{return require('electron');}})();
  const env={...process.env,COLLECTOR_CONFIG:file,COLLECTOR_NODE:process.execPath,COLLECTOR_DESKTOP_TEST:'1',COLLECTOR_DESKTOP_STORAGE_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  let app,page,compact;const errors=[];
  const wait=async(fn,label='condition')=>{for(let n=0;n<180;n++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label);};
  async function launch({startup=false}={}){
    console.log('Settings fixture: launch');
    app=await _electron.launch({executablePath:executable,args:[...(process.argv[2]?[]:[path.resolve(__dirname,'../desktop')]),...(startup?['--startup']:[])],env});
    await wait(()=>{page=app.windows().find(p=>p.url().startsWith('file:')&&!p.url().includes('compact=1'));compact=app.windows().find(p=>p.url().includes('compact=1'));return page&&compact;},'both windows');
    page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(30000);
    page.on('pageerror',e=>errors.push(e.message));compact.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>document.querySelector('html').dataset.closeBehavior);

    console.log('Settings fixture: window ready');
  }
  async function remote(name,online){
    const pairing=await api(owner,'/api/pairings','POST',{}),device={server,...await api({server},'/api/pair','POST',{key:pairing.key,name,clientType:'worker'})};
    if(online)await api(device,'/api/heartbeat','POST',{capabilities:['article','webpage'],agents:['codex'],deviceInfo:{os:{family:'macOS',version:'15.6'},client:{type:'worker',name:'InspiraiNest',version:'0.1.8'},model:'MacBookPro18,3'}});
    return device;
  }
  try{
    await launch();console.log('Settings fixture: appearance');assert.equal(await page.locator('#theme-toggle').count(),0);
    assert.deepEqual(await page.locator('.workspace-nav [data-view]').evaluateAll(xs=>xs.map(x=>x.dataset.view)),['record','inbox','overview','tasks','library','nodes','skill-market','settings']);
    await showSettings(page,'appearance');
    if(await app.evaluate(({app})=>app.isPackaged)){
      if(process.platform==='win32'){
        const native=await app.evaluate(()=>globalThis.workerDesktop().checkNativeLoginItem());
        assert.equal(native.on.registered,true);assert.equal(native.on.enabled,true);assert.equal(native.off.registered,false);
      }
      assert.equal(await page.locator('#launch-at-login').isChecked(),true);
      await page.locator('#launch-at-login').uncheck();await page.reload();await showSettings(page,'appearance');
      assert.equal(await page.locator('#launch-at-login').isChecked(),false);
      await page.locator('#launch-at-login').check();assert.equal(await app.evaluate(()=>globalThis.workerDesktop().loginItem.snapshot().enabled),true);
    }else assert.equal(await page.locator('#launch-at-login').isDisabled(),true);
    assert.equal(await page.locator('[name=themeMode][value=system]').isChecked(),true);
    // Exercise actual radio controls, persistence, tray synchronization and legacy migration.
    await page.locator('[name=themeMode][value=dark]').check();await compact.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await page.locator('[name=themeMode][value=light]').check();await compact.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await page.reload();await showSettings(page,'appearance');assert.equal(await page.locator('[name=themeMode][value=light]').isChecked(),true);
    fs.unlinkSync(path.join(await app.evaluate(({app})=>app.getPath('userData')),'desktop-settings.json'));
    await page.evaluate(()=>localStorage.setItem('worker-theme','dark'));
    await app.close();app=null;await launch();await showSettings(page,'appearance');
    assert.equal(await page.locator('[name=themeMode][value=dark]').isChecked(),true,'legacy explicit preference migrated');
    await page.locator('[name=themeMode][value=system]').check();
    for(const mode of ['light','dark']){
      await app.evaluate(({nativeTheme},mode)=>{nativeTheme.themeSource=mode;},mode);
      await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode);await compact.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode);
      assert.equal(await page.evaluate(async()=>(await window.desktopSettings.get()).themeMode),'system');
    }
    await assert.rejects(page.evaluate(()=>window.desktopSettings.update({url:'https://example.com'})),/设置内容无效/);
    await assert.rejects(compact.evaluate(()=>window.desktopSettings.update({themeMode:'dark'})),/主窗口/);
    console.log('Settings fixture: close to tray');
    await app.evaluate(()=>globalThis.workerDesktop().main.close());
    assert.equal(await app.evaluate(()=>globalThis.workerDesktop().main.isVisible()),false);
    await page.evaluate(()=>window.worker.action('show'));
    await showSettings(page,'devices');assert.equal(await page.locator('#owner-pair').isVisible(),true);
    console.log('Settings fixture: native login');
    const pairing=await api(owner,'/api/pairings','POST',{});
    await page.locator('#owner-pair [name=server]').fill(server);
    await page.locator('#owner-pair [name=key]').fill(pairing.key);
    await page.locator('#owner-pair button[type=submit]').click();
    console.log('Settings fixture: login submitted');
    await wait(async()=>{const message=await page.locator('#owner-pair [data-login-error]').textContent();if(message)throw new Error('Login fixture: '+message);return page.locator('#owner-pair').isHidden();},'native login');
    console.log('Settings fixture: logged in');
    const online=await remote('MacBook <script>坏标题</script>',true),offline=await remote('离线 Mac mini — 很长的设备名称用于验证文本截断',false);
    await page.locator('[data-view=nodes]').click();await wait(async()=>await page.locator(`[data-node="${online.device.id}"]`).count()===1,'remote discovery');
    assert.equal(await page.locator(`[data-node="${manager.configuration().deviceId}"]`).count(),0,'local ID deduplicated');
    await page.locator(`[data-node="${online.device.id}"]`).click();assert.match(await page.locator('#node-remote-content').innerText(),/MacBookPro18,3/);
    assert.equal(await page.locator('#node-remote-content script').count(),0);
    const originalNode=await service.store.get('device',online.device.id);
    for(const theme of ['dark','light']){
      await setTheme(page,theme);await page.locator('[data-node-update]').click();
      await page.locator('.client-update-manager [data-update-status]').filter({hasText:'本机升级'}).waitFor();
      assert.equal(await page.locator('.client-update-manager [data-update-start]').isEnabled(),false);
      await page.screenshot({path:path.join(output,`remote-update-${theme}.png`)});
      await app.evaluate(()=>globalThis.workerDesktop().main.setSize(740,580));
      assert.ok(await page.locator('.client-update-manager').evaluate(e=>e.scrollWidth<=e.clientWidth));
      await page.screenshot({path:path.join(output,`remote-update-minimum-${theme}.png`)});
      await page.keyboard.press('Escape');await app.evaluate(()=>globalThis.workerDesktop().main.setSize(1240,820));
    }
    const rename=page.locator('[data-node-rename]'); await rename.click();
    assert.equal(await page.locator('.node-name-dialog code').textContent(),online.device.id);
    await page.locator('#node-name-input').fill('MacBook 开发工作站');
    await api(online,'/api/heartbeat','POST',{capabilities:['article'],agents:['codex']});
    assert.equal(await page.locator('#node-name-input').inputValue(),'MacBook 开发工作站');
    await page.locator('.node-name-dialog [type=submit]').click(); await page.locator('.node-name-dialog').waitFor({state:'hidden'});
    await page.locator('#node-overview .detail-title').filter({hasText:'MacBook 开发工作站'}).waitFor();
    assert.equal((await service.store.get('device',online.device.id)).tokenHash,originalNode.tokenHash);
    const completedNodeTask={id:crypto.randomUUID(),state:'completed',deviceId:online.device.id,createdAt:new Date().toISOString(),content:'节点展示合成任务',type:'article',events:[]};
    await service.store.put('task',completedNodeTask); await page.locator('[data-view=tasks]').click(); await page.locator('#task-filter').selectOption('all');
    await page.locator(`[data-task="${completedNodeTask.id}"] .task-node`).filter({hasText:'MacBook 开发工作站'}).waitFor();
    await page.locator(`[data-task="${completedNodeTask.id}"]`).click(); assert.match(await page.locator('#task-detail .task-node').innerText(),/完成节点/);
    assert.ok((await page.locator('#task-detail .task-node').innerText()).includes(online.device.id));
    for(const theme of ['dark','light']){
      await setTheme(page,theme);await page.screenshot({path:path.join(output,`task-node-${theme}.png`)});
      await app.evaluate(()=>globalThis.workerDesktop().main.setSize(740,580));
      assert.ok(await page.locator('#task-detail').evaluate(el=>el.scrollWidth<=el.clientWidth));
      await page.screenshot({path:path.join(output,`task-node-minimum-${theme}.png`)});
      await app.evaluate(()=>globalThis.workerDesktop().main.setSize(1240,820));
    }
    await page.locator('[data-view=nodes]').click(); await page.locator(`[data-node="${online.device.id}"]`).click();
    await rename.click(); await page.locator('#node-name-input').fill('不保存'); await page.keyboard.press('Escape');
    for(const theme of ['dark','light']){
      await setTheme(page,theme);await rename.click();await page.screenshot({path:path.join(output,`node-name-${theme}.png`)});await page.keyboard.press('Escape');
    }
    assert.equal((await service.store.get('device',online.device.id)).name,'MacBook 开发工作站');
    await assert.rejects(compact.evaluate(input=>window.library.renameNode(input),{id:online.device.id,name:'托盘无权修改'}),/主窗口/);
    await app.evaluate(()=>globalThis.workerDesktop().main.setSize(740,580));
    await page.locator('#node-dispatch').focus();
    const scrollBefore=await page.locator('#node-detail').evaluate(el=>{el.scrollTop=80;return el.scrollTop;});
    await api(online,'/api/heartbeat','POST',{capabilities:['article','webpage'],agents:['codex'],deviceInfo:{os:{family:'macOS',version:'15.6'},client:{type:'worker',name:'InspiraiNest',version:'0.1.9'},model:'MacBookPro18,3'}});
    await page.waitForFunction(()=>document.querySelector('#node-remote-content').textContent.includes('v0.1.9'));
    assert.equal(await page.evaluate(()=>document.activeElement.id),'node-dispatch','refresh preserves keyboard focus');
    assert.equal(await page.locator('#node-detail').evaluate(el=>el.scrollTop),scrollBefore,'refresh preserves scroll');
    await app.evaluate(()=>globalThis.workerDesktop().main.setSize(1240,820));
    await page.locator(`[data-node="${offline.device.id}"]`).click();assert.match(await page.locator('#node-remote-content').innerText(),/未上报/);
    await page.locator('#node-dispatch').click();assert.equal(await page.locator('#capture-device').inputValue(),offline.device.id);assert.match(await page.locator('#capture-target-hint').innerText(),/离线/);
    let loseReply=true;const drop=(req,res)=>{if(loseReply&&req.method==='POST'&&req.url==='/api/tasks'){loseReply=false;res.end=()=>res.destroy();}};service.server.prependListener('request',drop);
    await page.locator('#capture-form textarea').fill('指定离线节点的合成验收任务');await page.locator('#capture-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#capture-error').textContent.length>0);const submission=await page.locator('#capture-form').getAttribute('data-submission');
    await page.locator('#capture-form button[type=submit]').click();await page.locator('#capture-dialog').waitFor({state:'hidden'});service.server.removeListener('request',drop);
    const created=(await api(owner,'/api/state')).tasks.filter(t=>t.submissionId===submission);assert.equal(created.length,1);assert.equal(created[0].preferredDeviceId,offline.device.id);
    await page.locator('[data-view=nodes]').click();await page.locator(`[data-node="${offline.device.id}"]`).click();assert.equal(await page.locator('[data-node-task]').count(),1);
    await page.locator('[data-node-task]').click();assert.match(await page.locator('#task-detail').innerText(),/指定离线节点/);
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('library:state');ipcMain.handle('library:state',()=>{throw new Error('模拟连接中断');});});
    await page.locator('[data-view=nodes]').click();await page.locator(`[data-node="${online.device.id}"]`).click();await page.waitForFunction(()=>document.querySelector('#nodes-freshness').textContent.includes('连接中断'));
    assert.match(await page.locator(`[data-node="${online.device.id}"]`).innerText(),/状态待更新/);assert.equal(await page.locator('#node-dispatch').isDisabled(),true);
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('library:state');ipcMain.handle('library:state',()=>globalThis.workerDesktop().ownerState());});await page.reload();await page.locator('[data-view=nodes]').click();
    await page.waitForFunction(()=>document.querySelector('#nodes-freshness').textContent.startsWith('最后更新'));
    await api(owner,`/api/devices/${online.device.id}/revoke`,'POST',{});
    await wait(async()=>await page.locator(`[data-node="${online.device.id}"]`).count()===0,'revoked node excluded');
    for(const mode of ['dark','light']){
      await setTheme(page,mode);await showSettings(page,'appearance');await page.screenshot({path:path.join(output,`settings-${mode}.png`)});
      await page.locator('[data-view=nodes]').click();await page.locator(`[data-node="${offline.device.id}"]`).click();await page.screenshot({path:path.join(output,`nodes-${mode}.png`)});
      await app.evaluate(()=>globalThis.workerDesktop().popover.show());await compact.screenshot({path:path.join(output,`tray-${mode}.png`)});await app.evaluate(()=>globalThis.workerDesktop().popover.hide());
      await app.evaluate(()=>globalThis.workerDesktop().main.setSize(740,580));await page.screenshot({path:path.join(output,`nodes-minimum-${mode}.png`)});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.locator('[data-node-back]').click();assert.equal(await page.locator('#node-list').isVisible(),true);await showSettings(page,'appearance');await page.screenshot({path:path.join(output,`settings-minimum-${mode}.png`)});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await app.evaluate(()=>globalThis.workerDesktop().main.setSize(1240,820));
    }
    await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-view=nodes]').click();await page.locator('[data-node=local]').click();
    assert.equal(await page.locator('#node-detail').evaluate(el=>el.getAnimations().length),0);
    await showSettings(page,'appearance');await page.locator('#settings-tab-appearance').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#settings-tab-devices').getAttribute('aria-selected'),'true');
    await showSettings(page,'appearance');await page.locator('#close-behavior').selectOption('quit');
    await page.locator('[data-view=nodes]').click();await page.locator('[data-node=local]').click();await page.locator('[data-action=start]').click();await wait(()=>manager.snapshot().online,'worker online');
    await page.locator('[data-action=pause]').click();await wait(()=>manager.snapshot().mode==='paused');const pid=manager.snapshot().pid;
    const desktopProcess=app.process();await app.evaluate(()=>globalThis.workerDesktop().main.close()).catch(()=>{});await wait(()=>desktopProcess.exitCode!==null,'manager exit after close');app=null;
    fs.writeFileSync(path.join(output,'close-state.json'),JSON.stringify({pid,snapshot:manager.snapshot()},null,2));
    assert.equal(manager.snapshot().pid,pid);assert.equal(manager.snapshot().running,true,'window quit preserves independent Worker');
    await launch();console.log('Settings fixture: appearance');assert.equal(await page.evaluate(async()=>(await window.desktopSettings.get()).closeBehavior),'quit');assert.equal(manager.snapshot().pid,pid,'reopen attaches same Worker');
    // End the isolated Worker while its manager is closed to simulate process
    // loss. Last user intent remains paused, not the test's external drain.
    const reopened=app.process();await app.evaluate(()=>globalThis.workerDesktop().main.close()).catch(()=>{});await wait(()=>reopened.exitCode!==null);app=null;
    await manager.control('drain');await wait(()=>!manager.snapshot().running);
    await launch();await wait(()=>manager.snapshot().running&&manager.snapshot().mode==='paused','paused state restored after process loss');
    assert.notEqual(manager.snapshot().pid,pid);await page.locator('[data-view=nodes]').click();await page.locator('[data-action=resume]').click();await wait(()=>manager.snapshot().mode==='running');
    const runningReopen=app.process();await app.evaluate(()=>globalThis.workerDesktop().main.close()).catch(()=>{});await wait(()=>runningReopen.exitCode!==null);app=null;
    await manager.control('drain');await wait(()=>!manager.snapshot().running);
    await launch({startup:true});await wait(()=>manager.snapshot().running&&manager.snapshot().mode==='running','running state restored at login');
    await page.waitForTimeout(300);assert.equal(await app.evaluate(()=>globalThis.workerDesktop().main.isVisible()),false,'login launch stays in tray');
    await page.evaluate(()=>window.worker.action('show'));
    await page.locator('[data-view=nodes]').click();assert.equal(await page.locator('[data-action=start]').isDisabled(),true);await page.locator('[data-action=drain]').click();await wait(()=>!manager.snapshot().running,'drained');
    // The process can exit before the stop IPC has persisted user intent.
    // Close only after the UI reports that the completed stop is ready for start.
    await page.waitForFunction(()=>!document.querySelector('[data-action=start]').disabled);
    await app.close();app=null;await launch();assert.equal(manager.snapshot().running,false,'explicit stop persists after reopen');
    await api(owner,`/api/devices/${offline.device.id}/revoke`,'POST',{});await page.waitForFunction(()=>document.querySelectorAll('#node-list [data-node]').length===1);
    await showSettings(page,'devices');await page.locator('#owner-logout').click();await page.locator('[data-view=nodes]').click();await page.locator('#nodes-auth-hint').waitFor({state:'visible'});
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,synthetic:true,checks:['theme modes and legacy migration','settings persistence','system event synchronization','IPC allowlist','unpaired settings','node reports and escaping','local deduplication','offline dispatch and idempotent retry','task drilldown','disconnect and recovery','revocation','dark/light standard/minimum/tray','keyboard and reduced motion','close to tray','close manager keeps Worker','reattach same process','paused/running recovery after process loss','login launch stays in tray','explicit stop persists','packaged login preference toggle and persistence'],errors,credentialStorage:'Isolated fixture replacement; native Keychain approval is separate acceptance.'},null,2));
    console.log('Desktop settings and nodes: passed');
  }catch(error){console.error('Settings fixture failed:',error.message);if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
  finally{if(manager.snapshot().managed){await manager.control('drain');await wait(()=>!manager.snapshot().running,'cleanup drain');}if(app)await app.close();await service.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
