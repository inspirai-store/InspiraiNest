import test from 'node:test';import assert from 'node:assert/strict';
import {shortcutAction,findMatches} from '../../../../packages/plugin-sdk/commands.ts';
const key=(value,patch={})=>({key:value,metaKey:true,ctrlKey:false,altKey:false,shiftKey:false,isComposing:false,keyCode:0,...patch});
test('Mac/Windows modifiers distinguish document find, list search and palettes without hijacking OS word movement',()=>{
 assert.equal(shortcutAction(key('f'),true),'find');assert.equal(shortcutAction(key('f',{shiftKey:true}),true),'search');assert.equal(shortcutAction(key('p'),true),'quick');assert.equal(shortcutAction(key('p',{shiftKey:true}),true),'commands');assert.equal(shortcutAction(key('f',{ctrlKey:true,metaKey:false}),false),'find');assert.equal(shortcutAction(key('f',{ctrlKey:true,metaKey:false}),true),null);assert.equal(shortcutAction(key('ArrowLeft',{metaKey:false,altKey:true}),true),null);
});
test('IME composition and AltGraph do not run writing/navigation commands',()=>{
 assert.equal(shortcutAction(key('n',{isComposing:true}),true),null);assert.equal(shortcutAction(key('s',{keyCode:229}),true),null);assert.equal(shortcutAction(key('j',{metaKey:false,ctrlKey:true,altKey:true}),false),null);
});
test('literal document search preserves original offsets across punctuation, Unicode and repeated matches',()=>{
 assert.deepEqual(findMatches('甲 [a+b] 乙 [a+b]','[a+b]'),[{from:2,to:7},{from:10,to:15}]);assert.deepEqual(findMatches('AI 写作 ai','ai'),[{from:0,to:2},{from:6,to:8}]);assert.deepEqual(findMatches('emoji 😀 中文','😀'),[{from:6,to:8}]);assert.deepEqual(findMatches('正文',''),[]);
});
