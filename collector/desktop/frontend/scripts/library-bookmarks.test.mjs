import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookmarkStore, bookmarkScope } from '../src/library/data/bookmarks.ts';

test('重新创建存储实例恢复收藏，另一账号/服务读不到原收藏', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const a = bookmarkScope({ paired: true, server: 'https://one.test', deviceId: 'a' });
  new BookmarkStore(storage).write(a, ['entry-31', 'entry-1']);
  assert.deepEqual(new BookmarkStore(storage).read(a), ['entry-31', 'entry-1']);
  assert.deepEqual(new BookmarkStore(storage).read(bookmarkScope({ paired: true, server: 'https://one.test', deviceId: 'b' })), []);
  assert.deepEqual(new BookmarkStore(storage).read(bookmarkScope({ paired: true, server: 'https://two.test', deviceId: 'a' })), []);
  assert.equal(bookmarkScope({ paired: false, server: 'https://one.test', deviceId: 'a' }), null);
});
test('保存失败不改写已落盘收藏，损坏的数据不伪装成空收藏', () => {
  let stored = '["entry-1"]';
  const store = new BookmarkStore({ getItem: () => stored, setItem: () => { throw new Error('quota'); } });
  assert.throws(() => store.write('scope', ['entry-2']), /quota/);
  assert.deepEqual(store.read('scope'), ['entry-1']);
  stored = '{bad';
  assert.throws(() => store.read('scope'));
});
