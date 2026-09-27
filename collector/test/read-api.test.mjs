import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReadApi } from '../src/read-api.mjs';
import { hash, requireValue } from '../src/common.mjs';

function archive(id, { title = id, summary = '', tags = [], text = 'first\nsecond\nthird', createdAt = '2026-09-26T00:00:00Z', collected = '2026-09-25T12:00:00+08:00', files, ...overrides } = {}) {
  const contents = files || [{ path: 'summary.md', role: 'summary', text }];
  const record = { entryId: id, id: hash(JSON.stringify({ id, title, text, createdAt, contents })), createdAt,
    meta: { schema_version: 1, id, title, summary, tags, type: 'article', status: 'archived', collected_at: collected,
      source_url: 'https://example.com/source', files: contents.map(({ path, role }) => ({ path, role })), ...overrides } };
  record.contents = contents;
  return record;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t, records, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-api-'));
  let revoked = false, active = 0, maxActive = 0, prepareCount = 0, fileCount = 0;
  const trash = [], hooks = {};
  const store = { async list(kind) { if (hooks.list) await hooks.list(kind); return kind === 'archive' ? [...records] : [...trash]; } };
  const browser = {
    async prepare(a) {
      active++; maxActive = Math.max(maxActive, active); prepareCount++;
      try {
        if (hooks.prepare) await hooks.prepare(a);
        if (options.prepare) await options.prepare(a);
        return { entry: { ...a.meta, omitted: ['video.mp4'], files: a.contents.map(f => ({ path: `files/${a.id}/${f.path}`, role: f.role, bytes: Buffer.byteLength(f.text), ...(options.legacy ? {} : { sha256: hash(f.text) }) })) },
          documents: Object.fromEntries(a.contents.filter(f => /\.(md|txt)$/.test(f.path)).map(f => [`files/${a.id}/${f.path}`, f.text])) };
      } finally { active--; }
    },
    async file(a, relative) { fileCount++; if (hooks.file) await hooks.file(a, relative); return Buffer.from(a.contents.find(f => f.path === relative).text); },
  };
  const args = { dataDir, store, browser, publicUrl: options.publicUrl,
    authenticate: async () => { if (hooks.auth) await hooks.auth(); requireValue(!revoked, 'Authorization required', 401); return { id: 'reader', role: 'reader' }; },
    send: (res, status, value) => { res.status = status; res.body = value; res.sent = true; } };
  let api = createReadApi(args);
  t.after(async () => { await api.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  async function call(route, params = {}, request = {}) {
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, writeHead(status) { this.status = status; }, end(body) { this.body = body; this.sent = true; } };
    const url = new URL(`/api/read/v1/${route}`, 'http://localhost');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const req = { method: 'GET', headers: { host: 'localhost:8080' }, socket: {}, ...request };
    const handled = await api.handle(req, res, url, { id: 'reader', role: 'reader' });
    return { ...res, handled };
  }
  return { records, trash, hooks, call, dataDir, get api() { return api; }, revoke() { revoked = true; },
    get stats() { return { maxActive, prepareCount, fileCount }; },
    async reopen() { await api.close(); api = createReadApi(args); await api.refresh(); } };
}

test('latest visible version, top-level metadata, checksums, filtering and stable paging', async t => {
  const old = archive('same', { createdAt: '2026-01-01T00:00:00Z', title: 'old' });
  const current = archive('same', { title: 'new', tags: ['AI'] });
  const gone = archive('deleted');
  const f = await fixture(t, [current, gone, old, archive('z'), archive('a')], { legacy: true, publicUrl: 'https://library.test/' });
  f.trash.push({ id: 'deleted', deletedAt: '2026-09-26' });
  await f.api.refresh();
  const response = await f.call('entries', { limit: 2 });
  assert.equal(response.body.total, 3);
  assert.deepEqual(response.body.items.map(item => item.id), ['a', 'same']);
  assert.deepEqual(response.body.index, { complete: true, pending: 0, failed: 0 });
  const entry = (await f.call('entry', { id: 'same' })).body;
  assert.equal(entry.title, 'new'); assert.equal(entry.archive_id, current.id);
  assert.equal(entry.reader_url, 'https://library.test/?entry=same');
  assert.deepEqual(entry.files[0], { path: 'summary.md', role: 'summary', bytes: 18, sha256: hash('first\nsecond\nthird') });
  assert.deepEqual(entry.omitted, ['video.mp4']);
  assert.ok(f.stats.fileCount >= 3);
  const filtered = (await f.call('entries', { tag: 'AI', type: 'article', status: 'archived', from: '2026-09-25T04:00:00Z', to: '2026-09-25T04:00:00Z' })).body;
  assert.equal(filtered.total, 1);
  assert.equal((await f.call('entries', { offset: 99, limit: 999 })).body.limit, 100);
  await assert.rejects(f.call('entry', { id: 'deleted' }), { status: 404 });
});

test('NFKC AND substring search across fields, ranking and exact original lines', async t => {
  const f = await fixture(t, [
    archive('body', { text: 'start\r\nﬃ ＡＬＰＨＡ\r\nthird', summary: 'beta' }),
    archive('summary', { summary: 'alpha beta' }),
    archive('title', { title: 'ＡＬＰＨＡ', tags: ['beta'] }),
    archive('no', { title: 'alpha' }),
  ]);
  await f.api.refresh();
  const result = (await f.call('search', { q: 'Alpha beta' })).body;
  assert.equal(result.total, 3);
  assert.deepEqual(result.items.map(item => item.id), ['title', 'summary', 'body']);
  assert.deepEqual(result.items[2].matches, [{ file: 'summary.md', start_line: 2, end_line: 2, snippet: 'ﬃ ＡＬＰＨＡ' }]);
  const ligature = (await f.call('search', { q: 'ffi' })).body;
  assert.equal(ligature.total, 1); assert.equal(ligature.items[0].matches[0].start_line, 2);
  assert.equal((await f.call('search', { q: "%_' OR 1=1" })).body.total, 0);
});

test('date-only filters include the whole Beijing day, including UTC boundary instants', async t => {
  const f = await fixture(t, [
    archive('before', { collected: '2026-09-24T15:59:59.999Z' }),
    archive('start', { collected: '2026-09-24T16:00:00Z' }),
    archive('end', { collected: '2026-09-25T15:59:59.999Z' }),
    archive('after', { collected: '2026-09-25T16:00:00Z' }),
  ]); await f.api.refresh();
  const response = (await f.call('entries', { from: '2026-09-25', to: '2026-09-25' })).body;
  assert.deepEqual(response.items.map(item => item.id), ['end', 'start']);
});

test('snippet includes late matches after Unicode expansions, with original source text', async t => {
  const line = 'ﬃ😀'.repeat(1200) + ' NEEDLE ' + 'suffix'.repeat(100);
  const f = await fixture(t, [archive('late', { text: 'first\n' + line })]); await f.api.refresh();
  const match = (await f.call('search', { q: 'needle' })).body.items[0].matches[0];
  assert.equal(match.start_line, 2); assert.equal(match.end_line, 2);
  assert.ok(match.snippet.includes('NEEDLE')); assert.ok(line.includes(match.snippet));
  assert.ok(!/[\uD800-\uDBFF]$/.test(match.snippet)); assert.ok(!/^[\uDC00-\uDFFF]/.test(match.snippet));
});

test('title matches outrank arbitrarily many summary matches', async t => {
  const words = Array.from({ length: 20 }, (_, i) => `word${String(i).padStart(2, '0')}`);
  const f = await fixture(t, [archive('in-title', { title: words[0], text: words.slice(1).join(' ') }), archive('in-summary', { summary: words.join(' ') })]);
  await f.api.refresh();
  assert.deepEqual((await f.call('search', { q: words.join(' ') })).body.items.map(item => item.id), ['in-title', 'in-summary']);
});

test('content defaults to summary then analysis and preserves original line locations', async t => {
  const a = archive('document', { files: [
    { path: 'raw.txt', role: 'source', text: 'raw' },
    { path: 'analysis.md', role: 'analysis', text: 'analysis' },
    { path: 'nested/summary.md', role: 'summary', text: 'one\r\ntwo\rthree\nfour' },
    { path: 'picture.png', role: 'image', text: 'bytes' },
  ] });
  const f = await fixture(t, [a, archive('analysis', { files: [{ path: 'a.md', role: 'analysis', text: 'analysis' }] })]);
  await f.api.refresh();
  const value = (await f.call('content', { id: 'document', start_line: 2, max_lines: 2 })).body;
  assert.equal(value.file, 'nested/summary.md'); assert.equal(value.content, 'two\nthree');
  assert.equal(value.start_line, 2); assert.equal(value.end_line, 3); assert.equal(value.total_lines, 4);
  assert.equal(value.next_line, 4); assert.equal(value.next_column, 0); assert.equal(value.truncated, true);
  assert.equal((await f.call('content', { id: 'analysis' })).body.file, 'a.md');
  assert.equal((await f.call('content', { id: 'document', file: 'raw.txt' })).body.content, 'raw');
  await assert.rejects(f.call('content', { id: 'document', file: 'picture.png' }), { status: 415 });
  await assert.rejects(f.call('content', { id: 'document', start_column: 99 }), { status: 400 });
});

test('64 KiB content cap supports lossless UTF16 continuation within huge Unicode lines', async t => {
  const text = '中😀ﬃ'.repeat(22000);
  const f = await fixture(t, [archive('long', { text })]);
  await f.api.refresh();
  let column = 0, reconstructed = '', pages = 0;
  do {
    const value = (await f.call('content', { id: 'long', start_column: column })).body;
    assert.ok(Buffer.byteLength(value.content) <= 65536);
    assert.ok(!value.content.includes('\uFFFD'));
    assert.equal(value.end_line, 1);
    reconstructed += value.content; pages++;
    if (!value.truncated) { assert.equal(value.next_line, null); break; }
    assert.equal(value.next_line, 1); assert.ok(value.next_column > column);
    column = value.next_column;
  } while (pages < 10);
  assert.equal(reconstructed, text); assert.ok(pages > 1);
  await assert.rejects(f.call('content', { id: 'long', start_column: 2 }), { status: 400 });
});

test('line cap and continuation at byte boundary do not drop the next source line', async t => {
  const f = await fixture(t, [archive('lines', { text: Array.from({ length: 1100 }, (_, i) => String(i)).join('\n') }), archive('edge', { text: 'a'.repeat(65536) + '\n中' })]);
  await f.api.refresh();
  const capped = (await f.call('content', { id: 'lines', max_lines: 9000 })).body;
  assert.equal(capped.end_line, 1000); assert.equal(capped.next_line, 1001);
  const edge = (await f.call('content', { id: 'edge' })).body;
  assert.equal(edge.next_line, 2); assert.equal(edge.next_column, 0);
  assert.equal((await f.call('content', { id: 'edge', start_line: 2 })).body.content, '中');
});

test('file access is registered and safe; bytes carry SHA256', async t => {
  const f = await fixture(t, [archive('file')]); await f.api.refresh();
  const response = await f.call('file', { id: 'file', file: 'summary.md' });
  assert.equal(response.body.toString(), 'first\nsecond\nthird');
  assert.equal(response.headers['X-Content-SHA256'], hash(response.body));
  for (const file of ['../summary.md', 'C:/secret', 'x\\y', 'files/hash/summary.md', 'unregistered.md']) {
    await assert.rejects(f.call('file', { id: 'file', file }), error => [400, 404].includes(error.status));
  }
});

test('reauthentication blocks revocation while file IO is in flight', async t => {
  const f = await fixture(t, [archive('revoked')]); await f.api.refresh();
  const entered = deferred(), release = deferred();
  f.hooks.file = async () => { entered.resolve(); await release.promise; };
  const request = f.call('file', { id: 'revoked', file: 'summary.md' });
  await entered.promise; f.revoke(); release.resolve();
  await assert.rejects(request, { status: 401 });
});

for (const route of ['entries', 'search', 'entry', 'content']) test(`${route} rechecks authorization after preparing private content`, async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, [archive('private')], { prepare: async () => { entered.resolve(); await release.promise; } });
  await entered.promise;
  const request = f.call(route, { id: 'private', q: 'private' });
  f.revoke(); release.resolve();
  await assert.rejects(request, { status: 401 });
});

