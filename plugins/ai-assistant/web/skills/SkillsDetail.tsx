import {MenuButton} from '../../../../packages/ui-react/src/Overlays';
import {Ellipsis} from 'lucide-react';
import {ModuleContent,ModuleHeader} from '../../../../packages/ui-react/src/ModuleLayout';
import {ArrowLeft} from 'lucide-react';
import {Action} from '../../../../packages/ui-react/src/Controls';
import {agentNames} from '../agents/model';
import type {SkillAgent} from './policy';
import styles from './SkillsDetail.module.css';
export type SkillDetailData={name:string;agent?:SkillAgent;scope?:string;directory?:string;description?:string;portable?:boolean;hash?:string|null;files?:{path:string;bytes:number}[];};
const scopes:Record<string,string>={user:'全局',project:'项目',plugin:'插件',system:'系统','compat-user':'共享全局','compat-project':'共享项目','custom-user':'自定义全局'};
const fileSize=(bytes:number)=>bytes<1024?`${bytes} B`:`${(bytes/1024).toFixed(1)} KB`;
export function SkillsDetail({commands=[],skill,back,publish,busy=false}:{commands?:import('../../../../packages/plugin-sdk/commands').Command[];skill:SkillDetailData;back:()=>void;publish:()=>void;busy?:boolean}){
 return <ModuleContent className={styles.content} data-region="技能详情">
 <ModuleHeader className={styles.header} title={skill.name} actions={<><MenuButton label="更多" icon={Ellipsis} iconOnly kind="ghost" options={commands.map(c=>({label:c.label,icon:c.icon,disabled:c.disabled,danger:c.danger,opensDialog:c.opensDialog,select:()=>{void c.run?.();}}))}/> <Action icon={ArrowLeft} onClick={back}>返回</Action> </>}/>
 <div className={styles.info}>{skill.agent&&<p>Agent　{agentNames[skill.agent]}</p>}{skill.scope&&<p>范围　{scopes[skill.scope]??skill.scope}</p>}{skill.directory&&<p className={styles.path}>路径　{skill.directory}</p>}</div>
 {skill.description&&<p className={styles.description}>{skill.description}</p>}
 {!!skill.files?.length&&<><h3>文件</h3><div className={styles.files}>{skill.files.map(file=><div className={styles.file} key={file.path}><span>{file.path}</span><span>{fileSize(file.bytes)}</span></div>)}</div></>}
 <Action kind="primary" disabled={busy||!skill.portable||!skill.hash} onClick={publish}>发布预览</Action>
 </ModuleContent>;
}
