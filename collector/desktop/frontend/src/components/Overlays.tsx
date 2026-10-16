import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronRight, Copy, Download, Tag, Trash2, X } from 'lucide-react';
import { Action, IconAction, SearchField } from './Controls';
import styles from './Overlays.module.css';

export type MenuOption = { label: string; icon?: LucideIcon; selected?: boolean; disabled?: boolean; danger?: boolean; separator?: boolean; select: (invoker: HTMLButtonElement) => void; opensDialog?: boolean };
export function MenuButton({ label, icon, options, width = 240, iconOnly = false, compact = false, kind = 'secondary', className = '', align = 'start', region, disabled=false, offset=4, triggerContent, triggerRegion }: {
  label: string; icon: LucideIcon; options: MenuOption[]; width?: number; iconOnly?: boolean; compact?: boolean;
  kind?: 'secondary' | 'ghost'; className?: string; align?: 'start' | 'end'; region?: string; disabled?:boolean; offset?:number; triggerContent?:ReactNode; triggerRegion?:string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const id = useId();
  const initialEdge = useRef<'first' | 'last'>('first');
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const focusableItems = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const height = menu.current!.getBoundingClientRect().height;
      const left = Math.max(8, Math.min(align === 'end' ? rect.right - width : rect.left, innerWidth - width - 8));
      const top = rect.bottom + offset + height <= innerHeight - 8 ? rect.bottom + offset : Math.max(8, rect.top - height - offset);
      setPosition({ left, top });
    };
    place();
    const items = focusableItems();
    (initialEdge.current === 'last' ? items.at(-1) : items[0])?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place); };
  }, [open, width, align, offset]);
  const buttonProps = { disabled, ref: trigger as Ref<HTMLButtonElement>, 'aria-haspopup': 'menu' as const, 'aria-expanded': open, 'aria-controls': open ? id : undefined,
    onClick: () => { initialEdge.current = 'first'; if (open) close(); else setOpen(true); },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialEdge.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true); }
    }, className };
  return <div className={styles.menuControl}>
    {triggerContent ? <button type="button" aria-label={label} data-region={triggerRegion} {...buttonProps}>{triggerContent}</button> : iconOnly ? <IconAction icon={icon} label={label} compact={compact} {...buttonProps} /> : <Action icon={icon} kind={kind} compact={compact} {...buttonProps}>{label}</Action>}
    {open && <div ref={menu} id={id} role="menu" aria-label={label} className={styles.menu} data-overlay={region ?? label} style={{ width, ...position }} onKeyDown={event => {
      const items = focusableItems(), index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); event.stopPropagation(); items[next]?.focus(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
    }}>
      <MenuRows options={options} choose={item => { if(item.opensDialog)trigger.current?.focus({preventScroll:true}); item.select(trigger.current!); close(!item.opensDialog); }} />
    </div>}
  </div>;
}

export function MoreMenu({ icon, iconOnly = true, compact = false, onAction, className, region, allowManage = true, allowDelete = true, onDownload }: {
  icon: LucideIcon; iconOnly?: boolean; compact?: boolean; className?: string; region?: string; allowManage?: boolean; allowDelete?: boolean; onDownload?: () => void;
  onAction: (action: 'tags' | 'copy' | 'delete', invoker: HTMLButtonElement) => void;
}) {
  return <MenuButton label="更多" icon={icon} iconOnly={iconOnly} kind="ghost" compact={compact} className={className} width={220} align="end" region={region ?? '更多菜单'} options={[
    { label: '管理标签', icon: Tag, disabled: !allowManage, opensDialog: true, select: invoker => onAction('tags', invoker) },
    { label: '复制标题', icon: Copy, select: invoker => onAction('copy', invoker) },
    { label: '下载附件', icon: Download, disabled: !onDownload, select: () => onDownload?.() },
    { label: '删除', icon: Trash2, disabled: !allowDelete, danger: true, separator: true, opensDialog: true, select: invoker => onAction('delete', invoker) },
  ]} />;
}

