import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { api, runWorker } from '../src/worker.mjs';
import { createWorkerEvents, readWorkerEvents } from '../src/worker-events.mjs';
import { createWorkerControl } from '../src/worker-control.mjs';
import { createService } from '../src/server.mjs';
import { watchCollectionSteps } from '../src/collection-steps.mjs';
import { describeAgentFailure } from '../src/agents.mjs';

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'worker-events-'));

test('unsupported CLI models are identified as environment problems rather than source failures', () => {
  const diagnostic = describeAgentFailure('codex', { code: 1, tail: JSON.stringify({ type: 'turn.failed', error: { message: JSON.stringify({ error: { message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." } }) } }) });
  assert.equal(diagnostic.code, 'AGENT_MODEL'); assert.match(diagnostic.message, /模型不可用/);
  assert.match(diagnostic.details.error, /not supported/);
});

test('remote errors preserve HTTP context, distinguish malformed success and never capture response bodies', async t => {
  let status = 503, type = 'text/html', body = '<html>private server diagnostic</html>';
  const server = http.createServer((_req, res) => { res.writeHead(status, { 'content-type': type }); res.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = { server: `http://127.0.0.1:${server.address().port}` };
  await assert.rejects(api(config, '/api/claim', 'POST', {}), error => {
    assert.equal(error.code, 'REMOTE_HTTP'); assert.equal(error.status, 503);
    assert.equal(error.route, '/api/claim'); assert.equal(error.contentType, 'text/html');
    assert.ok(!error.message.includes('private')); return true;
  });
  status = 200;
  await assert.rejects(api(config, '/api/claim'), { code: 'REMOTE_FORMAT', status: 200 });
  status = 401; type = 'application/json'; body = JSON.stringify({ error: 'Invalid or expired device token' });
  await assert.rejects(api(config, '/api/heartbeat'), { code: 'AUTH', status: 401 });
  status = 200; body = 'null';
  await assert.rejects(api(config, '/api/heartbeat'), { code: 'REMOTE_FORMAT' });
});

test('journal separates business and system, coalesces repeats, records recovery, redacts and sorts newest first', () => {
  const root = temporary(); let now = Date.UTC(2026, 9, 3);
  const journal = createWorkerEvents(root, { token: 'private-token', runId: 'run-one', now: () => now });
  journal.event({ taskId: 'task-one', code: 'TASK_RUNNING', message: '正在采集' });
  now += 1000;
  for (let n = 0; n < 12; n++) journal.fault('status', { code: 'EPERM', message: '状态保存受阻', details: { message: 'Bearer private-token password=abc secret=def', url: 'https://example.test/?share_token=hidden&ok=1' } });
  let result = readWorkerEvents(root, { runId: 'run-one' });
  assert.equal(result.events.length, 2); assert.equal(result.activeIssues, 1);
  assert.equal(result.events[0].domain, 'system');
  now += 1000; journal.recover('status', '状态保存已恢复');
  result = readWorkerEvents(root, { runId: 'run-one' });
  assert.equal(result.events.length, 2); assert.equal(result.activeIssues, 0);
  assert.equal(result.events[0].status, 'resolved'); assert.equal(result.events[0].count, 12);
  assert.ok(!JSON.stringify(result).includes('private-token') && !JSON.stringify(result).includes('password=abc'));
  assert.ok(!JSON.stringify(result).includes('share_token=hidden'));
  assert.equal(result.events[0].firstAt, new Date(Date.UTC(2026, 9, 3) + 1000).toISOString());
  assert.equal(result.events[0].resolvedAt, new Date(now).toISOString());
  journal.fault('new-fault', { code: 'NETWORK', message: '断线' });
  assert.equal(readWorkerEvents(root, { runId: 'different-run' }).activeIssues, 0);
  assert.throws(() => readWorkerEvents(root, { taskId: '../anything' }), /任务编号无效/);
});

test('journal rotates with bounded retention, tolerates partial lines and keeps unfiltered system context on task views', () => {
  const root = temporary(); let now = Date.UTC(2026, 9, 3);
  const journal = createWorkerEvents(root, { maxBytes: 700, now: () => now++ });
  for (let n = 0; n < 30; n++) journal.event({ taskId: n % 2 ? 'task-one' : 'task-two', code: 'STEP', message: '阶段'.repeat(40) });
  journal.fault('global', { code: 'NETWORK', message: '服务连接失败' });
  fs.appendFileSync(path.join(root, 'worker-events.jsonl'), '{broken');
  assert.equal(fs.readdirSync(root).filter(name => name.startsWith('worker-events.jsonl')).length, 3);
  const result = readWorkerEvents(root, { taskId: 'task-one' });
  assert.ok(result.events.length > 0 && result.events.length < 30);
  assert.ok(result.events.every(event => event.taskId === 'task-one' || event.domain === 'system'));
  for (let n = 1; n < result.events.length; n++) assert.ok(Date.parse(result.events[n - 1].at) >= Date.parse(result.events[n].at));
});

test('failure to save event logs cannot abort collection', () => {
  const root = temporary(); const journal = createWorkerEvents(root);
  const append = fs.appendFileSync; const error = console.error; const notices = [];
  try {
    console.error = message => notices.push(message);
    fs.appendFileSync = () => { throw Object.assign(new Error('test full disk'), { code: 'ENOSPC' }); };
    assert.doesNotThrow(() => { journal.event({ message: '执行中' }); journal.event({ message: '校验中' }); });
    assert.equal(notices.length, 1);
    fs.appendFileSync = append; journal.event({ message: '记录已恢复' });
    assert.equal(readWorkerEvents(root).events.length, 1);
  } finally { fs.appendFileSync = append; console.error = error; }
});

test('transient Windows sharing violation retries without removing the complete snapshot and reports stable recovery', async () => {
  const root = temporary(); const diagnostic = [];
  const control = createWorkerControl(root, { onDiagnostic: event => diagnostic.push(event) });
  const rename = fs.renameSync; let denied = true;
  try {
    fs.renameSync = (from, to) => {
      if (denied && to === path.join(root, 'worker-status.json')) { denied = false; throw Object.assign(new Error('sharing violation'), { code: 'EPERM' }); }
      return rename(from, to);
    };
    control.update({ phase: 'working' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'worker-status.json'))).phase, 'starting');
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'worker-status.json'))).phase, 'working');
    control.update({}); control.update({});
    assert.equal(diagnostic.filter(item => item.error).length, 1);
    assert.equal(diagnostic.filter(item => item.recovered).length, 1);
    assert.equal(fs.readdirSync(root).filter(name => name.endsWith('.tmp')).length, 0);
  } finally { fs.renameSync = rename; control.close(); }
});

test('explicit Agent progress skips previous output, handles partial lines and rejects unknown stages', () => {
  const root = temporary(); const file = path.join(root, 'collector-events.jsonl');
  fs.writeFileSync(file, '{"stage":"fetching","message":"上次运行"}\n');
  const events = []; const stop = watchCollectionSteps(root, event => events.push(event));
  fs.appendFileSync(file, '{"stage":"fetching","message":"正在获取正文"}\n{"stage":"transcribing","message":"已取得');
  fs.appendFileSync(file, '字幕"}\n{"stage":"invented","message":"不能当成已发生的动作"}\n');
  stop();
  assert.deepEqual(events.map(event => event.message), ['正在获取正文', '已取得字幕']);
});

test('task issues survive restarts, recover on completion and retain damaged progress only in details', () => {
  const root = temporary(); let now = Date.UTC(2026, 9, 8);
  const first = createWorkerEvents(root, { runId: 'first', now: () => now++ });
  first.event({ taskId: 'task-encoding', stage: 'archiving', message: '???? source.json ?????' });
  first.fault('task:task-encoding:ARCHIVE_ENCODING', { taskId: 'task-encoding', code: 'ARCHIVE_ENCODING', message: '摘要存在乱码' });
  let result = readWorkerEvents(root, { taskId: 'task-encoding', runId: 'second' });
  assert.equal(result.activeIssues, 1);
  assert.match(result.events.find(e => e.domain === 'collection').message, /历史记录存在文字编码问题/);
  assert.equal(result.events.find(e => e.domain === 'collection').details.originalMessage, '???? source.json ?????');
  const second = createWorkerEvents(root, { runId: 'second', now: () => now++ });
  second.fault('task:task-encoding:ARCHIVE_ENCODING', { taskId: 'task-encoding', code: 'ARCHIVE_ENCODING', message: '摘要仍存在乱码' });
  assert.equal(readWorkerEvents(root, { runId: 'second' }).activeIssues, 1);
  second.recover('task:task-encoding:ARCHIVE_ENCODING', '资料修复并上传成功');
  result = readWorkerEvents(root, { taskId: 'task-encoding', runId: 'second' });
  assert.equal(result.activeIssues, 0);
  assert.equal(result.events.find(e => e.domain === 'system').status, 'resolved');
  assert.equal(result.events.find(e => e.domain === 'system').count, 2);
});

test('UTF-8 BOM progress is accepted and corrupted messages produce a separate system diagnostic', () => {
  const root = temporary(), events = [], errors = [];
  const stop = watchCollectionSteps(root, event => events.push(event), error => errors.push(error));
  fs.writeFileSync(path.join(root, 'collector-events.jsonl'), '\uFEFF' + JSON.stringify({ stage: 'fetching', message: '已取得来源' }) + '\n'
    + JSON.stringify({ stage: 'archiving', message: '???? ready ??????' }) + '\n');
  stop();
  assert.equal(events[0].message, '已取得来源');
  assert.match(events[1].message, /文字编码异常/);
  assert.equal(errors[0].code, 'STEP_ENCODING');
});

test('source obstacles remain business events while local environment errors are separate system issues', async t => {
  for (const category of ['source', 'environment']) {
    const root = temporary(); const key = crypto.randomUUID();
    const service = createService({ dataDir: path.join(root, 'server'), masterKey: key });
    await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
    t.after(() => service.close());
    const server = `http://127.0.0.1:${service.server.address().port}`;
    const owner = { server, ...await api({ server }, '/api/pair', 'POST', { key, name: 'log-fixture-owner' }) };
    const pairing = await api(owner, '/api/pairings', 'POST', { role: 'worker' });
    const worker = { server, ...await api({ server }, '/api/pair', 'POST', { key: pairing.key, name: 'log-fixture-worker' }) };
    const task = await api(owner, '/api/tasks', 'POST', { content: '隔离日志测试', submissionId: crypto.randomUUID() });
    const script = path.join(root, 'agent.mjs');
    fs.writeFileSync(script, `import fs from 'node:fs'; if(process.argv.includes('--version')){console.log('fixture 1');process.exit()} for await (const _ of process.stdin){} fs.writeFileSync('collector-events.jsonl',JSON.stringify({stage:'fetching',message:'已尝试公开获取正文'})+'\\n'); fs.writeFileSync('collector-result.json',JSON.stringify({status:'waiting_action',category:'${category}',message:'${category === 'source' ? '来源需要用户登录授权' : '本机工具配置缺失'}'}));`);
    const config = { ...worker, dataDir: path.join(root, 'worker'), capabilities: ['article'], agents: { codex: { command: process.execPath, args: [script], versionArgs: [script, '--version'] }, codebuddy: { enabled: false } } };
    await runWorker(config, { once: true });
    const events = readWorkerEvents(config.dataDir, { taskId: task.id }).events;
    assert.ok(events.some(event => event.stage === 'fetching' && event.message === '已尝试公开获取正文'));
    assert.equal(events.some(event => event.domain === 'system' && event.code === 'AGENT_ENVIRONMENT'), category === 'environment');
    assert.ok(events.some(event => event.domain === 'collection' && event.stage === 'waiting_action'));
    assert.equal((await api(owner, '/api/state')).tasks.find(item => item.id === task.id).state, 'waiting_action');
  }
});
