import {useState,useMemo,useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useNavigate,useLocation} from 'react-router-dom';
import {AppShell} from '../app/AppShell';
import {useLibrarySession} from '../library/LibraryProvider';
import {useAppTheme} from '../settings/SettingsProvider';
import {Action} from '../../../ui-react/src/Controls';
import {TaskExecution} from './TaskExecution';
import styles from '../../../ui-react/src/Workbench.module.css';
export function ExecutionRecords(){
 const navigate=useNavigate(),location=useLocation(),{session}=useLibrarySession(),filter=useMemo(()=>new URLSearchParams(location.search).get('deviceId'),[location.search]),[selected,setSelected]=useState(''),[cursor,setCursor]=useState('0'),[previous,setPrevious]=useState<any[]>([]);
 useEffect(()=>{setPrevious([]);setCursor('0');setSelected('');},[session,filter]);
 const query=useQuery({queryKey:['execution-records',session,filter,cursor],queryFn:()=>{const bridge=window.library as any;if(!bridge.diagnosticTasks)throw Error('请更新客户端以查看全部执行记录');return bridge.diagnosticTasks({deviceId:filter,cursor});},retry:false,refetchInterval:10000});
 const items=[...previous,...(query.data?.items||[])],current=items.find(t=>t.id===selected)||items[0];
 return <div className={styles.app} data-theme={useAppTheme()}><AppShell area="tasks" title="执行记录" workspaceActions={<></>} go={navigate} onAction={()=>{}} favoritesOnly={false} onFavorites={()=>{}}><section style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0}} aria-label="全部执行记录"><div style={{display:'flex',gap:12,padding:16,flexWrap:'wrap'}}><select aria-label="选择任务执行记录" value={current?.id||''} onChange={e=>setSelected(e.target.value)}>{items.map(t=><option key={t.id} value={t.id}>{t.session_id?'文稿创作':t.kind==='writing'?'写作':'采集'} · {new Date(t.created_at).toLocaleString('zh-CN')} · {t.id.slice(0,8)}</option>)}</select><Action onClick={()=>void query.refetch()}>刷新</Action>{query.data?.next_cursor&&<Action onClick={()=>{setPrevious(items);setCursor(query.data.next_cursor);}}>更多记录</Action>}</div>{query.isError?<p role="alert">执行记录读取失败</p>:current?<TaskExecution key={current.id} taskId={current.id} onConfigure={id=>navigate('/settings/nodes/'+id)}/>:<p>暂无执行记录</p>}</section></AppShell></div>;
}
