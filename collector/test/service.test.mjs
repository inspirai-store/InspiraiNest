import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../src/server.mjs';
import { api, processTask, runWorker, syncLibrary } from '../src/worker.mjs';
import { packageEntry, unpackArchive, validateArchive, permitted } from '../src/archive.mjs';
import { agentOrder, detectAgents, unavailableBeforeWork, execute } from '../src/agents.mjs';
import { secret, hash, safePath } from '../src/common.mjs';
import { loadWorkerConfig, initializeWorkerConfig } from '../src/config.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url));
const profiles = { codex: { command: process.execPath, args: [fixture], versionArgs: [fixture, '--version'] }, codebuddy: { enabled: false } };
test('worker configuration paths are anchored to the configuration, not launch cwd', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-config-'));
  const file = path.join(root, 'worker.json');
  fs.writeFileSync(file, JSON.stringify({ dataDir: './data', watchLibrary: '../library', agents: { codex: { command: './runtime/codex' }, codebuddy: { command: 'codebuddy' } } }));
  const { config } = loadWorkerConfig(file);
  assert.equal(config.dataDir, path.join(root, 'data'));
  assert.equal(config.watchLibrary, path.resolve(root, '../library'));
  assert.equal(config.agents.codex.command, path.join(root, 'runtime/codex'));
  assert.equal(config.agents.codebuddy.command, 'codebuddy');
  assert.deepEqual(loadWorkerConfig(path.join(root, 'missing.json')).config, {});
});
test('capture profile initialization never replaces an existing configuration or token', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-init-'));
  const file = path.join(root, 'worker.json');
  const config = initializeWorkerConfig(file, { captureProfile: true });
  assert.ok(path.isAbsolute(config.agents.codex.command));
  assert.ok(config.agents.codebuddy.args.includes('acceptEdits'));
  assert.equal(config.watchLibrary, null);
  assert.equal(config.token, undefined);
  fs.writeFileSync(file, JSON.stringify({ token: 'existing-device-test-token' }));
  assert.throws(() => initializeWorkerConfig(file), { code: 'EEXIST' });
  assert.equal(loadWorkerConfig(file).config.token, 'existing-device-test-token');
});
test('original text and legacy source/transcript roles survive light archive packaging', () => {
  for (const role of ['original', 'source_snapshot', 'transcript_raw']) {
    assert.equal(permitted({ path: 'source/body.txt', role }), true);
    assert.equal(permitted({ path: 'source/cookies.txt', role }), false);
    assert.equal(permitted({ path: 'source/original.mp4', role }), false);
    assert.equal(permitted({ path: 'source/raw.html', role }), false);
  }
});
async function setup(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-collector-test-'));
  const key = secret();
  const app = createService({ dataDir: root, masterKey: key, ...overrides });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const server = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  const owner = { server, ...(await api({ server }, '/api/pair', 'POST', { key, name: 'owner' })) };
  async function pairWorker(name = 'worker') {
    const code = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
    const worker = { server, ...(await api({ server }, '/api/pair', 'POST', { key: code.key, name })) };
    await api(worker, '/api/heartbeat', 'POST', { capabilities: ['article'], agents: ['codex'], platform: process.platform });
    return worker;
  }
  const submit = (extra = {}) => api(owner, '/api/tasks', 'POST', { url: 'https://example.com/fixture', type: 'article', submissionId: crypto.randomUUID(), ...extra });
  return { app, root, owner, server, key, pairWorker, submit };
}

test('temporary review service refuses all access after its expiry', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-review-test-'));
  const app = createService({ dataDir: root, masterKey: secret(), reviewExpiresAt: new Date(Date.now() - 1000).toISOString() });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const server = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(server + '/healthz')).status, 200);
  assert.equal((await fetch(server + '/api/pair', { method: 'POST', body: '{}' })).status, 410);
});

