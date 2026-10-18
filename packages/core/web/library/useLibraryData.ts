import { useEffect } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLibrarySession } from './LibraryProvider';
import type { LibraryFilters } from './data/client';
import { readingFile } from './data/reading-file';

export function useLibraryData(filters: LibraryFilters, selected: string | null, tabs: Record<string,string>, favorites: string[] | null = null, tags: string[] = [], collectTags = false, directId:string|null=null) {
  const { client, session } = useLibrarySession();
  const list = useInfiniteQuery({
    queryKey: ['live-library', session, 'list', filters], initialPageParam: 0,
    queryFn: ({ pageParam }) => client.entries({ ...filters, offset: pageParam, limit: 30 }),
    getNextPageParam: page => page.items.length && page.offset + page.items.length < page.total ? page.offset + page.items.length : undefined,
    retry: false,
  });
  useEffect(() => { if ((favorites !== null || tags.length>1 || collectTags) && list.hasNextPage && !list.isFetchingNextPage && !list.isError) void list.fetchNextPage(); }, [favorites, tags.length, collectTags, list.hasNextPage, list.isFetchingNextPage, list.isError, list.fetchNextPage]);
  const items = (list.data?.pages.flatMap(page => page.items) ?? []).filter(item => favorites === null || favorites.includes(item.id)).filter(item=>tags.every(tag=>item.tags?.includes(tag)));
  const id = directId ?? (items.some(item => item.id === selected) ? selected! : items[0]?.id);
  const entry = useQuery({ queryKey: ['live-library', session, 'entry', id], queryFn: () => client.entry(id!), enabled: !!id, retry: false });
  const tab = id ? tabs[id] ?? (entry.data?.files.some(f=>f.role==='publication')?'正文':'摘要') : '摘要';
  const file = readingFile(entry.data?.files ?? [], tab);
  const content = useQuery({ queryKey: ['live-library', session, 'content', id, entry.data?.archive_id, file?.path], queryFn: () => client.content(id!, file!.path), enabled: !!id && !!file && tab !== '附件', retry: false });
  return { list, items, id, entry, content, file, session };
}
