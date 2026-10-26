import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import yaml from 'js-yaml';
import {desktopVersion,compareDesktopVersions,versionChannel} from '../../packages/core/shared/desktop-release.mjs';

export const packageFeed=(version,platform)=>`${versionChannel(version)==='beta'?'beta':'latest'}${platform==='macos'?'-mac':''}.yml`;
export const origin='https://library.inspirai.store';
export const targets={windows_x64:'Windows-x64.exe',macos_arm64:'macOS-arm64.zip',macos_x64:'macOS-x64.zip',macos_arm64_dmg:'macOS-arm64.dmg',macos_x64_dmg:'macOS-x64.dmg'};
export const digest=(bytes,algorithm='sha256',format='hex')=>createHash(algorithm).update(bytes).digest(format);
export async function fileDigest(file,algorithm='sha256',format='hex'){
 const hash=createHash(algorithm);for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest(format);
}
export function unsignedPE(bytes){
 assert.equal(bytes.subarray(0,2).toString(),'MZ','Windows installer must be PE');
 const start=bytes.readUInt32LE(0x3c);assert.equal(bytes.subarray(start,start+4).toString('hex'),'50450000');
 const optional=start+24,magic=bytes.readUInt16LE(optional);assert([0x10b,0x20b].includes(magic));
 const certificate=optional+(magic===0x20b?112:96)+8*4;
 assert.equal(bytes.readUInt32LE(certificate),0,'Windows publication currently requires the unsigned CI path');assert.equal(bytes.readUInt32LE(certificate+4),0);
}
function safeName(name){assert.equal(path.basename(name),name);assert(!name.includes('\\'));return name;}
export async function preparePublication({version,platforms,artifacts,base,overlay,notes,source}){
 assert(desktopVersion(version),'Invalid desktop version');assert(notes?.trim(),'Missing release notes');
 assert.deepEqual([...new Set(platforms)].sort(),platforms.slice().sort());assert(platforms.length&&platforms.every(p=>['windows','macos'].includes(p)));
 assert.equal(base.schemaVersion,1);assert(Array.isArray(base.releases));
 const index=structuredClone(base),existing=index.releases.find(r=>r.version===version),record=existing||{version,channel:versionChannel(version),publishedAt:new Date().toISOString(),releaseNotes:notes.trim(),assets:{}};
 assert.equal(record.channel,versionChannel(version));const assets=[],files=[];let changed=false;
 // Check the entire set before making an overlay; an incomplete platform never becomes visible.
 for(const platform of platforms){
  const feed=yaml.load(fs.readFileSync(path.join(artifacts,packageFeed(version,platform)),'utf8'));assert.equal(feed.version,version,'Package/feed version mismatch');
  for(const[target,suffix]of Object.entries(targets).filter(([t])=>t.startsWith(platform==='windows'?'windows':'macos'))){
   const filename=`InspiraiNest-v${version}-${suffix}`,file=path.join(artifacts,filename),size=fs.statSync(file).size;assert(size>0);
   const sha256=await fileDigest(file),sha512=await fileDigest(file,'sha512','base64'),entry=feed.files.find(f=>f.url===filename);assert(entry,'Missing package in update feed: '+filename);assert.equal(entry.size,size);assert.equal(entry.sha512,sha512);
   if(platform==='windows'){unsignedPE(fs.readFileSync(file));assert.equal(fs.readFileSync(file+'.sha256','utf8').trim(),sha256);}
   const blockFile=file+'.blockmap';assert(fs.existsSync(blockFile),'Missing blockmap: '+filename);
   const blockmap={filename:filename+'.blockmap',size:fs.statSync(blockFile).size,sha256:await fileDigest(blockFile)};assert(blockmap.size>0);
   const previous=record.assets[target];if(previous){assert.equal(previous.sha256,sha256,'Published package cannot be replaced: '+filename);assert.equal(previous.sha512,sha512);assert.equal(previous.size,size);assert.deepEqual(previous.blockmap,blockmap);}
   const newer=index.releases.find(r=>compareDesktopVersions(r.version,version)>0&&r.assets[target]&&(versionChannel(version)==='beta'||r.channel==='stable'));assert(!newer,'Refusing to move a channel backwards');
   if(!previous){record.assets[target]={filename,size,sha256,sha512,blockmap,sourceCommit:source.commit,ciRun:source[platform]?.run||source.run,signed:platform==='macos',platformPublishedAt:new Date().toISOString()};changed=true;}
   assets.push({target,...record.assets[target]});files.push({filename,file,size,sha256},{filename:blockmap.filename,file:blockFile,size:blockmap.size,sha256:blockmap.sha256});
  }
 }
 if(!existing)index.releases.push(record);
 fs.mkdirSync(overlay,{recursive:true});for(const item of files)fs.copyFileSync(item.file,path.join(overlay,safeName(item.filename)));
 fs.writeFileSync(path.join(overlay,'desktop-release.json'),JSON.stringify(index,null,2)+'\n');
 return {schemaVersion:1,version,channel:record.channel,changed,source,assets,files:files.map(({file,...item})=>item),index};
}
export async function readPublic(fetcher=fetch){const r=await fetcher(origin+'/client-release.json',{redirect:'error'});assert(r.ok,'Cannot read official release index');return r.json();}
export async function verifyPublic(plan,{fetcher=fetch,full=true,before}={}){
 const current=await readPublic(fetcher),checks=[];
 for(const asset of plan.assets){
  const platform=asset.target.startsWith('windows')?'windows':'macos',feedFile=(plan.channel==='stable'?'latest':'beta')+(platform==='macos'?'-mac':'')+'.yml';
  const published=current.desktop.channels[plan.channel][asset.target];assert.equal(published?.version,plan.version,'Public version lag');assert.equal(published?.sha256,asset.sha256,'Public index hash mismatch');
  const fr=await fetcher(origin+`/updates/${platform}/${feedFile}`,{redirect:'error'});assert(fr.ok);assert.equal(fr.headers.get('cache-control'),'no-store');const feed=yaml.load(await fr.text());assert.equal(feed.version,plan.version);const entry=feed.files.find(f=>f.url===asset.filename);assert.equal(entry?.sha512,asset.sha512);assert.equal(entry?.size,asset.size);
  for(const item of [asset,asset.blockmap]){
   const route=`/updates/${platform}/${safeName(item.filename)}`,r=await fetcher(origin+route,{redirect:'error',headers:{'accept-encoding':'identity',...(full?{}:{Range:'bytes=0-15'})}});assert.equal(r.status,full?200:206,route);assert.equal(r.headers.get('etag'),'"sha256-'+item.sha256+'"');
   const hash=createHash('sha256');let count=0;for await(const chunk of r.body){count+=chunk.length;hash.update(chunk);}if(full){assert.equal(count,item.size);assert.equal(hash.digest('hex'),item.sha256);}else assert.equal(count,16);
   checks.push({route,size:item.size,sha256:item.sha256,complete:full});
  }
  const r=await fetcher(origin+'/downloads/'+asset.filename,{redirect:'error',headers:{Range:'bytes=0-15','accept-encoding':'identity'}});assert.equal(r.status,206);assert.equal(r.headers.get('etag'),'"sha256-'+asset.sha256+'"');await r.arrayBuffer();
 }
 if(before){if(plan.channel==='beta'){assert.deepEqual(current.desktop.channels.stable,before.desktop.channels.stable,'Beta publication changed the stable channel');assert.deepEqual(current.worker,before.worker,'Beta publication changed legacy stable downloads');}for(const key of ['android','ios','reader'])assert.deepEqual(current[key],before[key]);for(const[target,value]of Object.entries(before.worker))if(!plan.assets.some(a=>a.target===target))assert.deepEqual(current.worker[target],value);}
 const page=await fetcher(origin+'/download',{redirect:'error'});assert(page.ok,'Download page unavailable');assert((await page.text()).includes('worker-title'));
 return {at:new Date().toISOString(),version:plan.version,passed:true,checks,downloadPage:origin+'/download'};
}
