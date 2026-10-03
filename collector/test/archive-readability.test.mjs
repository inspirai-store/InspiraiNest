import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requireReadableMetadata } from '../src/archive.mjs';
import { createService } from '../src/server.mjs';
import { api } from '../src/worker.mjs';
import { hash, secret } from '../src/common.mjs';

const metadata = () => ({
  schema_version: 1, id: 'article:readability', title: 'Readable archive', type: 'article',
  platform: 'fixture', source_url: 'https://example.com/readability', canonical_url: null,
  aliases: [], creator: null, published_at: null, collected_at: '2026-10-03T10:00:00+08:00',
  organized_at: '2026-10-03', mode: 'general', scenario: null, tags: ['fixture'],
  summary: 'A readable summary?', status: 'archived', verification_status: 'source_only',
  verified_at: null, coverage_note: 'Synthetic report', related: [],
  files: [{ path: 'summary.md', role: 'summary' }],
});

test('readable metadata allows ordinary questions but rejects corrupted text and tags', () => {
  assert.doesNotThrow(() => requireReadableMetadata(metadata()));
  for (const field of ['title', 'summary', 'coverage_note']) {
    for (const damaged of ['broken???', 'broken\uFFFD']) {
      assert.throws(() => requireReadableMetadata({ ...metadata(), [field]: damaged }), new RegExp(`Unreadable ${field}`));
    }
  }
  assert.throws(() => requireReadableMetadata({ ...metadata(), tags: ['??'] }), /Unreadable tags/);
});

test('upload rejects corrupted metadata before storing an archive and still accepts valid content', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-readability-'));
  const key = secret();
  const app = createService({ dataDir: root, masterKey: key });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const server = `http://127.0.0.1:${app.server.address().port}`;
  const owner = { server, ...await api({ server }, '/api/pair', 'POST', { key, name: 'readability-fixture' }) };
  const bytes = Buffer.from('# Readable report\n');
  const bundle = {
    version: 1, meta: metadata(),
    files: [{ path: 'summary.md', role: 'summary', bytes: bytes.length, sha256: hash(bytes), body: bytes.toString('base64') }],
  };
  await assert.rejects(api(owner, '/api/archives', 'POST', { ...bundle, meta: { ...bundle.meta, summary: 'broken????' } }), /Unreadable summary/);
  assert.equal((await app.store.list('archive')).length, 0);
  await api(owner, '/api/archives', 'POST', bundle);
  assert.equal((await app.store.list('archive')).length, 1);
});
