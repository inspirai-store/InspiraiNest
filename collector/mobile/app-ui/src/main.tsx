import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Select from '@radix-ui/react-select';
import { ArrowLeft, Bookmark, Check, ChevronDown, FileText, Link2, Search, Video, X } from 'lucide-react';
import { Button } from './components/motion/button/base';
import { Tabs, TabsList, TabsTrigger } from './components/motion/tabs';
import './styles.css';

type FileRecord = { path: string; name: string; role: string; bytes: number };
type Entry = {
  id: string; archiveId: string; title: string; type: string; status: string;
  summary: string; tags: string[]; collected_at?: string | null;
  published_at?: string | null; creator?: string | null; thumbnail?: string | null;
  files: FileRecord[]; coverage_note?: string; source_url?: string;
  canonical_url?: string;
};
type LibraryData = { entries: Entry[]; documents: Record<string, string> };
type DocumentGroup = { id: string; label: string; files: FileRecord[] };
type TypeFilter = 'all' | 'article' | 'video' | 'webpage' | 'other';

declare global {
  interface Window {
    marked?: { parse: (text: string) => string };
    DOMPurify?: { sanitize: (html: string, options?: Record<string, unknown>) => string };
    NookBack?: () => void;
    NookTheme?: (mode: string, dark: boolean) => void;
  }
}

const kinds: Record<string, string> = {
  article: '文章', video: '视频', webpage: '网页', repository: '代码项目',
  note: '笔记', document: '文档', audio: '音频', image: '图片', other: '其他',
};
const typeOptions: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: '全部' }, { value: 'article', label: '文章' },
  { value: 'video', label: '视频' }, { value: 'webpage', label: '网页' },
  { value: 'other', label: '其他' },
];
const sourceRoles = new Set(['source', 'original', 'source_excerpt', 'source_snapshot', 'reference', 'document']);
const textFile = /\.(md|markdown|txt|srt|vtt)$/i;

function safeFileURL(path: string): string | undefined {
  if (!/^files\/[a-f0-9]{64}\/.+/.test(path) || path.split('/').some(part => part === '..' || part === '.')) return;
  return '/library/' + path.split('/').map(encodeURIComponent).join('/');
}

function nativeAttachmentURL(archive: string, path: string): string | undefined {
  if (!/^[a-f0-9]{64}$/.test(archive) || !path.startsWith(`files/${archive}/`) || !safeFileURL(path)) return;
  return `nook://attachment?archive=${archive}&file=${encodeURIComponent(path)}`;
}

function date(value?: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' });
}

function kindIcon(type: string) {
  if (type === 'video') return <Video size={14} strokeWidth={1.7} />;
  if (type === 'webpage') return <Link2 size={14} strokeWidth={1.7} />;
  return <FileText size={14} strokeWidth={1.7} />;
}

function documentGroups(entry: Entry): DocumentGroup[] {
  const groups: DocumentGroup[] = [
    { id: 'summary', label: '摘要', files: entry.files.filter(file => ['summary', 'analysis', 'scenario'].includes(file.role) && textFile.test(file.path)) },
    { id: 'source', label: '原文', files: entry.files.filter(file => sourceRoles.has(file.role) && textFile.test(file.path)) },
    { id: 'transcript', label: '转录', files: entry.files.filter(file => ['transcript', 'transcript_raw'].includes(file.role) && textFile.test(file.path)) },
  ];
  return groups.filter(group => group.files.length > 0);
}

function safeDocument(value: string, path: string): string {
  if (!window.marked || !window.DOMPurify) return '';
  if (!/\.(md|markdown)$/i.test(path)) {
    const pre = document.createElement('pre');
    pre.textContent = value;
    return pre.outerHTML;
  }
  const html = window.DOMPurify.sanitize(window.marked.parse(value), {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio'],
    FORBID_ATTR: ['style'],
  });
  const template = document.createElement('template');
  template.innerHTML = html;
  if (template.content.firstElementChild?.tagName === 'H1') template.content.firstElementChild.remove();
  const base = new URL(safeFileURL(path) || '/library/', location.href);
  template.content.querySelectorAll('a').forEach(link => {
    try {
      const target = new URL(link.getAttribute('href') || '', base);
      if (target.origin !== location.origin || !target.pathname.startsWith('/library/files/')) link.removeAttribute('href');
      else { link.href = target.href; link.rel = 'noopener noreferrer'; }
    } catch { link.removeAttribute('href'); }
  });
  template.content.querySelectorAll('img').forEach(image => {
    try {
      const target = new URL(image.getAttribute('src') || '', base);
      if (target.origin !== location.origin || !target.pathname.startsWith('/library/files/')) image.remove();
      else { image.src = target.href; image.loading = 'lazy'; image.alt ||= '原文配图'; }
    } catch { image.remove(); }
  });
  return template.innerHTML;
}

