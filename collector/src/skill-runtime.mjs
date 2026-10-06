import fs from 'node:fs';
import path from 'node:path';
import { hash, atomicJson, readJson, now, requireValue, safePath, contained, canonicalJson } from './common.mjs';
import { dependencyStatus } from './skill-inventory.mjs';
import { createInventoryScanner } from './skill-scan.mjs';
import { packageSkill, validateSkillPackage, writeSkillPackage, cleanSkillPolicy } from './skill-package.mjs';

const read = (file, fallback) => { try { return readJson(file); } catch { return fallback; } };
const actualHash = directory => fs.existsSync(directory) ? packageSkill(directory,{validate:false}).hash : null;
const realTarget = file => {
  if(fs.existsSync(file))return fs.realpathSync(file);
  let stat;try{stat=fs.lstatSync(file);}catch{}
  requireValue(!stat?.isSymbolicLink(),'目标共享链接已失效，请先修复');
  const parent=path.dirname(file);requireValue(parent!==file,'目标目录无效');return path.join(realTarget(parent),path.basename(file));
};

export function createSkillRuntime(config, { api, cwd, scan = createInventoryScanner(), verify, home, env } = {}) {
  const namespace = hash(config.server + ':' + config.deviceId + ':' + hash(config.token || ''));
  const root = path.join(path.resolve(config.dataDir), 'environments', namespace);
  fs.mkdirSync(root,{recursive:true});
  const ledgerFile = path.join(root,'managed.json'), receiptsFile = path.join(root,'receipts.json'), transactionFile = path.join(root,'transaction.json');
  let ledger = read(ledgerFile,{installations:{},backups:{}}), receipts = read(receiptsFile,{}), state = { inventory:read(path.join(root,'inventory.json'),null),local:new Map() }, lastScan = 0, pending, dirty = true;
  const watchers = new Map();let closed=false;
  function recover() {
    const transaction=read(transactionFile,null);if(!transaction)return;
    if(!transaction.committed) for(const target of [...transaction.targets].reverse()) {
      if(fs.existsSync(target.backup)){
        if(fs.existsSync(target.real)){
          let current;try{current=actualHash(target.real);}catch{}
          if(current===(target.installHash ?? transaction.installHash))fs.rmSync(target.real,{recursive:true,force:true});
          else {const preserved=path.join(path.dirname(target.real),'.lingnest-preserved-'+transaction.id+'-'+hash(target.real).slice(0,12));requireValue(!fs.existsSync(preserved),'恢复目录已存在，请保留本地修改后重试');fs.renameSync(target.real,preserved);}
        }
        fs.renameSync(target.backup,target.real);
      }
      else if(target.originalHash === null && fs.existsSync(target.real) && actualHash(target.real)===transaction.installHash)fs.rmSync(target.real,{recursive:true,force:true});
      if(fs.existsSync(target.stage))fs.rmSync(target.stage,{recursive:true,force:true});
    }
    if(transaction.committed && transaction.ledger){ledger=transaction.ledger;atomicJson(ledgerFile,ledger);if(transaction.receipt){receipts[transaction.id]=transaction.receipt;atomicJson(receiptsFile,receipts);}}
    fs.rmSync(transactionFile,{force:true});
  }
  recover();
  async function refresh(force=false) {
    if(pending)return pending;
    if(!force && !dirty && Date.now()-lastScan<60000)return state;
    pending=(async()=>{
      const next=await scan({...config,skillProjects:read(path.join(root,'projects.json'),config.skillProjects || [])},{cwd,home,env});
      if(closed)throw Object.assign(new Error('技能盘点已停止'),{code:'SKILL_SCAN_STOPPED'});
      for(const item of next.inventory.items){
        const location=next.local.get(item.id), installed=location && ledger.installations[item.agent+':'+location.real];
        if(installed && installed.hash===item.hash){
          item.managedVersion=installed.versionId; item.capabilities=installed.policy.capabilities;
          item.applicableAgents=installed.policy.agents;item.systems=installed.policy.systems;
          item.requirements=installed.policy.requirements;
          item.dependencies=await dependencyStatus(item.requirements,{env:next.env,mcp:location.mcp});
          if(installed.verification?.state==='passed' && installed.verification.hash===item.hash && installed.verification.profileHash===next.inventory.agents.find(a=>a.name===item.agent)?.profileHash){item.verification=installed.verification;if(item.dependencies.state==='unknown')item.dependencies.state='ready';}
        }
      }
      next.inventory.digest=hash(JSON.stringify({agents:next.inventory.agents,items:next.inventory.items,projects:next.inventory.projects}));
      state=next;lastScan=Date.now();dirty=false;
      atomicJson(path.join(root,'inventory.json'),state.inventory);
      // Recursive watches traverse ignored virtual environments and plugin caches.
      // Watch only discovered package directories; polling covers additions and overflow.
      const locations=Array.from(next.local.values());
      const roots=new Set([...new Set([...Object.values(next.globalRoots),...locations.map(x=>x.real),...locations.flatMap(x=>x.watchDirectories || [])])].slice(0,2048));
      for(const [directory,watcher] of watchers)if(!roots.has(directory)){watcher.close();watchers.delete(directory);}
      for(const directory of roots)if(!watchers.has(directory) && fs.existsSync(directory))try{watchers.set(directory,fs.watch(directory,()=>{dirty=true;}));}catch{}
      return state;
    })().finally(()=>{pending=null;});
    return pending;
  }
  async function report() {
    const snapshot=await refresh(); const inventory=snapshot.inventory;
    const snapshotId=hash(inventory.scannedAt+inventory.digest);
    const pages=[[]];
    for(const item of inventory.items){let current=pages.at(-1);if(current.length>=40 || Buffer.byteLength(JSON.stringify([...current,item]))>85000){pages.push([]);current=pages.at(-1);}current.push(item);}
    for(let page=0;page<pages.length;page++){if(closed)return inventory;await api('/api/skills/environment','POST',{...inventory,items:pages[page],snapshotId,page,final:page===pages.length-1});}
    return inventory;
  }
  async function bundleFor(op) {
    const bundle=validateSkillPackage(await api('/api/skills/versions/'+op.versionId+'/package'));
    requireValue(bundle.hash===op.versionHash && bundle.name===op.name,'发布版本校验失败');return bundle;
  }
  function targetsFor(bundle,agents) {
    const targets=[];
    for(const agent of agents){
      const directory=path.join(state.globalRoots[agent],bundle.name);
      const real=realTarget(directory);
      const sharedAgents=[...new Set([...Object.entries(state.globalRoots).filter(([,global])=>realTarget(path.join(global,bundle.name))===real).map(([name])=>name),...Array.from(state.local.entries()).filter(([,location])=>location.real===real).map(([skillId])=>state.inventory.items.find(s=>s.id===skillId)?.agent).filter(Boolean)])];
      const currentHash=actualHash(real),managed=ledger.installations[agent+':'+real];
      const previous=currentHash?packageSkill(real,{validate:false}):null;
      const files=new Map((previous?.files || []).map(f=>[f.path,f]));
      const changes=bundle.files.filter(f=>files.get(f.path)?.sha256!==f.sha256 || Boolean(files.get(f.path)?.executable)!==Boolean(f.executable)).map(f=>({path:f.path,state:files.has(f.path)?'modified':'missing'}));
      changes.push(...(previous?.files || []).filter(f=>!bundle.files.some(next=>next.path===f.path)).map(f=>({path:f.path,state:'removed'})));
      targets.push({agent,targetId:hash(real),hash:currentHash,sharedAgents,exists:currentHash!==null,localModified:Boolean(managed && managed.hash!==currentHash),name:bundle.name,changes});
    }
    return targets;
  }
  async function compare(op,bundle) {
    const policy=cleanSkillPolicy(op.policy),targets=targetsFor(bundle,op.agents),problems=[];
    if(!policy.systems.includes(process.platform))problems.push('系统不兼容');
    for(const agent of op.agents){if(!policy.agents.includes(agent))problems.push(agent+' 不兼容');if(!state.inventory.agents.find(a=>a.name===agent)?.installed)problems.push(agent+' 未安装');}
    for(const target of targets)if(target.sharedAgents.some(agent=>!op.agents.includes(agent)))problems.push('共享技能须包含全部 Agent：'+target.sharedAgents.join('、'));
    const dependencies=await dependencyStatus(policy.requirements,{env:state.env});
    return {compatible:problems.length===0,targets,problems,dependencies,versionHash:bundle.hash};
  }
  function install(op,bundle,targets) {
    const groups=new Map();
    for(const target of targets){
      const directory=path.join(state.globalRoots[target.agent],bundle.name), real=realTarget(directory);
      requireValue(actualHash(real)===target.hash,'目标 Skill 已修改，请重新比较');
      requireValue(hash(real)===target.targetId,'目标链接已修改，请重新比较');
      if(!groups.has(real))groups.set(real,{real,stage:path.join(path.dirname(real),'.lingnest-stage-'+op.id),backup:path.join(path.dirname(real),'.lingnest-backup-'+op.id),originalHash:target.hash,agents:target.sharedAgents,directories:[]});
      groups.get(real).directories.push(directory);
    }
    const transaction={id:op.id,targets:[...groups.values()],committed:false,installHash:bundle.hash};
    // Persist the restore plan before the first rename; recovery also runs after a process crash.
    atomicJson(transactionFile,transaction);
    try{
      for(const target of transaction.targets){
        fs.mkdirSync(path.dirname(target.real),{recursive:true});
        requireValue(!fs.existsSync(target.backup) && !fs.existsSync(target.stage),'同步临时目录已存在');
        writeSkillPackage(bundle,target.stage);
        requireValue(actualHash(target.stage)===bundle.hash && actualHash(target.real)===target.originalHash,'目标 Skill 已修改，请重新比较');
        if(target.originalHash!==null){fs.renameSync(target.real,target.backup);requireValue(actualHash(target.backup)===target.originalHash,'目标 Skill 在提交时被修改');}
        fs.renameSync(target.stage,target.real);
      }
      const next=structuredClone(ledger);
      next.backups[op.id]={targets:transaction.targets,versionHash:bundle.hash,previousInstallations:ledger.installations};
      for(const target of transaction.targets)for(const agent of target.agents)next.installations[agent+':'+target.real]={versionId:op.versionId,hash:bundle.hash,policy:op.policy,operationId:op.id};
      const receipt={state:'succeeded',result:{installed:true,versionId:op.versionId,hash:bundle.hash,agents:op.agents}};
      Object.assign(transaction,{committed:true,ledger:next,receipt});atomicJson(transactionFile,transaction);
      ledger=next;atomicJson(ledgerFile,ledger);receipts[op.id]=receipt;atomicJson(receiptsFile,receipts);fs.rmSync(transactionFile,{force:true});
      return receipt.result;
    }catch(error){recover();throw error;}
  }
  function rollback(op) {
    const backup=ledger.backups[op.syncId];requireValue(backup && !backup.restored,'没有可恢复的旧版本');
    for(const target of backup.targets)requireValue(target.directories.every(directory=>realTarget(directory)===target.real) && actualHash(target.real)===op.expectedHash && (target.originalHash===null || actualHash(target.backup)===target.originalHash),'Skill 已被修改，请先保留本地版本');
    // Rollback is itself a staged installation, so an interruption cannot leave half a shared group.
    const transaction={id:op.id,committed:false,targets:backup.targets.map(t=>({...t,originalHash:op.expectedHash,installHash:t.originalHash,backup:path.join(path.dirname(t.real),'.lingnest-backup-'+op.id),stage:path.join(path.dirname(t.real),'.lingnest-stage-'+op.id)}))};
    atomicJson(transactionFile,transaction);
    try{
      for(let i=0;i<backup.targets.length;i++){
        const old=backup.targets[i],target=transaction.targets[i];
        if(old.originalHash!==null)writeSkillPackage(packageSkill(old.backup),target.stage);
        requireValue(actualHash(target.real)===op.expectedHash,'Skill 已修改');
        fs.renameSync(target.real,target.backup);
        if(old.originalHash!==null)fs.renameSync(target.stage,target.real);
      }
      const next=structuredClone(ledger);
      for(const target of backup.targets)for(const agent of target.agents){const key=agent+':'+target.real;if(backup.previousInstallations[key])next.installations[key]=backup.previousInstallations[key];else delete next.installations[key];}
      next.backups[op.syncId].restored=true;
      const receipt={state:'succeeded',result:{restored:true,syncId:op.syncId}};
      Object.assign(transaction,{committed:true,ledger:next,receipt});atomicJson(transactionFile,transaction);recover();return receipt.result;
    }catch(error){recover();throw error;}
  }
  async function operation(op) {
    requireValue(op.schemaVersion===1 && /^[a-f0-9]{64}$/.test(op.id),'操作格式无效');
    if(receipts[op.id])return receipts[op.id];
    await refresh(true);let result;
    if(op.action==='refresh'){await report();result={refreshed:true,digest:state.inventory.digest};}
    else if(op.action==='configure-projects'){
      requireValue(Array.isArray(op.projects) && op.projects.length<=10 && op.projects.every(p=>path.isAbsolute(p) && fs.existsSync(p) && fs.statSync(p).isDirectory() && path.parse(p).root!==p),'项目目录不存在或不适用于此系统');
      atomicJson(path.join(root,'projects.json'),op.projects);dirty=true;await report();result={configured:true,count:op.projects.length};
    }
    else if(['prepare-publish','publish'].includes(op.action)){
      const location=state.local.get(op.skillId),item=state.inventory.items.find(s=>s.id===op.skillId);
      requireValue(location && item?.portable,'该技能不能直接发布');
      const bundle=packageSkill(location.real);requireValue(bundle.hash===op.expectedHash,'源 Skill 已修改，请重新预览');
      result=op.action==='publish'?{bundle}:{preview:{name:bundle.name,hash:bundle.hash,skillMarkdown:Buffer.from(bundle.files.find(f=>f.path==='SKILL.md').body,'base64').toString('utf8'),files:bundle.files.map(({body,...f})=>f),texts:bundle.files.filter(f=>/\.(?:md|markdown|txt|json|ya?ml|toml|[cm]?js|tsx?|py|sh|ps1|css|html|sql)$/i.test(f.path)).map(f=>({path:f.path,content:Buffer.from(f.body,'base64').toString('utf8')})),omitted:bundle.omitted}};
    }else if(['compare','sync','verify'].includes(op.action)){
      const bundle=await bundleFor(op);
      if(op.action==='compare')result={comparison:await compare(op,bundle)};
      if(op.action==='sync'){
        const comparison=await compare(op,bundle);requireValue(comparison.compatible,comparison.problems.join('；'));
        requireValue(canonicalJson(comparison.targets)===canonicalJson(op.expectedTargets),'目标 Skill 已变化，请重新比较');
        requireValue(!comparison.targets.some(t=>t.sharedAgents.length>1) || op.confirmShared,'请确认全部共享 Agent');
        result=install(op,bundle,comparison.targets);
      }
      if(op.action==='verify'){
        const directory=path.join(state.globalRoots[op.agent],bundle.name),real=realTarget(directory);
        const installed=ledger.installations[op.agent+':'+real];requireValue(installed?.versionId===op.versionId && actualHash(real)===bundle.hash,'请先同步指定版本');
        requireValue(verify,'验证执行器不可用');
        const verification=await verify(op,bundle,path.join(root,'verification',op.id));
        result={verification:{...verification,versionId:op.versionId,hash:bundle.hash,profileHash:state.inventory.agents.find(a=>a.name===op.agent)?.profileHash,at:now(),sample:op.sample}};
        ledger.installations[op.agent+':'+real].verification=result.verification;atomicJson(ledgerFile,ledger);
      }
    }else if(op.action==='rollback')result=rollback(op);
    else throw new Error('不支持的技能操作');
    dirty=true;
    return {state:'succeeded',result};
  }
  async function tick({idle=true,operationIds=[]}={}) {
    try{if(dirty || Date.now()-lastScan>=60000)await report();}catch(error){if([401,403].includes(error.status))throw error;}
    if(closed || !idle || !operationIds.length)return;
    const response=await api('/api/skills/operations');
    for(const op of response.operations || []){
      if(closed)return;
      let receipt=receipts[op.id];
      if(!receipt){
        await api('/api/skills/operations/'+op.id+'/result','POST',{state:'running'});
        try{receipt=await operation(op);}catch(error){receipt={state:'failed',result:{error:String(error.message).replaceAll(root,'[本机]').slice(0,500)}};}
        // The bundle is retained only for retrying its private upload, in the deployment-scoped directory.
        receipts[op.id]=receipt;atomicJson(receiptsFile,receipts);
      }
      await api('/api/skills/operations/'+op.id+'/result','POST',receipt);
      if(receipt.result?.bundle){receipts[op.id]={state:receipt.state,result:{published:true}};atomicJson(receiptsFile,receipts);}
      dirty=true;if(!closed)await report();
    }
  }
  return {refresh,report,tick,operation,get inventory(){return state.inventory;},close(){closed=true;scan.close?.();for(const watcher of watchers.values())watcher.close();}};
}

export async function taskSkillSnapshots(task,workspace,api) {
  const manifest=path.join(workspace,'..','skill-snapshots.json');
  let snapshots=read(manifest,null);
  if(!snapshots){
    snapshots=[];
    for(const skill of task.selectedSkills || []){
      const bundle=validateSkillPackage(await api('/api/skills/versions/'+skill.versionId+'/package'));
      requireValue(bundle.hash===skill.hash,'任务技能版本校验失败');
      const destination=path.join(workspace,skill.agent==='codex'?'.agents':'.codebuddy','skills',bundle.name);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      if(!fs.existsSync(destination))writeSkillPackage(bundle,destination);
      requireValue(actualHash(destination)===bundle.hash,'任务技能快照已修改');
      snapshots.push({...skill,path:path.relative(workspace,destination).split(path.sep).join('/')});
    }
    atomicJson(manifest,snapshots);
  }
  for(const skill of snapshots){safePath(skill.path);requireValue(contained(workspace,path.resolve(workspace,skill.path)) && actualHash(path.join(workspace,skill.path))===skill.hash,'任务技能快照校验失败');}
  return snapshots;
}
