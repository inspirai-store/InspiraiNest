import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../android/app/src/main/assets/mobile-next');
const digest = 'a'.repeat(64);
const entries = Array.from({ length: 10 }, (_, index) => ({
  id: `article:demo-${index}`, archiveId: digest, title: index ? `阅读记录 ${index}` : '把看到的和想到的放在同一个地方',
  type: index === 1 ? 'video' : 'article', status: 'archived',
  summary: '一段完整的资料摘要，保留足够多的正文信息，便于在列表中快速判断是否值得打开。',
  tags: ['设计', '阅读'], collected_at: `2026-09-${String(20 - index).padStart(2, '0')}T10:00:00+08:00`,
  thumbnail: null, files: [{ path: `files/${digest}/summary.md`, name: '摘要', role: 'summary', bytes: 50 }],
}));
const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'");
  if (req.url === '/library/data') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ entries, documents: { [`files/${digest}/summary.md`]: '# 摘要\n\n可阅读的正文。' } }));
    return;
  }
  const relative = req.url?.replace(/^\/library\/mobile-next\//, '');
  if (!relative || relative.includes('..') || !['index.html', 'mobile.js', 'mobile.css', 'brand.png', 'vendor/marked.js', 'vendor/purify.js'].includes(relative)) {
    res.writeHead(404).end(); return;
  }
  res.setHeader('Content-Type', relative.endsWith('.html') ? 'text/html' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.png') ? 'image/png' : 'text/javascript');
  res.end(fs.readFileSync(path.join(root, relative)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/library/mobile-next/index.html`);
  await page.getByRole('heading', { name: '资料库' }).waitFor();
  assert.match(await page.locator('meta[name="viewport"]').getAttribute('content'), /maximum-scale=1, user-scalable=no/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction), 'pan-x pan-y');
  assert.equal(await page.locator('.entry-card').count(), 10);
  assert.deepEqual(await page.locator('.entry-tags').first().locator('span').allInnerTexts(), ['#设计', '#阅读']);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  assert.equal(await page.locator('.library-header').evaluate(element => Math.round(element.getBoundingClientRect().top)), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/lingnest-mobile-ui-list.png' });
  await page.getByRole('combobox', { name: '筛选资料类型' }).click();
  await page.getByRole('option', { name: '视频' }).click();
  assert.equal(await page.locator('.entry-card').count(), 1);
  await page.getByRole('combobox', { name: '筛选资料类型' }).click();
  await page.getByRole('option', { name: '全部' }).click();
  await page.locator('.entry-card').first().click();
  await page.getByText('可阅读的正文。').waitFor();
  assert.match(await page.locator('.attachments a').first().getAttribute('href'), /^nook:\/\/attachment\?/);
  entries[0].tags = ['已修复', '阅读'];
  await page.getByRole('button', { name: '返回资料库' }).click();
  await page.locator('.entry-tags').first().getByText('#已修复').waitFor();
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/lingnest-mobile-ui-reader.png' });
  console.log('Mobile UI: list, tags, sticky header, filter, reader and attachment route passed at 375px.');
} finally {
  await browser?.close();
  server.close();
}
