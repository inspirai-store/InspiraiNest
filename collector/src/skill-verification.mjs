import fs from 'node:fs';
import path from 'node:path';
import { hash, readJson, safePath, contained, requireValue } from './common.mjs';
import { runAgent } from './agents.mjs';
import { packageEntry } from './archive.mjs';
import { writeSkillPackage } from './skill-package.mjs';
import { fixedSkillProfiles } from './skill-inventory.mjs';

export async function verifySkillExtraction(config,op,bundle,workspace,{prepare,prompt,run=runAgent,signal}={}) {
  fs.mkdirSync(workspace,{recursive:true});
  prepare(workspace);
  const skillDir=path.join(workspace,op.agent==='codex'?'.agents':'.codebuddy','skills',bundle.name);
  fs.mkdirSync(path.dirname(skillDir),{recursive:true});
  if(!fs.existsSync(skillDir))writeSkillPackage(bundle,skillDir);
  const task={content:op.sample,type:'article',autoArchive:false,tags:[],scenario:null};
  const instructions=[config.instructions,config.agents?.[op.agent]?.instructions,`本次验证必须读取 ${path.relative(workspace,skillDir)}/SKILL.md 并使用该固定版本 ${bundle.hash}。将正文保存在条目的 original 或 source 文件中，不得伪造正文或用摘要替代。`].filter(Boolean).join('\n');
  const snapshots=[{agent:op.agent,name:bundle.name,path:path.relative(workspace,skillDir)}];
  const profiles=run===runAgent?await fixedSkillProfiles(config.agents || {},snapshots,workspace):config.agents || {};
  const result=await run(op.agent,profiles,{cwd:workspace,prompt:prompt(task,instructions),signal,timeoutMs:config.skillVerificationTimeoutMs || 10*60*1000});
  if(result.code!==0 || result.aborted || result.timedOut || result.permissionBlocked)return {state:'failed',reason:result.timedOut?'验证超时':result.permissionBlocked?'非交互权限不足':'Agent 未完成验证',agent:op.agent};
  const checkpoint=path.join(workspace,'collector-result.json');
  if(!fs.existsSync(checkpoint))return {state:'failed',reason:'缺少采集结果',agent:op.agent};
  const output=readJson(checkpoint);
  if(output.status!=='ready')return {state:'failed',reason:String(output.message || '提取受阻').slice(0,500),agent:op.agent};
  safePath(output.entry);
  const entry=fs.realpathSync(path.join(workspace,output.entry));requireValue(contained(fs.realpathSync(workspace),entry),'验证成果越界');
  const archive=packageEntry(entry);
  const bodies=archive.files.filter(f=>['source','original'].includes(f.role) && /\.(?:md|txt|markdown)$/i.test(f.path));
  // Several source files can contain the same article. Validate one complete body, never add duplicates.
  const body=bodies.map(f=>Buffer.from(f.body,'base64').toString('utf8')).sort((a,b)=>b.length-a.length)[0] || '';
  const compact=text=>text.replace(/\s+/g,'');
  const sameSource=[archive.meta.source_url,archive.meta.canonical_url,...archive.meta.aliases].includes(op.sample);
  const passed=archive.meta.status==='archived' && sameSource && compact(body).length>=300 && compact(body).includes(compact(op.expectedText)) && !/环境异常|访问过于频繁|请在微信客户端打开|验证码验证/.test(body.slice(0,500));
  return {state:passed?'passed':'failed',reason:passed?null:'正文完整度或样例校验未通过',agent:op.agent,bodyHash:hash(body),characters:compact(body).length,files:bodies.map(f=>({path:f.path,sha256:f.sha256}))};
}
