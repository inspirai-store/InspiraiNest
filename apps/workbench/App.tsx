import {webPlugins} from '../../plugins/registry.web';
import {PluginViewsProvider,usePluginViews} from '../../packages/plugin-sdk/views';
import {PluginProvider,usePlugins} from '../../packages/plugin-sdk/react';
import {InteractionProvider} from '../../packages/core/web/interactions/InteractionProvider';
import {StatusPanel} from '../../packages/core/web/status/StatusPanel';
import {updateBridge} from '../../packages/core/web/updates/client';
import {SettingsProvider,useAppTheme} from '../../packages/core/web/settings/SettingsProvider';
import {SettingsPage} from '../../packages/core/web/settings/SettingsPage';
import {DesktopRuntimeProvider} from '../../packages/core/web/platform/DesktopRuntime';
import {TasksPage} from '../../packages/core/web/tasks/TasksPage';
import {RichFixture} from '../../packages/core/web/records/RichFixture';
import {CameraDialog} from '../../packages/core/web/records/RecordMedia';
import {ProcessDialog,ConflictDialog} from '../../packages/core/web/records/RecordDialogs';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {RecordsProvider,useOptionalRecords} from '../../packages/core/web/records/RecordsProvider';
import {LiveRecords} from '../../packages/core/web/records/LiveRecords';
import { UiStateProvider, useUiState } from '../../packages/core/web/workspace/UiState';
import type { AreaState } from '../../packages/core/web/workspace/UiState';
import { rememberPage, restorePage } from '../../packages/core/web/workspace/PageMemory';
import { ContentSkeleton, StatePanel } from '../../packages/ui-react/src/AsyncState';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from '../../packages/core/web/app/AppShell';
import { EntityList } from '../../packages/core/web/workspace/EntityList';
import { RecordEditor, RecordDetail } from '../../packages/core/web/records/RecordPage';
import { LibraryReader } from '../../packages/core/web/library/LibraryPage';
import { LibraryProvider } from '../../packages/core/web/library/LibraryProvider';
import { LiveLibrary } from '../../packages/core/web/library/LiveLibrary';
import styles from '../../packages/ui-react/src/Workbench.module.css';
import { ContentPane, SplitPane } from '../../packages/ui-react/src/Workspace';
import { ComponentsShowcase } from '../../packages/core/web/workspace/ComponentsShowcase';
import { ControlsShowcase } from '../../packages/core/web/workspace/ControlsShowcase';
import { DeleteDialog, TagsDialog } from '../../packages/ui-react/src/Overlays';
import { library, records } from '../../packages/core/web/workspace/mock';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

