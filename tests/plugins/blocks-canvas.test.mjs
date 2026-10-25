import test from 'node:test';
import assert from 'node:assert/strict';
import {blockCanvas} from '../../plugins/blocks/web/canvas-model.ts';
import {readBoardLayout,mergeBoardPositions} from '../../packages/ui-react/src/canvas/layout.ts';
const fixture=()=>({id:'b',title:'研究',goals:[{id:'g',title:'交付',output:'product',parts:[{id:'p1',title:'定位',conditions:['官方来源'],dependsOn:[]},{id:'p2',title:'接入',conditions:['方案'],dependsOn:['p1']}]}],evaluations:[{parts:[{partId:'p1',ready:true,missing:[],dependencies:[],conflicts:[]},{partId:'p2',ready:false,missing:['方案'],dependencies:[],conflicts:[]}]}],links:[{id:'l1',kind:'entry',sourceId:'same',version:'v2',partId:'p1',title:'官方资料',relation:'support',reason:'依据',evidence:[],excluded:false},{id:'l2',kind:'entry',sourceId:'same',version:'v2',partId:'p2',title:'官方资料',relation:'lead',reason:'尚需方案',evidence:[],excluded:false},{id:'old',kind:'entry',sourceId:'same',version:'v1',partId:'p1',title:'旧资料',stale:true,relation:'support',reason:'旧版',excluded:false},{id:'removed',kind:'entry',sourceId:'removed',version:'v1',partId:'p1',relation:'lead',reason:'排除',excluded:true}]});
test('同一来源多部件只建一张卡，保持独立连线、版本与依赖，不改业务对象',()=>{
 const b=fixture(),before=structuredClone(b),g=blockCanvas(b);assert.equal(g.materials.length,1);assert.equal(g.relations.filter(e=>e.source===g.materials[0].id).length,2);assert.ok(g.relations.some(e=>e.id==='dependency:p1:p2'));assert.equal(g.items.find(n=>n.id==='part:p2').badge,'积累中');assert.deepEqual(b,before);
 const reordered=blockCanvas({...b,links:[...b.links].reverse()});assert.equal(g.materials[0].id,reordered.materials[0].id);const all=blockCanvas(b,{history:true});assert.equal(all.materials.length,2);assert.equal(all.items.find(n=>n.id===all.materials.find(m=>m.stale).id).source,false);
});
test('搜索只筛选资料卡，目标与部件仍保留，旧关联与移除材料不混入当前视图',()=>{const g=blockCanvas(fixture(),{query:'不存在'});assert.equal(g.materials.length,0);assert.equal(g.items.length,3);assert.ok(g.items.every(n=>n.kind!=='material'));});
test('布局按宿主提供的独立空间读取，合并可见卡片时保留被过滤卡片的位置',()=>{
 const values=new Map([['account:a',JSON.stringify({positions:{hidden:{x:900,y:500}},viewport:{x:8,y:12,zoom:.8}})]]),storage={getItem:k=>values.get(k)||null};const current=readBoardLayout(storage,'account:a');assert.equal(current.viewport.zoom,.8);assert.deepEqual(readBoardLayout(storage,'account:b'),{positions:{}});const next=mergeBoardPositions(current,[{id:'visible',position:{x:20,y:30}}]);assert.deepEqual(next.positions.hidden,{x:900,y:500});values.set('broken','{bad');assert.deepEqual(readBoardLayout(storage,'broken'),{positions:{}});
});
