import {useEffect,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {useAppTheme} from '../../../../packages/core/web/settings/SettingsProvider';
import styles from '../../../../packages/ui-react/src/Workbench.module.css';
import {Action} from '../../../../packages/ui-react/src/Controls';
import {CreationWorkbench} from './CreationWorkbench';
import type {ContextRef} from './client';
export function CreationPage(){const navigate=useNavigate(),location=useLocation();return <div className={styles.app} data-theme={useAppTheme()}><CreationWorkbench onBack={()=>navigate('/records'+location.search)}/></div>;}
export function CreationSidebar(){const theme=useAppTheme();const [open,setOpen]=useState(false),[context,setContext]=useState<ContextRef>(),navigate=useNavigate(),location=useLocation();useEffect(()=>{const listener=(e:Event)=>{setContext((e as CustomEvent).detail);setOpen(true);};window.addEventListener('creation:open',listener);return()=>window.removeEventListener('creation:open',listener);},[]);return open?<aside className="creation-sidebar" data-theme={theme} aria-label="Codex 创作侧栏"><header><strong>Codex</strong><Action onClick={()=>setOpen(false)}>关闭</Action></header><CreationWorkbench compact initialContext={context} onExpand={()=>{setOpen(false);navigate('/creation'+location.search);}}/></aside>:null;}
