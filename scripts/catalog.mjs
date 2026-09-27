import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserData } from './browser-data.mjs';
import libraryTime from '../assets/library-time.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = {
  video: ['videos', '视频'], article: ['articles', '文章'],
  webpage: ['webpages', '网页'], document: ['documents', '文档'],
  repository: ['repositories', '代码项目'], audio: ['audio', '音频'],
  image: ['images', '图片'], note: ['notes', '专题笔记'], other: ['other', '其他'],
};
const statusNames = { archived: '已归档', partial: '待补齐', pending: '待处理' };
const verificationNames = ['source_only', 'cross_checked', 'legacy_not_reverified'];
const fail = (message) => { throw new Error(message); };
const cell = (text) => String(text ?? '未记录').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
const label = (text) => cell(text).replace(/[\[\]]/g, '\\$&');
const link = (title, target) => `[${label(title)}](<${target}>)`;
const isWithin = (parent, target) => {
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function loadEntries() {
  const entries = [];
  const ids = new Set();
  for (const [type, [folder]] of Object.entries(types)) {
    const parent = path.join(root, folder);
    if (!fs.existsSync(parent)) continue;
    for (const child of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const directory = `${folder}/${child.name}`;
      const entryRoot = path.join(root, directory);
      const metaPath = path.join(entryRoot, 'source.json');
      if (!fs.existsSync(metaPath)) fail(`${directory}: missing source.json`);
      const meta = readJson(metaPath);
      if (meta.schema_version !== 1 || meta.type !== type) fail(`${directory}: invalid schema or type`);
      for (const field of ['id', 'title', 'summary', 'coverage_note']) {
        if (typeof meta[field] !== 'string' || !meta[field].trim()) fail(`${directory}: missing ${field}`);
      }
      if (ids.has(meta.id)) fail(`Duplicate id: ${meta.id}`);
      ids.add(meta.id);
      if (!Object.hasOwn(statusNames, meta.status)) fail(`${directory}: invalid status`);
      if (!verificationNames.includes(meta.verification_status)) fail(`${directory}: invalid verification_status`);
      if (!['general', 'scenario'].includes(meta.mode)) fail(`${directory}: invalid mode`);
      if (meta.scenario !== null && (typeof meta.scenario !== 'string' || !meta.scenario.trim())) fail(`${directory}: invalid scenario`);
      if (meta.mode === 'scenario' && !meta.scenario) fail(`${directory}: scenario mode needs scenario text`);
      for (const field of ['tags', 'aliases', 'related']) {
        if (!Array.isArray(meta[field]) || meta[field].some(x => typeof x !== 'string' || !x.trim())) fail(`${directory}: invalid ${field}`);
      }
      for (const field of ['published_at', 'collected_at', 'organized_at', 'verified_at']) {
        const value = meta[field];
        if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || Number.isNaN(Date.parse(value)))) fail(`${directory}: invalid ${field}`);
      }
      if (!libraryTime.isValid(meta.collected_at)) fail(`${directory}: collected_at must include seconds and a timezone (legacy YYYY-MM-DD or null also accepted)`);
      for (const url of [meta.source_url, meta.canonical_url, ...meta.aliases]) {
        if (url === null) continue;
        if (typeof url !== 'string' || !['https:', 'http:'].includes(new URL(url).protocol)) fail(`${directory}: invalid source URL`);
      }
      if (!Array.isArray(meta.files)) fail(`${directory}: files must be an array`);
      for (const file of meta.files) {
        if (typeof file.path !== 'string' || !file.path || typeof file.role !== 'string' || !file.role) fail(`${directory}: invalid file record`);
        const absolute = path.resolve(entryRoot, file.path);
        if (path.isAbsolute(file.path) || !isWithin(entryRoot, absolute)) fail(`${directory}: path outside entry: ${file.path}`);
        if (!fs.existsSync(absolute)) fail(`${directory}: missing file: ${file.path}`);
        if (!isWithin(fs.realpathSync(entryRoot), fs.realpathSync(absolute))) fail(`${directory}: file resolves outside entry: ${file.path}`);
      }
      if (meta.status === 'archived' && !meta.files.some(f => ['summary', 'analysis'].includes(f.role))) fail(`${directory}: archived entry needs a report`);
      entries.push({ ...meta, directory });
    }
  }
  for (const entry of entries) {
    for (const id of entry.related) {
      if (!ids.has(id)) fail(`${entry.directory}: unknown related id ${id}`);
    }
  }
  return entries.sort(libraryTime.compare);
}

function reportLink(entry) {
  const report = entry.files.find(file => ['summary', 'analysis'].includes(file.role));
  return link(entry.title, `${entry.directory}/${report?.path ?? 'source.json'}`);
}

