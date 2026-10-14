import { CircleAlert, FilePenLine, Library, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Action } from './Controls';
import styles from './AsyncState.module.css';

export function StatePanel({ title, kind, action, onAction, primary = false, region, icon }: {
  title: string; kind: 'records-empty' | 'library-empty' | 'no-results' | 'error';
  action?: string; onAction?: () => void; primary?: boolean; region: string;
  icon?: LucideIcon;
}) {
  const Icon = icon ?? (kind === 'records-empty' ? FilePenLine : kind === 'library-empty' ? Library : kind === 'no-results' ? Search : CircleAlert);
  return <div className={styles.state} data-state={kind} data-region={region} role={kind === 'error' ? 'alert' : 'status'}>
    <Icon size={32} className={kind === 'error' ? styles.error : styles.icon} aria-hidden="true" />
    <p>{title}</p>{action && <Action kind={primary ? 'primary' : 'secondary'} onClick={onAction}>{action}</Action>}
  </div>;
}
export function ListSkeleton() {
  return <div className={styles.listSkeleton} data-region="条目列表" aria-busy="true" aria-label="加载记录或资料">
    {[0, 1, 2, 3].map(index => <div className={styles.skeletonRow} key={index} data-region={'条目骨架 ' + index} aria-hidden="true">
      <i data-region={`骨架 ${index}-0`} className={styles.bone} style={{ height: 16 }} /><i data-region={`骨架 ${index}-1`} className={styles.bone} style={{ height: 14, width: 180 }} /><i data-region={`骨架 ${index}-2`} className={styles.bone} style={{ height: 12, width: 96 }} />
    </div>)}
  </div>;
}
export function ContentSkeleton({ reader = false }: { reader?: boolean }) {
  return <div className={styles.contentSkeleton} aria-busy="true" aria-label={reader ? '加载资料内容' : '加载记录内容'}>
    <div className={styles.skeletonTitle} style={{ height: reader ? 36 : 32 }} data-region="内容标题"><i data-region="标题骨架" className={styles.bone} style={{ width: 256, height: 24 }} /><i data-region="标题操作骨架" className={styles.bone} style={{ width: reader ? 32 : 64, height: 24 }} /></div>
    <div className={styles.skeletonMeta} style={{ height: reader ? 32 : 20 }} data-region={reader ? '来源与操作' : '记录信息'}><i data-region="元信息骨架" className={styles.bone} style={{ width: 144, height: 12 }} /></div>
    <div className={styles.skeletonActions} style={{ height: reader ? 40 : 36 }} data-region={reader ? '阅读分类' : '记录操作'}>{Array.from({length: reader ? 4 : 2}, (_, i) => <i key={i} data-region={`操作骨架 ${i}`} className={styles.bone} style={{ width: reader ? 48 : 112, height: reader ? 32 : 36, borderRadius: 6 }} />)}</div>
    <div className={`${styles.skeletonBody} ${reader ? styles.readerBody : ''}`} data-region={reader ? '阅读滚动区' : '原始内容'}>{Array.from({length: 6}, (_, i) => <i key={i} data-region={`正文骨架 ${i}`} className={styles.bone} style={{ width: i === 2 ? 240 : i === 5 ? 200 : '100%', height: i === 2 ? 24 : 18 }} />)}</div>
    {!reader && <><i data-region="附件标题骨架" className={styles.bone} style={{ width: 48, height: 20 }} /><i data-region="音频附件骨架" className={styles.bone} style={{ height: 80, borderRadius: 8 }} /></>}
  </div>;
}
