import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const types = ['article', 'webpage', 'video', 'document', 'repository', 'audio', 'image', 'note', 'other'];
export const folders = { article: 'articles', webpage: 'webpages', video: 'videos', document: 'documents', repository: 'repositories', audio: 'audio', image: 'images', note: 'notes', other: 'other' };
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const secret = () => crypto.randomBytes(32).toString('base64url');
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function requireValue(condition, message, status = 400) { if (!condition) fail(message, status); }
export function text(value, name, max = 1000) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Invalid ${name}`);
  return value.trim();
}
export function safePath(value) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\\:\x00-\x1f]/.test(value), 'Invalid file path');
  requireValue(value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Unsafe file path');
  return value;
}
export function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${id()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
}
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function canonicalJson(value) {
  const sort = input => Array.isArray(input) ? input.map(sort) : input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).sort().filter(key=>input[key]!==undefined).map(key=>[key,sort(input[key])])) : input;
  return JSON.stringify(sort(value));
}
export function sourceURL(value) {
  let url;
  try { url = new URL(value); } catch { fail('Invalid source URL'); }
  requireValue(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'Invalid source URL');
  return url;
}
export function remoteURL(value) {
  const url = new URL(value);
  requireValue(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)), 'Use HTTPS outside localhost');
  requireValue(!url.username && !url.password && !url.search && !url.hash, 'Invalid server URL');
  return url.href.replace(/\/$/, '');
}
