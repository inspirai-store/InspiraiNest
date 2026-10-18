const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),sharp=require('sharp');
const out=path.resolve(__dirname,'../../../../design-review/desktop-refactor/stage-04-components-v1');
const manifest=JSON.parse(fs.readFileSync(path.join(out,'prototype-manifest.json')));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'inspirainest-states-'));app.setPath('userData',profile);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{const frames=[];fs.mkdirSync(path.join(out,'implementation'),{recursive:true});try{
for(const frame of manifest.screens){const name=frame.name,wide=frame.width>820;let route;
if(name.startsWith('records-loading'))route='/records/demo?state=loading';
else if(name.startsWith('library-loading'))route='/library/demo?state=loading';
else if(name.startsWith('records-empty'))route='/records?state=empty';
else if(name.startsWith('library-empty'))route='/library?state=empty';
else if(name.startsWith('library-no-results'))route=(wide?'/library/demo':'/library')+'?state=no-results';
else if(name.startsWith('library-list-error'))route='/library/demo?state=list-error';
else if(name.startsWith('library-reader-error'))route='/library/demo?state=reader-error';
else if(name.startsWith('record-save-error'))route='/records/new?state=save-error';
else route='/library?modal=tags';
if(name.endsWith('dark'))route+='&theme=dark';
const win=new BrowserWindow({width:frame.width,height:frame.height,useContentSize:true,frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
const errors=[],requests=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{requests.push(details.url);callback({cancel:true})});
await win.loadFile(path.resolve(__dirname,'../dist/index.html'),{hash:route});win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
const regions=await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return Array.from(document.querySelectorAll('[data-region],[data-overlay], [data-state] > svg, [data-state] > p, [data-state] > button')).filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return{name:el.dataset.region||el.dataset.overlay||el.getAttribute('data-state')||el.textContent||'状态图标',x:r.x,y:r.y,width:r.width,height:r.height};});})()`);
await new Promise(r=>setTimeout(r,120));let png;for(let attempt=0;attempt<3;attempt++){const image=await win.webContents.capturePage(undefined,{stayAwake:true});png=image.resize({width:frame.width,height:frame.height}).toPNG({scaleFactor:1});if((await sharp(png).stats()).channels.some(c=>c.stdev>5))break;await new Promise(r=>setTimeout(r,80));}
fs.writeFileSync(path.join(out,'implementation',name+'.png'),png);frames.push({name,route,viewport:{width:frame.width,height:frame.height},regions,errors,requests});console.log(name,errors.length+' errors');win.destroy();}
fs.writeFileSync(path.join(out,'render-checks.json'),JSON.stringify({passed:frames.every(f=>!f.errors.length&&!f.requests.length),frames},null,2));app.exit(frames.every(f=>!f.errors.length&&!f.requests.length)?0:1);
}catch(e){console.error(e);app.exit(1);}});app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
