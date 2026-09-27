import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { hash, requireValue, safePath } from './common.mjs';

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase();
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const linesOf = text => text.split(/\r\n|\n|\r/);
const MAX_CONTENT = 64 * 1024;
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

function integer(params, name, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const raw = params.get(name);
  if (raw === null) return fallback;
  requireValue(/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) >= min, `Invalid ${name}`);
  return Math.min(Number(raw), max);
}

function dateFilter(value, name) {
  if (value === null) return null;
  requireValue(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
    && Number.isFinite(Date.parse(value)), `Invalid ${name}`);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  requireValue(month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate(), `Invalid ${name}`);
  return Date.parse(value.length === 10 ? `${value}T${name === 'to' ? '23:59:59.999' : '00:00:00'}+08:00` : value);
}

function snippetFor(line, terms) {
  const normalized = normalize(line);
  const match = Math.min(...terms.map(term => normalized.indexOf(term)).filter(index => index >= 0));
  let normalizedOffset = 0, originalOffset = 0;
  // Only grapheme boundaries are mapped. A compatibility glyph such as ﬃ can
  // expand to several normalized code units while occupying one source unit.
  for (const { segment, index } of graphemes.segment(line)) {
    normalizedOffset += normalize(segment).length;
    if (normalizedOffset > match) { originalOffset = index; break; }
  }
  let start = Math.max(0, originalOffset - 120), end = Math.min(line.length, start + 400);
  if (splitSurrogate(line, start)) start--;
  if (splitSurrogate(line, end)) end--;
  return line.slice(start, end);
}

// Columns are zero-based UTF-16 offsets; never split a surrogate pair.
function splitSurrogate(text, offset) {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
}

function sliceContent(text, params) {
  const lines = linesOf(text);
  const start = integer(params, 'start_line', 1, 1);
  const column = integer(params, 'start_column', 0, 0);
  const maxLines = integer(params, 'max_lines', 200, 1, 1000);
  requireValue(start <= lines.length + 1 && (start <= lines.length ? column <= lines[start - 1].length : column === 0), 'Content position out of range');
  requireValue(!splitSurrogate(lines[start - 1] || '', column), 'Invalid start_column');
  let content = '', used = 0, nextLine = start, nextColumn = column, end = start - 1;
  for (let i = start - 1; i < lines.length && i < start - 1 + maxLines; i++) {
    const offset = i === start - 1 ? column : 0;
    const separator = i === start - 1 ? '' : '\n';
    const remaining = MAX_CONTENT - used - separator.length;
    const rest = lines[i].slice(offset);
    if (remaining < 0 || (remaining === 0 && rest.length)) break;
    let taken = rest;
    if (Buffer.byteLength(rest) > remaining) {
      let low = 0, high = rest.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(rest.slice(0, mid)) <= remaining) low = mid;
        else high = mid - 1;
      }
      if (splitSurrogate(rest, low)) low--;
      taken = rest.slice(0, low);
      if (!taken.length) break;
    }
    content += separator + taken;
    used += separator.length + Buffer.byteLength(taken);
    end = i + 1;
    if (taken.length < rest.length) { nextLine = i + 1; nextColumn = offset + taken.length; break; }
    nextLine = i + 2; nextColumn = 0;
  }
  const truncated = nextLine <= lines.length;
  return { content, start_line: start, end_line: end, next_line: truncated ? nextLine : null,
    next_column: truncated ? nextColumn : null, total_lines: lines.length, truncated };
}

/** Reconstructible cache only. refresh() settles after its queued builds drain.
 * The caller owns initial reader/owner authorization and the /me and /logout routes.
 */
