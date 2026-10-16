import type {WritingSession} from './client';

// Only project AI editorial text. Original material, answers and exported history stay intact.
const audit=/(?:writing-(?:input|result)\.json|\.writing-input|\.agents[\\/]skills|\b(?:skillHash|schemaVersion|planVersion|styleVersion)\b|\bhash\s*[=:：]|\b[a-f0-9]{64}\b|\bcoverage\s*[=:：为是]|(?:已完整?读|已读).*(?:sources|answers|turns|request|style))/i;
const names:Record<string,string>={brief:'写作想法',sources:'补充材料',coverage:'材料阅读情况',answers:'已有回答',turns:'讨论',request:'本轮要求',workingPlan:'当前提纲',decisions:'已确定事项',openIssues:'待解决事项',ready:'写作准备状态','builtin-editorial-v1':'默认编辑规则'};
export function editorialText(value:string){
 return value.split(/(?<=[。；])|\n/).filter(line=>!audit.test(line)).join('').replace(/\b(?:builtin-editorial-v1|workingPlan|openIssues|decisions|coverage|sources|answers|turns|request|brief|ready)\b/g,key=>names[key]).replace(/\s*\[\s*\]/g,'').trim();
}
const lines=(values:string[])=>values.map(editorialText).filter(Boolean);
export function presentSession(source:WritingSession):WritingSession{
 const session=structuredClone(source);
 for(const round of session.rounds){
  const result=round.result;result.understanding=editorialText(result.understanding);result.changeSummary=editorialText(result.changeSummary);
  if(result.suggestedTitle)result.suggestedTitle=editorialText(result.suggestedTitle);
  result.directions=result.directions.map(d=>({...d,...Object.fromEntries(['title','thesis','readerValue','support','missing'].map(key=>[key,editorialText(d[key as keyof typeof d])]))}));
  result.questions=result.questions.map(q=>({...q,title:editorialText(q.title),reason:editorialText(q.reason),options:q.options.map(o=>({...o,label:editorialText(o.label),impact:editorialText(o.impact)}))}));
  if(result.workingPlan)result.workingPlan={thesis:editorialText(result.workingPlan.thesis),outline:lines(result.workingPlan.outline),materials:lines(result.workingPlan.materials),openIssues:lines(result.workingPlan.openIssues)};
  if(result.plan)result.plan={...result.plan,...Object.fromEntries(Object.entries(result.plan).map(([key,value])=>[key,Array.isArray(value)?lines(value):editorialText(value)]))};
 }
 if(session.workingPlan)session.workingPlan={thesis:editorialText(session.workingPlan.thesis),outline:lines(session.workingPlan.outline),materials:lines(session.workingPlan.materials),openIssues:lines(session.workingPlan.openIssues)};
 if(session.plan)session.plan={...session.plan,...Object.fromEntries(Object.entries(session.plan).map(([key,value])=>[key,Array.isArray(value)?lines(value):editorialText(value)]))};
 if(session.understanding)session.understanding=editorialText(session.understanding);
 if(session.titleSource==='assistant')session.title=editorialText(session.title)||'文章讨论';
 session.runs=session.runs.map(run=>({...run,message:editorialText(run.message)}));
 return session;
}