function Workbench({ area, view }: { area: 'records' | 'library'; view: 'list' | 'new' | 'detail' }) {
  const realRecords=useOptionalRecords();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useAppTheme();
  const root = useRef<HTMLDivElement>(null);
  const {state, setState, pages} = useUiState();
  const ui = state[area], entryIndex = ui.selected;
  const pageKey = area + ':' + view + (view === 'detail' ? ':' + entryIndex : '');
  const remember = useCallback(() => { const memory = rememberPage(root.current); if (!memory.focus) memory.focus = pages.get(pageKey)?.focus ?? null; pages.set(pageKey, memory); pages.set(area + ':last',memory); }, [pageKey, pages, area]);
  const go = useCallback((path: string) => { remember(); navigate(path + location.search, {state: path === '/settings/account' ? {settingsFocus:'content'} : path === '/records/new' ? {focus:'editor'} : null}); }, [navigate, location.search, remember]);
  const updateArea = useCallback((patch: Partial<AreaState>) => setState(current => ({...current, [area]: {...current[area], ...patch}})), [area, setState]);
  const [modal, setModal] = useState<{kind: 'tags' | 'delete' | 'process' | 'conflict' | 'camera'; invoker: HTMLButtonElement; manage?: boolean} | null>(null);
  const [resolvedPreview, setResolvedPreview] = useState<string | null>(null);
  const requestedState = new URLSearchParams(location.search).get('state');
  const previewKey = location.pathname + location.search + ':' + location.key;
  const applicable = requestedState !== 'save-error' && requestedState !== 'reader-error' || requestedState === 'save-error' && area === 'records' && view === 'new' || requestedState === 'reader-error' && area === 'library';
  const preview = resolvedPreview === previewKey || !applicable ? null : requestedState;
  const dataEmpty = ui.removed.length >= (area === 'records' ? records : library).length;
  const listPreview = preview ?? (dataEmpty ? 'empty' : null);
  const retry = () => {
    setResolvedPreview(previewKey);
    if (preview === 'reader-error' || preview === 'list-error' || preview === 'no-results') requestAnimationFrame(() => {
      const target = root.current?.querySelector<HTMLElement>(preview === 'reader-error' ? '[data-region="阅读滚动区"]' : `input[aria-label="${area === 'records' ? '搜索记录' : '搜索资料'}"]`);
      if (target?.getClientRects().length) target.focus({preventScroll:true});
    });
  };
  useLayoutEffect(() => {
    const focus = () => {const memory = rememberPage(root.current); if (memory.focus) {pages.set(pageKey,memory); pages.set(area + ':last',memory);}};
    const resize = () => {restorePage(root.current,view === 'list' ? pages.get(area + ':last') ?? pages.get(pageKey) : pages.get(pageKey) ?? pages.get(area + ':last')); const active = document.activeElement; if (active instanceof HTMLElement && !active.getClientRects().length) root.current?.querySelector<HTMLButtonElement>('[data-region="返回列表"]')?.focus({preventScroll:true});};
    root.current?.addEventListener('focusin',focus); window.addEventListener('resize',resize);
    const element = root.current;
    return () => {element?.removeEventListener('focusin',focus);window.removeEventListener('resize',resize);};
  }, [pageKey,pages,area,view]);
  useLayoutEffect(() => { restorePage(root.current, view === 'list' ? pages.get(area + ':last') ?? pages.get(pageKey) : pages.get(pageKey) ?? pages.get(area + ':last')); }, [pageKey, location.key, pages, area, view]);
  useEffect(() => {
    const requestedModal=new URLSearchParams(location.search).get('modal');
    if (requestedModal === 'process' || requestedModal === 'conflict' || requestedModal === 'camera') {const button=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button')??[]).find(el=>el.textContent===(requestedModal==='camera'?'拍照':'加工'));if(button)setModal({kind:requestedModal,invoker:button});}
    if (requestedModal === 'tags') {
      const button = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(el => el.textContent === '标签');
      if (button) setModal({kind:'tags',invoker:button});
    }
  }, [location.key, location.search]);
  const removed = ui.removed;
  const title = (area === 'records' ? records : library)[entryIndex]?.title ?? '';
  const onAction = (action: 'tags' | 'copy' | 'delete', invoker: HTMLButtonElement) => {
    if (action === 'copy') { void navigator.clipboard.writeText(title).catch(() => {}); return; }
    setModal({kind: action, invoker, manage: true});
  };
  useEffect(() => {
    const focus = location.state?.focus;
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(focus === 'editor' ? '[aria-label="记录正文"]' : `input[aria-label="${area === 'records' ? '搜索记录' : '搜索资料'}"]`)?.focus());
  }, [location.key, location.state, area]);

  return <div ref={root} className={styles.app} data-theme={theme} data-state-scene={preview ? 'true' : undefined}>
    <AppShell taskCount={realRecords?realRecords.records.flatMap(r=>r.tasks??[]).filter(t=>!['completed','cancelled','failed'].includes(t.state)).length:undefined} area={area} go={go} onAction={onAction} favoritesOnly={ui.favoritesOnly} onFavorites={() => updateArea({favoritesOnly: !ui.favoritesOnly})}>
      <SplitPane view={view}>
        <EntityList key={area} area={area} view={view} selectedIndex={entryIndex} onSelect={index => updateArea({selected:index})} go={go} removed={removed} tags={ui.tagFilter} favoritesOnly={ui.favoritesOnly} ui={ui} updateUi={updateArea} preview={listPreview} retry={retry} onTags={invoker => setModal({kind: 'tags', invoker})} />
        <ContentPane label={area === 'records' ? '记录内容' : '资料内容'} backLabel={area === 'records' ? '记录列表' : '资料列表'} onBack={() => go('/' + area)}>
          {preview === 'loading' ? <ContentSkeleton reader={area === 'library'} /> : preview === 'empty' || (dataEmpty && view !== 'new') ? <StatePanel region="内容状态" kind={area === 'records' ? 'records-empty' : 'library-empty'} title={area === 'records' ? '暂无记录' : '暂无资料'} action={area === 'records' ? '新建记录' : undefined} primary onAction={() => {retry(); navigate('/records/new' + location.search.replace(/([?&])state=empty(&?)/, '$1').replace(/[?&]$/, ''), {state:{focus:'editor'}});}} /> : area === 'library' ? <LibraryReader selectedIndex={entryIndex} onAction={onAction} failed={preview === 'reader-error'} retry={retry} /> : view === 'new' && new URLSearchParams(location.search).has('rich') ? <RichFixture scene={new URLSearchParams(location.search).get('rich')??'editor'}/> : view === 'new' ? <RecordEditor media={new URLSearchParams(location.search).get('media')} forceFailure={preview === 'save-error'} onRetry={retry} /> : <RecordDetail selectedIndex={entryIndex} go={go} onAction={onAction} />}
        </ContentPane>
      </SplitPane>
    </AppShell>
    {modal?.kind==='camera'&&<CameraDialog preview invoker={modal.invoker} close={()=>setModal(null)} capture={async()=>{}}/>}
    {modal?.kind==='process'&&<ProcessDialog invoker={modal.invoker} close={()=>setModal(null)} submit={async()=>{}}/>}
    {modal?.kind==='conflict'&&<ConflictDialog invoker={modal.invoker} close={()=>setModal(null)} submit={async()=>{}}/>}
    {modal?.kind === 'tags' && <TagsDialog invoker={modal.invoker} close={() => setModal(null)} value={modal.manage ? ui.itemTags : ui.tags} apply={value => {if (modal.manage) updateArea({itemTags:value}); else updateArea({tags:value,tagFilter:value});}} manage={modal.manage} />}
    {modal?.kind === 'delete' && <DeleteDialog title={title} invoker={modal.invoker} close={() => setModal(null)} confirm={() => {updateArea({removed:[...removed,entryIndex],selected:(area === 'records' ? records : library).findIndex((_, index) => index !== entryIndex && !removed.includes(index))}); go('/' + area);}} />}

  </div>;
}

