import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import styles from '../app/Workbench.module.css';

type Children = { children: ReactNode };

export function WorkspaceHeader({ title, actions }: { title: string; actions: ReactNode }) {
  return <header className={styles.pageHeader} data-region="页面标题栏">
    <h1>{title}</h1><div className={styles.pageActions} data-region="页面操作">{actions}</div>
  </header>;
}

export function SplitPane({ view, children }: Children & { view: 'list' | 'new' | 'detail' }) {
  return <div className={`${styles.split} ${view === 'list' ? styles.listMode : styles.contentMode}`} data-region="列表与内容">{children}</div>;
}

export function ListPane({ label, children }: Children & { label: string }) {
  return <aside className={styles.list} data-region="列表区" aria-label={label}>{children}</aside>;
}

export function ContentPane({ label, backLabel, onBack, children }: Children & { label: string; backLabel: string; onBack: () => void }) {
  return <section className={styles.content} data-region="内容区" aria-label={label}>
    <button type="button" className={styles.back} data-region="返回列表" onClick={onBack}><ArrowLeft /><span>{backLabel}</span></button>
    {children}
  </section>;
}

export function ContentHeader({ title, actions, reader = false }: { title: string; actions: ReactNode; reader?: boolean }) {
  return <header className={`${styles.contentTitle} ${reader ? styles.libraryTitle : ''}`} data-region="内容标题"><h2>{title}</h2>{actions}</header>;
}

export function SourceActions({ source, children }: Children & { source: string }) {
  return <div className={styles.sourceRow} data-region="来源与操作"><span>{source}</span><div className={styles.sourceActions}>{children}</div></div>;
}
