import {useState} from 'react';
import {Trash2,RotateCcw} from 'lucide-react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Modal} from '../components/Overlays';
import {Action} from '../components/Controls';
import {StatePanel,ListSkeleton} from '../components/AsyncState';
import {useLibrarySession} from './LibraryProvider';
import {libraryDateLabel} from './data/date-label';
import styles from './LibraryFiles.module.css';
export function LibraryTrash({invoker,close}:{invoker:HTMLElement;close:()=>void}) {
 const {client,session}=useLibrarySession(),cache=useQueryClient();
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState(false);
 const query=useQuery({queryKey:['live-library',session,'trash'],queryFn:()=>client.trash(),retry:false});
 const restore=async(id:string)=>{setBusy(id);setError(false);try{await client.restore(id);await cache.invalidateQueries({queryKey:['live-library',session]});}catch{setError(true);}finally{setBusy(null);}};
 return <Modal title="回收站" invoker={invoker} close={close} footer={null} className={styles.trash} region="回收站"><div className={styles.trashBody}>
 {query.isPending?<ListSkeleton/>:query.isError||error?<StatePanel region="回收站状态" kind="error" title={error?"恢复失败":"回收站加载失败"} action="重试" onAction={()=>{setError(false);void query.refetch();}}/>:!query.data?.length?<StatePanel region="回收站状态" kind="library-empty" icon={Trash2} title="回收站为空"/>:query.data.map(item=><div key={item.id} className={styles.row} data-region="回收站条目"><div className={styles.info}><strong title={item.title}>{item.title}</strong><span>{libraryDateLabel(item.deletedAt)+'删除'}</span></div><Action icon={RotateCcw} disabled={busy!==null} className={styles.restore} onClick={()=>void restore(item.archiveId)}>恢复</Action></div>)}
 </div></Modal>;
}
