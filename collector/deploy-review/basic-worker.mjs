import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicJson, hash, sourceURL } from '../src/common.mjs';
import { validateArchive, requireReadableMetadata } from '../src/archive.mjs';

const server = process.env.COLLECTOR_REVIEW_SERVER || 'http://127.0.0.1:4317';
const dataDir = process.env.COLLECTOR_REVIEW_WORKER_DATA || '/data/review-basic-worker';
const credentialFile = path.join(dataDir, 'credential.json');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(route, method = 'GET', token, body) {
  const response = await fetch(`${server}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(`${route}: ${result.error || 'request failed'}`), { status: response.status });
  return result;
}

function attachment(filePath, role, content) {
  const bytes = Buffer.from(content);
  return { path: filePath, role, bytes: bytes.length, sha256: hash(bytes), body: bytes.toString('base64') };
}

export function buildBasicBundle(task, at = new Date()) {
  const raw = String(task.content || task.url || '').trim();
  if (!raw || raw.length > 10000) throw new Error('No share text to archive');
  const link = task.url || raw.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.，。；;）]+$/, '') || null;
  const url = link ? sourceURL(link) : null;
  const prose = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .filter(line => line !== link);
  const title = (prose[0] || (url ? url.hostname : '文字摘录')).replace(/[\u0000-\u001f]/g, ' ').slice(0, 100);
  const hasBody = prose.join('').length >= 80;
  const summary = hasBody
    ? prose.join(' ').slice(0, 180)
    : url ? `已保存来自 ${url.hostname} 的分享链接和随附文字。` : `已保存分享的文字：${raw.slice(0, 160)}`;
  const original = `# ${title}\n\n${raw}\n`;
  const report = `# ${title}\n\n${summary}\n\n${url ? `来源链接：${url.href}\n\n` : ''}原始分享内容见 original.md。\n`;
  const files = [attachment('original.md', 'original', original), attachment('summary.md', 'summary', report)];
  const meta = {
    schema_version: 1,
    id: `mobile-share:${task.id}`,
    title,
    type: url ? 'webpage' : 'note',
    platform: url ? url.hostname : '手机分享',
    source_url: url?.href || null,
    canonical_url: null,
    aliases: [],
    creator: null,
    published_at: null,
    collected_at: at.toISOString(),
    organized_at: at.toISOString().slice(0, 10),
    mode: task.scenario ? 'scenario' : 'general',
    scenario: task.scenario || null,
    tags: url ? ['网页收藏'] : ['文字摘录'],
    summary,
    status: url && !hasBody ? 'partial' : 'archived',
    verification_status: 'source_only',
    verified_at: null,
    coverage_note: url ? '完整保存了分享时收到的文字和链接；未获取链接目标的网页正文。' : '完整保存了分享时收到的文字。',
    files: files.map(({ path: filePath, role }) => ({ path: filePath, role })),
    related: [],
  };
  requireReadableMetadata(meta);
  return validateArchive({ version: 1, meta, files, omitted: [] });
}

async function credential() {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(credentialFile)) return JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
  const master = process.env.COLLECTOR_MASTER_KEY;
  if (!master) throw new Error('Review master key is missing');
  const owner = await request('/api/pair', 'POST', null, { key: master, name: '审核处理器配对' });
  try {
    const pairing = await request('/api/pairings', 'POST', owner.token, { role: 'worker' });
    const worker = await request('/api/pair', 'POST', null, {
      key: pairing.key,
      name: '基础归档处理器',
      installationId: randomUUID(),
      platform: 'linux',
      system: '独立审核服务',
    });
    const result = { token: worker.token, deviceId: worker.device.id };
    atomicJson(credentialFile, result);
    return result;
  } finally {
    await request(`/api/devices/${owner.device.id}/revoke`, 'POST', owner.token, {}).catch(() => {});
  }
}

export async function runBasicWorker({ once = false } = {}) {
  const { token } = await credential();
  let reportedReady = false;
  do {
    try {
      await request('/api/heartbeat', 'POST', token, {
        capabilities: ['article', 'webpage', 'note', 'document', 'other'],
        agents: ['basic'],
        platform: 'linux',
        system: '独立审核服务',
      });
      if (!reportedReady) { console.log('Basic archive worker is ready.'); reportedReady = true; }
      const { task } = await request('/api/claim', 'POST', token, {});
      if (task) {
        try {
          await request(`/api/tasks/${task.id}/progress`, 'POST', token, { state: 'running', agent: 'basic', message: '正在保存分享内容' });
          const bundle = buildBasicBundle(task);
          await request(`/api/tasks/${task.id}/result`, 'POST', token, bundle);
          console.log(`Archived task ${task.id}`);
        } catch (error) {
          console.error(`Task ${task.id} needs attention: ${error.message}`);
          await request(`/api/tasks/${task.id}/progress`, 'POST', token, { state: 'waiting_action', agent: 'basic', message: '分享内容未能归档，请检查原始文字或链接。' }).catch(() => {});
        }
      }
    } catch (error) {
      if ([401, 403, 410].includes(error.status)) throw error;
      console.error(`Review worker connection: ${error.message}`);
    }
    if (!once) await pause(5000);
  } while (!once);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBasicWorker().catch(error => { console.error(error.message); process.exitCode = 1; });
}
