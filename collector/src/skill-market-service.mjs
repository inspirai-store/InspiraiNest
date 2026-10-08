import yauzl from 'yauzl';
import { crc32 } from 'node:zlib';
import { hash, now, requireValue, safePath, canonicalJson } from './common.mjs';
import { SKILL_AGENTS, MAX_SKILL_BYTES, skillMetadata, skillDigest, validateSkillPackage, cleanSkillPolicy } from './skill-package.mjs';
import { workerAuthorized, workerOnline } from './device-metadata.mjs';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const label = (value, max = 200) => {
  requireValue(typeof value === 'string' && value.length <= max && !/[\x00-\x1f]/.test(value), '技能参数无效');
  return value.trim();
};
const publicVersion = ({ key, files, ...version }) => ({ ...version, fileCount:files.length });
const marketItem = version => ({ ...publicVersion(version), slug:version.id, provider:'lingnest', version:version.declaredVersion || version.hash.slice(0,12), owner:'灵藏技能库', source:'private', category:'private', downloads:0, stars:0, installs:0 });
const bounded = async (response, limit) => {
  requireValue(response.ok, 'SkillHub 下载暂时不可用，请重试', 502);
  requireValue(Number(response.headers.get('content-length') || 0) <= limit, '技能包过大', 413);
  const reader=response.body?.getReader();requireValue(reader,'技能下载为空',502);
  const chunks=[];let total=0;
  try { while(true){ const {done,value}=await reader.read();if(done)break;total+=value.byteLength;requireValue(total<=limit,'技能包过大',413);chunks.push(Buffer.from(value)); } }
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks);
};

// Parse without writing any archive path to disk; packages still pass the same
// reference, credential, filename and hash validation used by private publishing.
export async function skillZip(bytes) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length <= MAX_SKILL_BYTES, '技能包过大',413);
  const zip=await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?reject(e):resolve(z)));
  const files=[];let count=0,total=0;
  await new Promise((resolve,reject)=>{
    let failed=false;
    const stop=error=>{if(!failed){failed=true;zip.close();reject(error);}};
    zip.on('error',stop);zip.on('end',resolve);
    zip.on('entry',async entry=>{
      try{
        requireValue(++count<=1200,'技能文件过多');
        const directory=entry.fileName.endsWith('/'), name=directory?entry.fileName.slice(0,-1):entry.fileName;
        safePath(name);
        const mode=entry.externalFileAttributes>>>16, type=mode&0o170000;
        requireValue(!type || type===(directory?0o040000:0o100000),'技能包不能包含符号链接或特殊文件');
        requireValue(!(entry.generalPurposeBitFlag&1),'技能包不能加密');
        total+=entry.uncompressedSize;requireValue(total<=MAX_SKILL_BYTES,'技能包解压后超过 16 MiB',413);
        if(!directory){
          const stream=await new Promise((resolve,reject)=>zip.openReadStream(entry,(e,s)=>e?reject(e):resolve(s)));
          const chunks=[];let actual=0;
          for await(const chunk of stream){actual+=chunk.length;requireValue(actual<=entry.uncompressedSize && actual<=MAX_SKILL_BYTES,'技能解压大小无效');chunks.push(chunk);}
          const body=Buffer.concat(chunks);
          requireValue(actual===entry.uncompressedSize && crc32(body)===entry.crc32,'技能 ZIP 校验失败');
          files.push({path:name,bytes:body.length,sha256:hash(body),executable:Boolean(mode&0o111),body:body.toString('base64')});
        }
        if(!failed)zip.readEntry();
      }catch(error){stop(error);}
    });
    zip.readEntry();
  });
  const entries=files.filter(file=>/(^|\/)SKILL\.md$/.test(file.path));
  requireValue(entries.length===1,'下载包必须包含一个完整的 SKILL.md');
  const prefix=entries[0].path.slice(0,-8);
  const selected=files.filter(file=>file.path.startsWith(prefix)).map(file=>({...file,path:file.path.slice(prefix.length)}));
  const metadata=skillMetadata(Buffer.from(entries[0].body,'base64').toString('utf8'));
  const bundle={schemaVersion:1,name:metadata.name,description:String(metadata.description || '').slice(0,1024),declaredVersion:String(metadata.metadata?.version || metadata.version || '').slice(0,100),files:selected,omitted:files.filter(file=>!file.path.startsWith(prefix)).map(file=>file.path),hash:skillDigest(selected)};
  return validateSkillPackage(bundle);
}