test('list hydration rechecks deletion before publishing private metadata or totals', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, [archive('private')], { prepare: async () => { entered.resolve(); await release.promise; } });
  await entered.promise;
  // Pause on the second archive scan (the request snapshot), then delete only
  // after the selected entry has reached prepare().
  let scans = 0;
  const snapshot = deferred();
  f.hooks.list = async kind => { if (kind === 'archive' && ++scans === 1) snapshot.resolve(); };
  const request = f.call('entries');
  await snapshot.promise;
  await new Promise(resolve => setImmediate(resolve));
  f.trash.push({ id: 'private', deletedAt: '2026-09-26' }); release.resolve();
  await assert.rejects(request, { status: 404 });
});

test('file checksum failure does not emit bytes', async t => {
  const record = archive('integrity');
  const f = await fixture(t, [record]); await f.api.refresh();
  record.contents[0].text = 'modified after indexing';
  await assert.rejects(f.call('file', { id: 'integrity', file: 'summary.md' }), { status: 502 });
});

for (const mutation of ['delete', 'replace']) test(`visibility guard blocks ${mutation} during file IO`, async t => {
  const a = archive('changing'); const f = await fixture(t, [a]); await f.api.refresh();
  const entered = deferred(), release = deferred();
  f.hooks.file = async () => { entered.resolve(); await release.promise; };
  const request = f.call('file', { id: a.entryId, file: 'summary.md' });
  await entered.promise;
  if (mutation === 'delete') f.trash.push({ id: a.entryId, deletedAt: '2026-09-26' });
  else f.records.push(archive(a.entryId, { title: 'replacement', createdAt: '2026-09-27T00:00:00Z' }));
  release.resolve();
  await assert.rejects(request, { status: mutation === 'delete' ? 404 : 409 });
});

