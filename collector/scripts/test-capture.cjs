const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
(async()=>{
 const {createService}=await import('../src/server.mjs'),{api}=await import('../src/worker.mjs'),{captureRequest}=await import('../desktop/capture-client.mjs'),{secret}=await import('../src/common.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'capture-browser-')),key=secret(),service=createService({dataDir:root,masterKey:key});
 await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));const server=`http://127.0.0.1:${service.server.address().port}`;
 const auth=await api({server},'/api/pair','POST',{key,name:'browser-fixture'}),owner={identity:{server,token:auth.token},fetcher:fetch};
 const output=path.resolve(__dirname,'../test-output/capture');fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[];let offline=false,currentServer=server;
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('captureHost',async(action,input)=>{if(action==='status')return {paired:true,server:currentServer};if(action==='navigate')return {};if(offline)throw new Error('network fixture offline');return captureRequest(owner,input);});
  const entry=pathToFileURL(path.resolve(__dirname,'../public/capture/index.html')).href;await page.goto(entry);
  await page.waitForFunction(()=>document.querySelector('#connection-label').textContent==='已连接');
  await page.locator('#record-text').fill('真实服务的混合记录');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvBYAAAAASUVORK5CYII=','base64');
  await page.locator('#photo-input').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>document.querySelectorAll('.attachment').length===1);
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.attachment').length===1);assert.equal(await page.locator('#record-text').inputValue(),'真实服务的混合记录');checks.push('text and binary draft recovered after reload');
  await page.screenshot({path:path.join(output,'mobile-record.png'),fullPage:true});
  offline=true;await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#detail-state').textContent==='同步失败');assert.equal((await api({server,token:auth.token},'/api/state')).tasks.length,0);checks.push('offline send durably queues without starting task');
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#recent-list .record-row').length===1);await page.locator('#recent-list .record-row').click();offline=false;await page.locator('#retry-sync').click();await page.waitForFunction(()=>document.querySelector('#detail-state').textContent==='未加工');
  const list=await api({server,token:auth.token},'/api/records');assert.equal(list.records.length,1);assert.equal(list.records[0].attachments.length,1);checks.push('retry uploads actual binary media and commits once');
  await page.locator('[data-media]').click();await page.waitForFunction(()=>document.querySelector('#detail-media img')?.complete);checks.push('authenticated media preview');
  await page.locator('#process').click();await page.locator('#instructions').fill('整理成笔记');await page.locator('#start-process').click();await page.waitForFunction(()=>document.querySelector('#detail-state').textContent==='加工中');
  const tasks=(await api({server,token:auth.token},'/api/state')).tasks;assert.equal(tasks.length,1);assert.equal(tasks[0].autoArchive,false);checks.push('only explicit processing creates a review-only task');
  await page.screenshot({path:path.join(output,'mobile-detail.png'),fullPage:true});
  await page.locator('#edit-record').click();await page.locator('#record-text').fill('本机保留的编辑内容');
  const id=list.records[0].id;await api({server,token:auth.token},'/api/records/'+id,'PUT',{requestId:crypto.randomUUID(),baseVersion:1,text:'另一设备的修改',attachments:[]});await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#detail-state').textContent==='版本冲突');assert.match(await page.locator('#detail-body').textContent(),/本机保留/);checks.push('concurrent edit conflict preserves local draft');
  await page.locator('#resolve-conflict').click();await page.waitForFunction(()=>document.querySelector('#detail-state').textContent==='加工中');assert.equal((await api({server,token:auth.token},'/api/records/'+id)).version,3);checks.push('explicit conflict resolution submits against latest version');
  await page.locator('.mobile-nav [data-page="record"]').click();await page.locator('#record-text').fill('绑定原服务器');offline=true;await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#detail-state').textContent==='同步失败');currentServer='https://another.test';offline=false;await page.locator('#retry-sync').click();assert.equal((await api({server,token:auth.token},'/api/records')).records.length,1);checks.push('queued record is never silently sent to a different origin');
  currentServer=server;await page.locator('#retry-sync').click();await page.waitForFunction(()=>document.querySelector('#detail-state').textContent==='未加工');
  for(const viewport of [{width:320,height:640},{width:390,height:844},{width:1280,height:720},{width:1440,height:900}]){await page.setViewportSize(viewport);for(const target of ['record','inbox','detail']){await page.evaluate(target=>window.captureNavigate(target),target);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}checks.push(`${viewport.width}x${viewport.height} no overflow`);}
  await page.evaluate(()=>window.captureNavigate('record'));await page.screenshot({path:path.join(output,'desktop-record.png'),fullPage:true});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({checks,errors,entry,browser:'Chrome',actualAPI:true,nativeMediaTested:false},null,2));console.log(JSON.stringify({passed:checks.length,errors,output}));
 }finally{await browser.close();await service.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
