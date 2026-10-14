import {FileRows} from '../components/FileRows';
import {CheckboxField} from '../components/FormControls';
import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {Action} from '../components/Controls';
import {agentNames} from '../agents/model';
import type {SkillOperation} from './operations';
import type {SkillVersion} from './versions';
import {versionLabel} from './versions';
import detail from './SkillsDetail.module.css';
export function SkillComparison({operation,version,nodeName,back,sync,busy=false}:{operation:SkillOperation;version:SkillVersion;nodeName:string;back:()=>void;sync:(confirmShared:boolean)=>void;busy?:boolean}){
 const [confirmed,setConfirmed]=useState(false),comparison=operation.result?.comparison;
 const shared=comparison?.targets.some(target=>target.sharedAgents.length>1)??false;
 return <ModuleContent className={detail.content} data-region="技能比较结果"><ModuleHeader className={detail.header} title={'比较结果'} actions={<> <Action icon={ArrowLeft} onClick={back}>返回</Action> </>}/>
 <div className={detail.info}><p>技能　{version.name} · {versionLabel(version)}</p><p>目标节点　{nodeName}</p>{comparison?.targets.map((target,index)=><div key={target.agent+index}><p className={detail.path}>目标路径　{target.directory}</p><p>共享 Agent　{target.sharedAgents.map(agent=>agentNames[agent]).join(' · ')}</p></div>)}</div>
 <p className={detail.description}>{comparison?.compatible?'兼容状态　可同步':'不兼容'}</p>{comparison?.problems.map((problem,index)=><p className={detail.description} key={index}>{problem}</p>)}
 {!!comparison?.targets.some(target=>target.changes?.length)&&<><h3>文件变更</h3><FileRows items={comparison.targets.flatMap(target=>(target.changes??[]).map(change=>({id:target.agent+':'+change.path,label:change.path,value:({modified:'修改',missing:'新增',removed:'删除'})[change.state]})))}/></>}
 {shared&&<CheckboxField disabled={busy} checked={confirmed} onChange={event=>setConfirmed(event.currentTarget.checked)}>确认同时更新共享 Agent</CheckboxField>}
 <Action kind="primary" disabled={busy||operation.state!=='succeeded'||!comparison?.compatible||shared&&!confirmed} onClick={()=>sync(confirmed)}>确认同步</Action></ModuleContent>;
}