test('cold partial coverage, failed builds, explicit retry, disk reuse and reconstruction', async t => {
  let fail = true;
  const entered = deferred(), release = deferred();
  const f = await fixture(t, [archive('bad', { text: 'needle' }), archive('good', { text: 'needle' })], {
    prepare: async a => { if (a.entryId === 'bad') { entered.resolve(); await release.promise; if (fail) throw new Error('secret storage path'); } },
  });
  await entered.promise;
  const cold = (await f.call('search', { q: 'needle' })).body;
  assert.equal(cold.total, 0); assert.equal(cold.index.complete, false); assert.equal(cold.index.pending, 2);
  release.resolve(); await f.api.refresh();
  const partial = (await f.call('search', { q: 'needle' })).body;
  assert.equal(partial.total, 1); assert.deepEqual(partial.index, { complete: false, pending: 0, failed: 1 });
  const failedMetadata = (await f.call('entries', { q: 'bad' })).body;
  assert.equal(failedMetadata.items[0].index_status, 'failed'); assert.equal(failedMetadata.items[0].files[0].sha256, null);
  await assert.rejects(f.call('entry', { id: 'bad' }), error => error.status === 503 && !error.message.includes('secret'));
  fail = false; await f.api.refresh();
  assert.equal((await f.call('search', { q: 'needle' })).body.total, 2);
  const before = f.stats.prepareCount; await f.reopen();
  assert.equal(f.stats.prepareCount, before);
  assert.equal((await f.call('search', { q: 'needle' })).body.index.complete, true);
});