function DocumentBody({ value, path }: { value: string; path: string }) {
  const html = useMemo(() => safeDocument(value, path), [value, path]);
  return <article className="document-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

function App() {
  const [data, setData] = useState<LibraryData>({ entries: [], documents: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [type, setType] = useState<TypeFilter>('all');
  const [entryID, setEntryID] = useState<string | null>(new URLSearchParams(location.hash.slice(1)).get('entry'));
  const [section, setSection] = useState('summary');
  const [selectedFile, setSelectedFile] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('personal-library-favorites') || '[]') as string[]); }
    catch { return new Set(); }
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(false); }
    try {
      const response = await fetch('/library/data', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('library data unavailable');
      const payload = await response.json() as LibraryData;
      setData({ entries: Array.isArray(payload.entries) ? payload.entries : [], documents: payload.documents || {} });
    } catch { if (!silent) setError(true); }
    finally { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(true); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);
  useEffect(() => {
    const root = document.documentElement;
    const preference = matchMedia('(prefers-color-scheme: dark)');
    const followsSystem = !root.dataset.theme;
    const applySystem = () => { if (followsSystem) root.dataset.theme = preference.matches ? 'dark' : 'light'; };
    applySystem();
    preference.addEventListener('change', applySystem);
    window.NookTheme = (_mode, dark) => { root.dataset.theme = dark ? 'dark' : 'light'; };
    return () => { preference.removeEventListener('change', applySystem); delete window.NookTheme; };
  }, []);
  useEffect(() => {
    const onPopState = () => {
      setEntryID(new URLSearchParams(location.hash.slice(1)).get('entry'));
      void load(true);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [load]);
  useEffect(() => {
    window.NookBack = () => {
      if (entryID) { history.back(); return; }
      location.href = 'nook://exit';
    };
    return () => { delete window.NookBack; };
  }, [entryID]);

  const selected = data.entries.find(entry => entry.id === entryID);
  const groups = useMemo(() => selected ? documentGroups(selected) : [], [selected]);
  const activeGroup = groups.find(group => group.id === section) || groups[0];
  const activeFile = activeGroup?.files.find(file => file.path === selectedFile) || activeGroup?.files[0];
  const filtered = useMemo(() => data.entries
    .filter(entry => type === 'all' || (type === 'other' ? !['article', 'video', 'webpage'].includes(entry.type) : entry.type === type))
    .filter(entry => !query.trim() || [entry.title, entry.summary, ...(entry.tags || [])].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => (b.collected_at || '').localeCompare(a.collected_at || '')), [data.entries, query, type]);

  function open(entry: Entry) {
    setSection('summary'); setSelectedFile('');
    history.pushState(null, '', '#entry=' + encodeURIComponent(entry.id));
    setEntryID(entry.id);
    window.scrollTo(0, 0);
  }
  function back() { history.back(); }
  function toggleFavorite(entry: Entry) {
    const next = new Set(favorites);
    if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
    try { localStorage.setItem('personal-library-favorites', JSON.stringify([...next])); setFavorites(next); }
    catch { /* Private storage can be unavailable; the library remains readable. */ }
  }

  return <div className="mobile-app">
    {!selected ? <>
      <header className="library-header">
        <div className="library-title"><img src="./brand.png" alt="" /><h1>资料库</h1></div>
        <div className="library-actions">
          <Select.Root value={type} onValueChange={value => setType(value as TypeFilter)}>
            <Select.Trigger className="type-select" aria-label="筛选资料类型"><Select.Value /><Select.Icon><ChevronDown size={14} aria-hidden="true" /></Select.Icon></Select.Trigger>
            <Select.Portal><Select.Content className="type-menu" position="popper" side="bottom" align="end" sideOffset={7}>
              <Select.Viewport className="type-menu-viewport">{typeOptions.map(option =>
                <Select.Item className="type-menu-item" value={option.value} key={option.value}><Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check size={16} strokeWidth={1.8} aria-hidden="true" /></Select.ItemIndicator></Select.Item>
              )}</Select.Viewport>
            </Select.Content></Select.Portal>
          </Select.Root>
          <Button variant="ghost" size="icon" className="header-action" aria-label={searchOpen ? '关闭搜索' : '搜索资料库'} onClick={() => { setSearchOpen(value => !value); setQuery(''); }}>{searchOpen ? <X size={21} /> : <Search size={21} />}</Button>
        </div>
      </header>
      {searchOpen && <div className="search-row"><Search size={18} /><input autoFocus type="search" aria-label="搜索资料库" placeholder="搜索资料" value={query} onChange={event => setQuery(event.target.value)} /></div>}
      {error ? <div className="empty-state"><span>暂时无法读取资料</span><Button variant="outline" onClick={() => void load()}>重试</Button></div>
        : loading ? <div className="loading-state" role="status">正在读取资料</div>
          : filtered.length ? <div className="entry-list">{filtered.map(entry => <button type="button" className="entry-card" key={entry.id} onClick={() => open(entry)} aria-label={'阅读：' + entry.title}>
            {entry.thumbnail && safeFileURL(entry.thumbnail) ? <img className="entry-cover" src={safeFileURL(entry.thumbnail)} alt="" loading="lazy" /> : <span className="entry-cover placeholder">{kindIcon(entry.type)}</span>}
            <span className="entry-content"><span className="entry-meta">{kindIcon(entry.type)}{kinds[entry.type] || '资料'}</span><span className="entry-title">{entry.title}</span></span>
            <span className="entry-summary">{entry.summary}</span>
            <span className="entry-tags">{(entry.tags || []).slice(0, 4).map(tag => <span key={tag}>#{tag}</span>)}</span>
            <span className="entry-date">{date(entry.collected_at)}</span>
          </button>)}</div>
            : <div className="empty-state">没有找到资料</div>}
    </> : <>
      <header className="reader-header">
        <Button variant="ghost" size="icon" className="header-action" aria-label="返回资料库" onClick={back}><ArrowLeft size={22} /></Button>
        <span>{kinds[selected.type] || '资料'}</span>
        <Button variant="ghost" size="icon" className="header-action" aria-label={favorites.has(selected.id) ? '取消收藏' : '收藏资料'} aria-pressed={favorites.has(selected.id)} onClick={() => toggleFavorite(selected)}><Bookmark size={20} fill={favorites.has(selected.id) ? 'currentColor' : 'none'} /></Button>
      </header>
      <div className="reader-heading">
        <span className="reader-meta">{kinds[selected.type] || '资料'}{date(selected.collected_at) ? ' · ' + date(selected.collected_at) : ''}</span>
        <h1>{selected.title}</h1>
        {!!selected.tags?.length && <div className="reader-tags">{selected.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
      </div>
      {groups.length > 0 && <Tabs value={activeGroup?.id} onValueChange={value => { setSection(value); setSelectedFile(''); }} variant="underline" className="reader-tabs"><TabsList>{groups.map(group => <TabsTrigger value={group.id} key={group.id}>{group.label}</TabsTrigger>)}</TabsList></Tabs>}
      {activeGroup && activeGroup.files.length > 1 && <select className="file-select" aria-label="选择文档" value={activeFile?.path} onChange={event => setSelectedFile(event.target.value)}>{activeGroup.files.map(file => <option value={file.path} key={file.path}>{file.name}</option>)}</select>}
      {activeFile && data.documents[activeFile.path] !== undefined
        ? <DocumentBody value={data.documents[activeFile.path]} path={activeFile.path} />
        : <div className="document-empty">{selected.summary}</div>}
      {!!selected.files.length && <section className="attachments"><h2>附件与来源</h2>{selected.files.map(file => <a key={file.path} href={nativeAttachmentURL(selected.archiveId, file.path) || '#'} onClick={event => { if (!nativeAttachmentURL(selected.archiveId, file.path)) event.preventDefault(); }}><span>{file.name}</span><span>›</span></a>)}</section>}
    </>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
