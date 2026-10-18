import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OwnerClient} from '../../owner-client.mjs';
test('图片、PDF和媒体预览保留原件字节并返回明确MIME',async()=>{
 const client=Object.create(OwnerClient.prototype);
 const bytes=Buffer.from([0,1,2,255]);
 client.fileBytes=async input=>({bytes,name:input.file});
 for(const [file,mime] of [['image.png','image/png'],['paper.pdf','application/pdf'],['movie.mp4','video/mp4'],['voice.m4a','audio/mp4'],['note.md','text/plain']]){
  const result=await client.preview({id:'entry',file});
  assert.equal(result.dataUrl,`data:${mime};base64,${bytes.toString('base64')}`);
 }
});
test('HTML/SVG/可执行格式不扩展到预览通道，附件校验错误不吞掉',async()=>{
 const client=Object.create(OwnerClient.prototype);let calls=0;
 client.fileBytes=async()=>{calls++;throw Error('附件校验失败');};
 for(const file of ['page.html','image.svg','app.exe'])await assert.rejects(client.preview({file}),/暂无预览/);
 assert.equal(calls,0);
 await assert.rejects(client.preview({file:'paper.pdf'}),/附件校验失败/);
});
