const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=path.resolve(__dirname,'../../../../design-review/desktop-refactor/stage-05-records-v1/rich-evidence/row-revision-v1');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'inspirainest-row-'));
app.setPath('userData',profile);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 fs.mkdirSync(out,{recursive:true});const frames=[];
 try {
  for(const longTitle of [false,true])for(const width of [1240,900,740])for(const theme of ['light','dark']){
   const win=new BrowserWindow({width,height:820,useContentSize:true,show:false,frame:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   const seed=path.join(profile,'seed.html');fs.writeFileSync(seed,'<!doctype html><title>Row fixture</title>');await win.loadFile(seed);
   const record={id:'11111111-1111-4111-8111-111111111111',text:(longTitle?'混合粘贴验证与长标题边界检查'.repeat(8):'混合粘贴验证')+'\n图片前的描述，加粗内容。\n图片后的描述，查看路线。'+(longTitle?'长摘要内容'.repeat(30):''),attachments:[],createdAt:'2026-10-13T05:09:12Z',version:2,remoteVersion:2,server:null,sync:'synced',error:''};
   record.document={version:1,doc:{type:'doc',content:record.text.split('\n').map((text,i)=>({type:i?'paragraph':'heading',...(i?{}:{attrs:{level:1}}),content:[{type:'text',text}]}))}};
   await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const req=indexedDB.open('inspirainest-capture-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('items',{keyPath:'id'});req.onsuccess=()=>{const tx=req.result.transaction('items','readwrite');tx.objectStore('items').put(${JSON.stringify(record)});tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);};})`);
   await win.loadFile(path.resolve(__dirname,'../dist/index.html'),{hash:(width===740?'/records':'/records/demo')+'?data=local&theme='+theme});
   await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;for(let i=0;i<100&&!document.querySelector('[data-row]');i++)await new Promise(r=>setTimeout(r,20));})()`);
   const check=await win.webContents.executeJavaScript(`(()=>{const row=document.querySelector('[data-row]');if(!row)return {passed:false,error:'Row missing'};const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};const children=Array.from(row.children),parts=children.map(e=>({rect:rect(e),whiteSpace:getComputedStyle(e).whiteSpace,overflow:getComputedStyle(e).overflow,textOverflow:getComputedStyle(e).textOverflow}));const r=rect(row),metadata=Array.from(children[2].children).map(rect);const actions=document.querySelector('[data-region="记录操作"]'),reader=document.querySelector('[aria-label="记录正文阅读"]');const readingAligned=!reader?.getClientRects().length||(!document.querySelector('[data-region="记录信息"]')&&Math.abs(rect(reader).y-rect(actions).bottom-20)<1);return {readingAligned,row:r,parts,metadata,passed:readingAligned&&r.height===100&&parts[0].rect.height===20&&parts[1].rect.height===18&&parts[2].rect.height===18&&parts[0].whiteSpace==='nowrap'&&parts[1].whiteSpace==='nowrap'&&parts.every(p=>p.rect.bottom<=r.bottom-10)&&metadata[0].right<=metadata[1].x&&parts[1].rect.bottom<parts[2].rect.y};})()`);
   const name=(longTitle?'long':'reported')+'-'+width+'-'+theme;
   fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());frames.push({name,width,theme,longTitle,...check});win.destroy();
  }
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({passed:frames.every(f=>f.passed),scope:'Actual IndexedDB-backed records route with reported text and long-content fixtures; not a screenshot of the running user window',frames},null,2));console.log(JSON.stringify({passed:frames.every(f=>f.passed),frames:frames.length,out}));app.exit(frames.every(f=>f.passed)?0:1);
 }catch(e){console.error(e);app.exit(1);}
});app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
