import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {starterGoal} from '../../plugins/learning/protocol/starter.mjs';

export async function importStarter({request,handbook,jd,jdUrl}){
  if(!handbook)throw Error('请提供学习手册文件');
  const sources=[{file:handbook,title:'AI 基础软件架构师面试学习手册'},...(jd?[{file:jd,title:'AI 基础软件架构师岗位要求',url:jdUrl||''}]:[])];
  let goal;
  for(const source of sources){
    const text=fs.readFileSync(source.file,'utf8'),sha=createHash('sha256').update(text).digest('hex');
    const candidate=await request('/api/learning/intake',{requestId:'starter-'+sha,title:source.title,text,url:source.url||'',manual:true});
    if(candidate.state==='confirmed'){goal=await request('/api/learning/goals/'+candidate.goalId);continue;}
    const accepted=await request('/api/learning/candidates/'+candidate.id,{revision:candidate.revision,action:'confirm',...starterGoal(),goalId:goal?.id,goalRevision:goal?.revision});
    goal=await request('/api/learning/goals/'+accepted.goalId);
  }
  if(!goal.nodes.length){
    const nodes=starterGoal().nodes.map(n=>{
      const source=goal.sources.find(s=>s.title.includes('学习手册'));
      const terms=n.title.split(/[ 与、]/).filter(x=>x.length>2);const paragraphs=source?.text.split(/\n\s*\n/).filter(p=>p.length>30&&p.length<1000&&!p.startsWith('#'))||[];
      const sections=source?.text.split(/(?=^### )/m)||[];
      const section=sections.find(part=>terms.some(term=>part.split('\n')[0].includes(term)));
      const quote=section?.split(/\n\s*\n/).find(p=>p.length>30&&!p.startsWith('#'))||paragraphs.find(p=>terms.some(term=>p.includes(term)));
      return {...n,citations:quote?[{kind:source.kind,sourceId:source.sourceId,version:source.version,quote,location:section?.split('\n')[0].replace(/^#+\s*/,'')||'学习手册对应概念段落'}]:[]};
    });
    goal=await request('/api/learning/goals/'+goal.id+'/edit',{revision:goal.revision,nodes});
  }
  return goal;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
  const config=JSON.parse(fs.readFileSync(option('--connection'),'utf8'));
  const request=async(route,input)=>{const r=await fetch(config.origin+route,{method:input===undefined?'GET':'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});const value=await r.json();if(!r.ok)throw Error(value.error||'导入失败');return value;};
  const goal=await importStarter({request,handbook:option('--handbook'),jd:args.includes('--jd')?option('--jd'):undefined,jdUrl:args.includes('--jd-url')?option('--jd-url'):undefined});
  console.log(JSON.stringify({goalId:goal.id,title:goal.title,nodes:goal.nodes.length,sources:goal.sources.length}));
}