test('installation identity retains the client ID, rotates credentials and revokes the whole client', async t => {
  const { owner, app } = await setup(t);
  const ownerInstallation = crypto.randomUUID();
  await api(owner, '/api/devices/me/info', 'POST', { installationId: ownerInstallation, platform: 'browser', system: 'Test browser' });
  assert.equal((await api(owner, '/api/state')).me.system, 'Test browser');
  await assert.rejects(api(owner, '/api/devices/me/info', 'POST', { installationId: crypto.randomUUID() }), { status: 409 });
  const installationId = crypto.randomUUID();
  const firstKey = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
  const first = await api(owner, '/api/pair', 'POST', { key: firstKey.key, name: '电脑 A', installationId, platform: 'win32', system: 'Windows test' });
  const secondKey = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
  const second = await api(owner, '/api/pair', 'POST', { key: secondKey.key, name: '电脑 A', installationId, platform: 'win32', system: 'Windows test' });
  assert.equal(first.device.id, second.device.id);
  await assert.rejects(api({ server: owner.server, token: first.token }, '/api/heartbeat', 'POST', { capabilities: [], agents: [] }), { status: 401 });
  const devices = (await api(owner, '/api/state')).devices;
  assert.equal(devices.filter(device => device.id === second.device.id).length, 1);
  assert.equal(devices.find(device => device.id === second.device.id).installationKey, undefined);
  assert.equal(devices.find(device => device.id === second.device.id).system, 'Windows test');
  await api(owner, `/api/devices/${second.device.id}/revoke`, 'POST', {});
  assert.equal(await app.store.get('device', second.device.id), null);
  assert.equal((await api(owner, '/api/state')).devices.some(device => device.id === second.device.id), false);
  await assert.rejects(api({ server: owner.server, token: second.token }, '/api/heartbeat', 'POST', { capabilities: [], agents: [] }), { status: 401 });
});

