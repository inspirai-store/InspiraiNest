import {usePlugins} from '../../../plugin-sdk/react';
import {useOptionalDesktopRuntime} from '../platform/DesktopRuntime';
import { WorkspaceHeader } from '../../../ui-react/src/Workspace';
import { MoreMenu, MenuButton } from '../../../ui-react/src/Overlays';
import type { ReactNode } from 'react';
import { Bookmark, ChevronDown, Ellipsis, Library, ListChecks, Pencil, Feather, Plus, Settings2, UserRound } from 'lucide-react';
import brand from '../assets/brand.png';
import { Action, Badge, NavigationButton } from '../../../ui-react/src/Controls';
import styles from '../../../ui-react/src/Workbench.module.css';

export function AppShell({ area, go, children, onAction, favoritesOnly, onFavorites, taskCount = 2, libraryControlsDisabled = false, favoritesDisabled = libraryControlsDisabled, libraryMenu, title, workspaceActions }: {
  title?:string;workspaceActions?:ReactNode;
  libraryMenu?: ReactNode;
  favoritesDisabled?: boolean;
  libraryControlsDisabled?: boolean;
  taskCount?: number; favoritesOnly: boolean; onFavorites: () => void;
  onAction: (action: 'tags' | 'copy' | 'delete', invoker: HTMLButtonElement) => void;
  area: string; go: (path: string) => void; children: ReactNode;
}) {
  const records = area === 'records';
  const runtime=useOptionalDesktopRuntime();
  const currentTaskCount=runtime?runtime.taskCount:taskCount;
  const {snapshot,available}=usePlugins();
  const pluginNavigation=(snapshot?.plugins??[]).filter(p=>available(p.id)).flatMap(p=>p.contributes.navigation);
  return <>
    <header className={styles.topbar} data-region="应用顶栏">
      <div className={styles.brand} data-region="品牌"><img src={brand} alt="" /><span>灵藏</span></div>
      <div className={styles.topActions} data-region="顶栏操作">
        <MenuButton label="我的资料空间" icon={UserRound} className={styles.space} triggerRegion="资料空间" triggerContent={<><i/><span>我的资料空间</span><ChevronDown size={16}/></>} width={160} align="end" region="资料空间菜单" options={[{label:"账号",icon:UserRound,select:()=>go("/settings/account")}]} />
        <button className={styles.tasks} data-region="任务入口" onClick={()=>go('/tasks')}><ListChecks size={16} /><span>任务</span><Badge kind="warning">{currentTaskCount}</Badge></button>
      </div>
    </header>
    <div className={styles.body} data-region="应用主体">
      <nav className={styles.nav} data-region="一级导航" aria-label="主导航">
        <NavigationButton icon={Pencil} selected={records} data-region="导航 / 记录" onClick={() => go('/records')} aria-label="记录">记录</NavigationButton>
        <NavigationButton icon={Library} selected={area==='library'} data-region="导航 / 资料库" onClick={() => go('/library')} aria-label="资料库">资料库</NavigationButton>
        {pluginNavigation.map(item=><NavigationButton key={item.id} icon={Feather} selected={area===item.id} data-region={'导航 / '+item.label} onClick={()=>go(item.path)} aria-label={item.label}>{item.label}</NavigationButton>)}
        <div className={styles.spacer} />
        <NavigationButton icon={Settings2} selected={area==='settings'} data-region="导航 / 设置" onClick={()=>go('/settings/general')} aria-label="设置">设置</NavigationButton>
      </nav>
      <main className={styles.workspace} data-region="工作区">
        <WorkspaceHeader title={title??(records ? '记录' : '资料库')} actions={workspaceActions??(records ? <Action icon={Plus} kind="primary" onClick={() => go('/records/new')}>新建记录</Action> : <><Action icon={Bookmark} kind="ghost" disabled={favoritesDisabled} aria-pressed={favoritesOnly} onClick={onFavorites}>只看收藏</Action><div className={styles.libraryMore}>{libraryMenu ?? (libraryControlsDisabled ? <Action icon={Ellipsis} kind="ghost" disabled>更多</Action> : <MoreMenu icon={Ellipsis} iconOnly={false} onAction={onAction} />)}</div></>)} />
        {children}
      </main>
    </div>
  </>;
}
