import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {desktopVersion,compareDesktopVersions,versionChannel,updateChannel} from '../../../packages/core/shared/desktop-release.mjs';
const targets={macos_arm64:['macos','macOS-arm64.zip'],macos_x64:['macos','macOS-x64.zip'],windows_x64:['windows','Windows-x64.exe'],macos_arm64_dmg:['macos','macOS-arm64.dmg'],macos_x64_dmg:['macos','macOS-x64.dmg']};
export function desktopReleases(releaseDir){
 function releases(){
  try{
   const index=JSON.parse(fs.readFileSync(path.join(releaseDir,'desktop-release.json'),'utf8'));
   if(index.schemaVersion!==1||!Array.isArray(index.releases))return [];
   return index.releases.filter(r=>{
    if(!desktopVersion(r.version)||r.channel!==versionChannel(r.version)||typeof r.releaseNotes!=='string'||!r.assets||!Number.isFinite(Date.parse(r.publishedAt)))return false;
    return Object.entries(r.assets).every(([target,a])=>{
     const def=targets[target];if(!def||a.filename!==`InspiraiNest-v${r.version}-${def[1]}`||!/^[a-f0-9]{64}$/.test(a.sha256||'')||!/^[A-Za-z0-9+/]{86}==$/.test(a.sha512||'')||!Number.isSafeInteger(a.size)||a.size<=0)return false;
     if(fs.statSync(path.join(releaseDir,a.filename)).size!==a.size)return false;
     if(a.blockmap&&(!(a.blockmap.filename===a.filename+'.blockmap'&&/^[a-f0-9]{64}$/.test(a.blockmap.sha256||''))||fs.statSync(path.join(releaseDir,a.blockmap.filename)).size!==a.blockmap.size))return false;
     return true;
    })&&Object.keys(r.assets).length>0;
   }).sort((a,b)=>compareDesktopVersions(b.version,a.version));
  }catch{return [];}
 }
 const eligible=(channel,r)=>updateChannel(channel)==='beta'||r.channel==='stable';
 function select(channel,target){return releases().find(r=>eligible(channel,r)&&r.assets[target]);}
 function platformReleases(channel='stable'){
  return Object.fromEntries(Object.keys(targets).map(target=>{const r=select(channel,target);return [target,r?{...r.assets[target],version:r.version,channel:r.channel,publishedAt:r.publishedAt,url:'/downloads/'+r.assets[target].filename}:null];}));
 }
 function publicIndex(){const history=releases().map(r=>({version:r.version,channel:r.channel,publishedAt:r.publishedAt,releaseNotes:r.releaseNotes,assets:Object.fromEntries(Object.entries(r.assets).map(([t,a])=>[t,{...a,url:`/updates/${targets[t][0]}/${a.filename}`}]))}));return {schemaVersion:1,channels:{stable:platformReleases('stable'),beta:platformReleases('beta')},history};}
 function feed(platform,channel){
  const available=releases().filter(r=>eligible(channel,r)&&Object.keys(r.assets).some(t=>targets[t][0]===platform));if(!available.length)return null;
  const r=available[0],files=Object.entries(r.assets).filter(([t])=>targets[t][0]===platform).map(([,a])=>({url:a.filename,sha512:a.sha512,size:a.size}));
  return yaml.dump({version:r.version,files,path:files[0].url,sha512:files[0].sha512,releaseDate:r.publishedAt,releaseNotes:r.releaseNotes});
 }
 function assetList(){return releases().flatMap(r=>Object.entries(r.assets).flatMap(([t,a])=>[{...a,url:`/updates/${targets[t][0]}/${a.filename}`,aliases:['/downloads/'+a.filename]},...(a.blockmap?[{...a.blockmap,url:`/updates/${targets[t][0]}/${a.blockmap.filename}`}]:[])]));}
 return {releases,platformReleases,publicIndex,feed,assetList};
}