export function Modal({ title, children, footer, invoker, close, narrow = false, focusCancel = false, className = '', region }: {
  title: string; children: ReactNode; footer: ReactNode; invoker: HTMLElement; close: () => void; narrow?: boolean; focusCancel?: boolean; className?: string; region?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), backdropPress=useRef(false);
  const id = useId();
  const closeRef = useRef(close); closeRef.current = close;
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    if (focusCancel) {const cancel=element.querySelector<HTMLButtonElement>('[data-initial-cancel]');if(cancel&&!cancel.disabled)cancel.focus({preventScroll:true});else heading.current?.focus({preventScroll:true});}
    else heading.current?.focus({ preventScroll: true });
    return () => {
      if (element.open) element.close();
      if (invoker.isConnected && invoker.getClientRects().length) invoker.focus({ preventScroll: true });
    };
  }, [invoker, focusCancel]);
  return <dialog ref={dialog} className={`${styles.dialog} ${narrow ? styles.narrow : ''} ${className}`} aria-modal="true" aria-labelledby={id} data-overlay={region ?? (narrow ? '回收站确认框' : '标签对话框')} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter(el => el.getClientRects().length);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && (index === items.length - 1 || index === -1)) { event.preventDefault(); items[0]?.focus(); }
  }} onPointerDown={event=>{const rect=event.currentTarget.getBoundingClientRect();backdropPress.current=event.target===event.currentTarget&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);}} onCancel={event => { event.preventDefault(); closeRef.current(); }} onClick={event => {
    const outsidePress=backdropPress.current;backdropPress.current=false;
    if (!outsidePress||event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeRef.current();
  }}>
    <header className={styles.dialogHeader} data-overlay-region="对话框标题栏"><h2 ref={heading} id={id} tabIndex={-1}>{title}</h2><IconAction icon={X} label="关闭对话框" onClick={close} /></header>
    {children}<footer className={styles.dialogFooter} data-overlay-region="对话框操作">{footer}</footer>
  </dialog>;
}

const tagChoices = ['阅读', '知识管理', '写作', '生活'];
export function TagsDialog({ invoker, close, value, apply, manage = false, availableTags = tagChoices }: { invoker: HTMLElement; close: () => void; value: string[]; apply: (tags: string[]) => void; manage?: boolean; availableTags?: string[] }) {
  const [selected, setSelected] = useState(value);
  const [query, setQuery] = useState('');
  const choices = [...new Set([...availableTags,...value])].filter(tag => tag.includes(query));
  return <Modal title={manage ? '管理标签' : '筛选标签'} invoker={invoker} close={close} footer={<><Action onClick={() => manage ? close() : (setSelected([]), setQuery(''))}>{manage ? '取消' : '重置'}</Action><Action kind="primary" onClick={() => { apply(selected); close(); }}>{manage ? '完成' : '应用'}</Action></>}>
    <div className={styles.tagSearch} data-overlay-region="标签搜索区"><span>标签</span><SearchField label="搜索标签" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }} /></div>
    <div className={styles.tagOptions} data-overlay-region="标签选项" role="group" aria-label="标签选项" onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length : -1;
      if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    }}>{choices.map(tag => <button type="button" key={tag} className={`${styles.tag} ${selected.includes(tag) ? styles.tagSelected : ''}`} aria-pressed={selected.includes(tag)} onClick={() => setSelected(current => current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag])}><span>{tag}</span></button>)}</div>
  </Modal>;
}

export function DeleteDialog({ title, invoker, close, confirm }: { title: string; invoker: HTMLElement; close: () => void; confirm: () => void|Promise<void> }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title="删除" invoker={invoker} close={()=>{if(!busy)close();}} narrow focusCancel footer={<><Action className={styles.cancel} disabled={busy} data-initial-cancel onClick={close}>取消</Action><Action kind="primary" disabled={busy} onClick={()=>{setBusy(true);setError('');void Promise.resolve().then(confirm).then(close).catch(e=>setError(e instanceof Error?e.message:'删除失败')).finally(()=>setBusy(false));}}>删除</Action></>}>
    <p className={styles.question} data-overlay-region="确认问题"><span>将「{title}」移至回收站？</span></p>{error&&<p role="alert">{error}</p>}
  </Modal>;
}

export type MenuRow = {label:string; icon?:LucideIcon; selected?:boolean; disabled?:boolean; danger?:boolean; separator?:boolean; shortcut?:string; children?:unknown[]};
export function MenuRows<T extends MenuRow>({options,choose}:{options:T[];choose:(item:T)=>void}){
 return <>{options.map(({icon:Icon,...item},index)=><div key={item.label}>
  {item.separator&&<div className={styles.separator} role="separator"/>}
  <button type="button" role={item.selected!==undefined?'menuitemradio':'menuitem'} aria-checked={item.selected} aria-haspopup={item.children?.length?'menu':undefined} disabled={item.disabled} tabIndex={-1} className={`${styles.menuItem} ${item.selected?styles.selected:''} ${item.danger?styles.danger:''}`} onClick={()=>choose(options[index]!)}>
   {Icon&&<Icon size={16}/>}<span>{item.label}</span>{item.shortcut&&<kbd style={{font:'inherit',fontSize:11,color:'var(--muted)',whiteSpace:'nowrap'}}>{item.shortcut}</kbd>}{item.selected&&<Check size={16}/>} {!!item.children?.length&&<ChevronRight size={14}/>}
  </button>
 </div>)}</>;
}
