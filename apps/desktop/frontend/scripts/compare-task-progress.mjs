import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const sharp=createRequire(import.meta.url)('sharp');
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../design-review/desktop-refactor/stage-06-tasks-v1');
const pairs={review:['hwyMR','pmdoY'],running:['JJBWD','QRkVz'],waiting:['W1mus','HIayZ'],failed:['DtpVo','0UwmY'],completed:['bMsqk','zqcaI'],approve:['Xqj2g','O9Q05'],cancel:['rGBpf','PALQc'],reassign:['1RAVL','RAdWQ'],retry:['jyJaY','Imb4J'],more:['7jwsN','FSe7l'],empty:['aruYe','a4JeR'],'no-results':['2TuVk','bBOlF'],'list-error':['7aGyO','oNLJp'],loading:['BOwlC','bOQkh'],'preview-error':['hfNr9','629ie'],'action-error':['YGjDT','dl1ab'],'review900':['zEJEJ','LxpXp'],'review740':['Q7MsP','YfS3k']};
const manifest=[];
for(const [kind,ids] of Object.entries(pairs))for(const [i,theme] of ['light','dark'].entries()){
 const width=kind.endsWith('900')?900:kind.endsWith('740')?740:1240;
 const name=kind.replace(/900|740/,'')+'-'+width+'-'+theme;
 const image=dir+'/evidence/client-'+name+'.png',reference=dir+'/prototype-2x/'+ids[i]+'.png';
 const metadata=JSON.parse(await fs.readFile(dir+'/evidence/client-'+name+'.json'));
 const a=await sharp(image).metadata(),b=await sharp(reference).metadata();
 if(a.width!==b.width||a.height!==b.height)throw Error('Dimension mismatch: '+name);
 const {data,info}=await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 for(let p=3;p<data.length;p+=4)data[p]=Math.round(data[p]*.5);
 await sharp(reference).composite([{input:data,raw:info}]).png().toFile(dir+'/evidence/overlay-'+name+'.png');
 manifest.push({name,prototype:ids[i],build:metadata.build,width:a.width,height:a.height,resized:false,alpha:.5});
}
await fs.writeFile(dir+'/evidence/task-progress-overlay-manifest.json',JSON.stringify(manifest,null,2));
let html='<!doctype html><meta charset="utf-8"><title>任务客户端复测</title><style>body{font:15px system-ui;margin:32px;background:#eee}section{margin:32px 0}img{width:100%;max-width:1240px}a{color:#111}</style><h1>任务客户端复测</h1><p>36 张实际 Electron 内容截图及原尺度50%叠加图。核心、菜单、确认框、窄窗口；会话与数值校准专项仍继续，不代表模块完整验收。</p>';
for(const s of manifest)html+=`<section><h2>${s.name}</h2><p>构建 ${s.build}</p><a href="evidence/client-${s.name}.png">客户端</a> · <a href="prototype-2x/${s.prototype}.png">Pencil</a> · <a href="evidence/client-${s.name}.json">布局数据</a><img src="evidence/overlay-${s.name}.png"></section>`;
await fs.writeFile(dir+'/client-progress-review.html',html);
console.log({scenes:manifest.length,builds:[...new Set(manifest.map(x=>x.build))]});
