// Disposable loopback REST services for manual native-client regression. No UI automation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createService} from '../../services/api/server.mjs';
import {api} from '../../services/worker/worker.mjs';
import {createWorkerEvents} from '../../packages/core/node/worker-events.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.NATIVE_REGRESSION_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'inspirainest-native-021-'));
const previous=fs.existsSync(path.join(root,'manifest.json'))?JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))):null;
const filesDir=path.join(root,'files');fs.mkdirSync(filesDir,{recursive:true});
function pdfFixture(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 3 /Kids [3 0 R 5 0 R 7 0 R] >>'];
 for(let page=1;page<=3;page++){const content=`0.15 0.15 0.15 rg 30 40 ${70*page} 50 re f BT /F1 22 Tf 30 400 Td (Native PDF - Page ${page}) Tj ET`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 380 468] /Resources << /Font << /F1 9 0 R >> >> /Contents ${objects.length+2} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);}
 objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(pdf);return Buffer.from(pdf+`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
fs.writeFileSync(path.join(filesDir,'native-3-pages.pdf'),pdfFixture());
fs.copyFileSync(path.join(here,'../../packages/core/web/records/fixtures/route.mp4'),path.join(filesDir,'route.mp4'));
const targets={},requests=[];
for(const label of ['A','B']){
 const key='native-021-disposable-regression-account-'+label;
 const service=createService({dataDir:path.join(root,'service-'+label),masterKey:key});
 await new Promise(resolve=>service.server.listen(previous?Number(new URL(previous.spaces[label].server).port):0,'127.0.0.1',resolve));
 const port=service.server.address().port,server='http://127.0.0.1:'+port;
 const owner={server,...await api({server},'/api/pair','POST',{key,name:'Native regression initializer '+label})};
 targets[label]={service,port,server,key,owner,offline:false};
 service.server.on('request',(req,res)=>{if(req.method==='PUT'&&/^\/api\/records\/[a-f0-9-]+$/.test(req.url)){const end=res.end;res.end=function(chunk,...args){requests.push({label,route:req.url,status:res.statusCode,response:chunk?.toString()});return end.call(this,chunk,...args);};}});
 const assets=[['summary.md','summary',Buffer.from(`# 空间 ${label} 预览回归\n\n[阅读 PDF](native-3-pages.pdf)\n\n[播放视频](route.mp4)`)],['native-3-pages.pdf','document',pdfFixture()],['route.mp4','document',fs.readFileSync(path.join(filesDir,'route.mp4'))]];
 const files=assets.map(([file,role,body])=>({path:file,role,bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex'),body:body.toString('base64')}));
 const stamp=new Date().toISOString();
 if(!(await service.store.list('archive')).length)await api(owner,'/api/archives','POST',{version:1,meta:{schema_version:1,id:'native-preview-'+label.toLowerCase(),title:'空间 '+label+' 预览回归',summary:'PDF 与视频预览',type:'article',status:'archived',verification_status:'source_only',coverage_note:'Disposable native regression files',mode:'general',scenario:null,tags:['QA'],aliases:[],related:[],published_at:null,collected_at:stamp,organized_at:stamp,verified_at:null,source_url:null,canonical_url:null,files:files.map(({path,role})=>({path,role}))},files,omitted:[]});
}
const config=path.join(root,'worker.json'),dataDir=path.join(root,'worker');
if(!fs.existsSync(config))fs.writeFileSync(config,JSON.stringify({dataDir,capabilities:['note'],defaultAgent:'codex'}),{mode:0o600});
const journal=createWorkerEvents(dataDir);journal.event({domain:'system',code:'WORKER_START',message:'采集服务已启动，准备领取任务'});journal.event({domain:'system',code:'CONTROL',message:'已暂停领取，当前任务继续执行'});journal.fault('regression-active',{code:'CONNECTION',message:'隔离服务连接中断'});journal.fault('regression-resolved',{code:'RECOVERED',message:'隔离服务历史连接中断'});journal.recover('regression-resolved','隔离服务连接已恢复');
const control=http.createServer(async(req,res)=>{try{
 const [action,label]=req.url.slice(1).split('/');const target=targets[label];
 if(req.method==='POST'&&target&&action==='offline'){if(!target.offline){const closed=new Promise(resolve=>target.service.server.close(resolve));target.service.server.closeAllConnections();await closed;target.offline=true;}}
 else if(req.method==='POST'&&target&&action==='online'){if(target.offline){await new Promise(resolve=>target.service.server.listen(target.port,'127.0.0.1',resolve));target.offline=false;}}
 else if(req.url!=='/snapshot'){res.writeHead(404).end();return;}
 const snapshot={requests,spaces:{}};for(const [name,t] of Object.entries(targets))snapshot.spaces[name]={offline:t.offline,records:await t.service.store.list('capture'),tasks:(await t.service.store.list('task')).length};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot));
 }catch(error){res.writeHead(500).end(JSON.stringify({error:error.message}));}});
await new Promise(resolve=>control.listen(previous?Number(new URL(previous.control).port):0,'127.0.0.1',resolve));
const manifest={root,config,filesDir,frontend:path.resolve(here,'../desktop/frontend/dist/index.html'),control:'http://127.0.0.1:'+control.address().port,spaces:Object.fromEntries(Object.entries(targets).map(([label,t])=>[label,{server:t.server,key:t.key}]))};
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});console.log(JSON.stringify(manifest));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{control.close();for(const t of Object.values(targets))await t.service.close();process.exit(0);});
