import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import spawn from 'cross-spawn';
import { hash, readJson, now, contained, canonicalJson } from './common.mjs';
import { agentProfile, execute, terminate, agentEnvironment } from './agents.mjs';
import { SKILL_AGENTS, skillMetadata, packageSkill, validateSkillPackage, cleanRequirements } from './skill-package.mjs';

const json = file => { try { return readJson(file); } catch { return {}; } };
const canonicalPath = file => {try{return fs.realpathSync(file);}catch{return path.resolve(file);}};
export function globalSkillRoots(home = os.homedir()) {
  return { codex: path.join(home, '.agents', 'skills'), codebuddy: path.join(home, '.codebuddy', 'skills'), claude: path.join(home, '.claude', 'skills') };
}

function settingsFor(home, agent, cwd, profile) {
  const files = [path.join(home, '.' + agent, 'settings.json'), path.join(cwd, '.' + agent, 'settings.json'), path.join(cwd, '.' + agent, 'settings.local.json')];
  const result = {skillOverrides:{}, enabledPlugins:{}, mcpServers:{}};
  for (const file of [...new Set(files)]) {
    const value=json(file);
    Object.assign(result, value, {skillOverrides:{...result.skillOverrides,...Object.fromEntries(Object.entries(value.skillOverrides || {}).filter(([,mode])=>['on','off','name-only','user-invocable-only'].includes(mode)))},enabledPlugins:{...result.enabledPlugins,...value.enabledPlugins},mcpServers:{...result.mcpServers,...value.mcpServers}});
  }
  if(agent === 'claude' && (profile.args || []).some(value=>['--bare','--disable-slash-commands','--safe-mode'].includes(value))) result.skillsDisabled=true;
  return result;
}

export function codexSkills(command, cwds, { args = [], env = agentEnvironment(), timeoutMs = 15000, query = 'skills/list' } = {}) {
  if(!['skills/list','model/list','config/read'].includes(query))throw new Error('Unsupported inventory query');
  return new Promise(resolve => {
    const child = spawn(command, ['app-server', '--listen', 'stdio://', ...args], { env, stdio: ['pipe','pipe','pipe'], detached: process.platform !== 'win32', windowsHide: true });
    let buffer = '', finished = false, timer;
    const finish = value => { if (finished) return; finished = true; clearTimeout(timer); terminate(child); resolve(value); };
    const send = value => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + '\n'); };
    child.stdin.on('error', () => finish(null));
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    child.stderr.resume(); // Never expose startup configuration or credentials.
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 8 * 1024 * 1024) return finish(null);
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value.id === 1) {
          if (value.error) return finish(null);
          send({ method: 'initialized' });
          send({ id: 2, method: query, params: query === 'skills/list' ? { cwds, forceReload: true } : query === 'config/read' ? {cwd:cwds[0],includeLayers:false} : {} });
        }
        if (value.id === 2) {
          if (query === 'config/read' && !value.error) {
            const config=value.result?.config || {};
            // Return only presence and skill visibility; native configuration can contain credentials.
            finish({configHash:hash(canonicalJson({model:config.model,profile:config.profile,model_provider:config.model_provider,sandbox_mode:config.sandbox_mode,approval_policy:config.approval_policy,skills:config.skills})),skills:(config.skills?.config || []).filter(s=>typeof s.path==='string').map(s=>({path:s.path,enabled:s.enabled!==false})),mcp:Object.fromEntries(Object.entries(config.mcp_servers || config.mcpServers || {}).map(([name,server])=>[name,{enabled:server.enabled!==false}]))});
          } else finish(value.error ? null : value.result);
        }
        // Refuse all requests requiring execution or approval during discovery.
        if (value.id && value.method) send({ id: value.id, error: { code: -32601, message: 'Inventory only' } });
      }
    });
    timer = setTimeout(() => finish(null), timeoutMs);
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'lingnest-skill-inventory', version: '1.0.0' }, capabilities: { experimentalApi: true } } });
  });
}

