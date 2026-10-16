import {useEffect,useState} from 'react';
import type {WritingSession} from './client';
import styles from './Writing.module.css';
const duration=(seconds:number)=>seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
export function WritingProgress({run}:{run?:WritingSession['runs'][number]}){
 const planning=run?.mode==='round';
 const phases=[['preparing','准备材料'],['organizing',planning?'组织问题':'按计划写作'],['validating','校验结果'],['saving',planning?'保存讨论':'保存稿件']] as const;
 const [clock,setClock]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const progress=run?.progress,index=phases.findIndex(([phase])=>phase===progress?.phase),queued=!run||run.state==='queued';
 const elapsed=Math.max(0,Math.floor((clock-Date.parse(progress?.startedAt||run?.createdAt||new Date(clock).toISOString()))/1000));
 const since=progress?Math.max(0,Math.floor((clock-Date.parse(progress.updatedAt))/1000)):0;
 return <section className={styles.notice} aria-label="本轮处理进度">
  <p role="status" aria-live="polite">{queued?'等待可用电脑':index>=0?phases[index][1]:run?.message||'正在准备这一轮'}{run?.deviceName&&!queued?` · ${run.deviceName}`:''}</p>
  <p className={styles.progressTime}>{queued?'已等待':'已用时'} {duration(elapsed)}</p>
  <ol className={styles.progressSteps}>{phases.map(([phase,label],i)=><li key={phase} aria-current={i===index?'step':undefined} data-complete={i<index||undefined}><span>{i<index?'✓':i+1}</span>{label}</li>)}</ol>
  {progress?.phase==='preparing'&&progress.fileCount>0&&<p>已准备 {progress.preparedFiles} / {progress.fileCount} 个附件</p>}
  {progress?.phase==='organizing'&&<p>{progress.toolCount?`已完成 ${progress.toolCount} 次工具操作，等待本轮结果。`:'AI 正在处理本轮输入，结果返回后会继续校验。'}</p>}
  {since>=30&&!queued&&<p>本阶段仍在等待返回，上次执行活动在 {duration(since)}前。</p>}
  <p>结果保存后即可回答，离开页面不影响进度。</p>
 </section>;
}
