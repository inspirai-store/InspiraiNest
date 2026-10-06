import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
if (process.argv.includes('--version')) { console.log('fixture-agent 1.0'); process.exit(); }
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
fs.writeFileSync('received-prompt.txt', prompt);
if (process.argv.includes('--wait-once')) {
  const marker = 'retained-source.txt';
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, 'source retained for explicit retry');
    fs.writeFileSync('collector-result.json', JSON.stringify({ status: 'waiting_action', category: 'source', message: '合成来源需要用户操作' }));
    process.exit();
  }
  if (fs.readFileSync(marker, 'utf8') !== 'source retained for explicit retry') throw new Error('Previous task workspace was not retained');
}
const meta = {
  schema_version: 1, id: 'article:fixture', title: '自动化闭环测试资料', type: 'article', platform: 'fixture',
  source_url: 'https://example.com/fixture', canonical_url: null, aliases: [], creator: null,
  published_at: null, collected_at: new Date().toISOString(), organized_at: new Date().toISOString().slice(0, 10),
  mode: 'general', scenario: null, tags: ['测试'], summary: '验证离线采集任务的派发、归档与上传。',
  status: 'archived', verification_status: 'source_only', verified_at: null,
  coverage_note: '这是自动化测试构造的资料，不是真实采集。', related: [],
  files: [{ path: 'summary.md', role: 'summary' }, { path: 'original.txt', role: 'source' }, { path: 'video.mp4', role: 'media' }, { path: 'cookies.txt', role: 'source' }],
};
const dir = path.join('articles', 'fixture');
meta.files.push({ path: 'cover.png', role: 'image' });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify(meta));
fs.writeFileSync(path.join(dir, 'summary.md'), '# 自动化闭环测试资料\n\n这是测试报告。资料经校验后上传，原始视频与登录凭据不上传。');
fs.writeFileSync(path.join(dir, 'original.txt'), 'This is synthetic test content.');
fs.writeFileSync(path.join(dir, 'video.mp4'), 'excluded media');
fs.writeFileSync(path.join(dir, 'cookies.txt'), 'excluded credential');
fs.writeFileSync(path.join(dir, 'cover.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
execFileSync(process.execPath, ['scripts/catalog.mjs', 'build']);
fs.writeFileSync('collector-result.json', JSON.stringify({ status: 'ready', entry: 'articles/fixture' }));
console.log(JSON.stringify({ type: 'result', result: 'fixture completed' }));