function PluginProviders({children}:{children:import('react').ReactNode}){const {active}=usePluginViews();return active.reduceRight((content,plugin)=>plugin.Provider?<plugin.Provider key={plugin.id}>{content}</plugin.Provider>:content,children);}
function PluginRoute({pluginId,Component}:{pluginId:string;Component:import('react').ComponentType}){const {available,loading}=usePlugins();return loading?<ContentSkeleton/>:available(pluginId)?<Component/>:<Navigate to="/records?data=local" replace/>;}
const queryClient=new QueryClient();
function RecordsRoute({view}:{view:'list'|'new'|'detail'}) {
 const location=useLocation();const preview=import.meta.env.DEV&&new URLSearchParams(location.search).get('data')==='fixture';return preview?<Workbench area="records" view={view}/>:<LiveRecords/>;
}
function LibraryRoute({view}:{view:'list'|'detail'}) {const location=useLocation();return import.meta.env.DEV&&new URLSearchParams(location.search).get('data')==='fixture'?<Workbench area="library" view={view}/>:<LiveLibrary/>;}
function SessionRoutes({children}:{children:import('react').ReactNode}){return <RecordsProvider><LibraryProvider><DesktopRuntimeProvider>{children}</DesktopRuntimeProvider></LibraryProvider></RecordsProvider>;}

export function App() {
  const updateNavigate=useNavigate(),updateLocation=useLocation(),updateSearch=useRef(updateLocation.search);updateSearch.current=updateLocation.search;
  useEffect(()=>updateBridge()?.onOpen?.(()=>updateNavigate('/settings/updates'+updateSearch.current,{state:{settingsFocus:'content',updateCheckRequest:Date.now()}})),[updateNavigate]);
  return <QueryClientProvider client={queryClient}><UiStateProvider><SettingsProvider><SessionRoutes><PluginProvider><PluginViewsProvider value={webPlugins}><PluginProviders><InteractionProvider><Routes>
    <Route path="/settings/nodes/:nodeId" element={<SettingsPage/>}/>
    <Route path="/settings/updates/:updateNodeId" element={<SettingsPage/>}/>
    {webPlugins.flatMap(plugin=>(plugin.settings??[]).filter(item=>item.path).map(item=><Route key={plugin.id+item.id} path={'/settings/'+item.path} element={<SettingsPage/>}/>))}
    <Route path="/settings/*" element={<SettingsPage/>}/>
    <Route path="/status" element={<StatusPanel/>} />
    {webPlugins.flatMap(plugin=>(plugin.routes??[]).map(route=><Route key={plugin.id+route.path} path={route.path} element={<PluginRoute pluginId={plugin.id} Component={route.Component}/>}/>))}
    <Route path="/tasks" element={<TasksPage/>} />
    <Route path="/tasks/:id" element={<TasksPage/>} />
    {import.meta.env.DEV&&<Route path="/components" element={<ComponentsShowcase />} />}
    {import.meta.env.DEV&&<Route path="/controls" element={<ControlsShowcase />} />}
    <Route path="/records" element={<RecordsRoute view="list" />} />
    <Route path="/records/new" element={<RecordsRoute view="new" />} />
    <Route path="/records/demo" element={<RecordsRoute view="detail" />} />
    <Route path="/library" element={<LibraryRoute view="list" />} />
    <Route path="/library/demo" element={<LibraryRoute view="detail" />} />
    <Route path="/library/:id" element={<LibraryRoute view="detail" />} />
    <Route path="*" element={<Navigate to="/records/new" replace />} />
  </Routes></InteractionProvider></PluginProviders></PluginViewsProvider></PluginProvider></SessionRoutes></SettingsProvider></UiStateProvider></QueryClientProvider>;
}
