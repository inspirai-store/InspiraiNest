import {FileRows,fileBytes} from '../components/FileRows';
import {CheckboxField} from '../components/FormControls';
import {ModuleContent,ModuleHeader,ModuleActions} from '../components/ModuleLayout';
import {useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import type {ReactNode} from 'react';
import {Action} from '../components/Controls';
import {agentNames} from '../agents/model';
import {skillAgents} from './policy';
import type {SkillAgent} from './policy';
import {versionLabel} from './versions';
import type {SkillVersion} from './versions';
import detail from './SkillsDetail.module.css';
import controls from './SkillPublishPreview.module.css';
const systemNames={darwin:'macOS',win32:'Windows',linux:'Linux'};
export function SkillVersionDetail({version,target,back,compare,verify,busy=false}:{version:SkillVersion;target:ReactNode;back:()=>void;compare:(agents:SkillAgent[])=>void;verify:()=>void;busy?:boolean}){
 const [agents,setAgents]=useState<SkillAgent[]>(()=>version.policy.agents.slice(0,1));
 return <ModuleContent className={detail.content} data-region="技能版本详情"><ModuleHeader className={detail.header} title={version.name} actions={<> <ModuleActions><Action disabled={busy||!version.policy.agents.some(agent=>['codex','codebuddy'].includes(agent))} onClick={verify}>验证</Action><Action icon={ArrowLeft} onClick={back}>返回</Action></ModuleActions> </>}/>
 <div className={detail.info}><p>版本　{versionLabel(version)}</p><p>适用 Agent　{version.policy.agents.map(agent=>agentNames[agent]).join(' · ')}</p><p className={detail.path}>适用系统　{version.policy.systems.map(system=>systemNames[system]).join(' · ')}</p></div>
 {version.description&&<p className={detail.description}>{version.description}</p>}
 {!!version.files?.length&&<><h3>文件</h3><FileRows items={version.files.map(file=>({id:file.path,label:file.path,value:fileBytes(file.bytes)}))}/></>}
 {target}<h3 className={controls.label}>目标 Agent</h3><div className={controls.choices}>{skillAgents.map(agent=><CheckboxField key={agent} disabled={busy||!version.policy.agents.includes(agent)} checked={agents.includes(agent)} onChange={event=>{const checked=event.currentTarget.checked;setAgents(current=>checked?[...current,agent]:current.filter(value=>value!==agent));}}>{agentNames[agent]}</CheckboxField>)}</div>
 <Action kind="primary" disabled={busy||!agents.length} onClick={()=>compare(agents)}>比较目标</Action></ModuleContent>;
}
