import {errorMessage} from '../shared/errors.ts';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LibraryClient } from './data/client';
import { BookmarkStore, bookmarkScope } from './data/bookmarks';
import { initialLiveLibrary, initialLiveTasks, useUiState } from '../workspace/UiState';

const Context = createContext<{ client: LibraryClient; session: number; scope:string|null; bookmarks: string[]; bookmarksReady: boolean; bookmarkError: string; toggleBookmark: (id:string) => void } | null>(null);
export function LibraryProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient(), { setState, pages } = useUiState();
  const [session, setSession] = useState(0);
  const [scope, setScope] = useState<string|null>(null), [bookmarks, setBookmarks] = useState<string[]>([]), [bookmarkError, setBookmarkError] = useState('');
  const bookmarkStore = useMemo(() => new BookmarkStore(localStorage), []);
  const bridge = window.library;
  const client = useMemo(() => new LibraryClient({
    status: async () => bridge ? bridge.status() : { paired: false, server: '' },
    entries: input => { if (!bridge?.entries) throw new Error('资料读取接口不可用'); return bridge.entries(input); },
    entry: id => { if (!bridge?.entry) throw new Error('资料读取接口不可用'); return bridge.entry(id); },
    content: input => { if (!bridge?.content) throw new Error('资料读取接口不可用'); return bridge.content(input); },
    preview: input => { if (!bridge?.preview) throw new Error('附件预览接口不可用'); return bridge.preview(input); },
    restore:id=>{if(!bridge?.restore)throw Error('恢复接口不可用');return bridge.restore(id);},
    trash: () => { if (!bridge?.trash) throw new Error('回收站接口不可用'); return bridge.trash(); },
  }), [bridge]);
  useEffect(() => {
    let active = true;
    setScope(null); setBookmarks([]); setBookmarkError('');
    void bridge?.status().then(connection => {
      if (!active) return;
      const scope = bookmarkScope(connection);
      if (scope) { setBookmarks(bookmarkStore.read(scope)); setScope(scope); }
    }).catch(error => { if(active) setBookmarkError(errorMessage(error)); });
    return () => { active = false; };
  }, [bridge, session, bookmarkStore]);
  const toggleBookmark = (id:string) => {
    if (!scope) return;
    const next = bookmarks.includes(id) ? bookmarks.filter(value => value !== id) : [...bookmarks, id];
    try { bookmarkStore.write(scope, next); setBookmarks(next); setBookmarkError(''); }
    catch (error) { setBookmarkError(errorMessage(error)); }
  };
  useEffect(() => {
    const changed = () => {
      client.invalidateSession();
      setScope(null); setBookmarks([]);
      cache.removeQueries({ queryKey: ['live-library'] });
      setState(current => ({ ...current, agentNodeId:null, liveLibrary: initialLiveLibrary(),liveTasks:initialLiveTasks() }));
      for (const key of pages.keys()) if (key.startsWith('library-live:')||key.startsWith('tasks-live:')||key.startsWith('agents-live:')) pages.delete(key);
      setSession(value => value + 1);
    };
    const unsubscribe = bridge?.onChanged?.(changed);
    return () => { unsubscribe?.(); client.invalidateSession(); cache.removeQueries({ queryKey: ['live-library'] }); };
  }, [bridge, cache, client, pages, setState]);
  return <Context.Provider value={{ client, session, scope, bookmarks, bookmarksReady:!!scope, bookmarkError, toggleBookmark }}>{children}</Context.Provider>;
}
export function useLibrarySession() {
  const context = useContext(Context);
  if (!context) throw new Error('LibraryProvider required');
  return context;
}

export function useOptionalLibrarySession(){return useContext(Context);}
