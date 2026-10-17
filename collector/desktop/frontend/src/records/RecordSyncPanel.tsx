import {useNavigate,useLocation} from 'react-router-dom';
import {Action} from '../components/Controls';
import {useRecords} from './RecordsProvider';
import type {LocalDraft} from './data/types';
export function RecordSyncPanel(){
 const records=useRecords(),navigate=useNavigate(),location=useLocation();
 return <section aria-label="记录同步"><h3>记录同步</h3>
 {records.lastCheckedAt&&<p>最近同步 {new Date(records.lastCheckedAt).toLocaleString('zh-CN',{hour12:false})}</p>}
 <Action onClick={()=>void records.reload()}>立即同步</Action>
 {records.records.filter(item=>item.sync!=='synced').map(item=><p key={item.id}><Action onClick={()=>{records.updateUi({selected:item.id});navigate('/records/demo'+location.search);}}>{item.text.split('\n')[0].slice(0,50)||'附件记录'}</Action> · {item.sync==='conflict'?'需要比较':item.sync==='failed'?'上传失败':'待上传'}</p>)}
 {records.recoveries.flatMap(item=>(item.recoveryDrafts as LocalDraft[]).map((draft,index)=><p key={item.id+':'+index}><Action onClick={()=>void records.service.openRecovery(item.id,index).then(records.reload).then(()=>navigate('/records/new'+location.search)).catch(e=>records.setError(e.message))}>恢复草稿 · {draft.text.split('\n')[0].slice(0,50)||'附件记录'}</Action></p>))}
 {records.error&&<p role="alert">{records.error}</p>}
 </section>;
}
