const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),sharp=require('sharp');
const out=path.resolve(__dirname,'../../../../design-review/desktop-refactor/stage-03-controls-v1');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'inspirainest-overlays-'));
app.setPath('userData',profile);app.on('window-all-closed',()=>{});
const reference={type:{x:192,y:212,width:240,height:188},more:{x:996,y:228,width:220,height:161},tags:{x:380,y:272,width:480,height:276},delete:{x:400,y:320,width:440,height:180}};
app.whenReady().then(async()=>{const frames=[];try{
for(const mode of ['light','dark'])for(const kind of ['type','more','tags','delete']){
 const name=(kind==='delete'?'record-delete-dialog':kind==='tags'?'library-tags-dialog':kind==='type'?'library-filter-open':'library-more-open')+'-'+mode;
 const win=new BrowserWindow({width:1240,height:820,useContentSize:true,frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await win.loadFile(path.resolve(__dirname,'../dist/index.html'),{hash:(kind==='delete'?'/records/demo':'/library/demo')+(mode==='dark'?'?theme=dark':'')});
 win.webContents.debugger.attach('1.3');
 await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
 const data=await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;
 const find=(selector,text)=>Array.from(document.querySelectorAll(selector)).find(el=>el.textContent===text);
 ${kind==='type'?"find('button','全部类型').click();":kind==='tags'?"find('button','标签').click();": "document.querySelector('section [aria-label=\"更多\"]').click();"}
 ${kind==='delete'?"await new Promise(r=>requestAnimationFrame(r));find('[role=menu] button','移至回收站').click();":''}
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const el=document.querySelector('[data-overlay]'),r=el.getBoundingClientRect();
 const regions=Array.from(el.querySelectorAll('[data-overlay-region],button,[data-region=搜索]')).map(e=>{const b=e.getBoundingClientRect();return{name:e.dataset.overlayRegion||(e.dataset.region === '搜索' ? '搜索框' : e.getAttribute('aria-label')||e.textContent),x:b.x,y:b.y,width:b.width,height:b.height,disabled:!!e.disabled}});
 return {name:${JSON.stringify(name)},kind:${JSON.stringify(kind)},mode:${JSON.stringify(mode)},actual:{x:r.x,y:r.y,width:r.width,height:r.height},regions,focused:document.activeElement.textContent||document.activeElement.getAttribute('aria-label')};})()`);
 await new Promise(resolve => setTimeout(resolve, 120));
 let png;for(let i=0;i<3;i++){const image=await win.webContents.capturePage(undefined,{stayAwake:true});png=image.resize({width:1240,height:820}).toPNG({scaleFactor:1});if((await sharp(png).stats()).channels.some(c=>c.stdev>5))break;await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');}
 fs.writeFileSync(path.join(out,'implementation',name+'.png'),png);
 data.reference=reference[kind];data.maxDelta=Math.max(...Object.keys(data.actual).map(k=>Math.abs(data.actual[k]-data.reference[k])));data.passed=data.maxDelta<=1;frames.push(data);console.log(name,data.maxDelta);win.destroy();
}
fs.writeFileSync(path.join(out,'overlay-checks.json'),JSON.stringify({passed:frames.every(f=>f.passed),referenceSource:'Pencil snapshot_layout tzKzA/eKTZw/ZAHkM/kf5j2; equivalent dark frames',frames},null,2));app.exit(frames.every(f=>f.passed)?0:1);
}catch(e){console.error(e);app.exit(1);}});app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