export function createReadApi({ dataDir, store, browser, publicUrl, authenticate, send }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'read-index.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS read_entries (
      id TEXT PRIMARY KEY, archive_id TEXT NOT NULL, metadata TEXT NOT NULL,
      title_norm TEXT NOT NULL, tags_norm TEXT NOT NULL, summary_norm TEXT NOT NULL,
      type TEXT, status TEXT, collected REAL, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS read_documents (
      entry_id TEXT NOT NULL, file TEXT NOT NULL, text TEXT NOT NULL, normalized TEXT NOT NULL,
      PRIMARY KEY(entry_id,file));
    CREATE INDEX IF NOT EXISTS read_documents_entry ON read_documents(entry_id);
    CREATE INDEX IF NOT EXISTS read_entries_collection ON read_entries(collected DESC,id);`);
  let closed = false, closing = false, scanFailed = false, scanned = false;
  let scanChain = Promise.resolve(), running = null, closePromise;
  const jobs = new Map(), queue = new Map(), urgent = new Set();

  async function visible() {
    const [archives, trash] = await Promise.all([store.list('archive'), store.list('trash')]);
    const deleted = new Set(trash.filter(item => item.deletedAt).map(item => item.entryId || item.id));
    const latest = new Map();
    for (const archive of archives) {
      if (deleted.has(archive.entryId)) continue;
      const old = latest.get(archive.entryId);
      const order = old ? compare(Date.parse(archive.createdAt) || 0, Date.parse(old.createdAt) || 0) : 1;
      if (order > 0 || (order === 0 && compare(archive.id, old.id) > 0)) latest.set(archive.entryId, archive);
    }
    return latest;
  }

  function rowFor(id) { return db.prepare('SELECT * FROM read_entries WHERE id=?').get(id); }
  function indexState() {
    const counts = Object.fromEntries(db.prepare('SELECT state,count(*) AS n FROM read_entries GROUP BY state').all().map(row => [row.state, row.n]));
    const pending = counts.pending || 0, failed = counts.failed || 0;
    return { complete: scanned && !scanFailed && !pending && !failed, pending, failed };
  }
  function seed(archive) {
    const meta = archive.meta;
    db.prepare(`INSERT OR REPLACE INTO read_entries VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      archive.entryId, archive.id, JSON.stringify({ ...meta, id: archive.entryId }), normalize(meta.title),
      normalize((meta.tags || []).join('\n')), normalize(meta.summary), meta.type ?? null, meta.status ?? null,
      Number.isFinite(Date.parse(meta.collected_at)) ? Date.parse(meta.collected_at) : null, 'pending');
    db.prepare('DELETE FROM read_documents WHERE entry_id=?').run(archive.entryId);
  }
  function relativeFile(archive, file) {
    const prefix = `files/${archive.id}/`;
    requireValue(typeof file === 'string' && file.startsWith(prefix), 'Invalid archive file', 502);
    return safePath(file.slice(prefix.length));
  }
  async function build(archive) {
    const prepared = await browser.prepare(archive);
    const files = [];
    for (const file of prepared.entry.files) {
      const relative = relativeFile(archive, file.path);
      let digest = file.sha256;
      if (!/^[a-f0-9]{64}$/i.test(digest || '')) digest = hash(await browser.file(archive, relative));
      files.push({ path: relative, role: file.role, bytes: file.bytes, sha256: digest.toLowerCase() });
    }
    const { directory, archiveId, thumbnail, files: ignoredFiles, ...meta } = prepared.entry;
    const metadata = { ...meta, id: archive.entryId, archive_id: archive.id, files,
      omitted: prepared.entry.omitted ?? prepared.omitted ?? [] };
    // A refresh may have replaced/deleted this entry while storage was awaited.
    if (rowFor(archive.entryId)?.archive_id === archive.id) {
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM read_documents WHERE entry_id=?').run(archive.entryId);
        for (const file of prepared.entry.files) {
          const text = prepared.documents?.[file.path];
          if (typeof text !== 'string') continue;
          db.prepare('INSERT INTO read_documents VALUES (?,?,?,?)').run(archive.entryId, relativeFile(archive, file.path), text, normalize(text));
        }
        db.prepare(`UPDATE read_entries SET metadata=?, title_norm=?, tags_norm=?, summary_norm=?, state='ready' WHERE id=?`).run(
          JSON.stringify(metadata), normalize(metadata.title), normalize((metadata.tags || []).join('\n')), normalize(metadata.summary), archive.entryId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    return metadata;
  }
  function kick() {
    if (running) return running;
    running = (async () => {
      // Yield between archives so cold indexing cannot monopolize request handling.
      while (queue.size) {
        await yieldTurn();
        if (!queue.size) continue;
        const key = [...urgent].find(id => queue.has(id)) || queue.keys().next().value;
        urgent.delete(key);
        const job = queue.get(key);
        queue.delete(key);
        try { job.resolve(await build(job.archive)); }
        catch {
          db.prepare("UPDATE read_entries SET state='failed' WHERE id=? AND archive_id=?").run(job.archive.entryId, job.archive.id);
          job.resolve(null); // Errors from storage are deliberately not exposed.
        } finally { jobs.delete(key); }
      }
    })().finally(() => { running = null; });
    return running;
  }
  function enqueue(archive, priority = false) {
    let job = jobs.get(archive.id);
    if (!job) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      job = { archive, promise, resolve };
      jobs.set(archive.id, job); queue.set(archive.id, job);
    }
    if (priority) urgent.add(archive.id);
    void kick();
    return job.promise;
  }
  function synchronize(retry = false) {
    const next = scanChain.then(async () => {
      const latest = await visible();
      for (const row of db.prepare('SELECT id,archive_id FROM read_entries').all()) {
        if (!latest.has(row.id)) {
          db.prepare('DELETE FROM read_entries WHERE id=?').run(row.id);
          db.prepare('DELETE FROM read_documents WHERE entry_id=?').run(row.id);
        }
      }
      // Cancel queued obsolete versions; the single in-flight prepare may finish.
      for (const [key, job] of queue) {
        if (latest.get(job.archive.entryId)?.id !== key) {
          queue.delete(key); jobs.delete(key); urgent.delete(key); job.resolve(null);
        }
      }
      for (const archive of latest.values()) {
        let row = rowFor(archive.entryId);
        if (row?.archive_id !== archive.id) { seed(archive); row = rowFor(archive.entryId); }
        if (row.state === 'pending' || (retry && row.state === 'failed')) {
          db.prepare("UPDATE read_entries SET state='pending' WHERE id=?").run(archive.entryId);
          enqueue(archive);
        }
      }
      scanned = true; scanFailed = false;
      return latest;
    });
    scanChain = next.catch(() => { scanFailed = true; });
    return next;
  }
  async function refresh() {
    requireValue(!closing && !closed, 'Read API is closed', 503);
    try { await synchronize(true); if (running) await running; }
    catch { requireValue(false, 'Read index unavailable', 503); }
  }
  async function ready(archive) {
    const row = rowFor(archive.entryId);
    if (row?.archive_id === archive.id && row.state === 'ready') return JSON.parse(row.metadata);
    return enqueue(archive, true);
  }
  function readerUrl(req, id) {
    let base = publicUrl;
    if (!base) {
      const host = req.headers?.host;
      if (typeof host === 'string' && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) {
        try { base = new URL(`${req.socket?.encrypted ? 'https' : 'http'}://${host}`).origin; } catch { /* Relative link below. */ }
      }
    }
    return `${base ? String(base).replace(/\/$/, '') : ''}/?entry=${encodeURIComponent(id)}`;
  }
  function outputMeta(req, archive, metadata) {
    return { ...metadata, schema_version: 1, id: archive.entryId, archive_id: archive.id, reader_url: readerUrl(req, archive.entryId) };
  }
  async function guard(req, expected, all = false) {
    await authenticate(req);
    let latest;
    try { latest = await visible(); } catch { requireValue(false, 'Read visibility unavailable', 503); }
    for (const archive of expected.values()) {
      requireValue(latest.has(archive.entryId), 'Entry not found', 404);
      requireValue(latest.get(archive.entryId).id === archive.id, 'Entry changed; retry request', 409);
    }
    requireValue(!all || latest.size === expected.size, 'Library changed; retry request', 409);
    // Last awaited operation also checks tokens revoked during visibility IO.
    await authenticate(req);
  }
  function matches(id, terms) {
    if (!terms.length) return [];
    const found = [];
    // Locations come from original lines, never offsets into normalized strings.
    for (const doc of db.prepare('SELECT file,text FROM read_documents WHERE entry_id=? ORDER BY file').iterate(id)) {
      const lines = linesOf(doc.text);
      for (let i = 0; i < lines.length; i++) {
        if (!terms.some(term => normalize(lines[i]).includes(term))) continue;
        found.push({ file: doc.file, start_line: i + 1, end_line: i + 1, snippet: snippetFor(lines[i], terms) });
        if (found.length >= 5) return found;
      }
    }
    return found;
  }
  function select(params, search) {
    const limit = integer(params, 'limit', 20, 1, 100), offset = integer(params, 'offset', 0, 0);
    const from = dateFilter(params.get('from'), 'from'), to = dateFilter(params.get('to'), 'to');
    requireValue(from === null || to === null || from <= to, 'Invalid date range');
    const q = params.get('q') || '';
    requireValue(q.length <= 2000, 'Query too long');
    const terms = [...new Set(normalize(q).trim().split(/\s+/).filter(Boolean))];
    const where = [], args = [];
    for (const key of ['type', 'status']) if (params.has(key)) { where.push(`e.${key}=?`); args.push(params.get(key)); }
    if (params.has('tag')) { where.push("EXISTS(SELECT 1 FROM json_each(e.metadata,'$.tags') WHERE value=?)"); args.push(params.get('tag')); }
    if (from !== null) { where.push('e.collected>=?'); args.push(from); }
    if (to !== null) { where.push('e.collected<=?'); args.push(to); }
    const query = JSON.stringify(terms);
    if (terms.length) {
      where.push(`NOT EXISTS(SELECT 1 FROM json_each(?) q WHERE instr(e.title_norm,q.value)=0
        AND instr(e.tags_norm,q.value)=0 AND instr(e.summary_norm,q.value)=0
        AND NOT EXISTS(SELECT 1 FROM read_documents d WHERE d.entry_id=e.id AND instr(d.normalized,q.value)>0))`);
      args.push(query);
    }
    const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT count(*) AS n FROM read_entries e ${condition}`).get(...args).n;
    const rank = terms.length ? `(SELECT count(*) FROM json_each(?) q WHERE instr(e.title_norm,q.value)>0 OR instr(e.tags_norm,q.value)>0) DESC,
      (SELECT count(*) FROM json_each(?) q WHERE instr(e.summary_norm,q.value)>0) DESC,` : '';
    const rows = db.prepare(`SELECT e.* FROM read_entries e ${condition} ORDER BY ${rank}
      e.collected DESC,e.id ASC LIMIT ? OFFSET ?`).all(...args, ...(terms.length ? [query, query] : []), limit, offset);
    return { rows, total, limit, offset, terms, search };
  }
  async function handle(req, res, url, device) {
    const route = url.pathname.slice('/api/read/v1/'.length);
    if (req.method !== 'GET' || !url.pathname.startsWith('/api/read/v1/') || !['entries', 'search', 'entry', 'content', 'file'].includes(route)) return false;
    requireValue(!closing && !closed, 'Read API is closed', 503);
    let latest;
    try { latest = await synchronize(); } catch { requireValue(false, 'Read index unavailable', 503); }
    const params = url.searchParams;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (route === 'entries' || route === 'search') {
      // Snapshot the SQL result before hydration: an incomplete cold search must
      // not claim the coverage of background work that finishes during this request.
      const state = indexState(), selection = select(params, route === 'search'), items = [];
      for (const row of selection.rows) {
        const archive = latest.get(row.id);
        const metadata = await ready(archive);
        const fallback = { ...archive.meta, files: (archive.meta.files || []).map(file => ({ path: file.path, role: file.role, bytes: null, sha256: null })), omitted: null, index_status: 'failed' };
        const item = outputMeta(req, archive, metadata || fallback);
        if (selection.search) item.matches = matches(archive.entryId, selection.terms);
        items.push(item);
      }
      await guard(req, latest, true);
      send(res, 200, { schema_version: 1, items, total: selection.total, limit: selection.limit, offset: selection.offset, index: state });
      return true;
    }
    const entryId = params.get('id');
    requireValue(typeof entryId === 'string' && entryId.length > 0 && entryId.length <= 300, 'Invalid id');
    const archive = latest.get(entryId);
    requireValue(archive, 'Entry not found', 404);
    const metadata = await ready(archive);
    requireValue(metadata, 'Entry content unavailable', 503);
    let result;
    if (route === 'entry') result = outputMeta(req, archive, metadata);
    else {
      let relative = params.get('file');
      if (relative === null && route === 'content') {
        const textFiles = new Set(db.prepare('SELECT file FROM read_documents WHERE entry_id=?').all(entryId).map(doc => doc.file));
        relative = (metadata.files.find(file => file.role === 'summary' && textFiles.has(file.path))
          || metadata.files.find(file => file.role === 'analysis' && textFiles.has(file.path))
          || metadata.files.find(file => textFiles.has(file.path)))?.path;
      }
      requireValue(typeof relative === 'string' && relative.length > 0, 'File required');
      safePath(relative);
      const file = metadata.files.find(file => file.path === relative);
      requireValue(file, 'File not found', 404);
      if (route === 'file') {
        let bytes;
        try { bytes = await browser.file(archive, relative); } catch { requireValue(false, 'File unavailable', 503); }
        const digest = hash(bytes);
        requireValue(digest === file.sha256, 'File checksum mismatch', 502);
        await guard(req, new Map([[entryId, archive]]));
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', bytes.length);
        res.setHeader('X-Content-SHA256', digest);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.posix.basename(relative)).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`);
        res.writeHead(200); res.end(bytes);
        return true;
      }
      const doc = db.prepare('SELECT text FROM read_documents WHERE entry_id=? AND file=?').get(entryId, relative);
      requireValue(doc, 'Text content not available for this file', 415);
      result = { schema_version: 1, id: entryId, archive_id: archive.id, file: relative,
        ...sliceContent(doc.text, params), source_url: metadata.source_url ?? null, reader_url: readerUrl(req, entryId) };
    }
    await guard(req, new Map([[entryId, archive]]));
    send(res, 200, result);
    return true;
  }
  function close() {
    if (!closePromise) {
      closing = true;
      closePromise = (async () => { await scanChain; if (running) await running; closed = true; db.close(); })();
    }
    return closePromise;
  }
  void refresh().catch(() => {});
  return { handle, refresh, close };
}
