import {useTaskCreation} from '../content/TaskCreate';
import {useContentActions} from '../content/ContentActions';
import {useCommandSurface} from '../interactions/InteractionProvider';
import type {Command} from '../../../plugin-sdk/commands';
import {Copy} from 'lucide-react';
import {useAppTheme} from '../settings/SettingsProvider';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUiState } from '../workspace/UiState';
import { rememberPage, restorePage } from '../workspace/PageMemory';
import { useLocation, useNavigate,useParams } from 'react-router-dom';
import { libraryDateLabel } from './data/date-label';
import { LibraryAttachments } from './LibraryAttachments';

import { LibraryMarkdown } from './LibraryMarkdown';
import { FileText, Bookmark, ChevronDown, ExternalLink, Tag, Ellipsis, Trash2 } from 'lucide-react';
import { AppShell } from '../app/AppShell';
import { ContentHeader, ContentPane, ListPane, SourceActions, SplitPane } from '../../../ui-react/src/Workspace';
import { Action, ChoiceBar, EntityRow, IconAction, SearchField } from '../../../ui-react/src/Controls';
import { ContentSkeleton, ListSkeleton, StatePanel } from '../../../ui-react/src/AsyncState';
import { MenuButton, TagsDialog } from '../../../ui-react/src/Overlays';
import { scrollReader } from '../../../ui-react/src/ReaderKeyboard';
import { focusListItem } from '../../../ui-react/src/ListKeyboard';
import { useLibrarySession } from './LibraryProvider';
import { useLibraryData } from './useLibraryData';
import { useRecords } from '../records/RecordsProvider';
import styles from '../../../ui-react/src/Workbench.module.css';

