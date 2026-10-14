import type {ReactNode} from 'react';import styles from './FileRows.module.css';
export function FileRows({items}:{items:readonly {id:string;label:string;value:ReactNode}[]}){return <div className={styles.files} role="list">{items.map(item=><div key={item.id} className={styles.file} role="listitem"><span>{item.label}</span><span>{item.value}</span></div>)}</div>;}
export function fileBytes(bytes:number){return bytes<1024?`${bytes} B`:`${(bytes/1024).toFixed(1)} KB`;}
