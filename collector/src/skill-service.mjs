import { hash, now, requireValue, canonicalJson } from './common.mjs';
import { SKILL_AGENTS, SKILL_EXECUTION_AGENTS, cleanSkillPolicy, cleanRequirements, validateSkillPackage } from './skill-package.mjs';
import { workerAuthorized, workerOnline } from './device-metadata.mjs';
import { canRunTask } from './task-routing.mjs';

const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const string = (x, max = 200) => typeof x === 'string' ? x.slice(0, max) : null;
const states = new Set(['loaded','configured','unknown','disabled','not_loaded','shadowed','agent_unavailable']);
export function environmentItem(input) {
  requireValue(input && digest(input.id) && SKILL_AGENTS.includes(input.agent) && states.has(input.loadState), 'Invalid skill entry');
  requireValue(input.hash === null || digest(input.hash), 'Invalid skill hash');
  requireValue(input.sharedWith===undefined || Array.isArray(input.sharedWith),'Invalid shared skill group');
  const list = x => Array.isArray(x) ? x.slice(0, 60).map(v => string(v, 120)).filter(Boolean) : [];
  return { id: input.id, agent: input.agent, name: string(input.name, 100), description: string(input.description, 1024), declaredVersion: string(input.declaredVersion, 100),
    hash: input.hash, directory:string(input.directory,1000),realDirectory:string(input.realDirectory,1000),scope: string(input.scope, 30), source: string(input.source, 150), context: string(input.context, 100), taskContext: input.taskContext === true,
    marketSource:input.marketSource && ['skillhub','lingnest'].includes(input.marketSource.provider)?{provider:input.marketSource.provider,slug:string(input.marketSource.slug),version:string(input.marketSource.version,100),archiveSha256:digest(input.marketSource.archiveSha256)?input.marketSource.archiveSha256:null}:null,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : null, loadState: input.loadState, portable: input.portable === true,
    requirements: cleanRequirements(input.requirements), dependencies: { state: ['ready','missing','unknown'].includes(input.dependencies?.state) ? input.dependencies.state : 'unknown', missing: list(input.dependencies?.missing), unknown: list(input.dependencies?.unknown) },
    issue: string(input.issue, 400), capabilities: list(input.capabilities).filter(c => /^[a-z][a-z0-9.-]{1,99}$/.test(c)),
    applicableAgents:list(input.applicableAgents).filter(a=>SKILL_AGENTS.includes(a)),systems:list(input.systems).filter(s=>['darwin','linux','win32'].includes(s)),
    managedVersion: digest(input.managedVersion) ? input.managedVersion : null,
    verification: input.verification?.state === 'passed' && digest(input.verification.versionId) ? { state: 'passed', versionId: input.verification.versionId, profileHash:digest(input.verification.profileHash)?input.verification.profileHash:null, at: string(input.verification.at, 40), sample: string(input.verification.sample, 2000), bodyHash: digest(input.verification.bodyHash) ? input.verification.bodyHash : null } : null,
    sharedWith: (input.sharedWith || []).slice(0, 50).filter(x => digest(x.id) && SKILL_AGENTS.includes(x.agent)).map(x => ({ id: x.id, agent: x.agent, name: string(x.name, 100) })) };
}

