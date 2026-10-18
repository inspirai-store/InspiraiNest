import type { Connection } from '../../records/data/types.ts';

export function bookmarkScope(connection: Connection) {
  return connection.paired && connection.deviceId ? JSON.stringify([connection.server, connection.deviceId]) : null;
}
export class BookmarkStore {
  private storage: Pick<Storage, 'getItem' | 'setItem'>;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'>) { this.storage = storage; }
  read(scope: string): string[] {
    const key = 'inspirainest-library-bookmarks-v1:' + scope;
    const stored = this.storage.getItem(key);
    const ids = this.parse(stored ?? '[]');
    let identity: unknown;
    try { identity = JSON.parse(scope); } catch { return ids; }
    if (!Array.isArray(identity) || identity.length !== 2 || !identity.every(value => typeof value === 'string' && value)) return ids;
    const [server, deviceId] = identity;
    const legacy = this.storage.getItem('lingnest-desktop-favorites:' + server);
    if (legacy === null) return ids;
    const ownerKey = 'inspirainest-library-bookmarks-legacy-owner-v1:' + server;
    const owner = this.storage.getItem(ownerKey);
    if (owner !== null && owner !== deviceId || owner === deviceId && stored !== null) return ids;
    const merged = [...new Set([...ids, ...this.parse(legacy)])];
    // Reserve the old server-wide favorites for the current account before copying.
    // A failed write can retry on that account without exposing them to another one.
    if (owner === null) this.storage.setItem(ownerKey, deviceId);
    this.storage.setItem(key, JSON.stringify(merged));
    return merged;
  }
  private parse(raw: string): string[] {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw new Error('收藏数据读取失败');
    return [...new Set(value)];
  }
  write(scope: string, ids: string[]) {
    this.storage.setItem('inspirainest-library-bookmarks-v1:' + scope, JSON.stringify([...new Set(ids)]));
  }
}
