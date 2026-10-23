import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {desktopVersion,versionChannel} from '../../packages/core/shared/desktop-release.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>v.startsWith('--')?[...a,[v.slice(2),all[i+1]]]:a,[]));
const version=args.version,dir=path.resolve(args.artifacts||''),release=path.resolve(args['release-dir']||'');
if(!desktopVersion(version)||!args.notes||!args.artifacts||!args['release-dir'])throw Error('需要 --version --artifacts --release-dir --notes');
const notes=fs.readFileSync(args.notes,'utf8').trim();if(!notes)throw Error('中文发布说明不能为空');
const record={version,channel:versionChannel(version),publishedAt:new Date().toISOString(),releaseNotes:notes,assets:{}};
const hash=(bytes,kind='sha256',format='hex')=>createHash(kind).update(bytes).digest(format);
const candidates={macos_arm64:`InspiraiNest-v${version}-macOS-arm64.zip`,macos_x64:`InspiraiNest-v${version}-macOS-x64.zip`,windows_x64:`InspiraiNest-v${version}-Windows-x64.exe`,macos_arm64_dmg:`InspiraiNest-v${version}-macOS-arm64.dmg`,macos_x64_dmg:`InspiraiNest-v${version}-macOS-x64.dmg`};
fs.mkdirSync(release,{recursive:true});
for(const [target,filename]of Object.entries(candidates)){
 const file=path.join(dir,filename);if(!fs.existsSync(file))continue;
 const bytes=fs.readFileSync(file),block=fs.existsSync(file+'.blockmap')?fs.readFileSync(file+'.blockmap'):null;if(!block&&!filename.endsWith('.dmg'))throw Error('Missing blockmap: '+filename);
 record.assets[target]={filename,size:bytes.length,sha256:hash(bytes),sha512:hash(bytes,'sha512','base64'),...(block?{blockmap:{filename:filename+'.blockmap',size:block.length,sha256:hash(block)}}:{})};
 for(const [name,data]of [[filename,bytes],...(block?[[filename+'.blockmap',block]]:[])]){const destination=path.join(release,name);if(fs.existsSync(destination)){if(hash(fs.readFileSync(destination))!==hash(data))throw Error('已发布版本文件不能覆盖：'+name);}else fs.writeFileSync(destination,data);}
}
if(!Object.keys(record.assets).length)throw Error('没有对应版本的安装包与 blockmap');
const filename=path.join(release,'desktop-release.json');let index={schemaVersion:1,releases:[]};if(fs.existsSync(filename))index=JSON.parse(fs.readFileSync(filename,'utf8'));
if(index.releases.some(r=>r.version===version))throw Error('该版本已发布，不可覆盖');
index.releases.push(record);const temp=filename+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(index,null,2)+'\n');fs.renameSync(temp,filename);
console.log(JSON.stringify({version,channel:record.channel,targets:Object.keys(record.assets)}));
