import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {ArrowLeft} from 'lucide-react';
import {Action} from '../components/Controls';
import type {SkillOperation} from './operations';
import type {SkillVersion} from './versions';
import {versionLabel} from './versions';
import {agentNames} from '../agents/model';
import {skillOperationLabels} from './operations';
import detail from './SkillsDetail.module.css';
const actionNames={refresh:'刷新', 'configure-projects':'项目配置','prepare-publish':'发布预览',publish:'发布',compare:'比较',sync:'同步',verify:'验证',rollback:'回滚'};
export function SkillOperationResult({operation,nodeName,version,comparison,recompare,back,rollback,confirmRollback,requestRollback,busy=false}:{operation:SkillOperation;nodeName:string;version?:SkillVersion;comparison?:SkillOperation;recompare:()=>void;back:()=>void;rollback:()=>void;confirmRollback:boolean;requestRollback:()=>void;busy?:boolean}){
 const pending=['queued','running'].includes(operation.state);
 const status=operation.action==='sync'?({queued:'等待节点',running:'同步中',succeeded:'同步完成',failed:'同步失败'})[operation.state]:operation.action==='rollback'?({queued:'等待节点',running:'回滚中',succeeded:'回滚完成',failed:'回滚失败'})[operation.state]:`${actionNames[operation.action]}　${skillOperationLabels[operation.state]}`;
 return <ModuleContent className={detail.content} data-region="技能操作结果"><ModuleHeader className={detail.header} title={['sync','rollback'].includes(operation.action)?'比较结果':actionNames[operation.action]} actions={<> <Action icon={ArrowLeft} onClick={back}>返回</Action> </>}/><div className={detail.info}>{version&&<p>技能　{version.name} · {versionLabel(version)}</p>}<p>目标节点　{nodeName}</p>{comparison?.result?.comparison?.targets.map((target,index)=><div key={target.agent+index}><p className={detail.path}>目标路径　{target.directory}</p><p>共享 Agent　{target.sharedAgents.map(agent=>agentNames[agent]).join(' · ')}</p></div>)}<p>{confirmRollback?'回滚　恢复同步前的技能文件':status}</p>{operation.result?.error&&<p role="alert">{operation.result.error}</p>}</div>{operation.action==='sync'&&pending&&<Action disabled>{status}</Action>}{operation.action==='sync'&&operation.state==='failed'&&<Action disabled={busy} onClick={recompare}>重新比较</Action>}{operation.action==='sync'&&operation.state==='succeeded'&&<Action kind={confirmRollback?'primary':'secondary'} disabled={busy||pending} onClick={confirmRollback?rollback:requestRollback}>{confirmRollback?'确认回滚':'回滚'}</Action>}</ModuleContent>;
}
