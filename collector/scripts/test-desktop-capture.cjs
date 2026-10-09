const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
(async()=>{
 const {createService}=await import('../src/server.mjs'),{api}=await import('../src/worker.mjs'),{secret}=await import('../src/common.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-capture-')),key=secret(),service=createService({dataDir:path.join(root,'server'),masterKey:key});await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
 const server=`http://127.0.0.1:${service.server.address().port}`,auth=await api({server},'/api/pair','POST',{key,name:'desktop-test'});
 const file=path.join(root,'worker.json');fs.writeFileSync(file,JSON.stringify({server,dataDir:path.join(root,'worker')}));
 const env={...process.env,COLLECTOR_CONFIG:file,COLLECTOR_DESKTOP_TEST:'1',COLLECTOR_DESKTOP_STORAGE_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const electron=(()=>{try{return require('../desktop/node_modules/electron');}catch{return require('electron');}})();
 const packaged=process.argv[2];
 const app=await _electron.launch({executablePath:packaged?path.resolve(packaged):electron,args:packaged?[]:[path.resolve(__dirname,'../desktop')],env});
 try{
  let page;for(let n=0;n<100&&!page;n++){page=app.windows().find(p=>p.url().startsWith('file:')&&!p.url().includes('compact=1'));if(!page)await new Promise(r=>setTimeout(r,100));}assert.ok(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.locator('#record-view').waitFor({state:'visible'});const frame=page.frameLocator('#record-frame');await frame.locator('html[data-theme]').waitFor({state:'attached',timeout:5000});await frame.locator('#record-text').fill('未连接也可以立即记录');
  await frame.locator('#send').click();await frame.locator('#detail-state').filter({hasText:'待同步'}).waitFor();
  await app.evaluate((_,credential)=>globalThis.workerDesktop().owner.saveCredential(credential),{server,deviceId:auth.device.id,token:auth.token});
  await frame.locator('#retry-sync').click();await frame.locator('#detail-state').filter({hasText:'未加工'}).waitFor();
  assert.equal((await api({server,token:auth.token},'/api/records')).records.length,1);assert.equal((await api({server,token:auth.token},'/api/state')).tasks.length,0);
  await page.locator('[data-view="nodes"]').click();await page.locator('#nodes-view').waitFor({state:'visible'});await page.locator('[data-view="record"]').click();await page.locator('#record-view').waitFor({state:'visible'});
  assert.equal(await frame.locator('#record-text').isVisible(),true);assert.deepEqual(errors,[]);
  const output=path.resolve(__dirname,'../test-output/capture');fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'windows-native.png')});console.log(JSON.stringify({passed:6,errors,actualElectron:true,physicalMediaTested:false,output}));
 }finally{await app.close();await service.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
