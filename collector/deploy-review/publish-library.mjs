import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageEntry } from '../src/archive.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const origin = 'https://review-library.inspirai.store';
const entries = [
  'articles/reading-notes',
  'notes/city-walk',
  'documents/weekend-walk',
];
const previousTitles = new Map([
  ['review-demo:article', '演示文章：把网页整理成可检索笔记'],
  ['review-demo:note', '演示笔记：如何使用手机分享'],
  ['review-demo:document', '演示文档：旅行清单'],
]);
const priorLinkTest = 'mobile-share:2e689d32-ee27-4dd6-a3f6-3f4ee49bc692';

const bundles = entries.map(entry => packageEntry(path.join(here, 'library', entry)));
for (const bundle of bundles) {
  if (/演示|示例|占位|placeholder/i.test([bundle.meta.title, bundle.meta.platform, bundle.meta.summary, ...bundle.meta.tags].join(' '))) {
    throw new Error(`User-visible sample metadata is not final: ${bundle.meta.id}`);
  }
  if (bundle.files.some(file => file.bytes === 0)) throw new Error(`Empty content: ${bundle.meta.id}`);
}

if (!process.argv.includes('--publish')) {
  for (const bundle of bundles) console.log(`${bundle.meta.type}: ${bundle.meta.title} (${bundle.files.length} files)`);
  process.exit(0);
}

const encodedKey = fs.readFileSync(0, 'utf8').trim();
const key = Buffer.from(encodedKey, 'base64').toString('utf8').trim();
if (key.length < 32 || Buffer.from(key).toString('base64') !== encodedKey) throw new Error('Missing or invalid review key on stdin');

async function request(route, method, token, body) {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${route}: ${response.status} ${result.error || 'request failed'}`);
  return result;
}

let token;
let ownerId;
try {
  const paired = await request('/api/pair', 'POST', null, { key, name: '审核资料维护' });
  token = paired.token;
  ownerId = paired.device.id;
  const state = await request('/api/state', 'GET', token);
  const latest = new Map();
  for (const archive of state.archives) {
    const prior = latest.get(archive.entryId);
    if (!prior || prior.createdAt < archive.createdAt) latest.set(archive.entryId, archive);
  }
  const extra = latest.get(priorLinkTest);
  if (extra && (extra.meta.title !== 'Example Domain' || extra.meta.status !== 'partial')) {
    throw new Error('Unexpected content in the previous link test');
  }
  if (latest.size !== bundles.length + (extra ? 1 : 0) || bundles.some(bundle => {
    const prior = latest.get(bundle.meta.id);
    return !prior || ![previousTitles.get(bundle.meta.id), bundle.meta.title].includes(prior.meta.title);
  })) throw new Error('Review library differs from the expected isolated three-entry dataset');
  for (const bundle of bundles) {
    await request('/api/archives', 'POST', token, bundle);
    console.log(`Published ${bundle.meta.title}`);
  }
  if (extra) {
    await request(`/api/archives/${extra.id}`, 'DELETE', token);
    console.log('Hid the earlier Example Domain link test from the review library.');
  }
  const updated = await request('/api/state', 'GET', token);
  const current = new Map();
  for (const archive of updated.archives) {
    const prior = current.get(archive.entryId);
    if (!prior || prior.createdAt < archive.createdAt) current.set(archive.entryId, archive);
  }
  if (current.size !== bundles.length || bundles.some(bundle => current.get(bundle.meta.id)?.meta.title !== bundle.meta.title)) {
    throw new Error('New review content was not visible after publishing');
  }
  console.log('Review library contains three complete, non-private entries. Earlier snapshots remain stored.');
} finally {
  if (token && ownerId) {
    await request(`/api/devices/${ownerId}/revoke`, 'POST', token, {}).catch(() => {
      console.error('Maintenance authorization could not be revoked; revoke it from the review server.');
    });
  }
}
