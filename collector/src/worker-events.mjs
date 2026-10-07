import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { redact } from './worker-control.mjs';
import { unreadableText, collectionStageNames } from './text-encoding.mjs';

const filename = 'worker-events.jsonl';
const maxRead = 512 * 1024;
const safe = (value, token) => JSON.parse(redact(JSON.stringify(value), token));

// Only pipeline boundaries enter this journal. Agent stdout remains a separate,
// bounded diagnostic file; it is never interpreted as collection progress.
export function createWorkerEvents(dataDir, { token, runId = randomUUID(), maxBytes = 2 * 1024 * 1024, now = () => Date.now() } = {}) {
  const target = path.join(dataDir, filename);
  const issues = new Map();
  let writeFailed = false;
  fs.mkdirSync(dataDir, { recursive: true });
  // Task failures survive a process restart; a restart alone is not recovery.
  for (const entry of readWorkerEvents(dataDir, { token, runId }).events) {
    if (entry.domain === 'system' && entry.taskId && entry.issueKey && entry.status === 'active') issues.set(entry.issueKey, entry);
  }
  const write = event => {
    const line = JSON.stringify(safe({ version: 1, id: randomUUID(), at: new Date(now()).toISOString(), runId, ...event }, token)) + '\n';
    try {
      if (fs.existsSync(target) && fs.statSync(target).size + Buffer.byteLength(line) > maxBytes) {
        if (fs.existsSync(target + '.2')) fs.unlinkSync(target + '.2');
        if (fs.existsSync(target + '.1')) fs.renameSync(target + '.1', target + '.2');
        fs.renameSync(target, target + '.1');
      }
      fs.appendFileSync(target, line, { mode: 0o600 });
      writeFailed = false;
    } catch (error) {
      // A full disk must not abort the Agent or recursively log its own failure.
      if (!writeFailed) console.error(`[${new Date(now()).toISOString()}] 系统日志保存失败（${error.code || error.name}）；采集继续，下一次事件重试。`);
      writeFailed = true;
    }
  };
  const event = entry => write({ domain: 'collection', level: 'info', ...entry });
  const fault = (key, entry) => {
    const time = new Date(now()).toISOString();
    const previous = issues.get(key);
    const issue = { ...previous, ...entry, id: previous?.id || randomUUID(), issueKey: key,
      runId, domain: 'system', level: entry.level || 'error', status: 'active', at: time,
      firstAt: previous?.firstAt || time, lastAt: time, count: (previous?.count || 0) + 1 };
    issues.set(key, issue);
    if (!previous || now() - (previous.writtenAt || 0) >= 30000) {
      issue.writtenAt = now(); write(issue);
    }
  };
  const recover = (key, message) => {
    const issue = issues.get(key);
    if (!issue) return;
    const at = new Date(now()).toISOString();
    write({ ...issue, runId, at, status: 'resolved', level: 'info', message, resolvedAt: at });
    issues.delete(key);
  };
  const flush = () => {
    for (const issue of issues.values()) write(issue);
  };
  return { runId, event, fault, recover, flush };
}

export function errorDetails(error) {
  // No request bodies, response bodies, environment variables or pairing codes.
  const result = {};
  for (const key of ['name', 'code', 'message', 'stack', 'route', 'method', 'status', 'contentType']) {
    if (error?.[key] !== undefined) result[key] = String(error[key]).slice(0, key === 'stack' ? 4000 : 1000);
  }
  if (error?.cause?.code) result.causeCode = String(error.cause.code).slice(0, 100);
  return result;
}

export function readWorkerEvents(dataDir, { token, taskId, runId } = {}) {
  if (taskId !== undefined && taskId !== null && (typeof taskId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(taskId))) throw new Error('任务编号无效');
  const records = new Map();
  let truncated = false;
  for (const suffix of ['.2', '.1', '']) {
    const file = path.join(dataDir, filename + suffix);
    if (!fs.existsSync(file)) continue;
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('日志路径无效');
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const offset = Math.max(0, size - maxRead);
      const buffer = Buffer.alloc(Math.min(size, maxRead));
      const length = fs.readSync(fd, buffer, 0, buffer.length, offset);
      let lines = buffer.subarray(0, length).toString('utf8').split('\n');
      if (offset) { lines.shift(); truncated = true; }
      for (const line of lines) {
        try {
          const entry = JSON.parse(redact(line, token));
          if (entry.version !== 1 || !entry.id || !Number.isFinite(Date.parse(entry.at)) || !['collection', 'system'].includes(entry.domain)) continue;
          if (!taskId || entry.taskId === taskId || (entry.domain === 'system' && !entry.taskId)) records.set(entry.id, entry);
        } catch { /* Incomplete append or old corrupt line; retain other records. */ }
      }
    } finally { fs.closeSync(fd); }
  }
  const latestTaskIssues = new Map();
  const completed = new Map();
  for (const entry of records.values()) {
    if (entry.domain === 'system' && entry.taskId && entry.issueKey) {
      const previous = latestTaskIssues.get(entry.issueKey);
      if (!previous || Date.parse(entry.at) >= Date.parse(previous.at)) latestTaskIssues.set(entry.issueKey, entry);
    }
    if (entry.domain === 'collection' && entry.taskId && ['completed', 'awaiting_review'].includes(entry.stage)) {
      completed.set(entry.taskId, Math.max(completed.get(entry.taskId) || 0, Date.parse(entry.at)));
    }
  }
  const sorted = [...records.values()].filter(entry => !entry.taskId || !entry.issueKey || entry.domain !== 'system' || latestTaskIssues.get(entry.issueKey) === entry)
    .map(entry => {
      if (entry.domain === 'system' && entry.taskId && entry.status === 'active' && (completed.get(entry.taskId) || 0) >= Date.parse(entry.at)) {
        entry = { ...entry, status: 'resolved', level: 'info', resolvedAt: new Date(completed.get(entry.taskId)).toISOString() };
      }
      if (entry.domain === 'collection' && unreadableText(entry.message)) entry = { ...entry,
        message: `${collectionStageNames[entry.stage] || '采集过程'}的历史记录存在文字编码问题，请查看详情`,
        details: { ...entry.details, originalMessage: entry.message, note: '这是采集程序写入时已损坏的历史文字；原始日志保留本机，修复后的过程以新记录为准' } };
      return entry;
    }).reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const events = sorted.slice(0, 300).map(entry => ({ ...entry, currentRun: entry.runId === runId }));
  return { events, activeIssues: sorted.filter(entry => entry.domain === 'system' && entry.status === 'active' && (entry.runId === runId || entry.taskId)).length,
    truncated: truncated || sorted.length > 300, legacyAvailable: ['worker.stderr.log', 'worker.stdout.log'].some(name => fs.existsSync(path.join(dataDir, name))) };
}
