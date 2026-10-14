import { createContext, useContext, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { editorBody } from './mock';

export type AreaState = {
  selected: number; query: string; status: string; type: string; libraryStatus: string;
  favoritesOnly: boolean; tags: string[]; tagFilter: string[] | null; itemTags: string[]; removed: number[];
};
export type ReaderState = { tab: string; bookmarked: boolean; scroll: number };
export type DraftState = { text: string; savedText: string; failed: boolean };
export type LiveLibraryState = {tags: string[]; favoritesOnly: boolean; selected: string | null; query: string; type: string; status: string; tabs: Record<string,string>};
export const initialLiveLibrary = (): LiveLibraryState => ({tags:[],favoritesOnly:false,selected:null,query:"",type:"全部类型",status:"全部状态",tabs:{}});
export type LiveTasksState={selected:string|null;query:string;filter:string;tabs:Record<string,string>};
export const initialLiveTasks=():LiveTasksState=>({selected:null,query:'',filter:'全部状态',tabs:{}});
export type UiState = { agentNodeId:string|null; liveTasks:LiveTasksState; liveLibrary: LiveLibraryState; records: AreaState; library: AreaState; draft: DraftState; readers: Record<number, ReaderState> };
export type PageMemory = { focus: string | null; scrolls: Record<string, number>; caret?: { start: number; end: number } };
const initialArea = (): AreaState => ({ selected: 0, query: '', status: '全部', type: '全部类型', libraryStatus: '全部状态', favoritesOnly: false, tags: ['阅读'], tagFilter: null, itemTags: ['阅读'], removed: [] });
const Context = createContext<{ state: UiState; setState: Dispatch<SetStateAction<UiState>>; pages: Map<string, PageMemory> } | null>(null);
export function UiStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UiState>(() => ({ agentNodeId:null, liveTasks:initialLiveTasks(), liveLibrary: initialLiveLibrary(), records: initialArea(), library: initialArea(), draft: { text: editorBody, savedText: editorBody, failed: false }, readers: {} }));
  const pages = useRef(new Map<string, PageMemory>()).current;
  return <Context.Provider value={{ state, setState, pages }}>{children}</Context.Provider>;
}
export function useUiState() {
  const value = useContext(Context);
  if (!value) throw new Error('UiStateProvider is required');
  return value;
}
