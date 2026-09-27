import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class Store {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id))');
  }
  access(work) { return this.pendingTransactions ? this.transactionTail.then(() => this.access(work)) : work(); }
  get(kind, id) { return this.access(() => { const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.body) : null; }); }
  getForUpdate(kind, id) { return this.get(kind, id); } // BEGIN IMMEDIATE owns the SQLite write lock.
  list(kind) { return this.access(() => this.db.prepare('SELECT body FROM records WHERE kind=?').all(kind).map(row => JSON.parse(row.body))); }
  put(kind, value) { return this.access(() => { this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, value.id, JSON.stringify(value)); return value; }); }
  delete(kind, id) { return this.access(() => this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id)); }
  touchDevice(id, at) { return this.access(() => this.db.prepare("UPDATE records SET body=json_set(body,'$.lastSeen',?) WHERE kind='device' AND id=?").run(at, id)); }
  async transaction(work) {
    const previous = this.transactionTail || Promise.resolve();
    let release;
    this.transactionTail = new Promise(resolve => { release = resolve; });
    this.pendingTransactions = (this.pendingTransactions || 0) + 1;
    await previous;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      // Only this view may use the connection while the transaction is open.
      const tx = Object.create(this);
      tx.pendingTransactions = 0;
      try { const result = await work(tx); this.db.exec('COMMIT'); return result; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    } finally { this.pendingTransactions--; release(); }
  }
  close() { this.db.close(); }
}
