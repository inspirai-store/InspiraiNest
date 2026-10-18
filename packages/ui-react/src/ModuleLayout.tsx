import type {HTMLAttributes,ReactNode,Ref} from 'react';
import styles from './ModuleLayout.module.css';

type ContentProps=HTMLAttributes<HTMLDivElement>&{ref?:Ref<HTMLDivElement>;scroll?:'content'|'children'};
export function ModuleContent({children,className='',scroll='content',...props}:ContentProps){
 return <div className={`${styles.content} ${scroll==='content'?styles.scroll:styles.bounded} ${className}`} {...props}>{children}</div>;
}
export function ModuleHeader({title,actions,className='',height=36,...props}:{title:ReactNode;actions?:ReactNode;height?:29|32|36;className?:string}&Omit<HTMLAttributes<HTMLElement>,'title'>){
 return <header className={`${styles.header} ${className}`} style={{height}} {...props}><h2 title={typeof title==='string'?title:undefined}>{title}</h2>{actions}</header>;
}

export function ModuleActions({className='',...props}:HTMLAttributes<HTMLDivElement>){return <div className={`${styles.actions} ${className}`} {...props}/>;}