export function taskCapabilities(task) {
  const candidates = String(task.content || task.url || '').match(/https?:\/\/[^\s<>"'，。]+/g) || [];
  return candidates.some(value => { try { return new URL(value).hostname.toLowerCase() === 'mp.weixin.qq.com'; } catch { return false; } }) ? ['wechat.article.extract'] : [];
}

export function createSkillService({ store, storage, serialized, updateDevice, owner, worker, body, send, clock = Date.now }) {
  // Pin readers to the snapshot that supplied their first page. Worker refreshes
  // can commit meanwhile without mixing inventories in one client table.
  const reads = new Map();
  const retain = (deviceId, data) => {
    const key = deviceId + ':' + data.snapshotId;
    for (const [id, value] of reads) if (clock() >= value.expiresAt) reads.delete(id);
    if (!reads.has(key)) reads.set(key, { data, expiresAt: clock() + 120000, bytes: Buffer.byteLength(JSON.stringify(data)) });
    while (reads.size > 16 || [...reads.values()].reduce((sum, value) => sum + value.bytes, 0) > 32 * 1024 * 1024) reads.delete(reads.keys().next().value);
  };
  const getVersion = async versionId => { requireValue(digest(versionId), 'Invalid skill version'); const version = await store.get('skill-version', versionId); requireValue(version, 'Skill version not found', 404); return version; };
  const inbox = async deviceId => (await store.list('skill-operation')).filter(o => o.deviceId === deviceId && ['queued','running'].includes(o.state)).sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(0,20).map(o => o.id);
  async function verifiedItems(device) {
    if(device.skillRuntime?.schemaVersion!==1)return [];
    const env = await store.get('skill-environment', device.id);
    if (!env || clock() - Date.parse(env.scannedAt) > 180000) return [];
    const proofs = (await store.list('skill-operation')).filter(o => o.deviceId === device.id && o.action === 'verify' && o.state === 'succeeded' && o.result?.verification?.state === 'passed');
    return env.items.filter(s => s.taskContext && s.enabled !== false && !['disabled','shadowed','not_loaded','agent_unavailable'].includes(s.loadState) && s.dependencies.state === 'ready' && device.agents.includes(s.agent)
      && env.agents.some(a => a.name === s.agent && a.installed && a.executionEnabled && a.profileHash === s.verification?.profileHash)
      && s.verification?.state === 'passed' && s.managedVersion === s.verification.versionId && proofs.some(p => p.versionId === s.managedVersion && p.agent === s.agent && p.result.verification.profileHash === s.verification.profileHash && p.result.verification.bodyHash === s.verification.bodyHash));
  }
  async function selection(task, claiming, tasks) {
    if (task.deviceId) return { eligible: !task.selectedSkills?.length || claiming.skillRuntime?.schemaVersion===1, selectedSkills: task.selectedSkills || [] };
    const snapshots = async target => {
      const env=target.skillRuntime?.schemaVersion===1 ? await store.get('skill-environment',target.id) : null;
      return (env && clock()-Date.parse(env.scannedAt)<=180000?env.items:[]).filter(s=>SKILL_EXECUTION_AGENTS.includes(s.agent) && s.taskContext && s.managedVersion && s.enabled !== false && !['disabled','shadowed','not_loaded','agent_unavailable'].includes(s.loadState) && target.agents.includes(s.agent) && (!task.preferredAgent || s.agent === task.preferredAgent)).map(s=>({agent:s.agent,versionId:s.managedVersion,hash:s.hash,name:s.name,capabilities:s.capabilities}));
    };
    if (!task.requiredCapabilities?.length) return { eligible: true, selectedSkills:await snapshots(claiming) };
    const candidates = (await store.list('device')).filter(d => canRunTask(task, d) && workerOnline(d, clock()) && (!d.skillRuntime || d.skillRuntime.mode === 'running' && d.skillRuntime.idle)
      && !tasks.some(t => t.deviceId === d.id && ['assigned','running','uploading'].includes(t.state)));
    const matches = [];
    for (const d of candidates) for (const s of await verifiedItems(d)) if ((!task.preferredAgent || s.agent === task.preferredAgent) && task.requiredCapabilities.some(c => s.capabilities.includes(c))) matches.push({ device: d, skill: s });
    if (!matches.length) return { eligible: true, selectedSkills:await snapshots(claiming) };
    const best = matches.sort((a,b) => a.device.id.localeCompare(b.device.id) || a.skill.id.localeCompare(b.skill.id))[0];
    const selectedSkills = await snapshots(best.device);
    selectedSkills.sort((a,b)=>Number(b.agent===best.skill.agent)-Number(a.agent===best.skill.agent));
    return { eligible: best.device.id === claiming.id, selectedSkills, environmentDigest: best.device.environment?.digest };
  }
  async function handle(req, res, route, device) {
    if (!route.startsWith('/api/skills/')) return false;
    const url = new URL(req.url, 'http://localhost');
    if (route === '/api/skills/environment' && req.method === 'POST') {
      worker(device);
      const input = await body(req);
      requireValue(input.schemaVersion === 1 && digest(input.snapshotId) && digest(input.digest) && Number.isInteger(input.page) && input.page >= 0 && input.page < 150 && Array.isArray(input.items) && input.items.length <= 40, 'Invalid environment page');
      requireValue(Number.isFinite(Date.parse(input.scannedAt)) && Math.abs(clock() - Date.parse(input.scannedAt)) < 10 * 60000, 'Invalid inventory time');
      requireValue(Array.isArray(input.agents) && input.agents.length<=SKILL_AGENTS.length,'Invalid inventory Agents');
      const agents = input.agents.filter(a => a && SKILL_AGENTS.includes(a.name)).slice(0,SKILL_AGENTS.length).map(a => ({ name: a.name, installed: a.installed === true, version: string(a.version,150), probeState: a.installed === true ? 'available' : ['not_found','timeout','failed'].includes(a.probeState) ? a.probeState : 'failed', profileHash:digest(a.profileHash)?a.profileHash:null, executionEnabled: SKILL_EXECUTION_AGENTS.includes(a.name) && a.executionEnabled === true, discovery:a.discovery === 'native'?'native':'filesystem', builtinState:a.builtinState==='reported'?'reported':'unknown', loadErrors:Number.isSafeInteger(a.loadErrors)?Math.min(a.loadErrors,1000):0,skillRoot:string(a.skillRoot,1000),sharedSkillRoot:string(a.sharedSkillRoot,1000),installationMode:a.installationMode==='shared-link'?'shared-link':null,projectSkillDirectory:string(a.projectSkillDirectory,100),legacySkillRoot:string(a.legacySkillRoot,1000),compatibleSkillRoots:Array.isArray(a.compatibleSkillRoots)?a.compatibleSkillRoots.slice(0,5).map(p=>string(p,1000)).filter(Boolean):[],loadMethod:string(a.loadMethod,200),installationScope:a.installationScope==='user'?'user':null }));
      const items = input.items.map(environmentItem);
      await serialized('skill-environment:' + device.id, () => store.transaction(async tx => {
        const currentDevice = await tx.getForUpdate('device', device.id);
        requireValue(currentDevice && !currentDevice.revokedAt && currentDevice.tokenHash === device.tokenHash, 'Device authorization required', 401);
        let stage = await tx.get('skill-stage', device.id);
        if (input.page === 0) stage = { id: device.id, snapshotId: input.snapshotId, digest: input.digest, pages: [], scannedAt: input.scannedAt, agents, platform: string(input.platform,20), projects:Array.isArray(input.projects)?input.projects.slice(0,10).filter(p=>typeof p==='string' && p.length<=1000):[] };
        requireValue(stage?.snapshotId === input.snapshotId && stage.digest === input.digest && (input.page === stage.pages.length || input.page < stage.pages.length && canonicalJson(stage.pages[input.page]) === canonicalJson(items)), 'Inventory page conflict', 409);
        if (input.page === stage.pages.length) stage.pages.push(items);
        await tx.put('skill-stage', stage);
        if (input.final === true) {
          requireValue(input.page === stage.pages.length - 1, 'Incomplete inventory', 409);
          const all = stage.pages.flat();
          requireValue(new Set(all.map(s => s.id)).size === all.length, 'Duplicate skill identity');
          const previous = await tx.get('skill-environment', device.id);
          requireValue(!previous || Date.parse(previous.scannedAt) <= Date.parse(stage.scannedAt), 'Stale inventory', 409);
          await tx.put('skill-environment', { ...stage, items: all, pages: undefined, schemaVersion: 1 });
          await tx.put('device', { ...currentDevice, environment: { schemaVersion: 1, digest: stage.digest, scannedAt: stage.scannedAt, count: all.length, agents: stage.agents, verifiedCount: all.filter(s => s.verification?.state === 'passed').length } });
          await tx.delete('skill-stage', device.id);
        }
      }));
      send(res, 200, { accepted: true }); return true;
    }
    const environment = route.match(/^\/api\/skills\/devices\/([\w-]+)\/environment$/);
    if (environment && req.method === 'GET') {
      owner(device);
      const latest = await store.get('skill-environment', environment[1]);
      const offset = Number(url.searchParams.get('offset') || 0);
      requireValue(Number.isSafeInteger(offset) && offset >= 0, 'Invalid inventory offset');
      const requested = url.searchParams.get('snapshotId');
      if (requested) requireValue(digest(requested), 'Invalid inventory snapshot');
      const cached = requested && reads.get(environment[1] + ':' + requested);
      const data = !requested || latest?.snapshotId === requested ? latest : cached && clock() < cached.expiresAt ? cached.data : null;
      if (requested && !data) throw Object.assign(new Error('技能清单已更新，请刷新'), { status: 409, code: 'inventory_changed' });
      if (data) retain(environment[1], data);
      send(res,200, data ? { ...data, items: data.items.slice(offset,offset+40), total: data.items.length, nextOffset: offset+40 < data.items.length ? offset+40 : null } : { schemaVersion:1, items:[], agents:[], total:0, nextOffset:null, scannedAt:null }); return true;
    }
    if (route === '/api/skills/versions' && req.method === 'GET') {
      owner(device); send(res,200,{ schemaVersion:1, versions:(await store.list('skill-version')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(({key,files,...version})=>({...version,fileCount:files.length})) }); return true;
    }
    const versionRoute = route.match(/^\/api\/skills\/versions\/([a-f0-9]{64})(\/package)?$/);
    if (versionRoute && req.method === 'GET') {
      requireValue(device.role === 'owner' || workerAuthorized(device), 'Skill access denied',403);
      const version = await getVersion(versionRoute[1]);
      if (!versionRoute[2]) { send(res,200,version); return true; }
      const bundle = JSON.parse((await storage.get(version.key)).toString('utf8'));
      validateSkillPackage(bundle); requireValue(bundle.hash === version.hash, 'Stored skill checksum mismatch',500);
      send(res,200,bundle); return true;
    }
    if (route === '/api/skills/operations' && req.method === 'GET') {
      if (device.role === 'owner') { const deviceId=url.searchParams.get('deviceId'); send(res,200,{operations:(await store.list('skill-operation')).filter(o=>!deviceId || o.deviceId===deviceId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(o=>({...o,result:o.result?.preview?{preview:{name:o.result.preview.name,hash:o.result.preview.hash}}:o.result}))});return true; }
      worker(device);
      const ids = await inbox(device.id); send(res,200,{ operations:await Promise.all(ids.map(v=>store.get('skill-operation',v))) }); return true;
    }
    if (route === '/api/skills/operations' && req.method === 'POST') {
      owner(device);
      const input = await body(req);
      requireValue(['refresh','configure-projects','prepare-publish','publish','compare','sync','verify','rollback'].includes(input.action) && typeof input.requestId === 'string' && /^[\w-]{1,100}$/.test(input.requestId), 'Invalid skill operation');
      const target = await store.get('device',input.deviceId); requireValue(target && workerAuthorized(target), 'Worker not found',404);
      const action = input.action, operationId = hash((device.credentialId || device.id) + ':' + input.requestId);
      const op = { id:operationId, schemaVersion:1, deviceId:target.id, action, createdAt:now(), state:'queued' };
      if(action==='configure-projects'){requireValue(Array.isArray(input.projects) && input.projects.length<=10 && input.projects.every(p=>typeof p==='string' && p.length>1 && p.length<=1000 && !/[\u0000-\u001f]/.test(p)),'Invalid project directories');op.projects=[...new Set(input.projects)];}
      if (['prepare-publish','publish'].includes(action)) { requireValue(digest(input.skillId) && digest(input.expectedHash),'Invalid source skill'); op.skillId=input.skillId; op.expectedHash=input.expectedHash; }
      if (action === 'publish') {
        const preview = await store.get('skill-operation',input.previewId);
        requireValue(preview?.action === 'prepare-publish' && preview.state === 'succeeded' && preview.deviceId === target.id && preview.skillId === op.skillId && preview.expectedHash === op.expectedHash, 'Publication preview required',409);
        op.previewId=preview.id; op.policy=cleanSkillPolicy(input.policy);
      }
      if (['compare','sync','verify'].includes(action)) { const version=await getVersion(input.versionId); op.versionId=version.id; op.versionHash=version.hash; op.policy=version.policy; op.name=version.name; if(version.source)op.source=version.source; }
      if (['compare','sync'].includes(action)) {
        requireValue(Array.isArray(input.agents) && input.agents.length > 0 && input.agents.length <= SKILL_AGENTS.length && input.agents.every(a=>SKILL_AGENTS.includes(a)), 'Invalid target Agents'); op.agents=[...new Set(input.agents)];
      }
      if (action === 'sync') {
        const comparison = await store.get('skill-operation',input.comparisonId);
        requireValue(comparison?.action === 'compare' && comparison.state === 'succeeded' && comparison.deviceId === target.id && comparison.versionId === op.versionId && comparison.result?.comparison?.compatible === true, 'Compatible comparison required',409);
        requireValue(JSON.stringify(comparison.agents) === JSON.stringify(op.agents), 'Comparison target changed',409);
        op.expectedTargets=comparison.result.comparison.targets; op.comparisonId=comparison.id;
        op.confirmShared=input.confirmShared === true;
        requireValue(!op.expectedTargets.some(t=>t.sharedAgents?.length > 1) || op.confirmShared,'Confirm all shared Agents',409);
      }
      if (action === 'verify') {
        requireValue(['codex','codebuddy'].includes(input.agent) && op.policy.agents.includes(input.agent),'Unsupported verification Agent');
        let sample; try { sample=new URL(input.sample); } catch {}
        requireValue(sample?.protocol === 'https:' && sample.hostname === 'mp.weixin.qq.com' && !sample.username && !sample.password,'Provide a public WeChat sample');
        requireValue(typeof input.expectedText === 'string' && input.expectedText.trim().length >= 20 && input.expectedText.length <= 1000, 'Provide expected article text (20-1000 characters)');
        op.sample=sample.href; op.expectedText=input.expectedText; op.agent=input.agent;
      }
      if (action === 'rollback') {
        const sync = await store.get('skill-operation',input.syncId); requireValue(sync?.action === 'sync' && sync.deviceId === target.id && sync.state === 'succeeded','Successful synchronization required',409);
        op.syncId=sync.id; op.expectedHash=sync.versionHash;
      }
      const fingerprint=hash(JSON.stringify(op)); // createdAt is excluded from the idempotency comparison below.
      const canonical=x=>canonicalJson({...x,createdAt:undefined,state:undefined,result:undefined,updatedAt:undefined,fingerprint:undefined});
      const result=await serialized('skill-operations:'+target.id,()=>store.transaction(async tx=>{
        const authorization=await tx.getForUpdate('device',target.id);
        requireValue(authorization && workerAuthorized(authorization), 'Worker not found',404);
        const previous=await tx.get('skill-operation',operationId);
        if(previous){requireValue(canonical(previous)===canonical(op),'Operation ID already used',409);return previous;}
        requireValue((await tx.list('skill-operation')).filter(o=>o.deviceId===target.id && ['queued','running'].includes(o.state)).length<20,'Too many pending skill operations',429);
        return tx.put('skill-operation',{...op,fingerprint});
      })); send(res,201,result);return true;
    }
    const operationRoute=route.match(/^\/api\/skills\/operations\/([a-f0-9]{64})(\/result)?$/);
    if(operationRoute){
      const op=await store.get('skill-operation',operationRoute[1]); requireValue(op,'Operation not found',404);
      if(!operationRoute[2] && req.method==='GET'){owner(device);send(res,200,op);return true;}
      if(operationRoute[2] && req.method==='POST'){
        worker(device);requireValue(op.deviceId===device.id,'Operation belongs to another device',403);
        const input=await body(req);requireValue(['running','succeeded','failed'].includes(input.state),'Invalid operation result');
        return await serialized('skill-operation:'+op.id,async()=>{
          const current=await store.get('skill-operation',op.id);
          const currentDevice=await store.get('device',device.id);requireValue(currentDevice && !currentDevice.revokedAt && currentDevice.tokenHash===device.tokenHash,'Device authorization required',401);
          if(['succeeded','failed'].includes(current.state)){send(res,200,current);return true;}
          let result=input.result || {}, publication;
          if(input.state==='succeeded' && op.action==='publish'){
            const bundle=validateSkillPackage(result.bundle); requireValue(bundle.hash===op.expectedHash,'Source skill changed',409);
            const key='private/skills/'+bundle.hash+'.json';await storage.put(key,Buffer.from(JSON.stringify(bundle)));
            const versionId=hash(canonicalJson({hash:bundle.hash,policy:op.policy}));
            publication={id:versionId,schemaVersion:1,key,hash:bundle.hash,name:bundle.name,description:bundle.description,declaredVersion:bundle.declaredVersion,policy:op.policy,sourceDeviceId:device.id,sourceSkillId:op.skillId,createdAt:now(),files:bundle.files.map(({body,...file})=>file)};
            result={versionId};
          }
          requireValue(Buffer.byteLength(JSON.stringify(result))<(op.action==='prepare-publish'?24:2)*1024*1024,'Operation result too large',413);
          const updated=await store.transaction(async tx=>{
            const authorization=await tx.getForUpdate('device',device.id);requireValue(authorization && !authorization.revokedAt && authorization.tokenHash===device.tokenHash,'Device authorization required',401);
            if(input.state==='running')requireValue(!(await tx.list('client-update')).some(o=>o.deviceId===device.id && ['waiting_worker','installing'].includes(o.state)),'客户端正在更新，稍后重试',409);
            if(publication && !await tx.get('skill-version',publication.id))await tx.put('skill-version',publication);
            return tx.put('skill-operation',{...current,state:input.state,result,updatedAt:now()});
          });send(res,200,updated);return true;
        });
      }
    }
    requireValue(false,'Skill route not found',404);
  }
  return {handle,inbox,selection};
}
