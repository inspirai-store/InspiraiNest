import type { Connection } from '../../records/data/types.ts';

export function bookmarkScope(connection: Connection) {
  return connection.paired && connection.deviceId ? JSON.stringify([connection.server, connection.deviceId]) : null;
}
export class BookmarkStore {
  private storage: Pick<Storage, 'getItem' | 'setItem'>;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'>) { this.storage = storage; }
  read(scope: string): string[] {
    const value: unknown = JSON.parse(this.storage.getItem('inspirainest-library-bookmarks-v1:' + scope) ?? '[]');
    if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw new Error('收藏数据读取失败');
    return [...new Set(value)];
  }
  write(scope: string, ids: string[]) {
    this.storage.setItem('inspirainest-library-bookmarks-v1:' + scope, JSON.stringify([...new Set(ids)]));
  }
}