test('refresh removes old documents, handles deletion and restoration; one builder at a time', async t => {
  const original = archive('versioned', { text: 'oldword' });
  const f = await fixture(t, [original, archive('extra')]); await f.api.refresh();
  f.records.push(archive('versioned', { text: 'newword', createdAt: '2026-09-27T00:00:00Z' }));
  await Promise.all([f.api.refresh(), f.api.refresh()]);
  assert.equal((await f.call('search', { q: 'oldword' })).body.total, 0);
  assert.equal((await f.call('search', { q: 'newword' })).body.total, 1);
  f.trash.push({ id: 'versioned', deletedAt: '2026-09-27' }); await f.api.refresh();
  assert.equal((await f.call('search', { q: 'newword' })).body.total, 0);
  f.trash[0].deletedAt = null; await f.api.refresh();
  assert.equal((await f.call('search', { q: 'newword' })).body.total, 1);
  assert.equal(f.stats.maxActive, 1);
});

test('deleting the derived database reconstructs search from archives', async t => {
  const f = await fixture(t, [archive('rebuild', { text: 'reconstructible' })]); await f.api.refresh();
  await f.api.close();
  await fs.unlink(path.join(f.dataDir, 'read-index.sqlite'));
  const before = f.stats.prepareCount;
  await f.reopen();
  assert.ok(f.stats.prepareCount > before);
  assert.equal((await f.call('search', { q: 'reconstructible' })).body.total, 1);
});

