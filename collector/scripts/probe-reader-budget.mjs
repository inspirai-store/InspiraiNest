// Synthetic resource probe. Run with an external 1 CPU / 768 MiB container limit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createService } from '../src/server.mjs';
import { hash, secret } from '../src/common.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingnest-budget-'));
const app = createService({ dataDir: root, masterKey: secret() });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const token = secret();
await app.store.put('device', { id: 'budget-reader', name: 'Synthetic resource probe', role: 'reader', scope: 'library:read', tokenHash: hash(token), createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() });
try {
  const started = performance.now();
  let bytesTotal = 0;
  for (let i = 0; i < 64; i++) {
    const body = `# 合成负载资料 ${i}\n索引验收唯一词 nebula-${i}\n` + '这是一行用于索引资源验收的合成文字。\n'.repeat(8192);
    const bytes = Buffer.from(body); bytesTotal += bytes.length;
    const meta = { schema_version: 1, id: `note:budget-${i}`, title: `合成负载资料 ${i}`, type: 'note', platform: 'fixture', source_url: 'https://example.com/synthetic', canonical_url: 'https://example.com/synthetic', aliases: [], creator: 'fixture', published_at: null, collected_at: '2026-09-26T12:00:00+08:00', organized_at: '2026-09-26', mode: 'general', scenario: null, tags: ['合成负载'], summary: '合成的全文检索资源测试。', status: 'archived', verification_status: 'source_only', verified_at: null, coverage_note: '合成验收，无真实用户资料。', files: [{ path: 'summary.md', role: 'summary' }], related: [] };
    const bundle = { version: 1, meta, files: [{ path: 'summary.md', role: 'summary', bytes: bytes.length, sha256: hash(bytes), body: bytes.toString('base64') }], omitted: [] };
    const data = Buffer.from(JSON.stringify(bundle)), digest = hash(data);
    fs.mkdirSync(path.join(root, 'objects/archives'), { recursive: true });
    fs.writeFileSync(path.join(root, 'objects/archives', digest + '.json'), data);
    await app.store.put('archive', { id: digest, entryId: meta.id, meta, key: `archives/${digest}.json`, createdAt: new Date().toISOString() });
  }
  async function search(q) {
    const start = performance.now();
    const response = await fetch(base + '/api/read/v1/search?q=' + encodeURIComponent(q), { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    return { result: await response.json(), ms: performance.now() - start };
  }
  let state;
  do {
    state = await search('nebula-63');
    assert.equal(state.result.index.failed, 0);
    assert.ok(performance.now() - started < 120000, 'Cold indexing exceeded 120 seconds');
    if (!state.result.index.complete) await new Promise(resolve => setTimeout(resolve, 50));
  } while (!state.result.index.complete);
  assert.equal(state.result.items.length, 1);
  const coldMs = performance.now() - started;
  const queries = [];
  for (let i = 0; i < 10; i++) {
    const found = await search(`nebula-${54 + i}`);
    assert.equal(found.result.items[0].id, `note:budget-${54 + i}`);
    queries.push(found.ms);
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), synthetic: true, entries: 64, textBytes: bytesTotal,
    coldMs: Math.round(coldMs), maxQueryMs: Math.round(Math.max(...queries)), meanQueryMs: Math.round(queries.reduce((a,b) => a+b,0) / queries.length),
    maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), limits: 'Set externally; standalone execution does not enforce CPU or memory limits' }, null, 2));
} finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
