import fs from 'node:fs';
import path from 'node:path';
import { hash, readJson, safePath, contained, requireValue, text, types, sourceURL } from './common.mjs';

const extensions = new Set(['.md', '.markdown', '.txt', '.srt', '.vtt', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.pdf']);
const roles = new Set(['summary', 'analysis', 'source', 'original', 'source_excerpt', 'source_snapshot', 'transcript', 'transcript_raw', 'image', 'scenario', 'reference', 'document']);
const secretName = /(?:^|[\/_.-])(cookies?|credentials?|tokens?|secrets?|passwords?|\.env)(?:[\/_.-]|$)/i;
export const MAX_ARCHIVE = 40 * 1024 * 1024;
export function permitted(file) {
  return roles.has(file.role) && extensions.has(path.posix.extname(file.path).toLowerCase()) && !secretName.test(file.path);
}
export function validateArchive(bundle) {
  requireValue(bundle && bundle.version === 1 && Array.isArray(bundle.files), 'Invalid archive');
  const meta = bundle.meta;
  requireValue(meta && meta.schema_version === 1 && types.includes(meta.type), 'Invalid source metadata');
  for (const field of ['id', 'title', 'summary', 'coverage_note']) text(meta[field], field, field === 'id' ? 300 : 20000);
  requireValue(['archived', 'partial', 'pending'].includes(meta.status), 'Invalid archive status');
  requireValue(['source_only', 'cross_checked', 'legacy_not_reverified'].includes(meta.verification_status), 'Invalid verification status');
  requireValue(['general', 'scenario'].includes(meta.mode) && (meta.scenario === null || typeof meta.scenario === 'string'), 'Invalid scenario');
  for (const field of ['tags', 'aliases', 'related']) requireValue(Array.isArray(meta[field]) && meta[field].length <= 200 && meta[field].every(x => typeof x === 'string'), `Invalid ${field}`);
  for (const field of ['published_at', 'collected_at', 'organized_at', 'verified_at']) {
    const value = meta[field];
    requireValue(value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) && Number.isFinite(Date.parse(value))), `Invalid ${field}`);
  }
  for (const value of [meta.source_url, meta.canonical_url, ...meta.aliases]) {
    if (value === null) continue;
    requireValue(typeof value === 'string', 'Invalid source URL');
    sourceURL(value);
  }
  requireValue(bundle.files.length <= 1000 && Array.isArray(meta.files), 'Invalid files');
  let total = 0;
  const names = new Set();
  for (const file of bundle.files) {
    safePath(file.path);
    requireValue(permitted(file) && !names.has(file.path.toLowerCase()), 'Disallowed or duplicate attachment');
    names.add(file.path.toLowerCase());
    requireValue(typeof file.body === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(file.body), 'Invalid attachment encoding');
    const buffer = Buffer.from(file.body, 'base64');
    requireValue(buffer.toString('base64') === file.body && buffer.length === file.bytes && hash(buffer) === file.sha256, 'Attachment integrity mismatch');
    requireValue(buffer.length <= 16 * 1024 * 1024, 'Attachment exceeds 16 MiB');
    total += buffer.length;
  }
  requireValue(total <= MAX_ARCHIVE, 'Archive exceeds 40 MiB');
  requireValue(meta.files.length === bundle.files.length && meta.files.every(f => bundle.files.some(b => b.path === f.path && b.role === f.role)), 'Metadata files do not match uploaded files');
  requireValue(bundle.files.some(f => ['summary', 'analysis'].includes(f.role) && f.bytes > 0 && /\.(md|markdown|txt)$/i.test(f.path)), 'Missing readable report');
  return bundle;
}

export function packageEntry(entryRoot) {
  const root = fs.realpathSync(entryRoot);
  const meta = readJson(path.join(root, 'source.json'));
  const files = [];
  const seen = new Set();
  const omitted = [];
  function collect(relative, role) {
    safePath(relative);
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    requireValue(!stat.isSymbolicLink() && contained(root, fs.realpathSync(file)), 'Links outside archive are not allowed');
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) collect(`${relative}/${name}`, role);
      return;
    }
    if (!permitted({ path: relative, role })) { omitted.push(relative); return; }
    if (seen.has(relative)) return;
    seen.add(relative);
    requireValue(stat.size <= 16 * 1024 * 1024, `Attachment too large: ${relative}`);
    const body = fs.readFileSync(file);
    files.push({ path: relative, role, bytes: body.length, sha256: hash(body), body: body.toString('base64') });
  }
  requireValue(Array.isArray(meta.files), 'Missing files');
  for (const file of meta.files) collect(file.path, file.role);
  // Only known metadata fields leave the machine; provider settings and local paths never do.
  const keys = ['schema_version', 'id', 'title', 'type', 'platform', 'source_url', 'canonical_url', 'aliases', 'creator', 'published_at', 'collected_at', 'organized_at', 'mode', 'scenario', 'tags', 'summary', 'status', 'verification_status', 'verified_at', 'coverage_note', 'related'];
  const clean = Object.fromEntries(keys.map(key => [key, meta[key]]));
  clean.files = files.map(({ path, role }) => ({ path, role }));
  return validateArchive({ version: 1, meta: clean, files, omitted });
}

export function unpackArchive(bundle, destination) {
  validateArchive(bundle);
  // Never overwrite an existing local entry. Downloads are immutable snapshots.
  fs.mkdirSync(destination, { recursive: false });
  fs.writeFileSync(path.join(destination, 'source.json'), JSON.stringify(bundle.meta, null, 2));
  for (const file of bundle.files) {
    const target = path.join(destination, safePath(file.path));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.body, 'base64'), { flag: 'wx' });
  }
}
