import test from 'node:test';
import assert from 'node:assert/strict';
import {visualWebAssets} from '../../plugins/learning/visuals/assets.mjs';
import {visualMath} from '../../plugins/learning/visuals/math.mjs';
import {visualDocument} from '../../plugins/learning/visuals/document.mjs';
import {visualLessons} from '../../plugins/learning/visuals/lessons.mjs';
import {starterGoal,visualLessonId} from '../../plugins/learning/protocol/starter.mjs';

test('visual calculations preserve masks, logical KV units and collective data ownership',()=>{
 const m=visualMath();assert.equal(m.kv().total,2**30);assert.equal(m.kv({batch:4}).total,4*2**30);assert.equal(m.kv({heads:32}).total,4*2**30);
 assert.deepEqual(m.attention(0).weights,[1,0,0]);assert.equal(m.attention(0).output,10);
 assert.equal(m.attention(1).weights[2],0);assert.ok(Math.abs(m.attention(2).output-24.2051248)<.0001);
 assert.deepEqual(m.collective('AllReduce'),[[4,6],[4,6]]);assert.deepEqual(m.collective('AllGather'),[[1,2,3,4],[1,2,3,4]]);
 assert.deepEqual(m.collective('ReduceScatter'),[[4],[6]]);assert.deepEqual(m.collective('All-to-All'),[['a0','b0'],['a1','b1']]);
 assert.equal(m.overlap(25),55);assert.equal(m.overlap(40),70);assert.deepEqual(m.compile(1000),{eager:10000,compiled:10000});
 assert.ok(m.gemm(1).ceiling<1);assert.equal(m.gemm(1024).ceiling,100);
});
test('visual lesson documents are offline, contain no host bridge and cover only matching authored content',()=>{
 const course=starterGoal();assert.equal(visualLessons.length,16);assert.equal(new Set(visualLessons.map(l=>l.id)).size,16);
 for(const node of course.nodes)assert.equal(visualLessonId(node),node.id);
 assert.equal(visualLessonId({...course.nodes[0],explanation:'我已修改的内容'}),null);
 assert.equal(visualLessonId({...course.nodes[0],title:'另一课程'}),null);
 const html=visualDocument('kv-cache','dark',true);
 assert.match(html,/data-lesson="kv-cache"/);assert.match(html,/connect-src 'none'/);assert.match(html,/form-action 'none'/);assert.match(html,/prefers-reduced-motion/);
 assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+href=|window\.library|messageHandlers|addJavascriptInterface|fetch\(/);
 assert.match(visualDocument('"><script>bad()</script>'),/data-lesson="overview"/);
});

test('Web diagrams use separate same-origin assets under the host CSP',()=>{
 const assets=visualWebAssets();assert.deepEqual(Object.keys(assets).sort(),['index.html','offline.html','player.css','player.js']);
 assert.ok(assets['index.html'].includes('src="./player.js"'));assert.ok(assets['index.html'].includes('href="./player.css"'));
 assert.doesNotMatch(assets['index.html'],/<script>|<style>|unsafe-inline/);
 assert.match(assets['player.css'],/--viewport-height/);assert.doesNotMatch(assets['player.js'],/window\.library|messageHandlers|fetch\(/);
});
