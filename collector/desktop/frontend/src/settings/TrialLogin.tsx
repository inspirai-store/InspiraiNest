import {useEffect,useState} from 'react';
import {Action} from '../components/Controls';
import styles from './SettingsPage.module.css';
export function TrialLogin(){
 const [state,setState]=useState('检测中'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!window.worker?.trial)return;let active=true,pending=false;const refresh=async()=>{if(pending)return;pending=true;try{const value=await window.worker!.trial!('status');if(active)setState(value.login==='ready'?'已登录':value.login==='unavailable'?'未安装 Codex':'未登录');}catch{if(active)setState('未连接');}finally{pending=false;}};void refresh();const timer=setInterval(refresh,5000);return()=>{active=false;clearInterval(timer);};},[]);
 if(!window.worker?.trial)return null;
 const login=async()=>{setBusy(true);setError('');try{await window.worker!.trial!('login');}catch(e){setError(e instanceof Error?e.message:'无法打开测试登录');}finally{setBusy(false);}};
 return <fieldset className={styles.field}><legend>Codex 测试账号</legend><span>{state}</span><Action disabled={busy} onClick={()=>void login()}>{state==='已登录'?'更换测试账号':'登录测试账号'}</Action>{error&&<p role="alert">{error}</p>}</fieldset>;
}
