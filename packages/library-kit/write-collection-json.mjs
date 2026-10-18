import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pass Base64 JSON as an ASCII argument, avoiding Windows PowerShell 5.1's
// lossy native stdin pipeline. This file also runs in isolated task workspaces.
export function writeCollectionJson(relative, encoded, root = process.cwd()) {
  if (typeof relative !== 'string' || /[\\:\x00-\x1f]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid collection JSON path');
  const name = path.posix.basename(relative);
  if (!['source.json', 'collector-events.jsonl', 'collector-result.json'].includes(name) || (name !== 'source.json' && relative !== name)) throw new Error('Only collection metadata, progress and result files are supported');
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Expected Base64 JSON');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error('Invalid Base64 JSON');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  const readable = (text, field, questionRun = 3) => {
    if (typeof text !== 'string' || !text.trim() || text.includes('\uFFFD') || new RegExp(`\\?{${questionRun},}`).test(text)) throw new Error(`Unreadable ${field}; use UTF-8 JSON`);
  };
  if (name === 'source.json') {
    for (const field of ['title', 'summary', 'coverage_note']) readable(value[field], field);
    if (!Array.isArray(value.tags)) throw new Error('Invalid tags');
    for (const tag of value.tags) readable(tag, 'tags', 2);
  } else if (name === 'collector-events.jsonl') {
    if (!['fetching', 'transcribing', 'analyzing', 'archiving'].includes(value.stage) || !['info', 'warn'].includes(value.level || 'info')) throw new Error('Invalid collection stage');
    readable(value.message, 'message');
  } else {
    if (!['ready', 'waiting_action'].includes(value.status)) throw new Error('Invalid result status');
    if (value.status === 'waiting_action') readable(value.message, 'message');
  }
  const base = fs.realpathSync(root), target = path.resolve(base, relative);
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const existing = path.relative(base, fs.realpathSync(ancestor));
  if (existing.startsWith('..' + path.sep) || existing === '..' || path.isAbsolute(existing)) throw new Error('Collection JSON must stay in the task workspace');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const parent = fs.realpathSync(path.dirname(target)), resolved = path.relative(base, parent);
  if (resolved.startsWith('..' + path.sep) || resolved === '..' || path.isAbsolute(resolved) || (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())) throw new Error('Collection JSON must stay in the task workspace');
  const content = JSON.stringify(value, null, name === 'collector-events.jsonl' ? undefined : 2) + '\n';
  if (name === 'collector-events.jsonl') fs.appendFileSync(target, content, { encoding: 'utf8', mode: 0o600 });
  else {
    const temporary = `${target}.${process.pid}.tmp`;
    try { fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temporary, target); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return { file: relative, mode: name === 'collector-events.jsonl' ? 'append' : 'replace', encoding: 'utf8' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(writeCollectionJson(process.argv[2], process.argv[3]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
