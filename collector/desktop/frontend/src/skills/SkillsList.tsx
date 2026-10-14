import {ModuleTabs} from '../components/ModuleTabs';
import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {ChevronDown,RotateCw} from 'lucide-react';
import {Action,Badge,SearchField} from '../components/Controls';
import {MenuButton} from '../components/Overlays';
import {agentNames} from '../agents/model';
import type {SkillAgent} from './policy';
import styles from './SkillsList.module.css';
export type SkillListRow={id:string;name:string;agent?:SkillAgent;version?:string;scope?:string;status?:string};
export type SkillsTab='local'|'versions'|'market';
type Props={tab:SkillsTab;setTab:(tab:SkillsTab)=>void;keyword:string;setKeyword:(keyword:string)=>void;agent:SkillAgent|null;setAgent:(agent:SkillAgent|null)=>void;rows:SkillListRow[];refresh:()=>void;open:(row:SkillListRow)=>void;busy?:boolean;projects?:()=>void;projectsDisabled?:boolean;target?:React.ReactNode;state?:React.ReactNode;disabledTabs?:SkillsTab[];};
export function SkillsList({tab,setTab,keyword,setKeyword,agent,setAgent,rows,refresh,open,busy=false,projects,projectsDisabled=false,target,state,disabledTabs=[]}:Props){
 return <ModuleContent scroll="children" className={styles.content} data-region="技能内容">
 <ModuleHeader className={styles.header} data-region="技能标题栏" title={'技能'} actions={<> <div className={styles.headerActions}>{tab==='local'&&projects&&<Action disabled={busy||projectsDisabled} onClick={projects}>项目目录</Action>}<Action icon={RotateCw} disabled={busy} onClick={refresh}>刷新</Action></div> </>}/>
 <ModuleTabs label="技能页面" value={tab} disabled={disabledTabs} onChange={setTab} items={[{id:'local',label:'节点技能'},{id:'versions',label:'版本库'},{id:'market',label:'技能市场'}]}/>
 {tab==='local'&&target}
 <div className={styles.filters}><SearchField label="搜索技能" value={keyword} onChange={event=>setKeyword(event.currentTarget.value)}/><MenuButton className={styles.filterTrigger} label={tab==='local'?'Agent 筛选':'来源筛选'} icon={ChevronDown} width={200} triggerContent={<><span>{agent?agentNames[agent]:tab==='local'?'全部 Agent':'全部来源'}</span><ChevronDown size={16}/></>} options={[{label:tab==='local'?'全部 Agent':'全部来源',selected:agent===null,select:()=>setAgent(null)},...(tab==='local'?Object.entries(agentNames).map(([id,label])=>({label,selected:agent===id,select:()=>setAgent(id as SkillAgent)})):[])]}/></div>
 {state??<div className={styles.table} role="table" aria-label="技能" data-region="技能列表"><div className={styles.columns} role="row">{['名称',tab==='local'?'Agent':'版本',tab==='local'?'范围':'状态','操作'].map(label=><span key={label} role="columnheader">{label}</span>)}</div>{rows.map(row=><div className={styles.row} key={row.id} data-skill-id={row.id} role="row" data-region={'技能行 '+row.name}><span className={styles.name} role="cell">{row.name}</span><span className={styles.value} role="cell">{tab==='local'?(row.agent?agentNames[row.agent]:'—'):row.version??'—'}</span><div role="cell"><Badge>{tab==='local'?row.scope??'—':row.status??'已发布'}</Badge></div><div role="cell"><Action disabled={busy} onClick={()=>open(row)}>查看</Action></div></div>)}</div>}
 </ModuleContent>;
}
