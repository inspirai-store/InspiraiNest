import {useEffect,useRef} from 'react';
import {Action} from '../../../../packages/ui-react/src/Controls';
import type {Answer,Round} from './client';
import {answerFor,emptyTurn,hasAnswer,legacyTurn,turnInput} from './turn';
import {useSaved} from './useSaved';
import styles from './Writing.module.css';

export function WritingTurn({round,scope,busy,submit,legacy=false}:{round?:Round;scope:string;busy:boolean;legacy?:boolean;submit:(action:string,input:Record<string,unknown>)=>Promise<void>}){
 const questions=round&&!round.answeredAt&&!round.supersededAt?round.result.questions:[];
 const [draft,setDraft,error]=useSaved(scope+':turn:'+(round?.id||'initial'),legacy?legacyTurn(localStorage,scope,round?.id):emptyTurn());
 const index=Math.min(Math.max(draft.index,0),Math.max(0,questions.length-1)),q=questions[index];
 const answer=q?answerFor(draft,q.id):undefined,anchor=useRef<HTMLDivElement>(null),previous=useRef(index);
 useEffect(()=>{if(previous.current!==index){anchor.current?.scrollIntoView({block:'nearest',behavior:'smooth'});anchor.current?.focus({preventScroll:true});previous.current=index;}},[index]);
 const update=(patch:Partial<Answer>)=>{if(!q)return;const next={...answerFor(draft,q.id),...patch};setDraft({...draft,answers:[...draft.answers.filter(a=>a.questionId!==q.id),next]});};
 const input=turnInput(questions,draft,round?.id),canSubmit=Boolean(input.answers.length||input.message.trim());
 const complete=questions.length>0&&questions.every(q=>hasAnswer(answerFor(draft,q.id)));
 const send=async()=>{await submit('turns',input);setDraft(emptyTurn());};
 return <section className={styles.stack} aria-label="本轮讨论">
  {q&&answer&&<div ref={anchor} tabIndex={-1} className={styles.questionAnchor}>
   <div className={styles.questionProgress} aria-live="polite"><span>第 {index+1} / {questions.length} 题</span><span>{questions.filter(q=>hasAnswer(answerFor(draft,q.id))).length} 题已选择</span></div>
   <fieldset className={styles.question}><legend>{q.title}{q.exploratory?' · 换个角度':''}</legend><p className={styles.reason}>{q.reason}</p>
    <div className={styles.options}>{q.options.map(option=><label key={option.id} className={`${styles.option} ${answer.selected.includes(option.id)?styles.chosen:''}`}><input type={q.mode==='multiple'?'checkbox':'radio'} name={q.id} checked={answer.selected.includes(option.id)} onChange={e=>update({selected:q.mode==='single'?[option.id]:e.target.checked?[...answer.selected,option.id]:answer.selected.filter(id=>id!==option.id),uncertain:false})}/><span>{option.label}{q.recommendedOptionId===option.id&&<span className={styles.recommended}>建议</span>}<span className={styles.impact}>{option.impact}</span></span></label>)}</div>
    <textarea aria-label={q.title+' 自由回答'} placeholder="也可以用自己的话回答" rows={2} value={answer.text} onChange={e=>update({text:e.target.value,uncertain:false})}/>
    <label className={styles.check}><input type="checkbox" checked={answer.uncertain} onChange={e=>update({uncertain:e.target.checked,selected:[]})}/>暂不确定</label>
   </fieldset>
   <div className={styles.questionNav}><Action disabled={index===0} onClick={()=>setDraft({...draft,index:index-1})}>上一题</Action><span className={styles.grow}/><Action disabled={index>=questions.length-1} onClick={()=>setDraft({...draft,index:index+1})}>下一题</Action></div>
  </div>}
  <div className={styles.composer}><textarea id="writing-adjustment" aria-label="补充或纠正" rows={2} value={draft.message} onChange={e=>setDraft({...draft,message:e.target.value})} placeholder={questions.length?'随时补充或纠正，也可以只提交已选答案':'接着聊，或说说想调整的方向'}/><div className={styles.actions}><span className={styles.grow}/><Action kind="primary" disabled={busy||!canSubmit} onClick={()=>void send().catch(()=>{})}>{complete?'提交本轮，继续讨论':'发送，继续讨论'}</Action></div></div>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
