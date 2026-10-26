import {fingerprint,fail} from './model.mjs';

export function teachingPacket(goal,nodeIds,format,sources){
  if(!['video','web'].includes(format))fail('请选择教学视频或 Web 演示');
  const nodes=goal.nodes.filter(n=>nodeIds.includes(n.id)).map(n=>({...n,notes:'',citations:n.citations.filter(c=>sources.some(s=>s.kind===c.kind&&s.sourceId===c.sourceId&&s.version===c.version))}));if(!nodes.length||nodes.length!==new Set(nodeIds).size)fail('请选择有效的学习节点');
  const snapshot={goalId:goal.id,goalRevision:goal.revision,title:goal.title,foundation:goal.foundation,format,nodes,sources};
  const packet={protocol:1,id:fingerprint(snapshot),...snapshot};
  const task=`# ${goal.title}\n\n## 交付目标\n${format==='web'?'制作可离线打开的自包含 HTML 交互演示，所有脚本和样式内联，不需要服务端或联网依赖。':'制作概念教学视频，并交付讲稿、字幕和可复现源码。'}\n\n## 学习者基础\n${goal.foundation}\n\n`+
    nodes.map(n=>`## ${n.title}\n\n学习目标：${n.objectives.join('；')}\n\n讲解材料：\n${n.explanation}\n\n讲解顺序：直觉 → 概念与前提 → 具体例子 → 常见误解 → 小练习。\n\n复述题：\n${n.recall.map(q=>'- '+q).join('\n')}\n\n练习与验收：\n${n.exercises.map(q=>'- '+q).join('\n')}\n\n验收标准：覆盖全部学习目标；演示变化与解释一致；区分假设与实测；保留来源引用。`).join('\n\n')+
    `\n\n## 成果回收\n回到灵藏新知的当前目标，选择此任务包并导入视频、HTML、讲义或源码。可同时提供 learning-result.json：{\"protocol\":1,\"handoffId\":\"${packet.id}\",\"goalId\":\"${goal.id}\",\"nodeIds\":${JSON.stringify(nodeIds)}}。不要包含账号、凭据或未选取的私人材料。\n`;
  return {...packet,files:[{name:'TASK.md',text:task},{name:'learning-handoff.json',text:JSON.stringify(packet,null,2)},...sources.map((s,i)=>({name:`materials/${i+1}.md`,text:`# ${s.title}\n\n${s.url||''}\n\n完整度：${s.coverage}\n\n${s.text}`}))]};
}
export {demoDocument} from './demo.mjs';
