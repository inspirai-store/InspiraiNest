import fs from 'node:fs';
const input=JSON.parse(fs.readFileSync('input.json','utf8'));
if(input.sources){
 const source=input.sources.find(s=>s.text.includes('选题'));
 fs.writeFileSync('matching-result.json',JSON.stringify({protocol:1,matches:source?[{sourceKey:source.key,partId:input.goals[0].parts[0].id,relation:'support',reason:'来源说明了完整运营流程',scopeReason:'引用完整记录描述用户安排，不作为外部验证',evidence:[{condition:input.goals[0].parts[0].conditions[0],unitId:source.units?.[0]?.id,quote:source.units?.length?source.text.slice(source.units[0].start,source.units[0].end):source.text}]}]:[]}));
}else if(!input.questionCount){
 fs.writeFileSync('plan-result.json',JSON.stringify({protocol:1,stage:'question',reply:'先确定计划的首要范围。',question:{title:'先验证哪个范围？',options:[{id:'small',label:'最小可用方案'},{id:'full',label:'完整蓝图'}]},proposal:null}));
}else{
 const cost=input.turns.some(t=>t.text?.includes('成本'));
 const parts=[{id:'p1',title:'运营闭环',conditions:['明确选题、制作、发布和复盘流程'],dependsOn:[]}];
 const goals=[{id:'g1',title:'最小运营方案',output:'product',parts}];if(cost)goals.push({id:'g2',title:'成本与风险',output:'product',parts:[{id:'p2',title:'预算评估',conditions:['给出可验证的预算依据'],dependsOn:['p1']}]});
 fs.writeFileSync('plan-result.json',JSON.stringify({protocol:1,stage:'proposal',reply:cost?'已保留运营方案，并加入成本评估。':'先建立一个最小运营闭环。',question:null,proposal:{title:'AI 账号运营试验',goals,collectionPlan:goals.flatMap(g=>g.parts.map(p=>({partId:p.id,existing:['查找已有运营随笔'],external:['补充公开规则和案例']}))),assumptions:['执行频率待验证']}}));
}