test('phone pairing QR is owner-only, short-lived, and consumes the existing one-time code', async t => {
  const { owner, server, app, pairWorker } = await setup(t, { publicUrl: 'https://library.example' });
  assert.equal((await fetch(server + '/api/pairings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'owner' }) })).status, 401);
  const code = await api(owner, '/api/pairings', 'POST', { role: 'owner' });
  assert.match(code.qrDataUrl, /^data:image\/png;base64,/);
  assert.ok(Date.parse(code.expiresAt) > Date.now() && Date.parse(code.expiresAt) <= Date.now() + 15 * 60000);
  const saved = await app.store.get('pairing', hash(code.key));
  assert.equal(saved.key, undefined); assert.equal(saved.qrDataUrl, undefined);
  const phone = await api({ server }, '/api/pair', 'POST', { name: 'QR phone', key: code.key });
  assert.equal(phone.device.role, 'owner');
  assert.equal((await fetch(server + '/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'duplicate', key: code.key }) })).status, 401);
  assert.equal((await api(owner, '/api/pairings', 'POST', { role: 'worker' })).qrDataUrl, null);
  const worker = await pairWorker('QR permission check');
  assert.equal((await fetch(server + '/api/pairings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${worker.token}` }, body: JSON.stringify({ role: 'owner' }) })).status, 403);
});

test('library browser reuses authenticated archives, protects cached files and rejects revoked cookies', async t => {
  const { owner, server, pairWorker, submit } = await setup(t);
  const worker = await pairWorker(); const task = await submit();
  await api(worker, '/api/claim', 'POST', {});
  await processTask({ ...worker, agents: profiles, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'browser-probe-')) }, task, await detectAgents(profiles));
  const state = await api(owner, '/api/state');
  const digest = state.archives[0].id;
  assert.equal((await fetch(server + '/library/data')).status, 401);
  const response = await fetch(server + '/api/library-session', { method: 'POST', headers: { Authorization: `Bearer ${owner.token}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie };
  const brand = await fetch(server + '/library/assets/brand-icon.png');
  assert.equal(brand.status, 200);
  assert.match(brand.headers.get('content-type'), /^image\/png/);
  assert.ok((await brand.arrayBuffer()).byteLength > 0);
  const index = await (await fetch(server + '/library/data', { headers })).json();
  assert.equal(index.entries[0].id, 'article:fixture');
  assert.ok(index.documents[`files/${digest}/summary.md`].includes('这是测试报告'));
  const fileURL = server + `/library/files/${digest}/original.txt`;
  assert.equal((await fetch(fileURL)).status, 401);
  assert.equal(await (await fetch(fileURL, { headers })).text(), 'This is synthetic test content.');
  assert.equal((await fetch(server + `/library/files/${digest}/cookies.txt`, { headers })).status, 404);
  assert.equal((await fetch(server + `/library/files/${digest}/..%2Fstate.sqlite`, { headers })).status, 404);
  assert.equal((await fetch(server + '/api/state', { headers })).status, 401);
  assert.equal((await fetch(server + '/api/library-session', { method: 'POST', headers })).status, 401);
  assert.equal((await fetch(server + `/library/bundle/${digest}`, { headers })).status, 200);
  await assert.rejects(api(worker, `/api/archives/${digest}`, 'DELETE'), { status: 403 });
  assert.equal((await fetch(server + `/api/archives/${digest}`, { method: 'DELETE', headers })).status, 401);
  await api(owner, `/api/archives/${digest}`, 'DELETE');
  assert.equal((await api(owner, '/api/state')).archives.length, 0);
  assert.equal((await api(owner, '/api/trash'))[0].id, 'article:fixture');
  assert.equal((await (await fetch(server + '/library/data', { headers })).json()).entries.length, 0);
  assert.equal((await fetch(fileURL, { headers })).status, 404);
  assert.equal((await fetch(server + `/library/bundle/${digest}`, { headers })).status, 404);
  await assert.rejects(api(owner, `/api/archives/${digest}`), { status: 404 });
  await api(owner, `/api/archives/${digest}/restore`, 'POST');
  assert.equal((await api(owner, '/api/trash')).length, 0);
  assert.equal((await fetch(fileURL, { headers })).status, 200);
  await api(owner, `/api/devices/${owner.device.id}/revoke`, 'POST', {});
  assert.equal((await fetch(fileURL, { headers })).status, 401);
  assert.equal((await fetch(server + '/library/data', { headers })).status, 401);
  await assert.rejects(api(owner, `/api/archives/${digest}`, 'DELETE'), { status: 401 });
});

test('manual review keeps drafts private until owner approval and routes to the selected worker', async t => {
  const { owner, pairWorker, submit, root, server } = await setup(t);
  const first = await pairWorker('first'); const second = await pairWorker('second');
  const task = await submit({ content: '分享内容', type: undefined, autoArchive: false, tags: ['界面'], deviceId: second.device.id });
  assert.equal(task.type, 'auto');
  assert.equal((await api(first, '/api/claim', 'POST', {})).task, null);
  assert.equal((await api(second, '/api/claim', 'POST', {})).task.id, task.id);
  await processTask({ ...second, agents: profiles, dataDir: path.join(root, 'worker') }, task, await detectAgents(profiles));
  let state = await api(owner, '/api/state');
  assert.equal(state.tasks[0].state, 'awaiting_review');
  assert.equal(state.archives.length, 0);
  const draft = await api(owner, `/api/tasks/${task.id}/draft`);
  assert.ok(draft.meta.tags.includes('界面'));
  const digest = state.tasks[0].draftId;
  await assert.rejects(api(owner, `/api/archives/${digest}`), { status: 404 });
  assert.equal((await (await fetch(server + '/library/data', { headers: { Authorization: `Bearer ${owner.token}` } })).json()).entries.length, 0);
  await assert.rejects(api(second, `/api/tasks/${task.id}/draft`), { status: 403 });
  await assert.rejects(api(second, `/api/tasks/${task.id}/approve`, 'POST', {}), { status: 403 });
  assert.equal((await api(second, '/api/claim', 'POST', {})).task, null);
  await api(second, `/api/tasks/${task.id}/result`, 'POST', draft);
  await api(owner, `/api/tasks/${task.id}/approve`, 'POST', {});
  await api(owner, `/api/tasks/${task.id}/approve`, 'POST', {});
  state = await api(owner, '/api/state');
  assert.equal(state.tasks[0].state, 'completed');
  assert.equal(state.archives.length, 1);
  assert.ok((await api(owner, `/api/archives/${digest}`)).meta.tags.includes('界面'));
  const cancelled = await submit({ autoArchive: false });
  await api(owner, `/api/tasks/${cancelled.id}/cancel`, 'POST', {});
  await assert.rejects(api(owner, `/api/tasks/${cancelled.id}/approve`, 'POST', {}), { status: 409 });
  await assert.rejects(submit({ autoArchive: 'false' }), { status: 400 });
  await assert.rejects(submit({ tags: [''] }), { status: 400 });
  await assert.rejects(submit({ deviceId: owner.device.id }), { status: 400 });
});

test('raw submissions preserve text, accept no URL, and keep idempotency', async t => {
  const { owner, submit, pairWorker } = await setup(t);
  const content = '  分享原文\n由 Agent 寻找和分析来源，不由系统提取链接。  ';
  const submissionId = crypto.randomUUID();
  const first = await submit({ content, submissionId });
  assert.equal(first.content, content);
  assert.equal(first.url, null);
  assert.equal((await submit({ content, submissionId })).id, first.id);
  await assert.rejects(submit({ content: content + '新要求', submissionId }), { status: 409 });
  for (const content of ['', '  ', 123, '文'.repeat(10001)]) await assert.rejects(submit({ content }), { status: 400 });
  const worker = await pairWorker();
  assert.equal((await api(worker, '/api/claim', 'POST', {})).task.content, content);
  assert.equal((await api(owner, '/api/state')).tasks[0].content, content);
});

test('one-use pairing, role isolation and immediate device revocation', async t => {
  const { owner, server, pairWorker } = await setup(t);
  await assert.rejects(api({ server }, '/api/state'), { status: 401 });
  const code = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
  await api({ server }, '/api/pair', 'POST', { key: code.key, name: 'first' });
  await assert.rejects(api({ server }, '/api/pair', 'POST', { key: code.key, name: 'second' }), { status: 401 });
  const worker = await pairWorker();
  await assert.rejects(api(worker, '/api/pairings', 'POST', { role: 'owner' }), { status: 403 });
  await assert.rejects(api(worker, '/api/state'), { status: 403 });
  const state = await api(owner, '/api/state');
  assert.ok(state.devices.every(d => !Object.hasOwn(d, 'tokenHash')));
  await api(owner, `/api/devices/${worker.device.id}/revoke`, 'POST', {});
  await assert.rejects(api(worker, '/api/claim', 'POST', {}), { status: 401 });
});

test('capabilities, idempotent submissions, single claimant and offline ownership', async t => {
  const { app, owner, pairWorker, submit } = await setup(t);
  const a = await pairWorker('a'); const b = await pairWorker('b');
  await submit({ type: 'video' });
  assert.equal((await api(a, '/api/claim', 'POST', {})).task, null);
  const task = await submit({ submissionId: 'stable' });
  assert.equal((await submit({ submissionId: 'stable' })).id, task.id);
  await assert.rejects(submit({ submissionId: 'stable', url: 'https://example.com/different' }), { status: 409 });
  const claims = await Promise.all([api(a, '/api/claim', 'POST', {}), api(b, '/api/claim', 'POST', {})]);
  assert.equal(claims.filter(x => x.task).length, 1);
  const winner = claims[0].task ? a : b; const loser = winner === a ? b : a;
  const record = app.store.get('device', winner.device.id);
  app.store.put('device', { ...record, lastSeen: '2000-01-01T00:00:00Z' });
  assert.equal((await api(loser, '/api/claim', 'POST', {})).task, null);
  assert.equal((await api(owner, '/api/state')).tasks.find(t => t.id === task.id).deviceId, winner.device.id);
  await assert.rejects(api(loser, `/api/tasks/${task.id}/progress`, 'POST', { state: 'running', message: 'wrong worker' }), { status: 403 });
});

async function assertWaitingQueue(t, overrides = {}) {
  const { owner, pairWorker, submit } = await setup(t, overrides);
  const worker = await pairWorker(); const other = await pairWorker('other'); const task = await submit();
  await api(worker, '/api/claim', 'POST', {});
  await api(worker, `/api/tasks/${task.id}/progress`, 'POST', { state: 'waiting_action', message: '请在本机登录' });
  const next = await submit();
  assert.equal((await api(worker, '/api/claim', 'POST', {})).task.id, next.id);
  await api(worker, `/api/tasks/${next.id}/progress`, 'POST', { state: 'running', message: '继续下一项' });
  const retried = await api(owner, `/api/tasks/${task.id}/retry`, 'POST', {});
  assert.equal(retried.state, 'queued');
  assert.equal(retried.deviceId, worker.device.id);
  assert.equal((await api(other, '/api/claim', 'POST', {})).task, null, 'other computers cannot take the retained workspace');
  assert.equal((await api(worker, '/api/claim', 'POST', {})).task.id, next.id, 'current work takes precedence over retry');
  await api(owner, `/api/tasks/${next.id}/cancel`, 'POST', {});
  assert.equal((await api(worker, '/api/claim', 'POST', {})).task.id, task.id);
  await api(owner, `/api/tasks/${task.id}/cancel`, 'POST', {});
  await assert.rejects(api(worker, `/api/tasks/${task.id}/progress`, 'POST', { state: 'running', message: 'late result' }), { status: 409 });
}
test('waiting tasks release the slot; retry queues behind current work on the original computer', assertWaitingQueue);
test('MySQL waiting tasks release the slot and retries retain original-computer ownership', { skip: !process.env.MYSQL_URL }, async t => {
  await assertWaitingQueue(t, { store: await mysqlFixture() });
});

test('Worker continues after a source obstacle and explicit retry reuses the retained workspace', async t => {
  const { owner, root, pairWorker, submit } = await setup(t);
  const worker = await pairWorker();
  const blocked = await submit({ agent: 'codex' });
  const dataDir = path.join(root, 'worker');
  const agents = { codex: { ...profiles.codex, args: [fixture, '--wait-once'] }, codebuddy: { ...profiles.codex, enabled: true } };
  const controller = new AbortController();
  const running = runWorker({ ...worker, dataDir, agents, capabilities: ['article'], pollMs: 1 }, { signal: controller.signal });
  try {
    let state;
    const blockedDeadline = Date.now() + 15000;
    do {
      state = await api(owner, '/api/state');
      if (state.tasks.find(task => task.id === blocked.id)?.state === 'waiting_action') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < blockedDeadline);
    assert.equal(state.tasks.find(task => task.id === blocked.id).state, 'waiting_action');
    // Establish the obstacle before enqueueing the next task; equal millisecond
    // timestamps do not imply a stable FIFO order across database engines.
    const next = await submit({ agent: 'codebuddy' });
    const deadline = Date.now() + 15000;
    do {
      state = await api(owner, '/api/state');
      if (state.tasks.find(task => task.id === next.id)?.state === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.equal(state.tasks.find(task => task.id === blocked.id).state, 'waiting_action');
    assert.equal(state.tasks.find(task => task.id === next.id).state, 'completed');
    assert.equal(state.tasks.find(task => task.id === blocked.id).deviceId, worker.device.id);
  } finally { controller.abort(); await running; }
  const workspace = path.join(dataDir, 'tasks', blocked.id, 'library');
  assert.equal(fs.readFileSync(path.join(workspace, 'retained-source.txt'), 'utf8'), 'source retained for explicit retry');
  await api(owner, `/api/tasks/${blocked.id}/retry`, 'POST', {});
  await runWorker({ ...worker, dataDir, agents, capabilities: ['article'] }, { once: true });
  assert.equal((await api(owner, '/api/state')).tasks.find(task => task.id === blocked.id).state, 'completed');
  assert.equal(fs.readFileSync(path.join(workspace, 'retained-source.txt'), 'utf8'), 'source retained for explicit retry');
  assert.ok(fs.readdirSync(workspace).some(name => /^collector-result\..+\.json$/.test(name)), 'the previous waiting checkpoint is retained');
});

test('noninteractive permission denial stops the agent without bypassing permissions', async () => {
  const event = { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'Error: Permission to use Write has been denied because this tool requires approval but permission prompts are not available in non-interactive mode.' }] }] } };
  const script = `console.log(${JSON.stringify(JSON.stringify(event))}); setTimeout(() => {}, 30000);`;
  const result = await execute(process.execPath, ['-e', script], { timeoutMs: 5000 });
  assert.equal(result.permissionBlocked, true);
  assert.equal(result.timedOut, false);
});

test('real child-process contract: assignment -> Agent -> validation -> light archive -> authenticated reading', async t => {
  const { owner, root, pairWorker, submit, server } = await setup(t);
  const content = '  【前端狂喜！超过7000个UI组件直接免费开源！-哔哩哔哩】 [https://b23.tv/Xrtm87o](https://b23.tv/Xrtm87o)\n分析一下这个视频的内容  ';
  const worker = await pairWorker(); const task = await submit({ content });
  assert.equal(task.content, content);
  assert.equal(task.url, null);
  await api(worker, '/api/claim', 'POST', {});
  const available = await detectAgents(profiles);
  assert.equal(available.codex.available, true);
  const agentProfiles = { codex: { ...profiles.codex, instructions: 'CODEX_PROFILE_INSTRUCTION' }, codebuddy: { ...profiles.codebuddy, instructions: 'OTHER_AGENT_INSTRUCTION' } };
  await processTask({ ...worker, agents: agentProfiles, instructions: 'COMMON_INSTRUCTION', dataDir: path.join(root, 'worker') }, task, available);
  const prompt = fs.readFileSync(path.join(root, 'worker', 'tasks', task.id, 'library', 'received-prompt.txt'), 'utf8');
  assert.ok(prompt.includes('COMMON_INSTRUCTION'));
  assert.ok(prompt.includes('CODEX_PROFILE_INSTRUCTION'));
  assert.ok(!prompt.includes('OTHER_AGENT_INSTRUCTION'));
  assert.ok(prompt.includes(JSON.stringify(content)));
  assert.ok(prompt.includes('这是资料采集归档任务'));
  assert.ok(prompt.includes('没有明确场景时使用通用模式'));
  assert.ok(prompt.includes('原生字幕要求登录或不存在时，先尝试匿名公开下载'));
  assert.ok(prompt.includes('不得绕过付费、登录或访问控制'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'worker', 'tasks', task.id, 'library', 'package.json'), 'utf8')).type, 'commonjs');
  const state = await api(owner, '/api/state');
  assert.equal(state.tasks[0].state, 'completed');
  assert.equal(state.archives.length, 1);
  const digest = state.archives[0].id;
  const bundle = await api(owner, '/api/archives/' + digest);
  assert.equal(bundle.meta.title, '自动化闭环测试资料');
  assert.deepEqual(bundle.files.map(f => f.path), ['summary.md', 'original.txt', 'cover.png']);
  assert.ok(!JSON.stringify(bundle).includes('excluded credential'));
  await assert.rejects(api({ server }, '/api/archives/' + digest), { status: 401 });
  await api(worker, `/api/tasks/${task.id}/result`, 'POST', bundle);
  assert.equal((await api(owner, '/api/state')).archives.length, 1, 'result retries must be idempotent');
  const downloaded = path.join(root, 'download');
  unpackArchive(bundle, downloaded);
  assert.ok(fs.existsSync(path.join(downloaded, 'summary.md')));
  assert.throws(() => unpackArchive(bundle, downloaded), /EEXIST/);
  const downloadedMeta = JSON.parse(fs.readFileSync(path.join(downloaded, 'source.json'), 'utf8'));
  downloadedMeta.files.find(file => file.path === 'original.txt').role = 'original';
  fs.writeFileSync(path.join(downloaded, 'source.json'), JSON.stringify(downloadedMeta));
  assert.equal(packageEntry(downloaded).files.find(file => file.path === 'original.txt').role, 'original');
  const broken = structuredClone(bundle); broken.files[0].body = Buffer.from('tampered').toString('base64');
  assert.throws(() => validateArchive(broken), /integrity/);
});

test('manual collection sync establishes a baseline, then uploads changes or explicit imports', async t => {
  const { owner, root, pairWorker, submit } = await setup(t);
  const worker = await pairWorker(); const task = await submit();
  await api(worker, '/api/claim', 'POST', {});
  const dataDir = path.join(root, 'worker');
  await processTask({ ...worker, agents: profiles, dataDir }, task, await detectAgents(profiles));
  const config = { ...worker, dataDir, watchLibrary: path.join(dataDir, 'tasks', task.id, 'library') };
  assert.equal((await syncLibrary(config)).uploaded, 0);
  assert.equal((await syncLibrary(config, { importExisting: true })).uploaded, 1);
  assert.equal((await syncLibrary(config)).uploaded, 0);
  assert.equal((await api(owner, '/api/state')).archives.length, 1);
});

test('routing preference and unsafe paths', () => {
  const available = { codex: { available: true }, codebuddy: { available: true } };
  const config = { defaultAgent: 'codex', fallbackAgents: ['codebuddy'], byType: { video: ['codebuddy'] } };
  assert.deepEqual(agentOrder(config, { type: 'video' }, available), ['codebuddy', 'codex']);
  assert.deepEqual(agentOrder(config, { type: 'video', preferredAgent: 'codex' }, available), ['codex']);
  assert.deepEqual(agentOrder(config, { type: 'video', agent: 'codex' }, {codebuddy:{available:true}}), []);
  assert.deepEqual(agentOrder(config, { type: 'article' }, { codex: { available: false }, codebuddy: { available: true } }), ['codebuddy']);
  for (const candidate of ['../escape', '/etc/passwd', 'C:/foo', 'a\\b', 'a/../b', 'NUL.txt', 'a./b']) assert.throws(() => safePath(candidate));
  const failure = { code: 1, tail: JSON.stringify({ type: 'turn.failed', error: { message: "The 'gpt-6-astra' model requires a newer version of Codex." } }) };
  assert.equal(unavailableBeforeWork(failure), true);
  assert.equal(unavailableBeforeWork({ ...failure, toolActivity: true }), false);
  assert.equal(unavailableBeforeWork({ code: 1, tail: 'unknown error' }), false);
});

test('SQLite persists assignments; invalid and revoked uploads are rejected', async t => {
  const { app, owner, root, pairWorker, submit } = await setup(t);
  const worker = await pairWorker(); const task = await submit();
  await api(worker, '/api/claim', 'POST', {});
  const { Store } = await import('../src/store.mjs');
  const second = new Store(path.join(root, 'state.sqlite'));
  assert.equal(second.get('task', task.id).deviceId, worker.device.id); second.close();
  // Invalid payloads are rejected before any object is stored.
  await assert.rejects(api(worker, `/api/tasks/${task.id}/result`, 'POST', { version: 1, meta: {}, files: [] }), { status: 400 });
  assert.equal(app.store.list('archive').length, 0);
  await api(owner, `/api/devices/${worker.device.id}/revoke`, 'POST', {});
  await assert.rejects(api(worker, `/api/tasks/${task.id}/result`, 'POST', {}), { status: 401 });
});

test('transient storage failure retries the completed checkpoint without running an Agent again', async t => {
  let attempts = 0;
  const objects = new Map();
  const storage = { async put(key, body) { if (++attempts === 1) throw new Error('simulated storage outage'); objects.set(key, body); }, async get(key) { return objects.get(key); } };
  const { owner, root, pairWorker, submit } = await setup(t, { storage });
  const worker = await pairWorker(); const task = await submit();
  await api(worker, '/api/claim', 'POST', {});
  const config = { ...worker, agents: profiles, dataDir: path.join(root, 'worker') };
  await assert.rejects(processTask(config, task, await detectAgents(profiles)), { status: 500 });
  assert.equal((await api(owner, '/api/state')).tasks[0].state, 'uploading');
  await processTask({ ...config, agents: { codex: { command: 'does-not-exist' } } }, task, {});
  assert.equal((await api(owner, '/api/state')).tasks[0].state, 'completed');
  assert.equal(attempts, 2);
});

test('revocation during upload blocks the final archive commit', async t => {
  let onPut;
  const storage = { async put() { await onPut(); }, async get() { throw new Error('not published'); } };
  const { owner, root, pairWorker, submit } = await setup(t, { storage });
  const worker = await pairWorker(); const task = await submit();
  await api(worker, '/api/claim', 'POST', {});
  onPut = () => api(owner, `/api/devices/${worker.device.id}/revoke`, 'POST', {});
  await assert.rejects(processTask({ ...worker, agents: profiles, dataDir: path.join(root, 'worker') }, task, await detectAgents(profiles)), { status: 401 });
  const state = await api(owner, '/api/state');
  assert.equal(state.archives.length, 0);
  assert.notEqual(state.tasks[0].state, 'completed');
});

test('invalid URLs are client errors, never accepted as task sources', async t => {
  const { submit } = await setup(t);
  for (const url of ['not-a-url', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.com']) await assert.rejects(submit({ url }), { status: 400 });
});
