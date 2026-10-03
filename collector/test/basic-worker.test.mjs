import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/server.mjs';
import { api } from '../src/worker.mjs';
import { buildBasicBundle } from '../deploy-review/basic-worker.mjs';
import { secret } from '../src/common.mjs';

test('basic archive preserves original share without claiming unread page content', () => {
  const task = { id: randomUUID(), content: '一篇关于记录方法的文章\nhttps://example.org/notes', scenario: null };
  const bundle = buildBasicBundle(task, new Date('2026-10-03T10:00:00Z'));
  assert.equal(bundle.meta.title, '一篇关于记录方法的文章');
  assert.equal(bundle.meta.source_url, 'https://example.org/notes');
  assert.equal(bundle.meta.status, 'partial');
  assert.match(Buffer.from(bundle.files[0].body, 'base64').toString(), /https:\/\/example.org\/notes/);
  assert.match(bundle.meta.coverage_note, /未获取链接目标的网页正文/);
});

test('review worker can claim, archive, and complete a shared-text task', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-basic-'));
  const key = secret();
  const service = createService({ dataDir: root, masterKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  const server = `http://127.0.0.1:${service.server.address().port}`;
  const owner = { server, ...(await api({ server }, '/api/pair', 'POST', { key, name: 'owner' })) };
  const code = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
  const worker = { server, ...(await api({ server }, '/api/pair', 'POST', { key: code.key, name: 'basic worker' })) };
  await api(worker, '/api/heartbeat', 'POST', { capabilities: ['note'], agents: ['basic'] });
  const text = '在手机上记下完整的阅读感想，包含观点、证据和仍需核实的问题。'.repeat(4);
  const task = await api(owner, '/api/tasks', 'POST', { content: text, type: 'auto', tags: ['阅读'], autoArchive: true, submissionId: randomUUID() });
  const claimed = (await api(worker, '/api/claim', 'POST', {})).task;
  assert.equal(claimed.id, task.id);
  await api(worker, `/api/tasks/${task.id}/progress`, 'POST', { state: 'running', agent: 'basic', message: '正在保存分享内容' });
  const bundle = buildBasicBundle(claimed);
  await api(worker, `/api/tasks/${task.id}/result`, 'POST', bundle);
  const state = await api(owner, '/api/state');
  assert.equal(state.tasks.find(item => item.id === task.id).state, 'completed');
  assert.equal(state.archives.find(item => item.entryId === bundle.meta.id).meta.status, 'archived');
  assert.deepEqual(state.archives.find(item => item.entryId === bundle.meta.id).meta.tags, ['文字摘录', '阅读']);
});
