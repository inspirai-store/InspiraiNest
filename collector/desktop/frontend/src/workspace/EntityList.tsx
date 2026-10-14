import { ListPane } from '../components/Workspace';
import { ChevronDown, FilePenLine, Tag } from 'lucide-react';
import type { AreaState } from './UiState';
import { ListSkeleton, StatePanel } from '../components/AsyncState';
import { Action, Badge, ChoiceBar, EntityRow, SearchField } from '../components/Controls';
import { MenuButton } from '../components/Overlays';
import { library, records } from './mock';
import styles from '../app/Workbench.module.css';

export function EntityList({ area, view, selectedIndex, onSelect, go, onTags, removed, tags, favoritesOnly, ui, updateUi, preview, retry }: {
  ui: AreaState; updateUi: (patch: Partial<AreaState>) => void; preview: string | null; retry: () => void;
  tags: string[] | null; favoritesOnly: boolean;
  onTags: (invoker: HTMLButtonElement) => void; removed: number[];
  area: 'records' | 'library'; view: 'list' | 'new' | 'detail'; selectedIndex: number; onSelect: (index: number) => void; go: (path: string) => void;
}) {
  const isRecords = area === 'records';
  const draftSelected = view === 'new';
  const query = preview === 'no-results' && !ui.query ? '旅行' : ui.query;
  const {status,type,libraryStatus} = ui;
  const setQuery = (query: string) => {updateUi({query}); if (preview === 'no-results') retry();};
  const setStatus = (status: string) => updateUi({status});
  const setType = (type: string) => updateUi({type});
  const setLibraryStatus = (libraryStatus: string) => updateUi({libraryStatus});
  const entries = (isRecords ? records : library).map((entry, index) => ({ entry, index })).filter(({ entry, index }) => !removed.includes(index) && (isRecords || !favoritesOnly || index === 0 || index === 2) && (isRecords || !tags?.length || tags.some(tag => [['阅读', '知识管理'], ['阅读', '写作'], ['知识管理'], ['生活']][index]?.includes(tag))) && (type === '全部类型' || entry.state.startsWith(type)) && (libraryStatus === '全部状态' || entry.state.includes(libraryStatus)) &&
    (entry.title + entry.excerpt).includes(query.trim()) && (!isRecords || status === '全部' || entry.state === status));
  return <ListPane label={isRecords ? '记录列表' : '资料列表'}>
    <div className={styles.listFilters} data-region="列表搜索筛选">
      <SearchField label={isRecords ? '搜索记录' : '搜索资料'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setQuery(''); } }} />
      {isRecords ? <ChoiceBar label="记录状态" options={['全部', '未加工', '待确认', '待同步']} value={status} onChange={setStatus} /> : <div className={styles.filters} data-region="筛选栏"><MenuButton label={type} icon={ChevronDown} compact region="类型菜单" options={['全部类型', '文章', '笔记', '文档', '音频'].map(label => ({label, selected: label === type, select: () => setType(label)}))} /><MenuButton label={libraryStatus} icon={ChevronDown} compact options={['全部状态', '已归档', '待补齐'].map(label => ({label, selected: label === libraryStatus, select: () => setLibraryStatus(label)}))} /><Action icon={Tag} kind="ghost" compact onClick={event => onTags(event.currentTarget)}>标签</Action></div>}
    </div>
    {preview === 'loading' ? <ListSkeleton /> : preview === 'empty' ? <div className={styles.rows} data-region="条目列表" /> : preview === 'list-error' ? <StatePanel region="条目列表" kind="error" title="资料加载失败" action="重试" onAction={retry} /> : entries.length === 0 || preview === 'no-results' ? <StatePanel region="条目列表" kind="no-results" title={isRecords ? '无匹配记录' : '无匹配资料'} action="清除筛选" onAction={() => {updateUi({query:'',status:'全部',type:'全部类型',libraryStatus:'全部状态',tagFilter:null,favoritesOnly:false}); retry();}} /> : <div className={styles.rows} data-region="条目列表" onKeyDown={event => {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? Math.min(current + 1, buttons.length - 1) : event.key === 'ArrowUp' ? Math.max(current - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
    }}>
      {isRecords && <button className={`${styles.draft} ${draftSelected ? styles.rowSelected : ''}`} data-region="草稿" onClick={() => go('/records/new')}><FilePenLine size={16} /><span>草稿</span><div className={styles.spacer} /><Badge>本机</Badge></button>}
      {entries.map(({ entry, index }) => <EntityRow key={entry.title} entry={entry} selected={index === selectedIndex && (!isRecords || view !== 'new')} className={isRecords && view === 'list' ? styles.recordRowSelected : ''} warning={entry.state === '待确认'} data-row={index} onClick={() => { onSelect(index); go('/' + area + '/demo'); }} />)}
    </div>}
    <footer className={styles.listCount} data-region="列表数量">{preview === 'loading' ? '加载中' : preview === 'list-error' ? '加载失败' : <>{preview === 'empty' || preview === 'no-results' ? 0 : query || status !== '全部' || type !== '全部类型' || libraryStatus !== '全部状态' || (!isRecords && (favoritesOnly || !!tags?.length)) ? entries.length : (isRecords ? 24 : 18) - removed.length} 条{isRecords ? '记录' : '资料'}</>}</footer>
  </ListPane>;
}
