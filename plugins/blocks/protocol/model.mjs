import {randomUUID} from 'node:crypto';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function structure(input){
 if(typeof input.title!=='string'||!input.title.trim())fail('请填写积木名称');
 if(!Array.isArray(input.goals)||!input.goals.length)fail('至少需要一个目标');
 const ids=new Set();const unique=id=>{id=id||randomUUID();if(typeof id!=='string'||ids.has(id))fail('目标或部件 ID 重复');ids.add(id);return id;};
 const goals=input.goals.map(g=>{
  if(!g.title?.trim()||!['article','product'].includes(g.output)||!Array.isArray(g.parts)||!g.parts.length)fail('目标需要名称、产物和部件');
  return {id:unique(g.id),title:g.title.trim(),output:g.output,parts:g.parts.map(p=>{
   if(!p.title?.trim()||!Array.isArray(p.conditions)||!p.conditions.length||p.conditions.some(c=>typeof c!=='string'||!c.trim()))fail('部件需要名称和验收条件');
   return {id:unique(p.id),title:p.title.trim(),conditions:p.conditions.map(c=>c.trim()),dependsOn:p.dependsOn||[]};
  })};
 });
 const parts=goals.flatMap(g=>g.parts),byId=new Map(parts.map(p=>[p.id,p]));
 const visit=(id,path=[])=>{if(path.includes(id))fail('部件依赖不能成环');const p=byId.get(id);if(!p)fail('依赖部件不存在');if(!Array.isArray(p.dependsOn))fail('依赖格式错误');p.dependsOn.forEach(d=>visit(d,[...path,id]));};
 parts.forEach(p=>visit(p.id));return {title:input.title.trim(),goals};
}
export function evaluate(block,at=new Date().toISOString()){
 const states=new Map(),parts=block.goals.flatMap(g=>g.parts);
 const check=p=>{
  if(states.has(p.id))return states.get(p.id);
  const evidence=block.links.filter(l=>l.partId===p.id&&!l.excluded&&!l.stale&&l.coverage==='full'&&l.relation==='support'&&(!l.expiresAt||Date.parse(l.expiresAt)>Date.parse(at)));
  const missing=p.conditions.filter(c=>!evidence.some(l=>l.conditions.includes(c)));
  const conflicts=block.links.filter(l=>l.partId===p.id&&!l.excluded&&!l.stale&&l.relation==='contradiction');
  const dependencies=p.dependsOn.filter(id=>!check(parts.find(x=>x.id===id)).ready);
  const result={partId:p.id,ready:!missing.length&&!conflicts.length&&!dependencies.length,missing,conflicts:conflicts.map(l=>l.id),dependencies,evidence:evidence.map(l=>l.id)};states.set(p.id,result);return result;
 };
 parts.forEach(check);return {id:randomUUID(),at,revision:block.revision,parts:[...states.values()],goals:block.goals.map(g=>({goalId:g.id,ready:g.parts.every(p=>states.get(p.id).ready)}))};
}
