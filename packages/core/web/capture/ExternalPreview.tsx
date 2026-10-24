import {useEffect,useRef,useState} from 'react';
import {Action} from '../../../ui-react/src/Controls';
import type {BrowserTab,CaptureBridge,PreviewFrame} from './types';
import styles from './Capture.module.css';
const frames=new Map<string,PreviewFrame>(),requests=new Map<string,Promise<PreviewFrame>>();
export function ExternalPreview({tab,bridge,visible,onOpen}:{tab:BrowserTab;bridge:CaptureBridge;visible:boolean;onOpen:()=>void}){
 const [frame,setFrame]=useState(frames.get(tab.id)),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false),root=useRef<HTMLDivElement>(null);
 useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>;setFrame(frames.get(tab.id));setError('');
  const tick=async()=>{if(stopped)return;if(!visible||document.hidden||!root.current?.getClientRects().length){timer=setTimeout(tick,1000);return;}setLoading(true);try{let pending=requests.get(tab.id);if(!pending){pending=bridge.preview(tab.id);requests.set(tab.id,pending);void pending.finally(()=>requests.delete(tab.id)).catch(()=>{});}const next=await pending;if(!stopped){if(frames.size>20)frames.delete(frames.keys().next().value!);frames.set(tab.id,next);setFrame(next);setError('');}}catch(e){if(!stopped)setError(e instanceof Error?e.message:String(e));}finally{if(!stopped){setLoading(false);timer=setTimeout(tick,1500);}}};void tick();return()=>{stopped=true;clearTimeout(timer);};
 },[tab.id,tab.error,bridge,visible,refresh]);
 const message=tab.error||error;
 return <div ref={root} className={styles.externalPreview} data-region="外部页面预览"><div className={styles.previewToolbar}><span>{tab.connectionKind==='extension'?'浏览器扩展':'外部浏览器'} · {tab.mode==='taking'?'正在交还控制':tab.mode==='agent'?'Agent 操作':tab.taskId?'用户控制':'已连接'}</span><Action disabled={loading} onClick={()=>setRefresh(v=>v+1)}>刷新画面</Action><Action disabled={!!tab.error&&tab.error!=='页面来源已变化'} onClick={onOpen}>打开浏览器</Action></div><div className={styles.previewCanvas}>{frame&&<img src={frame.dataUrl} alt={frame.title||'外部页面画面'} data-stale={!!message}/>}<div className={styles.previewState} role={message?'alert':undefined}>{message||(!frame?(loading?'读取画面':'等待画面'):'')}</div></div>{frame&&<time className={styles.previewTime} dateTime={frame.capturedAt}>{new Date(frame.capturedAt).toLocaleTimeString('zh-CN',{hour12:false})}{message?' · 已停止更新':''}</time>}</div>;
}
