import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createAgentCatalog, AGENT_CATALOG } from '../src/agent-catalog.mjs';
import { createAgentInstaller } from '../src/agent-install.mjs';

// Exercise vendor packages in a disposable OS-user directory. No login or model task.
const home=fs.mkdtempSync(path.join(os.tmpdir(),'lingnest-install-acceptance-'));
const catalog=createAgentCatalog();
const env={...process.env,HOME:home,USERPROFILE:home,PATH:process.platform==='win32'?process.env.PATH:'/usr/bin:/bin:/opt/homebrew/bin'};
const installer=createAgentInstaller({}, {home,env});
const results=[];
try{
 for(const entry of AGENT_CATALOG){
  const release=await catalog.release(entry.id), current=(await installer.scan()).agents.find(a=>a.id===entry.id);
  const operation={id:'a'.repeat(63)+String(results.length),agent:entry.id,method:'managed',release,expectedFingerprint:current.fingerprint};
  const result=await installer.install(operation,{signal:AbortSignal.timeout(15*60000)});
  const updated=(await installer.scan()).agents.find(a=>a.id===entry.id);
  assert.equal(updated.installed,true);assert.equal(updated.source,'managed');assert.ok(result.version.includes(release.version));
  const upgraded=await installer.install({...operation,id:'b'.repeat(63)+String(results.length),action:'update',expectedFingerprint:updated.fingerprint},{signal:AbortSignal.timeout(15*60000)});assert.ok(upgraded.version.includes(release.version));
  results.push({agent:entry.id,version:release.version,reportedVersion:result.version,platform:process.platform,arch:process.arch});
  console.log(JSON.stringify(results.at(-1)));
 }
 console.log('AGENT_INSTALLATION_ACCEPTANCE_PASSED');
}finally{fs.rmSync(home,{recursive:true,force:true,maxRetries:process.platform==='win32'?10:0,retryDelay:200});}
