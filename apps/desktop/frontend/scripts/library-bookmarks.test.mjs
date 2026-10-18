import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookmarkStore, bookmarkScope } from '../../../../packages/core/web/library/data/bookmarks.ts';

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
test('旧 Mac/Windows 收藏迁移到当前账号，保留原键并拒绝同服务的另一账号继承', () => {
  const legacyKey = 'lingnest-desktop-favorites:https://one.test';
  const data = new Map([[legacyKey, '["entry-1","entry-2","entry-1"]']]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const scope = id => bookmarkScope({paired:true,server:'https://one.test',deviceId:id});
  new BookmarkStore(storage).write(scope('a'), ['entry-3']);
  assert.deepEqual(new BookmarkStore(storage).read(scope('a')), ['entry-3','entry-1','entry-2']);
  assert.equal(data.get(legacyKey), '["entry-1","entry-2","entry-1"]');
  assert.deepEqual(new BookmarkStore(storage).read(scope('b')), []);
  new BookmarkStore(storage).write(scope('a'), ['entry-2']);
  assert.deepEqual(new BookmarkStore(storage).read(scope('a')), ['entry-2']);
});
test('收藏迁移的目标写入失败后原数据可重试，同时不流入另一账号', () => {
  const data = new Map([['lingnest-desktop-favorites:https://one.test','["entry-1"]']]);
  let fail = true;
  const storage = {getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(fail&&key.startsWith('inspirainest-library-bookmarks-v1:'))throw Error('quota');data.set(key,value);}};
  const scope = id => bookmarkScope({paired:true,server:'https://one.test',deviceId:id});
  assert.throws(()=>new BookmarkStore(storage).read(scope('a')),/quota/);
  assert.deepEqual(new BookmarkStore(storage).read(scope('b')),[]);
  fail=false;
  assert.deepEqual(new BookmarkStore(storage).read(scope('a')),['entry-1']);
});
