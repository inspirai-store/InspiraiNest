import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicationImages} from '../src/writing-images.mjs';
const bundle=(body,images=[])=>({files:[{path:'article.md',role:'publication',body:Buffer.from(body).toString('base64')},...images.map(name=>({path:name,role:'image',bytes:1}))]});
test('a generated SVG removed by the archive policy cannot silently become a successful illustrated article',()=>{
 assert.throws(()=>validatePublicationImages(bundle('![流程](images/flow.svg)')),/配图未进入/);
 assert.throws(()=>validatePublicationImages(bundle('![流程](images/flow.png)')),/配图未进入/);
 assert.doesNotThrow(()=>validatePublicationImages(bundle('![流程](images/flow.png)',['images/flow.png'])));
});
test('illustration checks handle encoded names, parentheses, image references and code examples',()=>{
 const body='![图](<images/流程 图.png> "图注")\n![图](images/flow(1).png)\n![引用][流程]\n[流程]: images/a%20b.png\n\n```md\n![示例](missing.svg)\n```\n\n`![示例](absent.png)`';
 assert.doesNotThrow(()=>validatePublicationImages(bundle(body,['images/流程 图.png','images/flow(1).png','images/a b.png'])));
 assert.throws(()=>validatePublicationImages(bundle('![未定义][x]')),/未定义/);
 assert.throws(()=>validatePublicationImages(bundle('![外链](https://example.com/image.png)')),/本地文件/);
 assert.throws(()=>validatePublicationImages(bundle('![越界](../secret.png)')));
});
