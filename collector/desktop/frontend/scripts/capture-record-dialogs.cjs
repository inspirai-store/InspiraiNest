const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),sharp=require('sharp');
const out=path.resolve(__dirname,'../../../../design-review/desktop-refactor/stage-05-records-v1');
const manifest=JSON.parse(fs.readFileSync(path.join(out,'prototype-manifest.json')));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'inspirainest-states-'));app.setPath('userData',profile);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{const frames=[];fs.mkdirSync(path.join(out,'implementation'),{recursive:true});try{
for(const frame of manifest.screens){const name=frame.name;let route='/records/demo?modal='+ (name.includes('process')?'process':'conflict');
if(name.endsWith('dark'))route+='&theme=dark';
const win=new BrowserWindow({width:frame.width,height:frame.height,useContentSize:true,frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
const errors=[],requests=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{requests.push(details.url);callback({cancel:true})});
await win.loadFile(path.resolve(__dirname,'../dist/index.html'),{hash:route});win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
const regions=await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return Array.from(document.querySelectorAll('[data-region],[data-overlay],[data-overlay-region], [data-state] > svg, [data-state] > p, [data-state] > button')).filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return{name:el.dataset.region||el.dataset.overlay||el.dataset.overlayRegion||el.getAttribute('data-state')||el.textContent||'状态图标',x:r.x,y:r.y,width:r.width,height:r.height};});})()`);
await new Promise(r=>setTimeout(r,120));let png;for(let attempt=0;attempt<3;attempt++){const image=await win.webContents.capturePage(undefined,{stayAwake:true});png=image.resize({width:frame.width,height:frame.height}).toPNG({scaleFactor:1});if((await sharp(png).stats()).channels.some(c=>c.stdev>5))break;await new Promise(r=>setTimeout(r,80));}
fs.writeFileSync(path.join(out,'implementation',name+'.png'),png);frames.push({name,route,viewport:{width:frame.width,height:frame.height},regions,errors,requests});console.log(name,errors.length+' errors');win.destroy();}
fs.writeFileSync(path.join(out,'render-checks.json'),JSON.stringify({passed:frames.every(f=>!f.errors.length&&!f.requests.length),frames},null,2));app.exit(frames.every(f=>!f.errors.length&&!f.requests.length)?0:1);
}catch(e){console.error(e);app.exit(1);}});app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
