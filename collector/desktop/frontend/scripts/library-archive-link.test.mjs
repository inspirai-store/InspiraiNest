import test from 'node:test';import assert from 'node:assert/strict';import {resolveArchiveLink} from '../src/library/data/archive-link.ts';
const files=['images/引用 图片.png','notes/next.md','paper.pdf'].map(path=>({path,role:'attachment',bytes:1,sha256:null}));
test('正文目录、父级相对路径、编码中文、fragment 与 query 对应已登记附件',()=>{
 assert.equal(resolveArchiveLink('../images/引用%20图片.png#caption','notes/summary.md',files)?.path,files[0].path);
 assert.equal(resolveArchiveLink('./next.md?view=reader','notes/summary.md',files)?.path,'notes/next.md');assert.equal(resolveArchiveLink('paper.pdf','summary.md',files)?.path,'paper.pdf');
});
test('路径越界、file/脚本 URL、未登记路径和无效转义不可使用附件权限',()=>{
 for(const href of ['../paper.pdf','../../paper.pdf','file:///paper.pdf','javascript:alert(1)','//host/paper.pdf','/paper.pdf','missing.pdf','%zz','notes\\next.md','%00paper.pdf','#heading'])assert.equal(resolveArchiveLink(href,'summary.md',files),null,href);
});
