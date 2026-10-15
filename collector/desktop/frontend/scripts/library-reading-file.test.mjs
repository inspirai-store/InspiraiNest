import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingFile } from '../src/library/data/reading-file.ts';
const file = (role, path = role + '.md') => ({ role, path, bytes: 10, sha256: null });
test('写作正文独立阅读，旧条目原文与摘要仍各自对应', () => {
  const files=[file('summary'),file('source'),file('publication')];
  assert.equal(readingFile(files,'正文').role,'publication');
  assert.equal(readingFile(files,'原文').role,'source');
  assert.equal(readingFile(files,'摘要').role,'summary');
  assert.equal(readingFile([file('summary')],'正文'),undefined);
});
test('旧文章 source/source_excerpt/source_snapshot 能进入原文', () => {
  for (const role of ['source','source_excerpt','source_snapshot','original']) assert.equal(readingFile([file('summary'),file(role)],'原文').role,role);
});
test('视频转录可阅读，有文章原文时不以转录替换原文', () => {
  assert.equal(readingFile([file('transcript_raw','raw.srt')],'原文').role,'transcript_raw');
  assert.equal(readingFile([file('transcript'),file('source')],'原文').role,'source');
});
test('场景分析和文件顺序保留，PDF不走文本接口', () => {
  const first=file('analysis');
  assert.equal(readingFile([first,file('scenario')],'分析'),first);
  assert.equal(readingFile([file('scenario')],'分析').role,'scenario');
  assert.equal(readingFile([file('source','source.pdf')],'原文'),undefined);
});
test('附件标签不复用原文查询文件或误读摘要', () => {
  assert.equal(readingFile([file('original'),file('summary')],'附件'),undefined);
  assert.equal(readingFile([file('analysis')],'摘要'),undefined);
});
