// Real Electron UI + isolated REST service. No production profile or credentials.
const { _electron:electron }=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function main(){
 const out=path.resolve(process.env.RECORD_CONFLICT_OUTPUT||'test-output/record-conflict');fs.mkdirSync(out,{recursive:true});
 const env={...process.env,SETTINGS_QA:'1',RECORDS_QA_ROUTE:'/records?data=local'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('desktop/frontend/scripts/records-qa.cjs'),...(process.platform==='linux'?['--no-sandbox']:[])],env});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.library?.capture);
  const id=await page.evaluate(async()=>{
   const status=await window.library.status(),id=crypto.randomUUID(),scope=JSON.stringify([status.server,status.deviceId??'']);
   const doc=text=>({version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text,marks:[{type:'bold'}]}]}]}});
   const first={requestId:crypto.randomUUID(),baseVersion:0,text:'共同基线',document:doc('共同基线'),createdAt:new Date().toISOString(),attachments:[]};
   const original=(await window.library.capture({route:'/api/records/'+id,method:'PUT',json:first})).json;
   await window.library.capture({route:'/api/records/'+id,method:'PUT',json:{...first,requestId:crypto.randomUUID(),baseVersion:1,text:'云端补充：另一台电脑的内容',document:doc('云端补充：另一台电脑的内容')}});
   await new Promise((resolve,reject)=>{const open=indexedDB.open('inspirainest-capture-v1',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('items','readwrite'),items=tx.objectStore('items'),key=raw=>'account-records-v1:'+encodeURIComponent(scope)+':'+encodeURIComponent(raw);items.put({id:key(id),localId:id,accountScope:scope,text:'本机补充：需要比较的内容',document:doc('本机补充：需要比较的内容'),attachments:[],createdAt:first.createdAt,version:1,remoteVersion:1,baseSnapshot:original,server:status.server,sync:'conflict',error:'本机与云端均有修改',errorCode:'record_version_conflict'});items.put({id:key('draft'),localId:'draft',accountScope:scope,recordId:crypto.randomUUID(),text:'',attachments:[]});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};open.onerror=()=>reject(open.error)});return id;
  });
  await page.reload();await page.locator('[data-row="'+id+'"]').click();await page.getByRole('button',{name:'处理冲突',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'比较冲突内容'});await dialog.getByRole('button',{name:'使用本机',exact:true}).waitFor();await dialog.getByText('云端补充：另一台电脑的内容',{exact:true}).waitFor();
  const screenshots=[];
  for(const theme of ['dark','light'])for(const [width,height]of [[1240,820],[740,580]]){
   await page.setViewportSize({width,height});await page.evaluate(theme=>window.desktopSettings.update({themeMode:theme}),theme);
   await page.waitForTimeout(220);const bounds=await dialog.evaluate(el=>({width:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,viewport:innerWidth,overflow:el.scrollWidth>el.clientWidth+1,bodyOverflow:document.documentElement.scrollWidth>innerWidth}));assert.equal(bounds.overflow,false);assert.equal(bounds.bodyOverflow,false);assert.ok(bounds.left>=0&&bounds.right<=width);
   const name='conflict-'+theme+'-'+width+'.png';await page.screenshot({path:path.join(out,name)});screenshots.push({name,...bounds});
  }
  await page.evaluate(async id=>{const remote=(await window.library.capture({route:'/api/records/'+id})).json;await window.library.capture({route:'/api/records/'+id,method:'PUT',json:{requestId:crypto.randomUUID(),baseVersion:remote.version,text:'云端再次更新',document:{version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'云端再次更新'}]}]}},attachments:[],createdAt:remote.createdAt}});},id);
  await dialog.getByRole('button',{name:'使用本机',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'云端再次更新'}).waitFor();await dialog.getByRole('button',{name:'重新加载比较'}).click();await dialog.getByText('云端再次更新',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'合并编辑',exact:true}).click();await page.locator('[aria-label="记录正文"]').waitFor();assert.match(await page.locator('[aria-label="记录正文"]').textContent(),/本机补充/);
  await page.locator('[aria-label="记录正文"]').fill('人工合并后的最终内容');await page.keyboard.press(process.platform==='darwin'?'Meta+s':'Control+s');await page.waitForFunction(()=>location.hash.includes('/records/demo'));
  await page.waitForFunction(async id=>{const r=await window.library.capture({route:'/api/records/'+id});return r.json.text==='人工合并后的最终内容'&&r.json.version===4;},id);
  await page.setViewportSize({width:1240,height:820});await page.reload();await page.locator('[data-row="'+id+'"]').click();await page.getByText('人工合并后的最终内容',{exact:true}).last().waitFor();
  const result={passed:true,screenshots,checks:['native Electron and isolated REST','dark/light standard/minimum','late remote changes do not overwrite','manual merge preserves draft','conditional save creates v4 once','reload retains confirmed content']};fs.writeFileSync(path.join(out,'verified.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
