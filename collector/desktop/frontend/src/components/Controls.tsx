import {useRef} from 'react';
import {useCommandSurface} from '../interactions/InteractionProvider';
import type {Command} from '../interactions/commands';
import { useId } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import styles from '../app/Workbench.module.css';

export type VisualState = 'hover' | 'focus';
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { previewState?: VisualState; ref?: Ref<HTMLButtonElement> };

export function Action({ children, icon: Icon, kind = 'secondary', compact = false, previewState, className = '', ...props }: ButtonProps & {
  icon?: LucideIcon; kind?: 'primary' | 'secondary' | 'ghost'; compact?: boolean;
}) {
  return <button type="button" className={`${styles.action} ${styles[kind]} ${compact ? styles.compact : ''} ${className}`} data-preview-state={previewState} aria-label={typeof children === 'string' ? children : undefined} {...props}>{Icon && <Icon size={16} />}<span>{children}</span></button>;
}
export function IconAction({ icon: Icon, label, compact = false, previewState, className = '', ...props }: ButtonProps & { icon: LucideIcon; label: string; compact?: boolean }) {
  return <button type="button" className={`${styles.iconAction} ${compact ? styles.compact : ''} ${className}`} data-preview-state={previewState} aria-label={label} {...props}><Icon size={16} /></button>;
}
export function Badge({ children, kind = 'neutral', ...props }: HTMLAttributes<HTMLSpanElement> & { children: ReactNode; kind?: 'neutral' | 'accent' | 'warning' | 'danger' }) {
  return <span className={`${styles.badge} ${styles[kind + 'Badge']}`} {...props}><span>{children}</span></span>;
}

export function SearchField({ label, previewState, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; previewState?: VisualState }) {
  return <label className={styles.search} data-region="搜索" data-preview-state={previewState} data-disabled={props.disabled || undefined}>
    <Search size={16} /><input type="search" aria-label={label} placeholder={label} {...props} onKeyDown={event => {
      if (event.key === 'Escape' && event.currentTarget.value === '') event.currentTarget.blur();
      props.onKeyDown?.(event);
    }} />
  </label>;
}

export function ChoiceBar({ label, options, value, onChange, tabs = false, idPrefix, disabledOptions=[] }: {
  label: string; options: readonly string[]; value: string; onChange: (value: string) => void; tabs?: boolean; idPrefix?: string; disabledOptions?:readonly string[];
}) {
  const generatedId = useId();
  const id = idPrefix ?? generatedId;
  return <div className={tabs ? styles.readerTabs : styles.filters} role={tabs ? 'tablist' : 'group'} aria-label={label} data-region={tabs ? '阅读分类' : '筛选栏'} onKeyDown={event => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowRight' ? (current + 1) % buttons.length : event.key === 'ArrowLeft' ? (current - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); onChange(buttons[next]!.dataset.choice!); }
  }}>
    {options.map(option => <button type="button" key={option} data-choice={option} disabled={disabledOptions.includes(option)} id={id + '-' + option} role={tabs ? 'tab' : undefined} aria-selected={tabs ? option === value : undefined} aria-pressed={!tabs ? option === value : undefined} aria-controls={tabs ? 'reader-panel' : undefined} tabIndex={option === value ? 0 : -1} className={`${styles.tab} ${option === value ? styles.tabSelected : ''}`} onClick={() => onChange(option)}><span>{option}</span></button>)}
  </div>;
}

export function NavigationButton({ children, icon: Icon, selected = false, previewState, ...props }: ButtonProps & { icon: LucideIcon; selected?: boolean }) {
  return <button type="button" className={`${styles.navItem} ${selected ? styles.navSelected : ''}`} aria-current={selected ? 'page' : undefined} data-preview-state={previewState} {...props}><Icon size={18} /><span>{children}</span></button>;
}

export type Entry = { title: string; excerpt: string; date: string; state: string };
export function EntityRow({ entry, selected = false, warning = false, previewState, className = '', commands, ...props }: ButtonProps & {
  entry: Entry; selected?: boolean; warning?: boolean; commands?:Command[];
}) {
  const row=useRef<HTMLButtonElement>(null);useCommandSurface(row,{commands:()=>commands??[]});
  return <button ref={row} type="button" className={`${styles.row} ${selected ? styles.rowSelected : ''} ${className}`} aria-pressed={selected} data-preview-state={previewState} {...props}>
    <span className={styles.rowTitle}>{entry.title}</span><span className={styles.rowExcerpt}>{entry.excerpt}</span>
    <span className={styles.rowMeta}><span>{entry.date}</span><span className={warning ? styles.warningText : selected ? styles.accentText : ''}>{entry.state}</span></span>
  </button>;
}
