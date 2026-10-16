import {useEffect,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {Action} from '../components/Controls';
import styles from './SettingsPage.module.css';
export function TrialLogin(){
 const [state,setState]=useState('检测中'),location=useLocation(),navigate=useNavigate();
 useEffect(()=>{if(!window.worker?.trial)return;let active=true,pending=false;const refresh=async()=>{if(pending)return;pending=true;try{const value=await window.worker!.trial!('status');if(active)setState(value.login==='ready'?'当前 Agent 可用':value.login==='unavailable'?'Agent 程序或配置不可用':'当前 Agent 授权需要处理');}catch{if(active)setState('未连接');}finally{pending=false;}};void refresh();const timer=setInterval(refresh,15000);return()=>{active=false;clearInterval(timer);};},[]);
 if(!window.worker?.trial)return null;
 return <fieldset className={styles.field}><legend>Codex 实测环境</legend><span role="status">{state}</span><Action onClick={()=>navigate('/settings/agents'+location.search,{state:{settingsFocus:'content',settingsSection:'agents'}})}>管理 Agent</Action></fieldset>;
}
