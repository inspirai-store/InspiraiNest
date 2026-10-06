const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
const {showSettings}=require('./desktop-test-helpers.cjs');
(async()=>{
 const {createService}=await import('../src/server.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-origin-switch-'));
 const services=[];
 async function service(label){
  const password=label+' fixture password '.repeat(3),app=createService({dataDir:path.join(root,label),masterKey:password});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));services.push(app);
  return {origin:'http://127.0.0.1:'+app.server.address().port,password};
 }
 const a=await service('personal'),b=await service('review');
 const file=path.join(root,'worker.json');fs.writeFileSync(file,JSON.stringify({dataDir:path.join(root,'data')}));
 const env={...process.env,COLLECTOR_CONFIG:file,COLLECTOR_DESKTOP_TEST:'1',COLLECTOR_DESKTOP_STORAGE_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;
 async function launch(){
  app=await _electron.launch({executablePath:process.argv[2]?path.resolve(process.argv[2]):require('electron'),args:process.argv[2]?[]:[path.resolve(__dirname,'../desktop')],env});
  for(let n=0;n<100;n++){page=app.windows().find(p=>p.url().startsWith('file:')&&!p.url().includes('compact=1'));if(page)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(page);page.setDefaultTimeout(20000);await showSettings(page,'devices');
 }
 async function login(target,key=target.password){
  await page.locator('#owner-pair [name=server]').fill(target.origin);
  await page.locator('#owner-pair [name=key]').fill(key);
  await page.locator('#owner-pair button[type=submit]').click();
 }
 try{
  await launch();await login(a);await page.locator('#overview-data').waitFor({state:'visible'});
  await showSettings(page,'devices');await page.locator('#switch-library').click();await login(b);
  await page.locator('#overview-data').waitFor({state:'visible'});
  const config=JSON.parse(fs.readFileSync(file));assert.equal(config.server,b.origin);assert.notEqual(config.dataDir,path.join(root,'data'));
  await app.close();app=null;page=null;await launch();
  const restored=await page.evaluate(()=>window.library.status());assert.equal(restored.paired,true);assert.equal(restored.server,b.origin);
  await page.locator('#switch-library').click();await login(a,'wrong');
  await page.locator('#owner-pair [data-login-error]').filter({hasText:'不正确'}).waitFor();
  assert.equal((await page.evaluate(()=>window.library.status())).server,b.origin);
  assert.equal(JSON.parse(fs.readFileSync(file)).server,b.origin);
  assert.equal(await page.locator('#owner-pair [name=key]').inputValue(),'');
  await login(a);await page.locator('#overview-data').waitFor({state:'visible'});
  assert.equal((await page.evaluate(()=>window.library.status())).server,a.origin);
  const out=path.resolve(__dirname,'../test-output/desktop-login');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'origin-switch.json'),JSON.stringify({passed:true,checks:['two actual isolated services','manager and Worker switch together','restart restores new origin credential','failed switch preserves old origin','separate Worker data directories'],credentialStorage:'Isolated fixture replacement; native Keychain approval is separate acceptance.'},null,2));
  console.log('Desktop login origin switch: passed');
 }finally{if(app)await app.close();for(const s of services)await s.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
