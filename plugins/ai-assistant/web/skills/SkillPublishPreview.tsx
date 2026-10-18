import {FileRows,fileBytes} from '../../../../packages/ui-react/src/FileRows';
import {CheckboxField} from '../../../../packages/ui-react/src/FormControls';
import {ModuleContent,ModuleHeader} from '../../../../packages/ui-react/src/ModuleLayout';
import {ArrowLeft,ChevronRight} from 'lucide-react';
import {Action} from '../../../../packages/ui-react/src/Controls';
import {agentNames} from '../agents/model';
import {skillAgents,skillSystems} from './policy';
import type {SkillPolicy} from './policy';
import type {SkillOperation} from './operations';
import styles from './SkillsDetail.module.css';
import controls from './SkillPublishPreview.module.css';
const systemNames={darwin:'macOS',win32:'Windows',linux:'Linux'};
export function SkillPublishPreview({operation,nodeName,directory,description,policy,setPolicy,back,dependencies,confirm,busy=false}:{operation:SkillOperation;nodeName:string;directory:string;description?:string;policy:SkillPolicy;setPolicy:(policy:SkillPolicy)=>void;back:()=>void;dependencies:()=>void;confirm:()=>void;busy?:boolean}){
 const preview=operation.result?.preview;
 return <ModuleContent className={`${styles.content} ${controls.content}`} data-region="技能发布预览"><ModuleHeader className={styles.header} title={'发布预览'} actions={<> <Action icon={ArrowLeft} onClick={back}>返回</Action> </>}/>
 <div className={styles.info}><p>技能　{preview?.name??'—'}</p><p>来源节点　{nodeName}</p><p className={`${styles.path} ${controls.infoPath}`}>路径　{directory}</p>
 <h3 className={controls.label}>适用 Agent</h3><div className={controls.choices}>{skillAgents.map(agent=><CheckboxField key={agent} disabled={busy} checked={policy.agents.includes(agent)} onChange={event=>setPolicy({...policy,agents:event.currentTarget.checked?[...policy.agents,agent]:policy.agents.filter(value=>value!==agent)})}>{agentNames[agent]}</CheckboxField>)}</div>
 <h3 className={controls.label}>适用系统</h3><div className={controls.choices}>{skillSystems.map(system=><CheckboxField key={system} disabled={busy} checked={policy.systems.includes(system)} onChange={event=>setPolicy({...policy,systems:event.currentTarget.checked?[...policy.systems,system]:policy.systems.filter(value=>value!==system)})}>{systemNames[system]}</CheckboxField>)}</div>
 <h3 className={controls.label}>依赖声明</h3><button type="button" className={controls.dependencies} data-skill-dependencies disabled={busy} onClick={dependencies}><span>命令 · 环境变量 · MCP · Python · 浏览器</span><ChevronRight size={16}/></button></div>
 {description&&<p className={styles.description}>{description}</p>}
 {!!preview?.files?.length&&<><h3>文件</h3><FileRows items={preview.files.map(file=>({id:file.path,label:file.path,value:fileBytes(file.bytes)}))}/></>}
 <Action kind="primary" disabled={busy||operation.state!=='succeeded'||!preview?.hash||!policy.agents.length||!policy.systems.length} onClick={confirm}>确认发布</Action></ModuleContent>;
}
