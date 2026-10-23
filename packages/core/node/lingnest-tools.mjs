import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {hash} from './common.mjs';
export function lingnestToolPaths(home=os.homedir(),platform=process.platform){
 const bin=path.join(home,'.local','bin'),name=platform==='win32'?'lingnest.exe':'lingnest';
 return {binary:path.join(bin,name),skills:[path.join(home,'.agents','skills','lingnest-library'),path.join(home,'.codebuddy','skills','lingnest-library')]};
}
export function lingnestToolsStatus(options={}){
 const files=lingnestToolPaths(options.home,options.platform);
 return {schemaVersion:1,cli:fs.existsSync(files.binary),codexSkill:fs.existsSync(path.join(files.skills[0],'SKILL.md')),codebuddySkill:fs.existsSync(path.join(files.skills[1],'SKILL.md'))};
}
export function installLingnestTools({bundle,home=os.homedir(),platform=process.platform}={}){
 const targets=lingnestToolPaths(home,platform),binary=path.join(bundle,'bin',platform==='win32'?'lingnest.exe':'lingnest'),skill=path.join(bundle,'skills','lingnest-library');
 if(!fs.existsSync(binary)||!fs.existsSync(path.join(skill,'SKILL.md')))throw Error('此安装包尚未包含灵藏 CLI 和 Skill，请更新客户端');
 const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backups=[];
 const install=(source,target)=>{fs.mkdirSync(path.dirname(target),{recursive:true});const temp=target+'.install-'+stamp;fs.cpSync(source,temp,{recursive:true,dereference:false});if(fs.existsSync(target)){const backup=target+'.backup-'+stamp;fs.renameSync(target,backup);backups.push(backup);}fs.renameSync(temp,target);};
 install(binary,targets.binary);if(platform!=='win32')fs.chmodSync(targets.binary,0o755);
 for(const target of targets.skills.slice(0,1)){install(skill,target);for(const name of ['lingnest-collect','writing-workshop']){const source=path.join(bundle,'skills',name);if(fs.existsSync(path.join(source,'SKILL.md')))install(source,path.join(path.dirname(target),name));}}
 // Windows cmd entry lives alongside the signed executable; no PATH mutation.
 if(platform==='win32')fs.writeFileSync(path.join(path.dirname(targets.binary),'lingnest.cmd'),'@echo off\r\n"%~dp0lingnest.exe" %*\r\n');
 return {...lingnestToolsStatus({home,platform}),sha256:hash(fs.readFileSync(targets.binary)),backups:backups.length};
}
