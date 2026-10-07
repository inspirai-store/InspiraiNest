import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execute, agentEnvironment } from './agents.mjs';
import { AGENT_CATALOG, agentDefinition, validateRelease, releaseVersion } from './agent-catalog.mjs';
import { agentHome, managedState, executable, resolveAgentProfile, commandEnvironment, installationFingerprint, agentVersion } from './agent-paths.mjs';
import { atomicJson, contained, requireValue } from './common.mjs';

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
export function installerEnvironment(source = process.env) {
  // npm must not inherit cloud credentials, Agent API keys or authentication files.
  const allowed = /^(?:HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|LANG|LC_ALL|SHELL)$/i;
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key)));
}
export function originalInstallation(entry, command, { home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  if (!command) return null;
  let real; try { real = fs.realpathSync(command); } catch { return null; }
  const brew = executable('brew', env, platform);
  if (brew && /\/(?:Cellar|Caskroom)\//.test(real)) {
    const formulas = { codex:'codex', codebuddy:'codebuddy-code', claude:'claude-code', gemini:'gemini-cli', opencode:'opencode' };
    if (real.includes('/' + formulas[entry.id] + '/')) return { source: 'homebrew', command, real, brew, formula: formulas[entry.id] };
  }
  if(platform==='win32' && /\.cmd$/i.test(command)){
    const prefix=path.dirname(command), directory=path.join(prefix,'node_modules',entry.package), data=read(path.join(directory,'package.json'));
    const bin=typeof data.bin==='string'?data.bin:data.bin?.[entry.command];
    let shim='';try{if(fs.statSync(command).size<32768)shim=fs.readFileSync(command,'utf8').replaceAll('\\','/');}catch{}
    const target=bin && path.resolve(directory,bin);
    if(data.name===entry.package && target && contained(directory,target) && fs.existsSync(target) && shim.includes('node_modules/'+entry.package+'/'+bin.replace(/^\.\//,'')))return {source:'npm',command,real:target,prefix,npm:executable('npm',env,platform),version:data.version};
  }
  let directory = path.dirname(real);
  for (let depth = 0; depth < 5; depth++, directory = path.dirname(directory)) {
    const data = read(path.join(directory, 'package.json'));
    if (data.name !== entry.package) continue;
    const parent = path.dirname(directory), modules = entry.package.startsWith('@') ? path.dirname(parent) : parent;
    if (path.basename(modules) !== 'node_modules') return null;
    const base = path.dirname(modules), prefix = path.basename(base) === 'lib' ? path.dirname(base) : base;
    return { source: 'npm', command, real, prefix, npm: executable('npm', env, platform), version: data.version };
  }
  const roots = { codex: ['.local/bin/codex', '.local/share/codex', '.codex/bin'], codebuddy: ['.local/bin/codebuddy', 'AppData/Local/codebuddy/bin'],
    claude: ['.local/bin/claude', '.local/share/claude'], opencode: ['.opencode/bin'] };
  if ((roots[entry.id] || []).some(relative => contained(path.join(home, relative), real) || path.resolve(command) === path.join(home, relative))) return { source: 'native', command, real };
  return { source: 'unknown', command, real };
}
export async function scanAgents(config = {}, { home = os.homedir(), platform = process.platform, arch = process.arch, env = process.env, probe = execute } = {}) {
  const items = [];
  for (const entry of AGENT_CATALOG) {
    const profile = { command: entry.command, ...(config.agents?.[entry.id] || {}) };
    const custom = profile.command !== entry.command;
    const resolved = resolveAgentProfile(entry.id, profile, { home, platform });
    const command = executable(resolved.command, env, platform);
    const original = originalInstallation(entry, executable(profile.command, env, platform), { home, platform, env });
    const result = command ? await probe(command, profile.versionArgs || ['--version'], { env: commandEnvironment(resolved, agentEnvironment(env)), timeoutMs: 5000 }) : { spawnError:'ENOENT' };
    const installed = result.code === 0;
    const source = resolved.managedRuntime ? 'managed' : original?.source || 'unknown';
    const item = { id: entry.id, command, version: installed ? agentVersion(result.tail) : null, installed, custom, source,
      originalSupported: !custom && Boolean(original && ['npm','homebrew','native'].includes(original.source) && (original.source !== 'npm' || original.npm)),
      original, probeState: installed ? 'available' : result.timedOut ? 'timeout' : result.spawnError === 'ENOENT' ? 'not_found' : 'failed' };
    let originalStamp='';try{const stat=fs.statSync(original.real);originalStamp=stat.size+':'+stat.mtimeMs+':'+(original.version || '');}catch{}
    let commandStamp='';try{const stat=fs.statSync(command);commandStamp=stat.size+':'+stat.mtimeMs;}catch{}
    item.fingerprint = installationFingerprint({ ...item, command: command + ':' + (original?.real || '') + ':' + originalStamp + ':' + commandStamp }); items.push(item);
  }
  return { schemaVersion:1, platform, arch, agents:items };
}
async function download(url, { fetcher = fetch, signal, maxBytes = 256 * 1024 * 1024, redirectHosts } = {}) {
  let response;
  for(let redirects=0;redirects<4;redirects++){
    response=await fetcher(url,{redirect:redirectHosts?'manual':'error',signal});
    if(![301,302,303,307,308].includes(response.status))break;
    const next=new URL(response.headers.get('location'),url);
    requireValue(redirectHosts?.includes(next.hostname)&&next.protocol==='https:'&&!next.username&&!next.password&&!next.port,'安装文件重定向来源无效');
    await response.body?.cancel();url=next.href;
  }
  requireValue(response.ok, '安装文件下载失败');
  requireValue(Number(response.headers.get('content-length') || 0) <= maxBytes, '安装文件过大');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) throw new Error('安装文件过大'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function ensureNode(root, { platform = process.platform, arch = process.arch, fetcher = fetch, run = execute, env = process.env, signal } = {}) {
  requireValue(['darwin','linux','win32'].includes(platform) && ['x64','arm64'].includes(arch), '当前系统架构不支持');
  const stored = read(path.join(root, 'runtime.json'));
  if (stored.node && stored.npm && contained(root, stored.node) && contained(root, stored.npm) && fs.existsSync(stored.node) && fs.existsSync(stored.npm)) return stored;
  const index = JSON.parse((await download('https://nodejs.org/dist/index.json', { fetcher, signal, maxBytes:2*1024*1024 })).toString());
  const release = index.find(r => /^v24\.\d+\.\d+$/.test(r.version) && r.lts);
  requireValue(release, 'Node.js 运行时不可用');
  const name = `node-${release.version}-${platform === 'win32' ? 'win' : platform}-${arch}`, extension = platform === 'win32' ? '.zip' : '.tar.gz';
  const filename = name + extension, base = 'https://nodejs.org/dist/' + release.version + '/';
  const checksums = (await download(base + 'SHASUMS256.txt', { fetcher, signal, maxBytes:1024*1024 })).toString();
  const expected = checksums.split('\n').find(line => line.trim().endsWith(' ' + filename))?.trim().split(/\s+/)[0];
  requireValue(/^[a-f0-9]{64}$/.test(expected || ''), '运行时校验信息缺失');
  const bytes = await download(base + filename, { fetcher, signal });
  requireValue(crypto.createHash('sha256').update(bytes).digest('hex') === expected, '运行时完整性校验失败');
  const staging = path.join(root, '.runtime-' + crypto.randomUUID()); fs.mkdirSync(staging, { recursive:true });
  const archive = path.join(staging, filename); fs.writeFileSync(archive, bytes);
  try {
    const command = platform === 'win32' ? 'powershell.exe' : 'tar';
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    const script='Expand-Archive -LiteralPath '+quote(archive)+' -DestinationPath '+quote(staging);
    const args = platform === 'win32' ? ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]
      : ['-xzf',archive,'-C',staging];
    const result = await run(command, args, { env:installerEnvironment(env), signal, timeoutMs:120000 });
    requireValue(result.code === 0 && !result.aborted, '运行时解压失败');
    const destination = path.join(root, 'runtimes', name); fs.mkdirSync(path.dirname(destination), { recursive:true });
    if (!fs.existsSync(destination)) fs.renameSync(path.join(staging, name), destination);
    const node = path.join(destination, platform === 'win32' ? 'node.exe' : 'bin/node');
    const npm = path.join(destination, platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js');
    const check = await run(node, ['--version'], { env:installerEnvironment(env), signal, timeoutMs:15000 });
    requireValue(check.code === 0 && check.tail.trim() === release.version && fs.existsSync(npm), '运行时验证失败');
    const value = { node, npm, version:release.version, sha256:expected }; atomicJson(path.join(root,'runtime.json'), value); return value;
  } finally { fs.rmSync(staging, { recursive:true, force:true }); }
}
export async function externalAgentRunning(command, { platform = process.platform, run = execute, env = process.env } = {}) {
  if (!command) return false;
  // Inspect executable identities only. Command-line arguments may contain credentials.
  const basename=path.basename(command).replace(/\.(?:exe|cmd|bat)$/i,'');
  // The inspection subprocess emits a boolean only, never another process's arguments.
  const source=`const c=require('node:child_process'),p=require('node:path');const target=${JSON.stringify(command)},name=${JSON.stringify(basename)};const rows=c.execFileSync('ps',['-axo','pid=,comm=,args='],{encoding:'utf8',maxBuffer:8*1024*1024}).split('\\n');process.stdout.write(String(rows.some(r=>{const m=r.trim().match(/^(\\d+)\\s+(\\S+)\\s+(.*)$/);return m && ![process.pid,process.ppid].includes(Number(m[1])) && (p.basename(m[2])===name || m[3].includes(target));})));`;
  const psQuote=value=>"'"+value.replaceAll("'","''")+"'";
  const psScript='$target='+psQuote(command)+';$name='+psQuote(basename)+";$found=Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne $PID -and ($_.Name -eq ($name+'.exe') -or ($_.CommandLine -and $_.CommandLine.Contains($target)))};[Console]::Write([bool]$found)";
  const result = platform === 'win32'
    ? await run('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(psScript,'utf16le').toString('base64')], { env:installerEnvironment(env), timeoutMs:10000 })
    : await run(process.execPath, ['-e',source], { env:{...installerEnvironment(env),...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})}, timeoutMs:10000 });
  if (result.code !== 0) throw new Error('无法确认 Agent 会话是否已结束');
  return result.tail.trim().toLowerCase()==='true';
}
async function updateNativeCodex(original, release, root, {platform,arch=process.arch,fetcher=fetch,run,env,signal,beforeCommit}) {
  const baseline=fs.statSync(original.real);
  requireValue(['darwin','linux','win32'].includes(platform)&&['arm64','x64'].includes(arch),'当前系统架构不支持');
  const triple=(arch==='arm64'?'aarch64':'x86_64')+'-'+({darwin:'apple-darwin',linux:'unknown-linux-musl',win32:'pc-windows-msvc'}[platform]);
  const filename='codex-'+triple+(platform==='win32'?'.exe.zip':'.tar.gz');
  const metadata=JSON.parse((await download('https://api.github.com/repos/openai/codex/releases/tags/rust-v'+release.version,{fetcher,signal,maxBytes:2*1024*1024})).toString());
  const asset=metadata.assets?.find(a=>a.name===filename);
  requireValue(asset?.browser_download_url==='https://github.com/openai/codex/releases/download/rust-v'+release.version+'/'+filename && /^sha256:[a-f0-9]{64}$/.test(asset.digest || ''),'官方原生安装校验信息不可用，请选择灵藏托管');
  const bytes=await download(asset.browser_download_url,{fetcher,signal,redirectHosts:['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']});
  requireValue('sha256:'+crypto.createHash('sha256').update(bytes).digest('hex')===asset.digest,'原生安装完整性校验失败');
  const temp=path.join(root,'.native-'+crypto.randomUUID());fs.mkdirSync(temp,{recursive:true});
  const archive=path.join(temp,filename);fs.writeFileSync(archive,bytes);
  try{
    fs.accessSync(path.dirname(original.real),fs.constants.W_OK);
    const quote=v=>"'"+v.replaceAll("'","''")+"'",script='Expand-Archive -LiteralPath '+quote(archive)+' -DestinationPath '+quote(temp);
    const result=await run(platform==='win32'?'powershell.exe':'tar',platform==='win32'?['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]:['-xzf',archive,'-C',temp],{env:installerEnvironment(env),signal,timeoutMs:120000});
    requireValue(result.code===0 && !signal?.aborted,'原生安装解压失败');
    const candidate=path.join(temp,'codex-'+triple+(platform==='win32'?'.exe':''));
    if(platform!=='win32')fs.chmodSync(candidate,0o755);
    const check=await run(candidate,['--version'],{env:installerEnvironment(env),signal,timeoutMs:15000});
    requireValue(check.code===0 && agentVersion(check.tail)?.includes(release.version) && !signal?.aborted,'原生安装验证失败');
    const staged=original.real+'.lingnest-'+crypto.randomUUID(),backup=staged+'.backup';fs.copyFileSync(candidate,staged);if(platform!=='win32')fs.chmodSync(staged,0o755);
    await beforeCommit();const current=fs.statSync(original.real);requireValue(!signal?.aborted && current.size===baseline.size && current.mtimeMs===baseline.mtimeMs,'Agent 安装状态已变化，请刷新');
    try{fs.renameSync(original.real,backup);try{fs.renameSync(staged,original.real);}catch(e){fs.renameSync(backup,original.real);throw e;}fs.rmSync(backup,{force:true});}
    finally{fs.rmSync(staged,{force:true});}
    return {code:0};
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
export function createAgentInstaller(config, options = {}) {
  const home = options.home || os.homedir(), platform = options.platform || process.platform, root = agentHome(home, platform);
  const run = options.run || execute, env = options.env || process.env;
  const scan = () => scanAgents(config, { ...options, home, platform });
  async function install(op, { signal, beforeCommit = async () => {} } = {}) {
    const entry = agentDefinition(op.agent), release = validateRelease(op.release, entry.id), inventory = await scan();
    const current = inventory.agents.find(a => a.id === entry.id);
    requireValue(!signal?.aborted,'操作已取消');
    requireValue(/^[a-f0-9]{64}$/.test(op.id || ''),'操作编号无效');
    const journalFile=path.join(root,'operations',op.id+'.json'), journal=read(journalFile);
    if(op.method==='original' && journal.started){
      requireValue(journal.agent===op.agent && journal.version===release.version && journal.deploymentId===op.deploymentId,'安装记录与当前操作不符');
      const actual=current.original && await run(current.original.command,['--version'],{env:installerEnvironment(env),signal,timeoutMs:15000});
      const version=actual?.code===0 && agentVersion(actual.tail);
      requireValue(version && (journal.verifiedVersion===version || new RegExp('(^|[^0-9])'+release.version.replaceAll('.','\\.')+'([^0-9]|$)').test(version)),'原有安装已中断，请在目标电脑核验后重新操作');
      await beforeCommit();requireValue(!signal?.aborted,'操作已取消');
      const state=managedState(home,platform);if(state[entry.id]){delete state[entry.id];atomicJson(path.join(root,'current.json'),state);}
      return {version};
    }
    requireValue(current.fingerprint === op.expectedFingerprint, 'Agent 安装状态已变化，请刷新');
    requireValue(!current.custom, '自定义命令不能远程覆盖');
    if (op.method === 'original') {
      requireValue(current.originalSupported, '原有安装来源不支持');
      const original = current.original;
      if (await (options.running || externalAgentRunning)(original.real, { platform, run, env })) return { waiting:true, error:'等待 Agent 会话结束' };
      await beforeCommit();
      let command, args;
      if (original.source === 'npm') {
        fs.accessSync(original.prefix, fs.constants.W_OK); command = original.npm;
        args = ['install','--global','--prefix',original.prefix,entry.package + '@' + release.version,'--registry=https://registry.npmjs.org','--no-audit','--no-fund'];
      } else if (original.source === 'homebrew') {
        command = original.brew; args = ['upgrade', ...(['codex','claude'].includes(entry.id) ? ['--cask'] : []), original.formula];
      } else { command = original.command; args = [entry.id === 'opencode' ? 'upgrade' : 'update']; }
      atomicJson(journalFile,{started:true,agent:op.agent,version:release.version,deploymentId:op.deploymentId});
      const result = original.source==='native' && entry.id==='codex'
        ? await updateNativeCodex(original,release,root,{...options,platform,run,env,signal,beforeCommit})
        : await run(command, args, { env:installerEnvironment(env), signal, timeoutMs:15*60000 });
      requireValue(!result.aborted && !result.timedOut && result.code === 0, result.aborted ? '操作已取消' : result.timedOut ? '安装超时' : '原有安装更新失败，请在目标电脑处理');
      const check = await run(original.command, ['--version'], { env:installerEnvironment(env), signal, timeoutMs:15000 });
      requireValue(check.code === 0, '更新后 Agent 验证失败');
      atomicJson(journalFile,{...read(journalFile),verifiedVersion:agentVersion(check.tail)});
      await beforeCommit();requireValue(!signal?.aborted,'操作已取消');
      const state=managedState(home,platform);if(state[entry.id]){delete state[entry.id];atomicJson(path.join(root,'current.json'),state);}
      return { version:agentVersion(check.tail) };
    }
    requireValue(op.method === 'managed', '安装方式无效');
    fs.mkdirSync(root, { recursive:true });
    const runtime = await (options.ensureRuntime || ensureNode)(root, { ...options, platform, env, signal });
    const directory = path.join(root, entry.id, release.version + '-' + crypto.createHash('sha256').update(release.integrity).digest('hex').slice(0,12));
    const staging = path.join(root, '.install-' + crypto.randomUUID()); fs.mkdirSync(staging);
    const archive = path.join(staging, 'package.tgz'), userconfig = path.join(staging, 'npmrc'); fs.writeFileSync(userconfig,'');
    const runtimeEnv = { ...installerEnvironment(env), PATH:path.dirname(runtime.node) + path.delimiter + (env.PATH || ''), DISABLE_AUTOUPDATER:'1', DISABLE_UPDATES:'1' };
    try {
      if (!fs.existsSync(path.join(directory,'verified.json'))) {
        const bytes = await download(release.tarball, { ...options, signal });
        requireValue('sha512-' + crypto.createHash('sha512').update(bytes).digest('base64') === release.integrity, 'Agent 完整性校验失败');
        fs.writeFileSync(archive, bytes);
        const result = await run(runtime.node, [runtime.npm,'install','--global','--prefix',path.join(staging,'prefix'),archive,'--registry=https://registry.npmjs.org','--userconfig',userconfig,'--engine-strict','--no-audit','--no-fund','--progress=false'], { cwd:staging,env:runtimeEnv, signal, timeoutMs:15*60000 });
        requireValue(!result.aborted && !result.timedOut && result.code === 0, result.aborted ? '操作已取消' : result.timedOut ? '安装超时' : 'Agent 安装失败');
        const modules = path.join(staging,'prefix', platform === 'win32' ? 'node_modules' : 'lib/node_modules');
        requireValue(read(path.join(modules,entry.package,'package.json')).version === release.version, '安装版本不一致');
        fs.mkdirSync(path.dirname(directory), { recursive:true });
        if (fs.existsSync(directory)) fs.rmSync(directory, {recursive:true,force:true});
        fs.renameSync(path.join(staging,'prefix'), directory);
      }
      const command = path.join(directory, platform === 'win32' ? entry.command + '.cmd' : 'bin/' + entry.command);
      const check = await run(command,['--version'],{env:runtimeEnv,signal,timeoutMs:15000});
      requireValue(!check.aborted && check.code === 0, 'Agent 安装验证失败');
      requireValue(new RegExp('(^|[^0-9])'+release.version.replaceAll('.','\\.')+'([^0-9]|$)').test(check.tail), 'Agent 安装版本验证失败');
      atomicJson(path.join(directory,'verified.json'), { version:release.version, integrity:release.integrity });
      await beforeCommit(); requireValue(!signal?.aborted,'操作已取消');
      // Recheck the user's original installation immediately before switching.
      const latest = (await scan()).agents.find(a => a.id === entry.id);
      requireValue(latest.fingerprint === op.expectedFingerprint, 'Agent 安装状态已变化，请刷新');
      const state = managedState(home, platform), previous = state[entry.id] ? {...state[entry.id],previous:undefined} : null;
      atomicJson(path.join(root,'current.json'), { ...state, [entry.id]: { command, runtime:runtime.node, version:release.version, operationId:op.id, previous } });
      return { version:agentVersion(check.tail) };
    } finally { fs.rmSync(staging,{recursive:true,force:true}); }
  }
  return { scan, install, root };
}
