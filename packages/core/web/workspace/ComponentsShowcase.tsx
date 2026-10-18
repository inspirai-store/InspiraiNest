import {ModuleComponentsShowcase} from './ModuleComponentsShowcase';
import { StateShowcase } from './StateShowcase';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bookmark, Ellipsis, ExternalLink, Plus } from 'lucide-react';
import { Action, Badge, ChoiceBar, EntityRow, IconAction, SearchField } from '../../../ui-react/src/Controls';
import { ContentHeader, ContentPane, ListPane, SourceActions, SplitPane, WorkspaceHeader } from '../../../ui-react/src/Workspace';
import { AttachmentCard } from '../../../ui-react/src/AttachmentCard';
import { DeleteDialog, MoreMenu, TagsDialog } from '../../../ui-react/src/Overlays';
import { ControlsShowcase } from './ControlsShowcase';
import { records } from './mock';
import workbench from '../../../ui-react/src/Workbench.module.css';
import styles from './ComponentsShowcase.module.css';

export function ComponentsShowcase() {
  const location = useLocation(), navigate = useNavigate();
  const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('全部');
  const [bookmarked, setBookmarked] = useState(false);
  const [tags, setTags] = useState(['阅读']);
  const [modal, setModal] = useState<{ kind: 'tags' | 'delete'; invoker: HTMLButtonElement } | null>(null);
  const entry = records[selected]!;
  return <div className={workbench.app} data-theme={theme}>
    <WorkspaceHeader title="组件" actions={<><Action aria-pressed={theme === 'light'} onClick={() => navigate('/components')}>浅色</Action><Action aria-pressed={theme === 'dark'} onClick={() => navigate('/components?theme=dark')}>深色</Action></>} />
    <div className={styles.scroll}>
      <ModuleComponentsShowcase/>
      <section className={styles.sample}>
        <WorkspaceHeader title="记录" actions={<Action icon={Plus} kind="primary" onClick={() => navigate('/records/new' + location.search)}>新建记录</Action>} />
        <div className={styles.layout}>
          <SplitPane view="detail">
            <ListPane label="记录列表">
              <div className={workbench.listFilters}><SearchField label="搜索记录" value={query} onChange={event => setQuery(event.target.value)} /><ChoiceBar label="记录状态" options={['全部', '未加工', '待确认', '待同步']} value={filter} onChange={setFilter} /></div>
              <div className={workbench.rows}>{records.map((item, index) => (item.title + item.excerpt).includes(query) && (filter === '全部' || item.state === filter) && <EntityRow key={item.title} entry={item} selected={selected === index} onClick={() => setSelected(index)} />)}</div>
            </ListPane>
            <ContentPane label="记录内容" backLabel="记录列表" onBack={() => navigate('/records' + location.search)}>
              <ContentHeader title={entry.title} actions={<Badge>{entry.state}</Badge>} />
              <SourceActions source={entry.date}><IconAction icon={Bookmark} label="收藏资料" aria-pressed={bookmarked} onClick={() => setBookmarked(value => !value)} /><Action icon={ExternalLink} compact kind="ghost">来源</Action><MoreMenu icon={Ellipsis} compact onAction={(kind, invoker) => { if (kind !== 'copy') setModal({kind, invoker}); }} /></SourceActions>
              <p>{entry.excerpt}</p><AttachmentCard name="阅读想法.m4a" duration="02:18" />
            </ContentPane>
          </SplitPane>
        </div>
      </section>
      <ControlsShowcase embedded />
      <StateShowcase />
    </div>
    {modal?.kind === 'tags' && <TagsDialog invoker={modal.invoker} close={() => setModal(null)} value={tags} apply={setTags} manage />}
    {modal?.kind === 'delete' && <DeleteDialog title={entry.title} invoker={modal.invoker} close={() => setModal(null)} confirm={() => setSelected((selected + 1) % records.length)} />}
  </div>;
}
