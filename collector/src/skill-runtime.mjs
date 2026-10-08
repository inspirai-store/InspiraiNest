import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { hash, atomicJson, readJson, now, requireValue, safePath, contained, canonicalJson } from './common.mjs';
import { dependencyStatus } from './skill-inventory.mjs';
import { acquireEnvironmentLock } from './agent-lock.mjs';
import { agentHome } from './agent-paths.mjs';
import { createInventoryScanner } from './skill-scan.mjs';
import { packageSkill, validateSkillPackage, writeSkillPackage, cleanSkillPolicy, skillMetadata } from './skill-package.mjs';
import { sharedSkillRoot, entryPath, referenceState, pointsTo, pathExists, skillArtifacts, applySkillLinks, recoverSkillLinks } from './skill-links.mjs';

const read = (file, fallback) => { try { return readJson(file); } catch { return fallback; } };
const actualHash = directory => fs.existsSync(directory) ? packageSkill(directory,{validate:false}).hash : null;
const realTarget = file => {
  if(fs.existsSync(file))return fs.realpathSync(file);
  let stat;try{stat=fs.lstatSync(file);}catch{}
  requireValue(!stat?.isSymbolicLink(),'目标共享链接已失效，请先修复');
  const parent=path.dirname(file);requireValue(parent!==file,'目标目录无效');return path.join(realTarget(parent),path.basename(file));
};