export function createSkillMarketService({store,storage,skillHub,serialized,owner,body,send,fetcher=fetch,clock=Date.now}) {
  let downloads=0;
  async function download(slug,version){
    requireValue(downloads<4,'技能下载繁忙，请稍后重试',429);downloads++;
    const signal=AbortSignal.timeout(30000);
    try{
      const query=new URLSearchParams({slug,version});
      let response=await fetcher('https://api.skillhub.cn/api/v1/download?'+query,{redirect:'manual',signal,headers:{Accept:'application/zip'}});
      if([301,302,303,307,308].includes(response.status)){
        const target=new URL(response.headers.get('location'));
        await response.body?.cancel();
        // Only the verified SkillHub distribution origin; never accept a URL
        // supplied by a renderer, or forward a library token/cookie to this host.
        requireValue(target.protocol==='https:' && target.hostname==='skillhub-1388575217.cos.accelerate.myqcloud.com' && !target.username && !target.password && target.pathname===`/skills/${slug}/${version}.zip`, 'SkillHub 下载版本或来源已变化，请重新查看详情',409);
        response=await fetcher(target.href,{redirect:'error',signal,headers:{Accept:'application/zip'}});
      }
      const bytes=await bounded(response,MAX_SKILL_BYTES);
      return {bundle:await skillZip(bytes),archiveSha256:hash(bytes)};
    }finally{downloads--;}
  }
  async function preview(version){
    const bundle=validateSkillPackage(JSON.parse((await storage.get(version.key)).toString('utf8')));
    requireValue(bundle.hash===version.hash,'保存的技能版本校验失败',500);
    return {version:publicVersion(version),preview:{markdown:Buffer.from(bundle.files.find(f=>f.path==='SKILL.md').body,'base64').toString('utf8').slice(0,65536),files:bundle.files.map(({body,...file})=>file),omitted:bundle.omitted || []}};
  }
  async function request(input){
    const provider=input.provider || 'skillhub';
    requireValue(['skillhub','lingnest'].includes(provider),'技能来源无效');
    if(provider==='skillhub')return skillHub.request(input);
    if(input.kind==='categories')return {items:[{key:'private',name:'私有技能'}]};
    const versions=(await store.list('skill-version')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    if(input.kind==='detail'){
      const version=versions.find(v=>v.id===input.slug);requireValue(version,'技能版本不存在',404);
      return {item:marketItem(version)};
    }
    requireValue(input.kind==='search','技能市场请求无效');
    const keyword=label(input.keyword || '').toLocaleLowerCase(),page=Number(input.page || 1),pageSize=Number(input.pageSize || 20);
    requireValue(Number.isSafeInteger(page)&&page>0&&page<=100000&&Number.isSafeInteger(pageSize)&&pageSize>0&&pageSize<=100,'分页无效');
    const selected=versions.filter(v=>!keyword || [v.name,v.description,v.declaredVersion].some(x=>String(x || '').toLocaleLowerCase().includes(keyword)));
    return {total:selected.length,page,pageSize,items:selected.slice((page-1)*pageSize,page*pageSize).map(marketItem)};
  }
  async function inventory(input){
    const agents=SKILL_AGENTS;requireValue(!input.agent || agents.includes(input.agent),'Agent 无效');
    const nodes=(await store.list('device')).filter(d=>!d.revokedAt&&!d.canonicalDeviceId&&workerAuthorized(d)&&(!input.deviceId || d.id===input.deviceId));
    const keyword=label(input.keyword || '').toLocaleLowerCase(),page=Number(input.page || 1);
    requireValue(Number.isSafeInteger(page)&&page>0&&page<=100000,'分页无效');
    const snapshots=await Promise.all(nodes.map(d=>store.get('skill-environment',d.id)));
    const items=nodes.flatMap((device,i)=>(snapshots[i]?.items || []).filter(s=>(!input.agent || s.agent===input.agent)&&(!keyword || [s.name,s.description,s.directory,s.realDirectory].some(x=>String(x || '').toLocaleLowerCase().includes(keyword)))).map(s=>({...s,deviceId:device.id,deviceName:device.name,online:workerOnline(device,clock()),scannedAt:snapshots[i].scannedAt})));
    return {total:items.length,page,pageSize:40,items:items.slice((page-1)*40,page*40),nodes:nodes.map((device,i)=>({id:device.id,name:device.name,online:workerOnline(device,clock()),scannedAt:snapshots[i]?.scannedAt || null,agents:snapshots[i]?.agents || [],count:snapshots[i]?.items.length || 0}))};
  }
  async function importVersion(input,device){
    const provider=input.provider;
    if(provider==='lingnest'){
      requireValue(digest(input.versionId),'技能版本无效');const version=await store.get('skill-version',input.versionId);requireValue(version,'技能版本不存在',404);return preview(version);
    }
    requireValue(provider==='skillhub','技能来源无效');
    const slug=label(input.slug),version=label(input.version,100);
    requireValue(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(slug)&&/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(version),'技能或版本标识无效');
    requireValue(typeof input.requestId==='string'&&/^[\w-]{1,100}$/.test(input.requestId),'安装请求标识无效');
    const importId=hash((device.credentialId || device.id)+':'+input.requestId),fingerprint=canonicalJson({provider,slug,version});
    return serialized('skill-import:'+importId,async()=>{
      const old=await store.get('skill-import',importId);
      if(old){requireValue(old.fingerprint===fingerprint,'安装请求标识已用于其他版本',409);return preview(await store.get('skill-version',old.versionId));}
      const detail=await skillHub.request({kind:'detail',slug});
      requireValue(detail.item.version===version,'市场版本已更新，请重新查看详情',409);
      const {bundle,archiveSha256}=await download(slug,version),metadata=skillMetadata(Buffer.from(bundle.files.find(f=>f.path==='SKILL.md').body,'base64').toString('utf8'));
      const declared=metadata.metadata?.['lingnest-requirements'];
      const policy=cleanSkillPolicy({requirements:declared?JSON.parse(declared):undefined}),key='private/skills/'+bundle.hash+'.json';
      // The package is merely installed. No capability, dependency readiness or
      // extraction verification is inferred from the market's popularity.
      const versionId=hash(canonicalJson({hash:bundle.hash,policy}));
      const record={id:versionId,schemaVersion:1,key,hash:bundle.hash,name:bundle.name,description:bundle.description,declaredVersion:version,policy,createdAt:now(),source:{provider:'skillhub',slug,version,archiveSha256,requirementsDeclared:Boolean(declared)},files:bundle.files.map(({body,...file})=>file)};
      await storage.put(key,Buffer.from(JSON.stringify(bundle)));
      await store.transaction(async tx=>{
        const authorized=await tx.getForUpdate('device',device.credentialId || device.id);requireValue(authorized&&!authorized.revokedAt,'客户端授权已失效',401);
        if(!await tx.get('skill-version',record.id))await tx.put('skill-version',record);
        await tx.put('skill-import',{id:importId,fingerprint,versionId:record.id,createdAt:now()});
      });
      return preview(await store.get('skill-version',record.id));
    });
  }
  async function handle(req,res,route,device){
    if(!['/api/skills/market','/api/skills/market/import','/api/skills/installed'].includes(route))return false;
    owner(device);const input=Object.fromEntries(new URL(req.url,'http://local').searchParams);
    if(route==='/api/skills/market'&&req.method==='GET')send(res,200,await request(input));
    else if(route==='/api/skills/installed'&&req.method==='GET')send(res,200,await inventory(input));
    else if(route==='/api/skills/market/import'&&req.method==='POST')send(res,200,await importVersion(await body(req),device));
    else requireValue(false,'Method not allowed',405);
    return true;
  }
  return {handle};
}