const types: Record<string, string> = { 文章: 'article', 笔记: 'note', 文档: 'document', 音频: 'audio', 视频: 'video', 网页: 'webpage', 图片: 'image', 代码项目: 'repository', 其他: 'other' };
const states: Record<string, string> = { 已归档: 'archived', 待补齐: 'partial', 待处理: 'pending' };
export function LiveLibrary() {
  const location = useLocation(), navigate = useNavigate(), params=useParams();
  const theme=useAppTheme(),dark=theme==='dark';
  const { taskCount } = useRecords();
  const contentActions=useContentActions(),taskCreation=useTaskCreation();
  const [tagsInvoker,setTagsInvoker]=useState<HTMLElement|null>(null);
  const [scrollFraction,setScrollFraction]=useState(0);

  const [operationError,setOperationError]=useState(false);
  const root = useRef<HTMLDivElement>(null), readerScroll = useRef<HTMLDivElement>(null);
  const { state, setState, pages } = useUiState();
  const ui = state.liveLibrary;
  const { query, type, status, selected } = ui;
  const update = (patch: Partial<typeof ui>) => setState(current => ({ ...current, liveLibrary: { ...current.liveLibrary, ...patch } }));
  const setQuery = (query: string) => update({ query });
  const setType = (type: string) => update({ type });
  const setStatus = (status: string) => update({ status });
  const setSelected = (selected: string | null) => update({ selected });
  const {bookmarks,bookmarksReady,bookmarkError,toggleBookmark,session:librarySession} = useLibrarySession();
  const previousSession=useRef(librarySession);useEffect(()=>{if(previousSession.current!==librarySession&&params.id)navigate('/library'+location.search);previousSession.current=librarySession;},[librarySession,params.id,navigate,location.search]);
  const currentSession=useRef(librarySession); currentSession.current=librarySession;
  const data = useLibraryData({ q: query.trim(), type: types[type], status: states[status], tag:ui.tags[0] }, selected, ui.tabs, ui.favoritesOnly ? bookmarks : null,ui.tags,!!tagsInvoker,params.id??null);
  const listLoading = data.list.isPending || (ui.favoritesOnly || ui.tags.length>1) && !!data.list.hasNextPage && !data.list.isError;
  const currentTab = data.id ? ui.tabs[data.id] ?? (data.entry.data?.files.some(f=>f.role==='publication')?'正文':'摘要') : '摘要';
  const setTab = (tab: string) => { if (data.id) update({ selected: data.id, tabs: { ...ui.tabs, [data.id]: tab } }); };
  const pageKey = 'library-live:' + (data.id ?? '') + ':' + currentTab;
  const remember = () => { const memory = rememberPage(root.current); pages.set(pageKey, { ...memory, focus: memory.focus ?? pages.get(pageKey)?.focus ?? null }); };
  const go = (path: string) => { remember(); navigate(path + location.search,{state:path==='/settings/account'?{settingsFocus:'content'}:null}); };
  useLayoutEffect(() => { if(root.current?.querySelector('[aria-label="搜索资料"]')===document.activeElement)return; if (!data.list.isPending && !data.content.isFetching) restorePage(root.current, pages.get(pageKey)); }, [pageKey, pages, data.list.isPending, data.content.isFetching]);

  useEffect(() => { if (location.state?.focus === 'search') root.current?.querySelector<HTMLInputElement>('[aria-label="搜索资料"]')?.focus(); }, [location.key, location.state]);
  const entry = data.entry.data ?? data.items.find(item=>item.id===data.id);
  const source = entry?.canonical_url || entry?.source_url;
  const collectedLabel=libraryDateLabel(entry?.collected_at);
  const sourceLabel = entry ? [Object.keys(types).find(key => types[key] === entry.type) || entry.type, collectedLabel].filter(Boolean).join(' · ') : '';

  useEffect(()=>{setTagsInvoker(null);setOperationError(false);},[librarySession]);
  const clear = () => { setQuery(''); setType('全部类型'); setStatus('全部状态'); setSelected(null); update({favoritesOnly:false,tags:[]}); };
  const openEntry=(id:string)=>{setSelected(id);go('/library/demo');};
  const itemCommands=(item:import('./data/client').LibraryEntry):Command[]=>[{id:'library.task',label:'创建任务',opensDialog:true,run:async()=>{const full=await libraryClient.entry(item.id);const file=(item.id===data.id&&currentTab!=='附件'?full.files.find(f=>f.path===data.file?.path):undefined)??full.files.find(f=>f.role==='publication')??full.files.find(f=>f.role==='summary');const body=file?(await libraryClient.content(item.id,file.path)).content:full.summary??full.title;const url=full.canonical_url||full.source_url||'';taskCreation.open({key:'library:'+full.id,text:body+(url?'\n\n来源：'+url:''),url,files:full.files.map(f=>({name:f.path.split('/').at(-1)!,load:async()=>{if(!window.library?.taskFile)throw Error('需更新客户端');const result=await window.library.taskFile({id:full.id,file:f.path});const bytes=Uint8Array.from(atob(result.bytes),c=>c.charCodeAt(0));return new File([bytes],result.name);}}))});}},{id:'library.open',label:'打开',run:()=>openEntry(item.id)},{id:'library.bookmark',label:bookmarks.includes(item.id)?'取消收藏':'收藏',icon:Bookmark,disabled:!bookmarksReady,run:()=>toggleBookmark(item.id)},{id:'library.copy',label:'复制标题',icon:Copy,run:()=>navigator.clipboard.writeText(item.title)},{id:'library.tags',label:'标签',icon:Tag,disabled:!item.tags?.length,children:item.tags?.map(tag=>({id:'library.tag.'+tag,label:tag,run:()=>update({tags:[tag],selected:null})}))},{id:'library.source',label:'来源',icon:ExternalLink,disabled:!item.canonical_url&&!item.source_url,run:()=>window.library?.openUrl?.(item.canonical_url||item.source_url||'')},{id:'library.delete',label:'删除',icon:Trash2,danger:true,separator:true,opensDialog:true,run:()=>contentActions.remove({type:'library',id:item.archive_id,title:item.title,version:0,trashVersion:0},[],()=>{if(data.id===item.id){const index=data.items.findIndex(i=>i.id===item.id),next=data.items[index+1]??data.items[index-1];setSelected(next?.id??null);go(next?'/library/demo':'/library');}})}];
  const libraryClient=useLibrarySession().client;
  useCommandSurface(root,{commands:()=>entry?itemCommands(entry):[],quick:async query=>{const result=await libraryClient.entries({q:query,limit:50});return result.items.map(item=>({id:item.id,label:item.title,run:()=>openEntry(item.id)}));},newRecord:()=>go('/records/new'),search:()=>{const input=root.current?.querySelector<HTMLInputElement>('[aria-label="搜索资料"]');if(input?.getClientRects().length)input.focus();else navigate('/library'+location.search,{state:{focus:'search'}});}});
  return <div ref={root} onFocusCapture={remember} className={styles.app} data-list-first-error={data.list.isError && !data.id || undefined} data-theme={theme}>
    <AppShell area="library" go={go} taskCount={taskCount} libraryControlsDisabled libraryMenu={<MenuButton label="更多" icon={Ellipsis} iconOnly={false} compact={false} offset={dark?6:8} kind="ghost" width={160} align="end" options={[{label:"回收站",icon:Trash2,opensDialog:true,select:contentActions.openTrash}]} />} favoritesDisabled={!bookmarksReady} favoritesOnly={ui.favoritesOnly} onFavorites={() => update({favoritesOnly:!ui.favoritesOnly,selected:null})} onAction={() => {}}>
      <SplitPane view={location.pathname!== '/library' ? 'detail' : 'list'}>
        <ListPane label="资料列表">
          <div className={styles.listFilters} data-region="列表搜索筛选">
            <SearchField label="搜索资料" value={query} onChange={event => { setQuery(event.target.value); setSelected(null); }} onKeyDown={event => { if (event.key === 'Escape') clear(); }} />
            <div className={styles.filters} data-region="筛选栏">
              <MenuButton label={type} icon={ChevronDown} compact region="类型菜单" options={['全部类型', ...Object.keys(types)].map(label => ({ label, selected: label === type, select: () => { setType(label); setSelected(null); } }))} />
              <MenuButton label={status} icon={ChevronDown} compact options={['全部状态', ...Object.keys(states)].map(label => ({ label, selected: label === status, select: () => { setStatus(label); setSelected(null); } }))} />
              <Action icon={Tag} kind="ghost" compact aria-pressed={ui.tags.length>0} onClick={event=>setTagsInvoker(event.currentTarget)}>标签</Action>
            </div>
          </div>
          {listLoading ? <ListSkeleton /> : data.list.isError ? <StatePanel kind="error" title="资料加载失败" action="重试" region="条目列表" onAction={() => void data.list.refetch()} /> : !data.items.length ? <StatePanel kind="no-results" title="无匹配资料" action="清除" region="条目列表" onAction={clear} /> : <div className={styles.rows} data-region="条目列表" onKeyDown={focusListItem} onWheel={event=>{const el=event.currentTarget;if(event.deltaY>0&&el.scrollHeight<=el.clientHeight&&data.list.hasNextPage&&!data.list.isFetchingNextPage)void data.list.fetchNextPage();}} onScroll={event => { const el = event.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 96 && data.list.hasNextPage && !data.list.isFetchingNextPage) void data.list.fetchNextPage(); }}>
            {data.items.map(item => <EntityRow key={item.id} commands={itemCommands(item)} data-row={item.id} selected={item.id === data.id} entry={{ title: item.title, excerpt: item.summary || '', date: libraryDateLabel(item.collected_at), state: `${Object.keys(types).find(key => types[key] === item.type) || item.type} · ${Object.keys(states).find(key => states[key] === item.status) || item.status}` }} onClick={() => { setSelected(item.id); go('/library/demo'); }} />)}
          </div>}
          <footer className={styles.listCount} data-region="列表数量">{listLoading ? '加载中' : data.list.isError ? '加载失败' : `${ui.favoritesOnly || ui.tags.length>1 ? data.items.length : data.list.data?.pages[0]?.total ?? 0} 条资料`}</footer>
        </ListPane>
        <ContentPane label="资料内容" backLabel="资料列表" onBack={() => go('/library')}>
          {listLoading ? <ContentSkeleton reader /> : data.list.isError && !data.id ? null : !data.id ? <StatePanel kind="library-empty" title="暂无资料" region="内容状态" /> : data.entry.isPending ? <ContentSkeleton reader /> : entry && <>
            <ContentHeader title={entry.title} reader actions={<IconAction icon={Bookmark} label="收藏资料" disabled={!bookmarksReady} aria-pressed={bookmarks.includes(entry.id)} onClick={() => toggleBookmark(entry.id)} />} />
            <SourceActions source={sourceLabel}><Action icon={ExternalLink} kind="ghost" compact disabled={!source} onClick={() => { if (source) void window.library?.openUrl?.(source); }}>来源</Action><MenuButton label="更多" icon={Ellipsis} iconOnly compact kind="ghost" width={200} align="end" options={itemCommands(entry).filter(c=>c.id!=='library.open'&&!c.children).map(c=>({label:c.label,icon:c.icon,disabled:c.disabled,danger:c.danger,separator:c.separator,opensDialog:c.opensDialog,select:()=>{void c.run?.();}}))}/></SourceActions>
            <ChoiceBar label="资料阅读内容" options={entry.files.some(f=>f.role==='publication')?['正文','摘要','分析','原文','附件']:['摘要','分析','原文','附件']} value={currentTab} onChange={setTab} tabs idPrefix="live-library-reader" />
            <div className={styles.readerViewport} data-region="阅读滚动区" role="tabpanel" id="reader-panel" aria-labelledby={"live-library-reader-" + currentTab} tabIndex={0} onKeyDown={event => scrollReader(event, readerScroll.current)}>
              {operationError ? <StatePanel kind="error" title="操作失败" action="重试" region="阅读状态" onAction={()=>{setOperationError(false);void data.entry.refetch();}}/> : data.entry.isError && currentTab!=="附件" ? <StatePanel kind="error" title="内容加载失败" action="重试" region="阅读状态" onAction={()=>void data.entry.refetch()}/> : bookmarkError ? <StatePanel kind="error" title="内容加载失败" region="阅读状态" /> : data.content.isFetching && data.file ? <ContentSkeleton reader /> : data.content.isError ? <StatePanel kind="error" title="内容加载失败" action="重试" region="阅读状态" onAction={() => void data.content.refetch()} /> : <div className={styles.readerScroll} ref={readerScroll} data-region="阅读正文滚动" onScroll={event => { const element=event.currentTarget; setScrollFraction(element.scrollTop/Math.max(1,element.scrollHeight-element.clientHeight)); const memory = rememberPage(root.current); pages.set(pageKey, { ...memory, focus: memory.focus ?? pages.get(pageKey)?.focus ?? null }); }}>{currentTab === "附件" ? <LibraryAttachments key={entry.id+entry.archive_id} entry={entry} failed={data.entry.isError} retry={()=>void data.entry.refetch()}/> : !data.file && !(currentTab === '摘要' && entry.summary) ? <div className={styles.readerEmpty}><StatePanel kind="library-empty" icon={FileText} title={'暂无'+currentTab} region="阅读空态"/></div> : <LibraryMarkdown key={entry.id+':'+entry.archive_id+':'+currentTab} entry={entry} document={data.content.data?.file??data.file?.path??''} content={data.content.data?.content ?? (currentTab === "摘要" ? entry.summary ?? "" : "")} />}</div>}
              <div className={styles.readerTrack} data-region="阅读滚动条" aria-hidden="true"><div className={styles.readerThumb} data-region="滚动滑块" style={{transform:`translateY(${Math.max(0,(readerScroll.current?.clientHeight??96)-96)*scrollFraction}px)`}}/></div>
            </div>
          </>}
        </ContentPane>
      </SplitPane>
    </AppShell>
    {tagsInvoker&&<TagsDialog invoker={tagsInvoker} close={()=>setTagsInvoker(null)} value={ui.tags} availableTags={[...new Set(data.list.data?.pages.flatMap(page=>page.items.flatMap(item=>item.tags??[]))??[])]} apply={tags=>update({tags,selected:null})}/> }
    {contentActions.dialogs}{taskCreation.dialog}
  </div>;
}