export function createSkillRuntime(config, { api, cwd, scan = createInventoryScanner(), verify, home = os.homedir(), env } = {}) {
  const namespace = hash(config.server + ':' + config.deviceId + ':' + hash(config.token || ''));
  const root = path.join(path.resolve(config.dataDir), 'environments', namespace);
  fs.mkdirSync(root,{recursive:true});
  const ledgerFile = path.join(root,'managed.json'), receiptsFile = path.join(root,'receipts.json'), transactionFile = path.join(root,'transaction.json');
  let ledger = read(ledgerFile,{installations:{},backups:{}}), receipts = read(receiptsFile,{}), state = { inventory:read(path.join(root,'inventory.json'),null),local:new Map() }, lastScan = 0, pending, dirty = true;
  const watchers = new Map();let closed=false;
  async function pauseWatches() {
    const closing=[...watchers.values()].map(watcher=>new Promise(resolve=>{
      if(watcher.once)watcher.once('close',resolve);
      watcher.close();if(!watcher.once)resolve();
    }));
    watchers.clear();await Promise.all(closing);
  }
  function recover() {
    const transaction=read(transactionFile,null);if(!transaction)return;
    recoverSkillLinks(transaction);
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
        const location=next.local.get(item.id), direct=location && ledger.installations[item.agent+':'+location.real];
        const installed=direct || (location && item.scope.startsWith('compat-') && Object.entries(ledger.installations).find(([key,value])=>key.endsWith(':'+location.real) && value.hash===item.hash)?.[1]);
        if(installed && installed.hash===item.hash){
          item.managedVersion=installed.versionId; item.capabilities=installed.policy.capabilities;
          item.marketSource=installed.source || null;
          item.applicableAgents=installed.policy.agents;item.systems=installed.policy.systems;
          item.requirements=installed.policy.requirements;
          item.dependencies=await dependencyStatus(item.requirements,{env:next.env,mcp:location.mcp});
          if(installed.source?.provider==='skillhub' && !installed.source.requirementsDeclared){item.dependencies.unknown.push('市场技能未声明依赖');if(item.dependencies.state==='ready')item.dependencies.state='unknown';}
          if(direct && installed.verification?.state==='passed' && installed.verification.hash===item.hash && installed.verification.profileHash===next.inventory.agents.find(a=>a.name===item.agent)?.profileHash){item.verification=installed.verification;if(item.dependencies.state==='unknown')item.dependencies.state='ready';}
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
    const source=referenceState(path.join(state.sharedRoot || sharedSkillRoot(home),bundle.name));
    requireValue(source.kind!=='link','统一技能源不能是软链接，请先整理该技能');
    const attached=Object.entries(state.globalRoots).filter(([,global])=>{
      const directory=path.join(global,bundle.name);
      return fs.existsSync(directory) && fs.realpathSync(directory)===source.entry;
    }).map(([agent])=>agent);
    const sharedAgents=[...new Set([...agents,...attached,...Array.from(state.local.entries())
      .filter(([,location])=>location.real===source.entry && !location.origin.scope.startsWith('compat-'))
      .map(([id])=>state.inventory.items.find(item=>item.id===id)?.agent).filter(Boolean)])].sort();
    for(const agent of agents){
      const directory=path.join(state.globalRoots[agent],bundle.name);
      const reference=referenceState(directory),real=source.entry;
      const legacy=agent==='codex'?path.join(state.env.CODEX_HOME || path.join(home,'.codex'),'skills',bundle.name):null;
      const references=[reference,...(legacy && path.resolve(legacy)!==path.resolve(directory) && pathExists(legacy)?[referenceState(legacy)]:[])];
      const existingShared=reference.hash===null?[]:Object.entries(state.globalRoots).filter(([,global])=>fs.existsSync(path.join(global,bundle.name)) && fs.realpathSync(path.join(global,bundle.name))===reference.real).map(([name])=>name);
      const affected=[...new Set([...sharedAgents,...existingShared])].sort();
      const visibleTo=Object.entries(state.compatibleRoots || {}).filter(([,roots])=>roots.some(root=>agents.some(name=>path.resolve(root)===path.resolve(state.globalRoots[name])) || (fs.existsSync(path.join(root,bundle.name)) && fs.realpathSync(path.join(root,bundle.name))===real))).map(([name])=>name);
      const currentHash=reference.hash,managed=ledger.installations[agent+':'+real] || ledger.installations[agent+':'+reference.real];
      const previous=currentHash?packageSkill(reference.real,{validate:false}):null;
      const files=new Map((previous?.files || []).map(f=>[f.path,f]));
      const changes=bundle.files.filter(f=>files.get(f.path)?.sha256!==f.sha256 || Boolean(files.get(f.path)?.executable)!==Boolean(f.executable)).map(f=>({path:f.path,state:files.has(f.path)?'modified':'missing'}));
      changes.push(...(previous?.files || []).filter(f=>!bundle.files.some(next=>next.path===f.path)).map(f=>({path:f.path,state:'removed'})));
      targets.push({agent,targetId:hash(real),directory,realDirectory:real,sourceDirectory:real,sourceHash:source.hash,sourceFingerprint:source.fingerprint,
        reference,references,linkedDirectories:references.map(ref=>ref.entry),installationMode:'shared-link',scope:'user',hash:currentHash,sharedAgents:affected,visibleTo,exists:currentHash!==null,
        localModified:Boolean(managed && managed.hash!==currentHash),name:bundle.name,changes});
    }
    return targets;
  }
  async function compare(op,bundle) {
    const policy=cleanSkillPolicy(op.policy),targets=targetsFor(bundle,op.agents),problems=[];
    if(!policy.systems.includes(process.platform))problems.push('系统不兼容');
    for(const agent of op.agents){if(!policy.agents.includes(agent))problems.push(agent+' 不兼容');if(!state.inventory.agents.find(a=>a.name===agent)?.installed)problems.push(agent+' 未安装');}
    if(op.agents.includes('opencode')) {
      const entry=bundle.files.find(f=>f.path==='SKILL.md');
      const description=Buffer.from(entry.body,'base64').toString('utf8');
      if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(bundle.name))problems.push('OpenCode 要求技能名称使用单个连字符');
      // Validate the frontmatter separately from generic portable package rules.
      const frontmatter=skillMetadata(description);
      if(typeof frontmatter.description!=='string' || !frontmatter.description.trim() || frontmatter.description.length>1024)problems.push('OpenCode 要求 1–1024 字的技能描述');
    }
    for(const target of targets)if(target.sharedAgents.some(agent=>!op.agents.includes(agent)))problems.push('共享技能须包含全部 Agent：'+target.sharedAgents.join('、'));
    const dependencies=await dependencyStatus(policy.requirements,{env:state.env});
    return {compatible:problems.length===0,targets,problems,dependencies,versionHash:bundle.hash};
  }
  function install(op,bundle,targets) {
    const groups=new Map();
    const links=new Map();
    for(const target of targets){
      const directory=path.join(state.globalRoots[target.agent],bundle.name), reference=referenceState(directory), real=entryPath(target.sourceDirectory);
      requireValue(reference.fingerprint===target.reference.fingerprint && referenceState(real).fingerprint===target.sourceFingerprint,'目标 Skill 或链接已修改，请重新比较');
      requireValue(hash(real)===target.targetId,'统一技能源已变化，请重新比较');
      if(!groups.has(real))groups.set(real,{real,...skillArtifacts(real,op.id),originalHash:target.sourceHash,agents:target.sharedAgents,directories:[]});
      for(const ref of target.references){
        requireValue(referenceState(ref.entry).fingerprint===ref.fingerprint,'技能兼容入口已修改，请重新比较');
        // A root already linked to the source needs no per-skill self-link.
        if(ref.entry!==real && !pointsTo(ref.entry,real) && !links.has(ref.entry))links.set(ref.entry,{
          entry:ref.entry,destination:real,...skillArtifacts(ref.entry,op.id),
          originalKind:ref.kind,originalLink:ref.link,originalHash:ref.hash,
        });
      }
      groups.get(real).directories.push(directory);
    }
    const transaction={id:op.id,targets:[...groups.values()],links:[...links.values()],committed:false,installHash:bundle.hash};
    // Persist the restore plan before the first rename; recovery also runs after a process crash.
    atomicJson(transactionFile,transaction);
    try{
      for(const target of transaction.targets){
        fs.mkdirSync(path.dirname(target.real),{recursive:true});fs.mkdirSync(path.dirname(target.backup),{recursive:true});
        requireValue(!fs.existsSync(target.backup) && !fs.existsSync(target.stage),'同步临时目录已存在');
        writeSkillPackage(bundle,target.stage);
        requireValue(actualHash(target.stage)===bundle.hash && actualHash(target.real)===target.originalHash,'目标 Skill 已修改，请重新比较');
        if(target.originalHash!==null){fs.renameSync(target.real,target.backup);requireValue(actualHash(target.backup)===target.originalHash,'目标 Skill 在提交时被修改');}
        fs.renameSync(target.stage,target.real);
      }
      applySkillLinks(transaction.links);
      requireValue(targets.every(target=>fs.realpathSync(target.directory)===target.sourceDirectory),'技能链接校验失败');
      const next=structuredClone(ledger);
      next.backups[op.id]={targets:transaction.targets,links:transaction.links,versionHash:bundle.hash,previousInstallations:ledger.installations};
      for(const target of transaction.targets)for(const agent of target.agents)next.installations[agent+':'+target.real]={versionId:op.versionId,hash:bundle.hash,policy:op.policy,source:op.source || {provider:'lingnest'},operationId:op.id};
      const receipt={state:'succeeded',result:{installed:true,versionId:op.versionId,hash:bundle.hash,agents:op.agents,locations:targets.map(({agent,directory,realDirectory})=>({agent,directory,realDirectory}))}};
      Object.assign(transaction,{committed:true,ledger:next,receipt});atomicJson(transactionFile,transaction);
      ledger=next;atomicJson(ledgerFile,ledger);receipts[op.id]=receipt;atomicJson(receiptsFile,receipts);fs.rmSync(transactionFile,{force:true});
      return receipt.result;
    }catch(error){recover();throw error;}
  }
  function rollback(op) {
    const backup=ledger.backups[op.syncId];requireValue(backup && !backup.restored,'没有可恢复的旧版本');
    for(const target of backup.targets)requireValue(target.directories.every(directory=>realTarget(directory)===target.real) && actualHash(target.real)===op.expectedHash && (target.originalHash===null || actualHash(target.backup)===target.originalHash),'Skill 已被修改，请先保留本地版本');
    for(const link of backup.links || [])requireValue(pointsTo(link.entry,link.destination) && (link.originalKind==='missing' || (link.originalKind==='link'
      ? fs.lstatSync(link.backup).isSymbolicLink() && fs.readlinkSync(link.backup)===link.originalLink
      : actualHash(link.backup)===link.originalHash)),'技能链接或原目录备份已修改，请先保留本地版本');
    // Rollback is itself a staged installation, so an interruption cannot leave half a shared group.
    const transaction={id:op.id,committed:false,targets:backup.targets.map(t=>({...t,originalHash:op.expectedHash,installHash:t.originalHash,...skillArtifacts(t.real,op.id)})),
      links:(backup.links || []).map(link=>({...link,originalKind:'link',...skillArtifacts(link.entry,op.id),
        ...(link.originalKind==='missing'?{remove:true}:{restore:link.backup})}))};
    atomicJson(transactionFile,transaction);
    try{
      applySkillLinks(transaction.links);
      for(let i=0;i<backup.targets.length;i++){
        const old=backup.targets[i],target=transaction.targets[i];
        fs.mkdirSync(path.dirname(target.backup),{recursive:true});
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
        await pauseWatches();
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
    }else if(op.action==='rollback'){await pauseWatches();result=rollback(op);}
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
      const unlock=acquireEnvironmentLock(agentHome(home));if(!unlock)return;
      try{
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
      }finally{unlock();}
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