test('source scan failure is safe, does not serve stale data, and a refresh recovers', async t => {
  const f = await fixture(t, [archive('recover')]); await f.api.refresh();
  f.hooks.list = () => { throw new Error('private storage details'); };
  await assert.rejects(f.api.refresh(), { status: 503, message: 'Read index unavailable' });
  await assert.rejects(f.call('entries'), { status: 503, message: 'Read index unavailable' });
  delete f.hooks.list; await f.api.refresh();
  assert.equal((await f.call('entries')).body.index.complete, true);
});

test('ties choose stable archive id regardless of store ordering', async t => {
  const a = archive('tie', { title: 'A' }), b = archive('tie', { title: 'B' });
  const f = await fixture(t, [a, b]); await f.api.refresh();
  const winner = [a, b].sort((x, y) => x.id.localeCompare(y.id)).at(-1);
  assert.equal((await f.call('entry', { id: 'tie' })).body.archive_id, winner.id);
  f.records.reverse(); await f.api.refresh();
  assert.equal((await f.call('entry', { id: 'tie' })).body.archive_id, winner.id);
});

test('latest archive ordering compares timestamps across timezone offsets', async t => {
  const older = archive('offset', { title: 'older', createdAt: '2026-09-26T08:00:00+08:00' });
  const newer = archive('offset', { title: 'newer', createdAt: '2026-09-26T01:00:00Z' });
  const f = await fixture(t, [older, newer]); await f.api.refresh();
  assert.equal((await f.call('entry', { id: 'offset' })).body.title, 'newer');
});

test('reader URL trusts configuration or loopback Host only, ignores forwarded origins', async t => {
  const f = await fixture(t, [archive('article:hello world')]); await f.api.refresh();
  const params = { id: 'article:hello world' };
  assert.equal((await f.call('entry', params)).body.reader_url, 'http://localhost:8080/?entry=article%3Ahello%20world');
  assert.equal((await f.call('entry', params, { headers: { host: 'evil.test', 'x-forwarded-host': 'localhost' } })).body.reader_url, '/?entry=article%3Ahello%20world');
  assert.equal((await f.call('entry', params, { headers: { host: '[::1]:9999' }, socket: { encrypted: true } })).body.reader_url, 'https://[::1]:9999/?entry=article%3Ahello%20world');
});

test('reject invalid parameters and leave me/logout/non-GET routes to main', async t => {
  const f = await fixture(t, [archive('one')]); await f.api.refresh();
  for (const params of [{ limit: 0 }, { offset: -1 }, { offset: '1e2' }, { from: 'yesterday' }, { from: '2026-02-30' }, { from: '2026-10-01', to: '2026-01-01' }]) {
    await assert.rejects(f.call('entries', params), { status: 400 });
  }
  for (const route of ['me', 'logout', 'other']) assert.equal((await f.call(route)).handled, false);
  assert.equal((await f.call('entries', {}, { method: 'POST' })).handled, false);
  // A long multi-term query uses a bound JSON list, not SQLite expression trees.
  const manyTerms = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ');
  assert.equal((await f.call('search', { q: manyTerms })).body.total, 0);
});

test('close drains an active build before closing SQLite and is idempotent', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, [archive('closing')], { prepare: async () => { entered.resolve(); await release.promise; } });
  await entered.promise;
  let ended = false;
  const closing = f.api.close().then(() => { ended = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(ended, false);
  release.resolve(); await closing; await f.api.close();
  assert.equal(ended, true); await assert.rejects(f.call('entries'), { status: 503 });
});
