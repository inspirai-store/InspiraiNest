import test from 'node:test';
import assert from 'node:assert/strict';
import {streamedReply,CodexAppServer} from '../src/codex-app-server.mjs';
test('流式回复只解码已收到的JSON字符，保留换行与中文',()=>{
 const value=JSON.stringify({reply:'讨论“普通人”\n第二行 😀',action:'reply'});
 for(let i=1;i<value.length;i++)assert('讨论“普通人”\n第二行 😀'.startsWith(streamedReply(value.slice(0,i))));
 assert.equal(streamedReply(value),'讨论“普通人”\n第二行 😀');assert.equal(streamedReply('{"reply":"\\u6b2'),'');
});
test('本机真实app-server能够初始化并读取账户，不运行推理', {skip:process.env.CREATION_REAL_CODEX!=='1'},async()=>{const runtime=new CodexAppServer();try{const account=await runtime.account();assert('requiresOpenaiAuth' in account);}finally{runtime.close();}});
