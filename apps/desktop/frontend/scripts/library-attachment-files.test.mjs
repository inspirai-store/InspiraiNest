import {test} from 'node:test';import assert from 'node:assert/strict';
import {attachmentFiles} from '../../../../packages/core/web/library/data/attachment-files.ts';
const file=(path,role)=>({path,role,bytes:1,sha256:'hash'});
test('阅读标签已展示的摘要分析不重复放进附件，保留原文和图片',()=>{
 const files=[file('summary.md','summary'),file('analysis.md','analysis'),file('source.txt','original'),file('image.jpg','image')];
 assert.deepEqual(attachmentFiles(files).map(f=>f.path),['source.txt','image.jpg']);
});
test('额外摘要、场景分析和不可文本阅读的报告仍能在附件访问',()=>{
 const files=[file('summary.md','summary'),file('second.md','summary'),file('analysis.md','analysis'),file('scenario.md','scenario'),file('report.pdf','summary')];
 assert.deepEqual(attachmentFiles(files).map(f=>f.path),['second.md','scenario.md','report.pdf']);
});
test('只有已展示报告时附件为空',()=>assert.deepEqual(attachmentFiles([file('summary.md','summary')]),[]));