function renderIndex(entries) {
  const tags = [...new Set(entries.flatMap(e => e.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const counts = Object.entries(types).map(([type, [, title]]) => {
    const count = entries.filter(entry => entry.type === type).length;
    return count ? `${count} 条${title}` : null;
  }).filter(Boolean);
  const lines = [
    '# 资料总索引', '',
    '> 根据各条目的 source.json 自动生成。更新命令：node scripts/catalog.mjs build', '',
    `[资料库说明](README.md) | [收集约定](AGENTS.md) | [机器可读目录](catalog.json)`, '',
    `共 **${entries.length}** 条资料：${counts.join('、')}。`, '',
    '完整度表示本地材料是否齐备，不代表内容已经独立验证。历史导入条目的结论未在整理时重新核验。采集时间按北京时间显示并倒序排列；只有日期的历史资料在同一天的精确时间之后，时间完全未知的排在最后。', '',
    '## 类型导航', '',
    Object.entries(types).filter(([type]) => entries.some(e => e.type === type)).map(([type, [, title]]) => `[${title}](#type-${type})`).join(' | '), '',
    '## 主题导航', '',
    tags.map((tag, i) => `[${label(tag)} (${entries.filter(e => e.tags.includes(tag)).length})](#tag-${i + 1})`).join(' | '), '',
    '## 待补齐清单', '',
  ];
  const incomplete = entries.filter(e => e.status !== 'archived');
  if (!incomplete.length) lines.push('暂无。', '');
  for (const entry of incomplete) lines.push(`- ${reportLink(entry)}：${cell(entry.coverage_note)}`);
  lines.push('');
  for (const [type, [, title]] of Object.entries(types)) {
    const group = entries.filter(e => e.type === type);
    if (!group.length) continue;
    lines.push(`<a id="type-${type}"></a>`, '', `## ${title}`, '',
      '| 资料 | 采集时间（北京时间） | 标签 | 完整度 | 摘要 |', '| --- | --- | --- | --- | --- |');
    for (const entry of group) {
      lines.push(`| ${reportLink(entry)} | ${cell(libraryTime.format(entry.collected_at))} | ${cell(entry.tags.join('、'))} | ${statusNames[entry.status]} | ${cell(entry.summary)} |`);
    }
    lines.push('');
  }
  lines.push('## 按主题浏览', '');
  tags.forEach((tag, i) => {
    lines.push(`<a id="tag-${i + 1}"></a>`, '', `### ${tag}`, '');
    for (const entry of entries.filter(e => e.tags.includes(tag))) lines.push(`- ${reportLink(entry)}`);
    lines.push('');
  });
  lines.push('## 来源与归档范围', '', '| 资料 | 来源 | 本地内容与核验说明 |', '| --- | --- | --- |');
  for (const entry of entries) {
    const url = entry.canonical_url ?? entry.source_url;
    lines.push(`| ${reportLink(entry)} | ${url ? link(entry.platform ?? '原始来源', url) : '本地整理'} | ${cell(entry.coverage_note)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const [command = 'check', ...args] = process.argv.slice(2);
  if (command === 'now') { console.log(libraryTime.now()); return; }
  if (!['build', 'check', 'search'].includes(command)) fail('Usage: node scripts/catalog.mjs build|check|now|search <query>');
  const entries = loadEntries();
  if (command === 'search') {
    const query = args.join(' ').trim().toLocaleLowerCase();
    if (!query) fail('Usage: node scripts/catalog.mjs search <query>');
    const matches = entries.filter(entry => [entry.id, entry.title, entry.summary, entry.scenario, entry.directory, entry.source_url, entry.canonical_url, ...entry.aliases, ...entry.tags].join(' ').toLocaleLowerCase().includes(query));
    for (const entry of matches) console.log(`${entry.title}\n  ${entry.directory}\n  ${statusNames[entry.status]} | ${entry.summary}\n`);
    console.log(`${matches.length} match(es).`);
    return;
  }
  const outputs = {
    'catalog.json': `${JSON.stringify({ schema_version: 1, entries }, null, 2)}\n`,
    'INDEX.md': renderIndex(entries),
    'assets/library-data.js': browserData(root, entries),
  };
  if (command === 'build') {
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    for (const [name, content] of Object.entries(outputs)) fs.writeFileSync(path.join(root, name), content, 'utf8');
    console.log(`Built catalog.json, INDEX.md and browser data from ${entries.length} entries.`);
  } else {
    for (const [name, content] of Object.entries(outputs)) {
      const file = path.join(root, name);
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) fail(`${name} is missing or stale; run build.`);
    }
    console.log(`OK: ${entries.length} entries; IDs, local files, relationships and generated indexes are valid.`);
  }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