export function configOverrides(profile) {
  const result = [];
  for (let i = 0; i < (profile.args || []).length; i++) {
    if (['-c','--config','-p','--profile'].includes(profile.args[i]) && typeof profile.args[i+1] === 'string') result.push(profile.args[i], profile.args[++i]);
  }
  return result;
}

export async function fixedSkillProfiles(profiles, snapshots, cwd, {native=codexSkills,env=agentEnvironment()}={}) {
  const fixed=snapshots.filter(s=>s.agent==='codex');
  if(!fixed.length)return profiles;
  const profile=agentProfile('codex',profiles),args=configOverrides(profile);
  const [settings,listing]=await Promise.all([native(profile.command,[cwd],{args,env,query:'config/read'}),native(profile.command,[cwd],{args,env})]);
  if(!settings || !listing)throw new Error('当前 Codex 无法确认任务技能快照，请升级后继续');
  const entries=(listing.data || []).flatMap(group=>group.skills || []);
  const names=new Set(fixed.map(s=>s.name)),visibility=new Map((settings.skills || []).map(s=>[s.path,s.enabled]));
  for(const skill of entries)if(skill.path && (names.has(skill.name) || skill.enabled===false))visibility.set(skill.path,false);
  for(const skill of fixed)visibility.set(canonicalPath(path.join(cwd,skill.path,'SKILL.md')),true);
  const override='skills.config=['+[...visibility].map(([file,enabled])=>`{path=${JSON.stringify(file)},enabled=${enabled}}`).join(',')+']';
  const result=await native(profile.command,[cwd],{args:[...args,'-c',override],env});
  const checked=(result?.data || []).flatMap(group=>group.skills || []);
  for(const skill of fixed)if(!checked.some(s=>s.path && canonicalPath(s.path)===canonicalPath(path.join(cwd,skill.path,'SKILL.md')) && s.enabled!==false))throw new Error('Codex 未加载固定技能快照');
  for(const skill of checked)if(names.has(skill.name) && skill.enabled!==false && !fixed.some(s=>skill.path && canonicalPath(skill.path)===canonicalPath(path.join(cwd,s.path,'SKILL.md'))))throw new Error('Codex 同名全局技能未隔离');
  const execution=[...(profile.args || [])];execution.splice(execution.at(-1)==='-'?execution.length-1:execution.length,0,'-c',override);
  return {...profiles,codex:{...profile,args:execution}};
}

function findSkills(root) {
  const result = [], seen = new Set();
  function walk(directory, depth) {
    let real; try { real = fs.realpathSync(directory); } catch { return; }
    if (seen.has(real) || seen.size > 1000 || depth > 5) return;
    seen.add(real);
    if (fs.existsSync(path.join(directory, 'SKILL.md'))) { result.push(directory); return; }
    let entries; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) if (!entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink())) walk(path.join(directory, entry.name), depth + 1);
  }
  walk(root, 0); return result;
}

function projectRoots(cwd, agent) {
  const rootName = agent === 'codex' ? '.agents' : '.' + agent;
  const result = []; let directory = path.resolve(cwd);
  // Stop at the repository root; a task without a repository has no parent scope.
  const ancestors = [];
  for (;;) {
    ancestors.push(directory);
    if (fs.existsSync(path.join(directory, '.git'))) { for (const item of ancestors) result.push({ root: path.join(item, rootName, 'skills'), scope: 'project', context: cwd }); break; }
    const parent = path.dirname(directory); if (parent === directory) { result.push({ root: path.join(cwd, rootName, 'skills'), scope: 'project', context: cwd }); break; }
    directory = parent;
  }
  return result;
}

