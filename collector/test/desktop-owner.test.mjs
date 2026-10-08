import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { OwnerClient } from '../desktop/owner-client.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encryption = { isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from('encrypted:' + text),
  decryptString: bytes => bytes.toString().replace(/^encrypted:/, '') };

test('owner authorization stays separate, encrypted at rest and bound to the Worker server', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lingnest-owner-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'owner.json'), calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/pair')) return Response.json({ device: { id: 'owner-1', role: 'owner' }, token: 'owner-secret' }, { status: 201 });
    if (url.endsWith('/api/state')) return Response.json({ me: { id: 'owner-1' }, tasks: [], devices: [], archives: [] });
    return Response.json({ error: 'Not found' }, { status: 404 });
  };
  const client = new OwnerClient({ file, workerServer: () => 'https://library.example', encryption, fetcher });
  await assert.rejects(client.pair({ server: 'https://other.example', key: 'one-time', name: 'Desktop' }), /同一服务/);
  assert.equal(client.status().paired, false);
  await client.pair({ server: 'https://library.example', key: 'one-time', name: 'Desktop' });
  assert.equal(client.status().paired, true);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('owner-secret'));
  assert.equal(calls[0].options.body.includes('one-time'), true);
  client.assertWorkerServer('https://library.example');
  assert.throws(() => client.assertWorkerServer('https://other.example'), /同一服务/);
  await client.state();
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer owner-secret');
  await assert.rejects(client.taskAction({ id: randomUUID(), action: 'reassign' }), /Not found/);
  assert.match(calls.at(-1).url, /\/api\/tasks\/[a-f0-9-]+\/reassign$/);
  assert.throws(() => client.taskAction({ id: randomUUID(), action: 'arbitrary' }), /不支持/);
  const reopened = new OwnerClient({ file, workerServer: () => 'https://library.example', encryption, fetcher });
  assert.equal(reopened.status().deviceId, 'owner-1');
  reopened.logout();
  assert.equal(fs.existsSync(file), false);
});

test('task submission keeps a stable ID and private attachment bytes require matching SHA-256', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lingnest-owner-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  let corrupt = false;
  const content = Buffer.from('original attachment');
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/api/pair')) return Response.json({ device: { id: 'owner-2', role: 'owner' }, token: 'token-2' }, { status: 201 });
    if (url.endsWith('/api/tasks')) return Response.json({ id: 'task-1', ...JSON.parse(options.body) }, { status: 201 });
    if (url.includes('/api/read/v1/entry?')) return Response.json({ id: 'entry-1', files: [{ path: 'summary.md', sha256: sha(content) }] });
    if (url.includes('/api/read/v1/file?')) return new Response(corrupt ? 'modified' : content, { headers: { 'x-content-sha256': sha(content) } });
    return Response.json({ error: 'Not found' }, { status: 404 });
  };
  const client = new OwnerClient({ file: path.join(folder, 'owner.json'), workerServer: () => '', encryption, fetcher });
  await client.pair({ server: 'https://library.example', key: 'key', name: 'Desktop' });
  const submissionId = randomUUID(), input = { content: '完整分享文字 https://example.com/a', submissionId, autoArchive: true, tags: ['设计'] };
  await client.createTask(input); await client.createTask(input);
  assert.equal(requests.filter(r => r.url.endsWith('/api/tasks')).length, 2);
  assert.deepEqual(requests.filter(r => r.url.endsWith('/api/tasks')).map(r => JSON.parse(r.options.body).submissionId), [submissionId, submissionId]);
  assert.equal((await client.fileBytes({ id: 'entry-1', file: 'summary.md' })).bytes.toString(), content.toString());
  corrupt = true;
  await assert.rejects(client.fileBytes({ id: 'entry-1', file: 'summary.md' }), /校验失败/);
  await assert.rejects(client.fileBytes({ id: 'entry-1', file: '../secret' }), /Unsafe|Invalid/);
});
