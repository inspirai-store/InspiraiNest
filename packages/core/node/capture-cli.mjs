#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import spawn from 'cross-spawn';
import {fileURLToPath} from 'node:url';
import {captureURL,identifyCaptureSource,contentDigest,validateCoverage} from './capture-contract.mjs';
import {parseCaptureDocument,assessCapturePage} from './capture-document.mjs';
import {validateCaptureAudits} from './capture-audit.mjs';

function command(program,args,{timeout=30000,cwd=process.cwd()}={}){return new Promise(resolve=>{let stdout='',stderr='',done=false,outputTruncated=false;const child=spawn(program,args,{cwd,shell:false,windowsHide:true,env:process.env});const timer=setTimeout(()=>{child.kill();finish({code:null,error:'TIMEOUT'});},timeout);const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve({...value,stdout,stderr,outputTruncated});};child.stdout.on('data',b=>{stdout+=b;if(stdout.length>16*1024*1024){outputTruncated=true;stdout=stdout.slice(0,16*1024*1024);}});child.stderr.on('data',b=>stderr=(stderr+b).slice(-2*1024*1024));child.on('error',error=>finish({code:null,error:error.code}));child.on('close',code=>finish({code}));});}
export async function doctor(){const commands={};for(const [name,args]of [['yt-dlp',['--version']],['ffmpeg',['-version']],['ffprobe',['-version']],['whisper',['--help']],['opencli',['--version']],['defuddle',['--help']],['pdftotext',['-v']],['tesseract',['--version']]]){let executable=name;let result=await command(executable,args,{timeout:10000});if(result.error==='ENOENT'&&process.platform==='darwin'&&fs.existsSync('/opt/homebrew/bin/'+name)){executable='/opt/homebrew/bin/'+name;result=await command(executable,args,{timeout:10000});}commands[name]={available:result.code===0,path:result.code===0?executable:null,version:(result.stdout||result.stderr).split('\n')[0].slice(0,160)};}return {version:1,platform:process.platform,commands,cloudEnabled:false};}
function writeNew(root,name,bytes){fs.mkdirSync(root,{recursive:true});const file=path.join(root,name);fs.writeFileSync(file,bytes,{flag:'wx'});return {path:name,sha256:contentDigest(bytes),bytes:Buffer.byteLength(bytes)};}
function saveExtraction(doc,url,out,{html='',method='http'}={}){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+Math.random().toString(16).slice(2,8);
  const original=writeNew(out,`original-${stamp}.txt`,doc.text),article=writeNew(out,`article-${stamp}.md`,doc.markdown||doc.text);
  const files=[{...original,role:'source'},{...article,role:'source'}];if(html)files.push({...writeNew(out,`source-${stamp}.html`,html),role:'local_snapshot'});
  const result={version:2,...identifyCaptureSource(url),canonical:url,title:doc.title,collectedAt:new Date().toISOString(),status:'extracted',method,textCharacters:doc.text.length,files,images:doc.images||[],quality:doc.quality,coverage:{version:1,items:files.filter(f=>f.role==='source').map((f,n)=>({id:n?'text-markdown':'text',kind:'text',state:'saved',label:n?'正文阅读版':'正文',path:f.path,sha256:f.sha256}))}};
  const manifest=writeNew(out,`extraction-${stamp}.json`,JSON.stringify(result,null,2));return {...result,manifest:manifest.path};
}
export async function extract(url,out){
  let response=await fetch(captureURL(url),{signal:AbortSignal.timeout(45000),headers:{'User-Agent':'LingnestCapture/1.0'},redirect:'follow'});
  if(!response.ok)throw Object.assign(Error(`来源返回 HTTP ${response.status}`),{code:[401,403].includes(response.status)?'SOURCE_ACCESS':'HTTP_ERROR'});
  captureURL(response.url);if(Number(response.headers.get('content-length'))>8*1024*1024)throw Error('正文超过 8 MiB，请使用文件采集');
  let total=0;const chunks=[];for await(const chunk of response.body){total+=chunk.length;if(total>8*1024*1024)throw Error('正文超过 8 MiB，请使用文件采集');chunks.push(chunk);}const html=Buffer.concat(chunks).toString('utf8'),mime=response.headers.get('content-type')??'';
  let doc;
  try{
    if(/(?:text\/plain|text\/markdown|application\/json)/i.test(mime)){
      const access=assessCapturePage({text:html,url:response.url});if(access.code)throw Object.assign(Error(access.reason),{code:access.code});
      doc={text:html,markdown:html,title:new URL(url).pathname,images:[],quality:{version:2,status:'needs_review',warnings:[],images:{expected:0,unresolved:0}}};
    }else if(/html/i.test(mime))doc=parseCaptureDocument(html,{url:response.url});
    else throw Object.assign(Error('请使用对应文件或媒体提取器'),{code:'SPECIALIST_REQUIRED'});
  }catch(error){if(['SOURCE_CHALLENGE','SOURCE_LOGIN','SOURCE_UNAVAILABLE','BROWSER_REQUIRED'].includes(error.code))writeNew(out,`access-${Date.now()}-${Math.random().toString(16).slice(2,8)}.json`,JSON.stringify({url:response.url,code:error.code,reason:error.message,collectedAt:new Date().toISOString()}));throw error;}
  return saveExtraction(doc,response.url,out,{html,method:'http'});
}
export async function browser(operation,input={},connectionFile=path.resolve('.capture-input/connection.json')){
  const descriptor=JSON.parse(fs.readFileSync(connectionFile,'utf8'));const endpoint=new URL(descriptor.endpoint);
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||!/^[-a-f0-9]{36}$/i.test(descriptor.sessionId))throw Error('本机采集连接无效');
  if(!['snapshot','observe','scroll','click','acquire','asset'].includes(operation))throw Error('页面操作无效');
  let response;try{response=await fetch(`${endpoint.origin}/sessions/${descriptor.sessionId}/${operation}`,{method:'POST',headers:{Authorization:'Bearer '+descriptor.token,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(['acquire','asset'].includes(operation)?60000:15000),redirect:'error'});}catch(error){throw Object.assign(Error(error.name==='TimeoutError'?'浏览器处理超时，请稍后从当前页面继续':'浏览器连接已失效，请在客户端重新连接页面'),{code:error.name==='TimeoutError'?'BROWSER_TIMEOUT':'BROWSER_DISCONNECTED'});}
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error),{code:result.code||'BROWSER_ERROR'});return result;
}
export async function collect(url,out,{connection=path.resolve('.capture-input/connection.json'),preferBrowser=false}={}){
  let result,fallback=null;const connected=fs.existsSync(connection);
  try{if(!preferBrowser)result=await extract(url,out);}catch(error){
    if(!connected||!['SOURCE_ACCESS','SOURCE_CHALLENGE','SOURCE_LOGIN','BROWSER_REQUIRED','HTTP_ERROR'].includes(error.code))throw error;
    fallback={code:error.code,reason:error.message};
  }
  if(!result||result.quality?.status==='partial'&&connected){
    const page=await browser('acquire',{url:captureURL(url)},connection);
    if(page.access?.kind&&page.access.kind!=='article')throw Object.assign(Error(page.access.reason),{code:page.access.code});
    result=saveExtraction(page,page.url,out,{html:page.html,method:'browser'});result.browserAcquisition=page.acquisition;
  }
  let downloaded=await assets(path.join(out,result.manifest),path.join(out,'images'),{connection});
  // A normal static article can need its browser session only for CDN images.
  if(connected&&result.method==='http'&&downloaded.images.some(i=>i.state==='missing')){
    try{await browser('acquire',{url:captureURL(url)},connection);downloaded=await assets(path.join(out,result.manifest),path.join(out,'images'),{connection});}catch(error){result.assetRecovery={code:error.code,reason:error.message};}
  }
  const images=downloaded.images.map(i=>i.path?{...i,path:'images/'+i.path}:i),warnings=[...(result.quality?.warnings||[])];
  const previousReading=result.files.find(f=>f.role==='source'&&f.path.endsWith('.md'));
  let reading=fs.readFileSync(path.join(out,previousReading.path),'utf8');
  for(const image of images){const remote=result.images.find(i=>i.url===image.url);for(const url of remote?.candidates||[image.url])reading=reading.split(url).join(image.path||'');}
  const localReading=writeNew(out,`reading-${Date.now()}-${Math.random().toString(16).slice(2,8)}.md`,reading);
  result.files=result.files.map(f=>f.path===previousReading.path?{...f,role:'local_snapshot'}:f).concat({...localReading,role:'source'});
  if(images.some(i=>i.state==='missing'))warnings.push({code:'MISSING_IMAGES',reason:`${images.filter(i=>i.state==='missing').length} 个正文配图未保存`});
  if(result.browserAcquisition?.complete===false)warnings.push({code:'BROWSER_LIMIT',reason:'页面滚动或展开未完成，保留待补齐'});
  const quality={...result.quality,version:2,status:warnings.length?'partial':'needs_review',warnings,images:{...result.quality?.images,saved:images.filter(i=>i.state==='saved').length,missing:images.filter(i=>i.state==='missing').length}};
  const audit={version:2,url:result.canonical,collectedAt:result.collectedAt,method:result.method,fallback,quality,files:result.files.filter(f=>f.role==='source'),images};
  const auditFile=writeNew(out,`capture-audit-${Date.now()}-${Math.random().toString(16).slice(2,8)}.json`,JSON.stringify(audit,null,2));
  return {...result,quality,images,audit:auditFile,coverage:{version:1,items:[...result.files.filter(f=>f.role==='source').map((f,n)=>({id:n?'text-markdown':'text',kind:'text',state:'saved',label:n?'正文阅读版':'正文',path:f.path,sha256:f.sha256})),...images.map((i,n)=>({id:'image-'+(n+1),kind:'image',state:i.state,label:i.alt||'正文配图 '+(n+1),...(i.path?{path:i.path,sha256:i.sha256}:{reason:i.reason})}))]}};
}
export async function transcribe(file,out,{language}={}){const env=await doctor(),tool=env.commands.whisper;if(!tool.available)throw Object.assign(Error('本机未检测到 Whisper，请配置转录工具后继续'),{code:'DEPENDENCY_MISSING'});fs.mkdirSync(out,{recursive:true});const result=await command(tool.path,[path.resolve(file),'--model','small','--output_dir',path.resolve(out),'--output_format','all',...(language?['--language',language]:[])],{timeout:60*60*1000});if(result.code!==0)throw Object.assign(Error(result.stderr||'本地转录失败'),{code:'TRANSCRIPTION_FAILED'});return {version:1,engine:'whisper-small',language:language??'auto',files:fs.readdirSync(out).filter(n=>/\.(txt|srt|vtt|json|tsv)$/.test(n)).map(n=>({path:n,sha256:contentDigest(fs.readFileSync(path.join(out,n)))}))};}
export async function media(url,out){const env=await doctor();if(!env.commands['yt-dlp'].available)throw Object.assign(Error('本机未检测到 yt-dlp，请配置媒体提取工具后继续'),{code:'DEPENDENCY_MISSING'});fs.mkdirSync(out,{recursive:true});const result=await command(env.commands['yt-dlp'].path,['--no-playlist','--no-overwrites','--write-info-json','--write-subs','--write-auto-subs','--sub-langs','zh.*,en.*','--sub-format','vtt','--skip-download','-o',path.join(path.resolve(out),'%(id)s.%(ext)s'),'--',captureURL(url)],{timeout:120000});if(result.code!==0)throw Object.assign(Error(result.stderr||'字幕提取失败'),{code:'SOURCE_ACCESS'});return {version:1,files:fs.readdirSync(out).map(n=>({path:n,sha256:contentDigest(fs.readFileSync(path.join(out,n)))})),requiresTranscription:!fs.readdirSync(out).some(n=>n.endsWith('.vtt'))};}
export async function downloadMedia(url,out){const env=await doctor();if(!env.commands['yt-dlp'].available)throw Object.assign(Error('本机未检测到 yt-dlp'),{code:'DEPENDENCY_MISSING'});fs.mkdirSync(out,{recursive:true});const result=await command(env.commands['yt-dlp'].path,['--no-playlist','--no-overwrites','--max-filesize','2G','-f','b[height<=720]/best','-o',path.join(path.resolve(out),'%(id)s.%(ext)s'),'--',captureURL(url)],{timeout:30*60*1000});if(result.code!==0)throw Object.assign(Error(result.stderr||'公开媒体下载失败'),{code:'SOURCE_ACCESS'});const files=fs.readdirSync(out).filter(n=>/\.(mp4|webm|mkv|m4a|mp3|ogg)$/.test(n)).map(n=>({path:n,sha256:contentDigest(fs.readFileSync(path.join(out,n))),origin:'downloaded',state:'temporary'}));fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({version:1,files},null,2),{flag:'wx'});return {version:1,files};}
export async function frames(file,out){const env=await doctor();if(!env.commands.ffmpeg.available)throw Object.assign(Error('本机未检测到 FFmpeg'),{code:'DEPENDENCY_MISSING'});fs.mkdirSync(out,{recursive:true});const result=await command(env.commands.ffmpeg.path,['-nostdin','-n','-i',path.resolve(file),'-vf','select=isnan(prev_selected_t)+gte(t-prev_selected_t\\,30),showinfo,scale=960:-1','-fps_mode','vfr','-frames:v','120',path.join(path.resolve(out),'frame-%04d.jpg')],{timeout:15*60*1000});if(result.code!==0)throw Object.assign(Error(result.stderr||'关键帧提取失败'),{code:'FRAME_FAILED'});const times=[...result.stderr.matchAll(/pts_time:([0-9.]+)/g)].map(m=>Number(m[1]));return {version:1,sampling:'间隔至少 30 秒，最多 120 帧；不是完整画面覆盖',files:fs.readdirSync(out).filter(n=>/^frame-\d+.jpg$/.test(n)).map((n,index)=>({path:n,start:times[index]??null,sha256:contentDigest(fs.readFileSync(path.join(out,n)))}))};}
export function checkEvidence(file){
  const root=fs.realpathSync(path.dirname(path.resolve(file))),meta=JSON.parse(fs.readFileSync(file,'utf8')),files=[],seen=new Set();
  function collect(relative,role){
    if(typeof relative!=='string'||relative.includes('\\')||path.isAbsolute(relative)||relative.split('/').some(p=>!p||p==='..'||p==='.'))throw Error('证据路径无效');
    const target=path.join(root,relative),stat=fs.lstatSync(target),resolved=fs.realpathSync(target);
    if(!resolved.startsWith(root+path.sep)||stat.isSymbolicLink())throw Error('证据路径无效');
    if(stat.isDirectory()){for(const name of fs.readdirSync(target).sort())collect(relative+'/'+name,role);return;}
    if(!stat.isFile()||stat.size>16*1024*1024)throw Error('证据文件无效或超过 16 MiB');
    if(seen.has(relative))return;seen.add(relative);files.push({path:relative,role,sha256:contentDigest(fs.readFileSync(target))});
  }
  if(!Array.isArray(meta.files))throw Error('缺少文件清单');for(const item of meta.files)collect(item.path,item.role);
  const coverage=validateCoverage(meta.coverage,files);
  validateCaptureAudits(meta,root,coverage);
  if(meta.status==='archived'&&(!coverage?.items.length||coverage.items.some(i=>i.state!=='analyzed')))throw Error('完整归档不能包含未分析或缺失证据');
  return {version:1,coverage,status:meta.status};
}
export async function localDocument(file,out,{ocr=false,language='chi_sim+eng'}={}){
  const env=await doctor(),name=ocr?'tesseract':'pdftotext',tool=env.commands[name];if(!tool.available)throw Object.assign(Error(`本机未检测到 ${name}`),{code:'DEPENDENCY_MISSING'});
  const result=await command(tool.path,ocr?[path.resolve(file),'stdout','-l',language]:['-layout',path.resolve(file),'-'],{timeout:300000});if(result.code!==0)throw Object.assign(Error(result.stderr||'本地文本提取失败'),{code:'EXTRACTION_FAILED'});
  if(result.outputTruncated)throw Object.assign(Error('提取文本超过 16 MiB，请按页拆分后继续'),{code:'DOCUMENT_TOO_LARGE'});
  if(!result.stdout.trim())throw Object.assign(Error(ocr?'OCR 未识别到文字，请检查图像和语言包':'PDF 没有可提取文字，需要逐页 OCR'),{code:ocr?'OCR_EMPTY':'OCR_REQUIRED'});
  const saved=writeNew(out,(ocr?'ocr-':'document-')+Date.now()+'.txt',result.stdout);return {version:1,engine:name,file:saved,characters:result.stdout.length,state:'saved',needsReview:true};
}
export async function assets(manifestFile,out,{connection=path.resolve('.capture-input/connection.json')}={}){
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));const images=manifest.images;if(!Array.isArray(images)||images.length>200)throw Error('配图清单无效');const results=[];
  for(const [index,item]of images.entries()){
    try{
      let bytes,mime,error,svg;const candidates=[...new Set([item.url,...(item.candidates||[])])];
      for(const url of candidates){try{const res=await fetch(captureURL(url),{signal:AbortSignal.timeout(15000),headers:{...(manifest.canonical?{Referer:manifest.canonical}:{}),'User-Agent':'LingnestCapture/1.0'}});if(!res.ok)throw Error('HTTP '+res.status);mime=(res.headers.get('content-type')||'').split(';')[0].trim();const parts=[];let size=0;for await(const b of res.body){size+=b.length;if(size>16*1024*1024)throw Error('图片超过 16 MiB');parts.push(b);}bytes=Buffer.concat(parts);if(mime==='image/svg+xml'){svg=bytes;bytes=null;error=Error('SVG 需要生成阅读图片');break;}if(!imageExtension(mime,bytes))throw Error('来源未返回可识别图片');break;}catch(e){bytes=null;error=e;}}
      let original;
      if(!bytes&&fs.existsSync(connection)){const image=await browser('asset',{url:item.url,svg:svg?.toString('base64')},connection);bytes=Buffer.from(image.bytes,'base64');mime=image.mime;if(image.original){original=writeNew(out,`original-${Date.now()}-${index}.svg`,Buffer.from(image.original,'base64'));}}
      if(!bytes)throw error||Error('配图未取得');const ext=imageExtension(mime,bytes);if(!ext)throw Error('非支持的图片格式');
      const saved=writeNew(out,`image-${Date.now()}-${index}.${ext}`,bytes);results.push({...saved,url:item.url,role:'image',state:'saved',alt:String(item.alt??''),...(original?{original}:{})});
    }catch(error){results.push({url:item.url,state:'missing',reason:error.message});}
  }
  return {version:1,images:results,status:results.some(r=>r.state==='missing')?'partial':'saved'};
}
function imageExtension(mime,b){
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(b[0]===255&&b[1]===216&&b[2]===255)return 'jpg';
  if(/^GIF8[79]a/.test(b.subarray(0,6).toString()))return 'gif';
  if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'webp';
  if(b.subarray(4,12).toString().match(/ftypavif|ftypavis/))return 'avif';
  return null;
}
export async function main(args=process.argv.slice(2)){
  const option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};const out=option('out');
  switch(args[0]){
    case 'doctor':return doctor();
    case 'extract':if(!out)throw Error('需要 --out 目录');return extract(args[1],out);
    case 'collect':if(!out)throw Error('需要 --out 目录');return collect(args[1],out,{connection:option('connection'),preferBrowser:args.includes('--page')});
    case 'browser':{const result=await browser(args[1],{url:option('url'),selector:option('selector'),observationId:option('observation'),elementId:option('element'),y:Number(option('y'))},option('connection'));if(out&&args[1]==='snapshot'){if(result.access?.code)throw Object.assign(Error(result.access.reason),{code:result.access.code});const file=writeNew(out,`page-${Date.now()}.txt`,result.text);return {...result,text:undefined,html:undefined,markdown:undefined,file};}return result;}
    case 'transcribe':if(!out)throw Error('需要 --out 目录');return transcribe(args[1],out,{language:option('language')});
    case 'media':if(!out)throw Error('需要 --out 目录');return media(args[1],out);
    case 'download':if(!out)throw Error('需要 --out 目录');return downloadMedia(args[1],out);
    case 'frames':if(!out)throw Error('需要 --out 目录');return frames(args[1],out);
    case 'validate':return checkEvidence(args[1]);
    case 'document':if(!out)throw Error('需要 --out 目录');return localDocument(args[1],out);
    case 'ocr':if(!out)throw Error('需要 --out 目录');return localDocument(args[1],out,{ocr:true,language:option('language')});
    case 'assets':if(!out)throw Error('需要 --out 目录');return assets(args[1],out,{connection:option('connection')});
    default:return {version:2,name:'lingnest-capture',commands:['doctor','collect URL --out DIR [--page]','extract URL --out DIR','browser snapshot --out DIR','browser observe','browser scroll --observation ID --y 800','browser click --observation ID --element ID','media URL --out DIR','download URL --out .capture-cache','transcribe FILE --out DIR [--language zh]','frames FILE --out DIR','document FILE --out DIR','ocr FILE --out DIR [--language chi_sim+eng]','assets MANIFEST_JSON --out DIR','validate SOURCE_JSON']};
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(result=>process.stdout.write(JSON.stringify({ok:true,...result})+'\n')).catch(error=>{process.stdout.write(JSON.stringify({ok:false,code:error.code??'CAPTURE_ERROR',error:error.message})+'\n');process.exitCode=1;});