function plugins(home, agent, settings) {
  const installed = json(path.join(home, '.' + agent, 'plugins', 'installed_plugins.json'));
  const result = [];
  for (const [name, entries] of Object.entries(installed.plugins || {})) {
    for (const entry of Array.isArray(entries) ? entries : [entries]) if (typeof entry.installPath === 'string') {
      result.push({ root: path.join(entry.installPath, 'skills'), scope: 'plugin', plugin: name, enabled: settings.enabledPlugins?.[name] !== false, context: entry.projectPath || null, nativeVersion: entry.version || entry.gitCommitSha || null });
    }
  }
  return result;
}

export async function dependencyStatus(requirements, { env = agentEnvironment(), mcp = {}, browserAvailable = false, probe = execute } = {}) {
  const missing = [], unknown = [];
  for (const name of requirements.commands || []) {
    // This is a presence check, not an arbitrary command declared by a skill.
    const directories = String(env.PATH || '').split(path.delimiter);
    const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
    const found = directories.some(dir => suffixes.some(suffix => { try { fs.accessSync(path.join(dir, name + suffix), process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return true; } catch { return false; } }));
    if (!found) missing.push('程序：' + name);
  }
  for (const name of requirements.env || []) if (!env[name]) missing.push('环境变量：' + name);
  if(requirements.pythonModules?.length){
    const source='import sys,json,importlib.metadata as m\nr=[]\nfor n in json.load(sys.stdin):\n try: m.distribution(n)\n except m.PackageNotFoundError: r.append(n)\nprint(json.dumps(r))';
    const result=await probe(process.platform==='win32'?'python':'python3',['-c',source],{env,input:JSON.stringify(requirements.pythonModules),timeoutMs:5000});
    if(result.code===0){try{for(const name of JSON.parse(result.tail.trim()))missing.push('Python 模块：'+name);}catch{unknown.push('Python 模块检查');}}
    else missing.push('Python 运行时');
  }
  for (const name of requirements.mcp || []) if (!mcp[name] || mcp[name].disabled || mcp[name].enabled === false) missing.push('MCP：' + name); else unknown.push('MCP 授权：' + name);
  if (requirements.browser && !browserAvailable) unknown.push('浏览器会话');
  return { state: missing.length ? 'missing' : unknown.length ? 'unknown' : 'ready', missing, unknown };
}

export async function scanSkillInventory(config = {}, { cwd = process.cwd(), home = os.homedir(), env = agentEnvironment(), nativeCodex = codexSkills, versionProbe = execute } = {}) {
  const globalRoots = globalSkillRoots(home), local = new Map(), items = [], agents = [];
  const contexts = [...new Set([cwd, ...(config.skillProjects || []).filter(p => typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p))])];
  for (const agent of SKILL_AGENTS) {
    const profile = agentProfile(agent, config.agents);
    const probe = await versionProbe(profile.command, profile.versionArgs || ['--version'], { env, timeoutMs: 5000 });
    const available = probe.code === 0;
    const version=available ? String(probe.tail || '').trim().slice(0,150) : null;
    agents.push({ name: agent, installed: available, version, executionEnabled: agent !== 'claude' && profile.enabled !== false, profileHash:hash(canonicalJson({profile,version,platform:process.platform,home,cwd})) });
    const settings = settingsFor(home, agent, cwd, profile);
    const roots = [{ root: globalRoots[agent], scope: 'user', context: null }, ...contexts.flatMap(dir => projectRoots(dir, agent)).filter(origin=>path.resolve(origin.root)!==path.resolve(globalRoots[agent])), ...plugins(home, agent, settings)];
    if (agent === 'codex') roots.push({ root: path.join(env.CODEX_HOME || path.join(home, '.codex'), 'skills'), scope: 'legacy-user', context: null }, { root: '/etc/codex/skills', scope: 'admin', context: null });
    if (agent === 'claude') roots.push({root:path.join(process.platform==='darwin'?'/Library/Application Support/ClaudeCode':process.platform==='win32'?path.join(env.ProgramFiles || 'C:\\Program Files','ClaudeCode'):'/etc/claude-code','.claude','skills'),scope:'admin',context:null});
    const native = agent === 'codex' && available ? await nativeCodex(profile.command, contexts, { args: configOverrides(profile), env }) : null;
    const nativeConfig = agent === 'codex' && native ? await nativeCodex(profile.command, [cwd], {args:configOverrides(profile),env,query:'config/read'}) : null;
    agents.at(-1).profileHash=hash(canonicalJson({profile,version,platform:process.platform,home,cwd,nativeConfigHash:nativeConfig?.configHash || null}));
    agents.at(-1).discovery = agent === 'codex' && native ? 'native' : 'filesystem';
    agents.at(-1).builtinState = agent === 'codex' && native ? 'reported' : 'unknown';
    agents.at(-1).loadErrors = (native?.data || []).reduce((count,group)=>count+(group.errors?.length || 0),0);
    const codexCache=path.join(env.CODEX_HOME || path.join(home,'.codex'),'plugins','cache');
    if(agent==='codex' && !native)roots.push({root:codexCache,scope:'plugin',context:null});
    const nativeEntries = (native?.data || []).flatMap(group => (group.skills || []).map(skill => ({ ...skill, context: group.cwd })));
    const foundDirectories=new Set(roots.flatMap(origin=>findSkills(origin.root)).map(canonicalPath));
    for (const skill of nativeEntries) if (typeof skill.path === 'string' && path.basename(skill.path) === 'SKILL.md') {
      const directory = path.dirname(skill.path);
      if(foundDirectories.has(canonicalPath(directory)))continue;
      const parent = roots.find(r => contained(canonicalPath(r.root), canonicalPath(directory)));
      const plugin=agent==='codex' && contained(canonicalPath(codexCache),canonicalPath(directory)) ? path.relative(canonicalPath(codexCache),canonicalPath(directory)).split(path.sep).slice(0,3).join('/') : null;
      const nativeScope=String(skill.scope || 'system').toLowerCase();
      roots.push({ root: directory, scope: plugin?'plugin':['system','admin'].includes(nativeScope)?nativeScope:parent?.scope || nativeScope, plugin, context: plugin || ['system','admin'].includes(nativeScope)?null:parent ? parent.context || null : (nativeScope==='user' ? null : skill.context) });
    }
    const seen = new Set();
    for (const origin of roots) for (const directory of findSkills(origin.root)) {
      const identity = agent + ':' + path.resolve(directory) + ':' + (origin.context || 'global');
      if (seen.has(identity)) continue; seen.add(identity);
      const skillId = hash(identity), real = fs.realpathSync(directory);
      let metadata = {}, bundle, portable = false, issue = null;
      try {
        metadata = skillMetadata(fs.readFileSync(path.join(real, 'SKILL.md'), 'utf8'));
        bundle = packageSkill(real, { validate: false });
        try { validateSkillPackage(bundle); portable = ['user','legacy-user','project'].includes(origin.scope); } catch (error) { issue = error.message.replace(real, '[Skill]'); }
      } catch { issue = '技能包无法读取或不符合发布格式'; }
      const name = String(metadata.name || path.basename(directory)).slice(0, 100);
      const loaded = nativeEntries.filter(s => typeof s.path === 'string' && canonicalPath(s.path) === path.join(real, 'SKILL.md'));
      const effective=settingsFor(home,agent,origin.context || cwd,profile);
      let enabled = origin.enabled === false || effective.skillsDisabled ? false : agent === 'codex' ? (native ? loaded.some(s => s.enabled !== false) : null) : origin.scope!=='plugin' && effective.skillOverrides?.[name] === 'off' ? false : true;
      let loadState = !available ? 'agent_unavailable' : enabled === false ? 'disabled' : agent === 'codex' ? native ? loaded.length ? 'loaded' : 'not_loaded' : 'unknown' : 'configured';
      const toolDependencies = json(path.join(real, 'SKILL.json')).dependencies?.tools || loaded[0]?.dependencies?.tools || [];
      let requirements = { commands: [], env: [], mcp: [], browser: false };
      try {
        requirements = cleanRequirements(metadata.metadata?.['lingnest-requirements'] ? JSON.parse(metadata.metadata['lingnest-requirements']) : {});
        for (const tool of toolDependencies) if (tool.type === 'env_var' && /^[\w.-]{1,100}$/.test(tool.value || '')) requirements.env.push(tool.value);
        else if (tool.type === 'mcp' && /^[\w.-]{1,100}$/.test(tool.value || '')) requirements.mcp.push(tool.value);
      } catch { issue = 'Skill 依赖声明无法解析'; }
      const mcp = agent==='codex' ? nativeConfig?.mcp || {} : effective.mcpServers;
      const dependencies = await dependencyStatus(requirements, { env, mcp });
      if(!metadata.metadata?.['lingnest-requirements'] && !toolDependencies.length){dependencies.unknown.push('依赖未声明');if(dependencies.state==='ready')dependencies.state='unknown';}
      const item = { id: skillId, agent, name, description: String(metadata.description || '').slice(0, 1024), declaredVersion: String(metadata.metadata?.version || metadata.version || origin.nativeVersion || '').slice(0, 100),
        hash: bundle?.hash || null, scope: origin.scope, source: origin.plugin || (agent==='codex' && origin.scope==='plugin'?path.relative(origin.root,directory).split(path.sep).slice(0,3).join('/'):origin.scope), context: origin.context ? path.basename(origin.context) : '采集环境', enabled, loadState,
        portable, requirements, dependencies, issue, capabilities: [], applicableAgents:[],systems:[],verification: null, sharedWith: [], taskContext: !origin.context || path.resolve(origin.context) === path.resolve(cwd) };
      items.push(item); local.set(skillId, { directory, real, origin, globalRoot: globalRoots[agent], profile, metadata, mcp });
    }
    // Preserve a diagnostic row for bundled skills that expose no local file.
    for (const skill of nativeEntries.filter(s => !s.path)) items.push({ id: hash(agent + ':native:' + skill.name + ':' + skill.context), agent, name: skill.name, description: String(skill.description || '').slice(0,1024), scope: 'system', source: 'native', context: path.basename(skill.context), enabled: skill.enabled !== false, loadState: 'loaded', hash: null, portable: false, requirements: {}, dependencies: { state: 'unknown', missing: [], unknown: ['无本地技能包'] }, capabilities: [], verification: null, sharedWith: [] });
  }
  // Different products have different precedence. Do not collapse identities.
  for (const item of items) {
    const location = local.get(item.id); if (!location) continue;
    item.sharedWith = items.filter(other => other.id !== item.id && local.get(other.id)?.real === location.real).map(other => ({ id: other.id, agent: other.agent, name: other.name }));
    if (['codebuddy','claude'].includes(item.agent) && !['plugin','system'].includes(item.scope) && item.enabled !== false) {
      const competing = items.filter(other => other.agent === item.agent && other.name === item.name && other.taskContext && item.taskContext && !['plugin','system'].includes(other.scope) && other.enabled !== false);
      const score = x => item.agent === 'codebuddy' ? x.scope === 'project' ? 2 : 1 : x.scope === 'admin' ? 3 : x.scope === 'user' ? 2 : 1;
      if (competing.some(other => score(other) > score(item))) item.loadState = 'shadowed';
      if (!agents.find(a => a.name === item.agent)?.installed) item.loadState = 'agent_unavailable';
    }
  }
  const inventory = { schemaVersion: 1, scannedAt: now(), platform: process.platform, agents, items, projects:contexts.filter(directory=>directory!==cwd) };
  inventory.digest = hash(JSON.stringify({ agents, items,projects:inventory.projects }));
  return { inventory, local, globalRoots, contexts, env };
}
