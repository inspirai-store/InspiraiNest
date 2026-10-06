import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { hash, safePath, contained, requireValue } from './common.mjs';

export const SKILL_AGENTS = ['codex', 'codebuddy', 'claude'];
export const MAX_SKILL_BYTES = 16 * 1024 * 1024;
const excluded = /(?:^|\/)(?:\.git|\.ssh|\.aws|\.netrc|\.npmrc|\.pypirc|\.lingnest-package\.json|auth\.json|session\.json|node_modules|\.venv|venv|__pycache__|\.cache|\.DS_Store|\.env(?:\..*)?|tokens?(?:\.[^/]*)?|[^/]*(?:cookies?|credentials?|passwords?|private[-_]?keys?|secrets?|auth[-_]?state|browser[-_]?profiles?|session[-_]?(?:cache|store|state))[^/]*)(?:\/|$)/i;
const extensions = new Set(['.md','.markdown','.txt','.json','.yaml','.yml','.toml','.ini','.cfg','.lock','.py','.js','.mjs','.cjs','.sh','.bash','.ps1','.html','.css','.csv','.ts','.tsx','.svg','.png','.jpg','.jpeg','.webp','.gif','.pdf','.xml','.sql','.r','.license']);
const sensitive = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})\b|(?:access[_-]?key[_-]?secret|app[_-]?specific[_-]?password|password|client[_-]?secret|api[_-]?key|(?:(?:access|refresh|auth|id|session)[_-]?)?token)["']?\s*[=:]\s*["'](?!\$|\{|<|YOUR_|REPLACE_|example|placeholder)[^"'\n]+["']/i;

export function skillMetadata(markdown) {
  const match = markdown.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  requireValue(match, 'Skill 缺少 YAML 元信息');
  let value;
  try { value = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }); } catch { throw new Error('Skill 的 YAML 元信息无法解析'); }
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Skill 元信息无效');
  return value;
}

export function cleanRequirements(value = {}) {
  requireValue(value && typeof value==='object' && !Array.isArray(value),'依赖声明无效');
  const result = {};
  for (const key of ['commands', 'env', 'mcp', 'pythonModules']) {
    const items = value[key] || [];
    requireValue(Array.isArray(items) && items.length <= 30 && items.every(x => typeof x === 'string' && /^[\w.-]{1,100}$/.test(x)), '依赖名称无效');
    result[key] = [...new Set(items)];
  }
  requireValue(value.browser === undefined || typeof value.browser === 'boolean', '浏览器依赖无效');
  result.browser = Boolean(value.browser);
  return result;
}

export function cleanSkillPolicy(value = {}) {
  requireValue(value && typeof value==='object' && !Array.isArray(value),'Skill 策略无效');
  const capabilities = value.capabilities || [];
  requireValue(Array.isArray(capabilities) && capabilities.length <= 30 && capabilities.every(x => typeof x === 'string' && /^[a-z][a-z0-9.-]{1,99}$/.test(x)), '能力标签无效');
  const agents = value.agents || SKILL_AGENTS;
  const systems = value.systems || ['darwin', 'win32', 'linux'];
  requireValue(Array.isArray(agents) && agents.length > 0 && agents.every(x => SKILL_AGENTS.includes(x)), 'Skill 的 Agent 范围无效');
  requireValue(Array.isArray(systems) && systems.length > 0 && systems.every(x => ['darwin','win32','linux'].includes(x)), 'Skill 的系统范围无效');
  return { capabilities: [...new Set(capabilities)], agents: [...new Set(agents)], systems: [...new Set(systems)], requirements: cleanRequirements(value.requirements) };
}

export function skillDigest(files) {
  return hash(JSON.stringify(files.map(f => [f.path, f.sha256, f.bytes, Boolean(f.executable)]).sort((a,b) => a[0].localeCompare(b[0], 'en'))));
}

