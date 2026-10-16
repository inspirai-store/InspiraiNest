import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {localAgentContext,probeLocalAgent,rememberAuthFailure,taskPluginProfile} from '../src/codex-local-agent.mjs';
import {runAgent} from '../src/agents.mjs';
import {trialEnvironment} from '../src/codex-trial.mjs';

const home=fs.mkdtempSync(path.join(os.tmpdir(),'codex-local-agent-'));process.env.CODEX_HOME=home;
const config={agents:{codex:{command:'custom-codex',args:['exec','--json','-m','configured-model','-c','model_provider="private"','-']}}};
test('existing Agent command, provider credentials, model and args pass through the same execution entry',async()=>{
 process.env.TEST_PROVIDER_KEY='local-provider-key';process.env.OSS_TEST_SECRET='server-secret';
 try{
  let received;await runAgent('codex',config.agents,{cwd:home,prompt:'bounded test',extraArgs:['--add-dir','task'],run:async(...args)=>{received=args;return {code:0};}});
  assert.equal(received[0],'custom-codex');assert.deepEqual(received[1],['exec','--json','-m','configured-model','-c','model_provider="private"','--add-dir','task','-']);assert.equal(received[2].env.TEST_PROVIDER_KEY,'local-provider-key');assert.equal(received[2].env.OSS_TEST_SECRET,undefined);assert.equal(received[2].env.CODEX_HOME,home);
 }finally{delete process.env.TEST_PROVIDER_KEY;delete process.env.OSS_TEST_SECRET;}
});
test('custom Provider and API key are not blocked by absent auth.json; program and configuration failures remain distinct',async()=>{
 const seen=[],run=async(command,args)=>{seen.push(args);return {code:0,tail:'codex-cli 0.148.0'};};
 const custom=await probeLocalAgent(config,{run});assert.equal(custom.login,'ready');assert.equal(custom.provider,'private');assert.equal(custom.model,'configured-model');assert.equal(seen.length,1);assert.equal(fs.existsSync(path.join(home,'auth.json')),false);
 process.env.OPENAI_API_KEY='fixture-key';try{seen.length=0;assert.equal((await probeLocalAgent({}, {run})).login,'ready');assert.equal(seen.length,1);}finally{delete process.env.OPENAI_API_KEY;}
 assert.equal((await probeLocalAgent(config,{run:async()=>({code:null,spawnError:'ENOENT',tail:''})})).reason,'program');
 assert.equal((await probeLocalAgent({agents:{codex:{enabled:false}}},{run})).reason,'disabled');
});
test('ChatGPT cached login works without file checks, and actual auth failure waits for a changed environment',async()=>{
 const file=path.join(home,'authorization-failure.json'),run=async(command,args)=>({code:0,tail:args[0]==='--version'?'codex-cli 0.148.0':'Logged in using ChatGPT'});
 assert.equal((await probeLocalAgent({}, {run})).login,'ready');
 rememberAuthFailure(localAgentContext({}),file);assert.equal((await probeLocalAgent({}, {run,failureFile:file})).login,'required');
 fs.writeFileSync(path.join(home,'auth.json'),'fixture changed, not a real credential');assert.equal((await probeLocalAgent({}, {run,failureFile:file})).login,'ready');
 fs.unlinkSync(path.join(home,'auth.json'));
 const status=await probeLocalAgent({}, {run:async(c,args)=>({code:args[0]==='--version'?0:1,tail:args[0]==='--version'?'codex-cli 0.148.0':'Not logged in'})});assert.equal(status.login,'required');
});
test('task plugin profile retains configured profile and cleans only its own file after interruption',()=>{
 const file=path.join(home,'work.config.toml'),base=path.join(home,'config.toml');fs.writeFileSync(base,'model="base"\n');fs.writeFileSync(file,'model="work-model"\n[plugins."existing@local"]\nenabled=true\n');
 const configured={agents:{codex:{command:'custom-codex',args:['exec','--profile','work','--json','-']}}},context=localAgentContext(configured),before=fs.readFileSync(file),original=fs.readFileSync(base);
 const scope=taskPluginProfile(context,'a'.repeat(32),'candidate@task');
 assert.equal(context.metadata.model,'work-model');assert.ok(fs.readFileSync(path.join(home,scope.name+'.config.toml'),'utf8').includes('existing@local'));assert.deepEqual(scope.profiles.codex.args,['exec','--json','-']);scope.dispose();assert.equal(fs.existsSync(path.join(home,scope.name+'.config.toml')),false);assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(base),original);
});
test('heartbeat mode is optional and rejects unknown modes',()=>{
 assert.deepEqual(trialEnvironment({protocol:1,login:'ready',projects:[]}),{protocol:1,login:'ready',projects:[]});
 assert.equal(trialEnvironment({protocol:1,login:'ready',executionMode:'local-agent',projects:[]}).executionMode,'local-agent');assert.throws(()=>trialEnvironment({protocol:1,login:'ready',executionMode:'remote',projects:[]}));
});
