import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LibraryClient } from '../src/library/data/client.ts';

const connection = { paired: true, server: 'http://localhost:49423', deviceId: 'owner-a' };
const page = (content, next_line = null, next_column = null, archive_id = 'a') => ({ id: 'entry', file: 'summary.md', archive_id, content, truncated: next_line !== null, next_line, next_column });
test('图片预览迟到响应不会进入切换后的资料空间', async () => {
  let resolvePreview;
  const pending = new Promise(resolve => { resolvePreview = resolve; });
  const client = new LibraryClient({ status: async () => connection, preview: async () => pending });
  const read = client.preview('entry', 'image.png');
  await new Promise(resolve => setImmediate(resolve));
  client.invalidateSession();
  resolvePreview({ dataUrl: 'data:image/png;base64,AA==', name: 'image.png' });
  await assert.rejects(read, /已切换/);
});
test('回收站读取保留归档编号，缺少接口不伪装为空列表', async () => {
  const items = [{ id: 'entry', archiveId: 'archive', title: '资料', deletedAt: '2026-10-13T00:00:00Z', deviceId: 'owner-a' }];
  const client = new LibraryClient({ status: async () => connection, trash: async () => items });
  assert.deepEqual(await client.trash(), items);
  await assert.rejects(new LibraryClient({ status: async () => connection }).trash(), /接口不可用/);
});
test('接齐跨行及同一长行分页，保留换行和正文', async () => {
  const pages = [page('第一行', 2, 0), page('长行前半', 2, 4), page('后半\n末行')];
  const calls = [];
  const client = new LibraryClient({ status: async () => connection, content: async input => { calls.push(input); return pages.shift(); } });
  assert.equal((await client.content('entry')).content, '第一行\n长行前半后半\n末行');
  assert.deepEqual(calls.map(c => [c.startLine, c.startColumn]), [[1, 0], [2, 0], [2, 4]]);
});
test('阅读过程中归档版本变化不拼接两份资料', async () => {
  const pages = [page('旧版', 2, 0), page('新版', null, null, 'b')];
  const client = new LibraryClient({ status: async () => connection, content: async () => pages.shift() });
  await assert.rejects(client.content('entry'), /版本已变化/);
});
test('账号切换时拒绝迟到列表，即使服务器和设备标识相同', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const client = new LibraryClient({ status: async () => connection, entries: async () => pending });
  const read = client.entries({});
  await new Promise(r => setImmediate(r));
  client.invalidateSession();
  resolve({ items: [], total: 0 });
  await assert.rejects(read, /已切换/);
});
test('身份读取期间切换会话，不发起旧列表请求', async () => {
  let resolveStatus, calls = 0;
  const status = new Promise(resolve => { resolveStatus = resolve; });
  const client = new LibraryClient({ status: () => status, entries: async () => { calls++; return { items: [], total: 0 }; } });
  const read = client.entries({});
  client.invalidateSession();
  resolveStatus(connection);
  await assert.rejects(read, /已切换/);
  assert.equal(calls, 0);
});
test('正文分页等待期间切换会话，不继续请求后续页', async () => {
  let resolvePage, calls = 0;
  const pending = new Promise(resolve => { resolvePage = resolve; });
  const client = new LibraryClient({ status: async () => connection, content: async () => { calls++; return pending; } });
  const read = client.content('entry');
  await new Promise(resolve => setImmediate(resolve));
  client.invalidateSession();
  resolvePage(page('旧资料', 2, 0));
  await assert.rejects(read, /已切换/);
  assert.equal(calls, 1);
});
test('恢复授权在初始身份等待期间失效，不发出新账号恢复请求',async()=>{let resolve,calls=0;const client=new LibraryClient({status:()=>new Promise(r=>resolve=r),restore:async()=>{calls++;}});const pending=client.restore('archive');client.invalidateSession();resolve(connection);await assert.rejects(pending,/已切换/);assert.equal(calls,0);});
