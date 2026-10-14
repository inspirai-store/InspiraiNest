const fs=require('node:fs'),path=require('node:path');
exports.create=async({profile,configuration,api})=>{
 if(!path.basename(profile).startsWith('inspirainest-formal-settings-'))throw Error('isolated profile required');
 const {createSkillRuntime}=await import('../../../src/skill-runtime.mjs'),{packageSkill}=await import('../../../src/skill-package.mjs');
 const seed=await require('./skills-inventory-fixture.cjs').seed({profile,configuration,api,portable:true}),home=path.join(profile,'skill-worker-home');fs.mkdirSync(home,{recursive:true});
 const globalRoots=Object.fromEntries(['codex','codebuddy','claude','gemini','opencode'].map(agent=>[agent,path.join(home,agent,'skills')]));for(const directory of Object.values(globalRoots))fs.mkdirSync(directory,{recursive:true});
 const scan=async()=>{const items=structuredClone(seed.items);items[0].hash=packageSkill(seed.packageData.directory).hash;return {inventory:{schemaVersion:1,scannedAt:new Date().toISOString(),platform:'darwin',agents:['codex','codebuddy'].map(name=>({name,installed:true,version:'1.0.0',profileHash:'a'.repeat(64),executionEnabled:true})),items,projects:[]},local:new Map([[items[0].id,{directory:seed.packageData.directory,real:seed.packageData.directory,origin:{scope:'user',context:null},globalRoot:globalRoots.codex,mcp:{}}]]),globalRoots,compatibleRoots:{},env:{},profiles:{}};};
 const runtime=createSkillRuntime({...configuration,dataDir:path.join(profile,'skill-runtime-data')},{home,cwd:home,scan,api:(route,method,body)=>api(configuration,route,method,body)});
 await runtime.report();return {runtime,deviceId:configuration.deviceId,skillId:seed.items[0].id,directory:seed.packageData.directory,report:()=>runtime.report(),run:async()=>{const pending=await api(configuration,'/api/skills/operations');return runtime.tick({idle:true,operationIds:pending.operations.map(operation=>operation.id)});},close:()=>runtime.close()};
};
