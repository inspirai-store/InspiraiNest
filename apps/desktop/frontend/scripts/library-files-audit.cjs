const fs=require('node:fs'),path=require('node:path');
exports.watch=(window,build)=>{
 let last='',running=false;
 const timer=setInterval(async()=>{
  if(running||window.isDestroyed())return;running=true;
  try{
   const result=await window.webContents.executeJavaScript(`(()=>{
    const measure=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,w:r.width,h:r.height,padding:s.padding,gap:s.gap,radius:s.borderRadius,fontSize:s.fontSize,fontFamily:s.fontFamily,fontWeight:s.fontWeight,lineHeight:s.lineHeight,background:s.backgroundColor,whiteSpace:s.whiteSpace,wordSpacing:s.wordSpacing,letterSpacing:s.letterSpacing,textAutospace:s.textAutospace,textOverflow:s.textOverflow,overflow:s.overflow,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,outline:s.outline,outlineOffset:s.outlineOffset};};
    const metrics=document.createElement('canvas').getContext('2d');const fontWidths=['12px "PingFang SC"','12px Arial'].map(font=>{metrics.font=font;return {font,width:metrics.measureText('文档 · 240 KB').width};});
    const rows=[...document.querySelectorAll('[data-region="附件行"],[data-region="回收站条目"]')].map(e=>({kind:e.dataset.region,...measure(e),text:e.textContent,children:[...e.children].map(measure),textNodes:[...e.querySelectorAll('strong,span')].map(n=>({text:n.textContent,...measure(n)}))}));
    const states=[...document.querySelectorAll('[data-region="附件状态"],[data-region="回收站状态"]')].map(e=>({kind:e.dataset.region,state:e.dataset.state,...measure(e),children:[...e.children].map(measure)}));
    const readerLines=[...document.querySelectorAll('[data-region="阅读正文"] p,[data-region="阅读正文"] h3,[data-region="阅读正文"] h4,[data-region="阅读正文"] li')].map(e=>{const range=document.createRange();range.selectNodeContents(e);return {tag:e.tagName,text:e.textContent,...measure(e),lineRects:[...range.getClientRects()].map(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))};});
    const regions=[...document.querySelectorAll('[data-region]')].map(e=>({name:e.dataset.region,...measure(e)}));
    const menus=[...document.querySelectorAll('[role="menu"]')].map(e=>({...measure(e),children:[...e.children].map(measure)}));
    const dialog=document.querySelector('dialog[open]'),panel=document.querySelector('[role="tabpanel"]');
    return {theme:document.querySelector('[data-theme]')?.getAttribute('data-theme'),viewport:{width:innerWidth,height:innerHeight,scale:devicePixelRatio},rows,states,menus,regions,readerLines,fontWidths,dialog:dialog?measure(dialog):null,panel:panel?measure(panel):null,focusedPanel:panel===document.activeElement};
   })()`);
   const signature=JSON.stringify(result);if(signature!==last&&(result.rows.length||result.states.length||result.menus.length||result.dialog||result.focusedPanel)){
    last=signature;const dir=path.resolve(__dirname,'../../../../design-review/desktop-refactor/stage-05-library-v1/evidence');
    const kind=result.menus.length?'menu':result.states.length?'state-'+(result.dialog?'trash-':'attachments-')+result.states[0].state:result.dialog?'trash-or-preview':result.focusedPanel?'focus':'attachments';
    const report=JSON.stringify({build,...result},null,2);fs.writeFileSync(path.join(dir,'native-files-layout-'+kind+'.json'),report);fs.writeFileSync(path.join(dir,'native-files-layout-'+kind+'-'+result.viewport.width+'-'+result.theme+'.json'),report);
   }
  }catch(error){if(!window.isDestroyed())console.error('Read-only files audit:',error.message);}finally{running=false;}
 },1000);
 window.once('closed',()=>clearInterval(timer));
};
