import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Ellipsis, Pencil, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Action, Badge, EntityRow, IconAction, NavigationButton, SearchField } from '../../../ui-react/src/Controls';
import { records } from './mock';
import styles from './ControlsShowcase.module.css';
import workbench from '../../../ui-react/src/Workbench.module.css';

function Row({ label, name, children }: { label: string; name: string; children: ReactNode }) {
  return <div className={styles.row} data-state-row={name}><span className={styles.label}>{label}</span>{children}</div>;
}
export function ControlsShowcase({ embedded = false }: { embedded?: boolean }) {
  const mode = new URLSearchParams(useLocation().search).get('theme') === 'dark' ? 'dark' : 'light';
  const [search, setSearch] = useState('导航');
  const Container = embedded ? 'section' : 'main';
  return <Container className={`${workbench.app} ${styles.board} ${embedded ? styles.embedded : ''}`} data-theme={mode}>
    <h1>控件与状态</h1>
    <div className={styles.head}><span className={styles.label} /><span>默认</span><span>悬停</span><span>聚焦</span><span>禁用 / 选中</span></div>
    <Row label="主要按钮" name="primaryRow"><Action icon={Plus} kind="primary">新建记录</Action><Action icon={Plus} kind="primary" previewState="hover">新建记录</Action><Action icon={Plus} kind="primary" previewState="focus">新建记录</Action><Action icon={Plus} kind="primary" disabled>新建记录</Action></Row>
    <Row label="次要按钮" name="secondaryRow"><Action icon={Pencil}>编辑</Action><Action icon={Pencil} previewState="hover">编辑</Action><Action icon={Pencil} previewState="focus">编辑</Action><Action icon={Pencil} disabled>编辑</Action></Row>
    <Row label="搜索" name="searchRow"><SearchField label="搜索记录" /><SearchField label="搜索记录" previewState="hover" /><SearchField label="搜索记录" previewState="focus" value={search} onChange={e => setSearch(e.target.value)} /><SearchField label="搜索记录" disabled /></Row>
    <Row label="导航" name="navRow"><NavigationButton icon={Pencil}>记录</NavigationButton><NavigationButton icon={Pencil} previewState="hover">记录</NavigationButton><NavigationButton icon={Pencil} previewState="focus">记录</NavigationButton><NavigationButton icon={Pencil} selected>记录</NavigationButton></Row>
    <Row label="筛选" name="tabRow">{['全部', '未加工', '待确认', '全部'].map((value, i) => <button type="button" key={i} className={`${workbench.tab} ${i === 3 ? workbench.tabSelected : ''}`} aria-pressed={i === 3}><span>{value}</span></button>)}</Row>
    <Row label="状态" name="badgeRow"><Badge>未加工</Badge><Badge kind="accent">已同步</Badge><Badge kind="warning">待确认</Badge><Badge kind="danger">同步失败</Badge></Row>
    <Row label="列表条目" name="entityRow"><EntityRow entry={records[0]} /><EntityRow entry={records[0]} previewState="hover" /><EntityRow entry={records[0]} previewState="focus" /><EntityRow entry={records[0]} selected /></Row>
    <Row label="更多操作" name="moreRow"><Action icon={Ellipsis} kind="ghost">更多</Action><IconAction icon={Ellipsis} label="更多" /></Row>
  </Container>;
}
