// Packaged main process, real preload, native safeStorage and disposable REST only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {create,until}=require('./react-desktop-fixture.cjs');
(async()=>{
 const f=await create(process.argv[2]),version=require('../package.json').version;
 const button=name=>f.page.getByRole('button',{name,exact:true}),dialog=()=>f.page.getByRole('dialog');
 const doc=text=>({version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text,marks:[{type:'bold'}]}]}]}});
 try{
  await f.launch();
  await f.check('packaged React, native login and complete rich document survive restart',async()=>{
   assert.equal(await f.app.evaluate(({app})=>app.getVersion()),version);assert.equal(await f.page.locator('iframe').count(),0);
   await f.login('A');await f.nav('记录');await button('新建记录').click();await f.page.getByRole('textbox',{name:'记录正文',exact:true}).fill('签名包完整记录');await button('保存记录').click();
   await until(async()=>(await f.api(f.targets.A.owner,'/api/records')).records.some(r=>r.text==='签名包完整记录'&&r.document),'complete rich document');
   await f.close();await f.launch();assert.equal((await f.page.evaluate(()=>window.library.status())).paired,true);await f.nav('记录');await f.page.getByRole('button').filter({hasText:'签名包完整记录'}).click();await f.page.locator('[data-region=内容标题]').getByText('已同步',{exact:true}).waitFor();
  });
  await f.check('conditional conflict resolution rejects stale review, preserves merge and creates one version',async()=>{
   const id=crypto.randomUUID(),first={requestId:crypto.randomUUID(),baseVersion:0,text:'共同基线',document:doc('共同基线'),attachments:[],createdAt:new Date().toISOString()};
   const base=await f.api(f.targets.A.owner,'/api/records/'+id,'PUT',first);
   await f.api(f.targets.A.owner,'/api/records/'+id,'PUT',{...first,requestId:crypto.randomUUID(),baseVersion:1,text:'云端补充',document:doc('云端补充')});
   await f.page.evaluate(async({id,base})=>{
    const status=await window.library.status(),scope=JSON.stringify([status.server,status.deviceId??'']),key=raw=>'account-records-v1:'+encodeURIComponent(scope)+':'+encodeURIComponent(raw);
    await new Promise((resolve,reject)=>{const r=indexedDB.open('inspirainest-capture-v1',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('items','readwrite');tx.objectStore('items').put({...base,id:key(id),localId:id,accountScope:scope,text:'本机补充',document:{version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'本机补充'}]}]}},baseSnapshot:base,remoteVersion:1,server:status.server,sync:'conflict',error:'双方均有修改'});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};r.onerror=()=>reject(r.error)});
   },{id,base});
   await f.page.reload();await f.page.locator('[data-row="'+id+'"]').click();await button('处理冲突').click();await dialog().getByText('云端补充',{exact:true}).waitFor();
   await f.api(f.targets.A.owner,'/api/records/'+id,'PUT',{...first,requestId:crypto.randomUUID(),baseVersion:2,text:'云端再次修改',document:doc('云端再次修改')});
   await dialog().getByRole('button',{name:'使用本机',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'云端再次更新'}).waitFor();assert.equal((await f.api(f.targets.A.owner,'/api/records/'+id)).version,3);
   await dialog().getByRole('button',{name:'重新加载比较'}).click();await dialog().getByText('云端再次修改',{exact:true}).waitFor();await f.shot('packaged-record-conflict');await dialog().getByRole('button',{name:'合并编辑',exact:true}).click();
   const editor=f.page.getByRole('textbox',{name:'记录正文',exact:true});await until(async()=>(await editor.innerText()).includes('本机补充'),'preserved merged draft');await editor.fill('人工确认合并');await button('保存记录').click();
   await until(async()=>{const r=await f.api(f.targets.A.owner,'/api/records/'+id);return r.text==='人工确认合并'&&r.version===4&&!!r.document;},'one conditional merge version');
   await f.close();await f.launch();await f.nav('记录');await f.page.locator('[data-row="'+id+'"]').click();await f.page.locator('[data-region=记录阅读滚动区]').getByText('人工确认合并',{exact:true}).waitFor();assert.equal((await f.api(f.targets.A.owner,'/api/records/'+id)).version,4);
  });
  assert.deepEqual(f.failures,[]);assert.deepEqual(f.errors,[]);fs.writeFileSync(path.join(f.output,'records-packaged-result.json'),JSON.stringify({passed:true,version,platform:process.platform,checks:f.checks,scope:'Packaged React entry and native encrypted authorization; isolated service and profiles; no physical camera/microphone or Intel GUI validation.'},null,2));console.log(JSON.stringify({passed:true,version,checks:f.checks}));
 }finally{await f.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1});
