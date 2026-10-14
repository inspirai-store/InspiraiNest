import {errorMessage} from '../shared/errors.ts';
import {TextInput} from '../components/FormControls';
import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {projectPaths} from './projects';
import {useSkillMemory} from './useSkillMemory';
import {useDesktopRuntime} from '../platform/DesktopRuntime';
import {ArrowLeft,X} from 'lucide-react';
import {Action} from '../components/Controls';
import detail from './SkillsDetail.module.css';
import styles from './SkillProjects.module.css';
export function SkillProjects({deviceId,nodeName,projects,back,save,busy=false}:{deviceId:string;nodeName:string;projects:string[];back:()=>void;save:(projects:string[])=>void;busy?:boolean}){
 const {session}=useDesktopRuntime();const key='projects-draft:'+deviceId;
 const [paths,setPaths]=useSkillMemory(session,key+':paths',()=>[...projects]),[input,setInput]=useSkillMemory(session,key+':input',''),[error,setError]=useSkillMemory(session,key+':error','');
 const add=()=>{try{setPaths(projectPaths([...paths,input]));setInput('');setError('');}catch(error){setError(errorMessage(error));}};
 return <ModuleContent className={detail.content} data-region="技能项目目录"><ModuleHeader className={detail.header} title={'项目目录'} actions={<> <Action icon={ArrowLeft} disabled={busy} onClick={back}>返回</Action> </>}/><p className={styles.node}>{nodeName}</p>{paths.map(path=><div className={styles.row} key={path}><span>{path}</span><button type="button" disabled={busy} aria-label={'移除 '+path} onClick={()=>setPaths(current=>current.filter(value=>value!==path))}><X size={16}/></button></div>)}<TextInput className={styles.input} aria-label="添加项目目录" placeholder="添加项目目录" value={input} disabled={busy} onChange={event=>setInput(event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();add();}}}/>{error&&<p role="alert" className={styles.error}>{error}</p>}<Action kind="primary" disabled={busy} onClick={()=>{try{save(projectPaths([...paths,input]));}catch(error){setError(errorMessage(error));}}}>保存</Action></ModuleContent>;
}