function checkReferences(files) {
  const names = new Set(files.map(f => f.path));
  for (const file of files.filter(f => /\.md$/i.test(f.path))) {
    const content = Buffer.from(file.body, 'base64').toString('utf8');
    const refs = [...content.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)|(?:^|\s)@([^\s`]+)|\b((?:scripts|references|assets|templates)\/[^\s`"'\]\)<>]+\.[\w]+)(?=[\s`"'\]\)<>]|$)/g)];
    for (const ref of refs) {
      let raw = ref[1] || ref[2] || ref[3];
      if (/^(?:https?:|mailto:|#|\$\{)/.test(raw)) continue;
      raw = raw.split('#')[0];
      requireValue(!/^(?:\/|[A-Za-z]:|~\/)/.test(raw), 'Skill 引用了本机绝对路径，需适配后再发布');
      if (!raw || !/\.[a-z0-9]+$/i.test(raw)) continue;
      const target = path.posix.normalize(path.posix.join(ref[3] ? '' : path.posix.dirname(file.path), raw));
      safePath(target);
      requireValue(names.has(target), `Skill 引用文件缺失：${target}`);
    }
  }
  for(const file of files.filter(f=>/\.(?:[cm]?js|tsx?)$/i.test(f.path))){
    const content=Buffer.from(file.body,'base64').toString('utf8');
    for(const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.[^"']+)["']/g)){
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(file.path),match[1]));safePath(target);
      requireValue(names.has(target) || ['.js','.mjs','.cjs','.ts','.json','/index.js'].some(suffix=>names.has(target+suffix)),`Skill 引用文件缺失：${target}`);
    }
  }
}

export function validateSkillPackage(bundle) {
  requireValue(bundle?.schemaVersion === 1 && /^[a-z0-9][a-z0-9-]{0,63}$/.test(bundle.name || ''), 'Skill 包名称无效');
  requireValue(Array.isArray(bundle.files) && bundle.files.length > 0 && bundle.files.length <= 1000, 'Skill 文件数量无效');
  const names = new Set(); let total = 0;
  for (const file of bundle.files) {
    safePath(file.path);
    requireValue(!excluded.test(file.path) && !names.has(file.path.toLowerCase()), 'Skill 包含凭据路径或重复文件');
    requireValue(extensions.has(path.posix.extname(file.path).toLowerCase()) || /^(?:LICENSE|NOTICE|\.gitignore)$/i.test(file.path), `不支持的 Skill 文件：${file.path}`);
    names.add(file.path.toLowerCase());
    requireValue(typeof file.body === 'string', 'Skill 文件编码无效');
    const bytes = Buffer.from(file.body, 'base64');
    requireValue(bytes.toString('base64') === file.body && bytes.length === file.bytes && hash(bytes) === file.sha256, 'Skill 文件校验失败');
    requireValue(!sensitive.test(bytes.toString('utf8')), 'Skill 文件含有疑似凭据，不能发布');
    total += bytes.length;
    requireValue(total <= MAX_SKILL_BYTES, 'Skill 包超过 16 MiB');
  }
  const entry = bundle.files.find(f => f.path === 'SKILL.md');
  requireValue(entry, 'Skill 包缺少 SKILL.md');
  const metadata = skillMetadata(Buffer.from(entry.body, 'base64').toString('utf8'));
  requireValue((metadata.name || bundle.name) === bundle.name, 'Skill 名称与元信息不一致');
  requireValue(bundle.hash === skillDigest(bundle.files), 'Skill 包哈希不一致');
  checkReferences(bundle.files);
  return bundle;
}

export function packageSkill(directory, { validate = true } = {}) {
  const root = fs.realpathSync(directory), files = [], omitted = [];
  let executableManifest={};
  if(process.platform==='win32')try{executableManifest=JSON.parse(fs.readFileSync(path.join(root,'.lingnest-package.json'),'utf8'));}catch{}
  let total = 0;
  function walk(relative = '') {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const key = relative ? relative + '/' + name : name;
      if (excluded.test(key)) { omitted.push(key); continue; }
      safePath(key);
      const file = path.join(root, key), stat = fs.lstatSync(file);
      requireValue(!stat.isSymbolicLink() && contained(root, fs.realpathSync(file)), 'Skill 包内不能包含符号链接或越界文件');
      if (stat.isDirectory()) { walk(key); continue; }
      requireValue(stat.isFile(), 'Skill 包含非普通文件');
      total += stat.size;
      requireValue(total <= MAX_SKILL_BYTES && files.length < 1000, 'Skill 包过大');
      const body = fs.readFileSync(file);
      const sha256=hash(body), recorded=executableManifest[key];
      files.push({ path: key, bytes: body.length, sha256, executable: process.platform==='win32' && recorded?.sha256===sha256 ? recorded.executable===true : Boolean(stat.mode & 0o111), body: body.toString('base64') });
    }
  }
  walk();
  const entry = files.find(f => f.path === 'SKILL.md');
  requireValue(entry, '缺少 SKILL.md');
  const metadata = skillMetadata(Buffer.from(entry.body, 'base64').toString('utf8'));
  const bundle = { schemaVersion: 1, name: metadata.name || path.basename(root), description: String(metadata.description || '').slice(0, 1024),
    declaredVersion: String(metadata.metadata?.version || metadata.version || '').slice(0, 100), files, omitted, hash: skillDigest(files) };
  return validate ? validateSkillPackage(bundle) : bundle;
}

export function writeSkillPackage(bundle, destination) {
  validateSkillPackage(bundle);
  fs.mkdirSync(destination, { recursive: false });
  for (const file of bundle.files) {
    const target = path.join(destination, safePath(file.path));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.body, 'base64'), { flag: 'wx', mode: file.executable ? 0o700 : 0o600 });
  }
  // NTFS has no Unix execute bit. Keep its portable value without copying OS permissions.
  if(process.platform==='win32')fs.writeFileSync(path.join(destination,'.lingnest-package.json'),JSON.stringify(Object.fromEntries(bundle.files.map(f=>[f.path,{sha256:f.sha256,executable:Boolean(f.executable)}]))),{flag:'wx'});
}
