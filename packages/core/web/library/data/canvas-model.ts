import type {LibraryEntry} from './client';
import type {CanvasItem} from '../../../../ui-react/src/canvas/MaterialCanvas';
import {libraryDateLabel} from './date-label.ts';
export type LibraryView='canvas'|'list';
const typeNames:Record<string,string>={article:'文章',note:'笔记',document:'文档',audio:'音频',video:'视频',webpage:'网页',image:'图片',repository:'代码项目',other:'其他'};
const statusNames:Record<string,string>={archived:'已归档',partial:'待补齐',pending:'待处理'};
export const libraryNodeId=(id:string)=>'entry:'+encodeURIComponent(id);
export function libraryCards(entries:LibraryEntry[],bookmarks:string[]=[]):CanvasItem[]{return entries.map((entry,index)=>({id:libraryNodeId(entry.id),kind:'material',title:entry.title,label:typeNames[entry.type]||entry.type,badge:statusNames[entry.status]||entry.status,tone:entry.status==='archived'?'positive':entry.status==='partial'?'warning':'neutral',preview:entry.summary,meta:[libraryDateLabel(entry.collected_at),entry.tags?.slice(0,3).join(' / '),bookmarks.includes(entry.id)?'已收藏':''].filter(Boolean).join(' · '),position:{x:(index%4)*320,y:Math.floor(index/4)*300}}));}
export function readLibraryView(storage:Pick<Storage,'getItem'>,scope:string|null):LibraryView{try{return scope&&storage.getItem('library-view:v1:'+scope)==='list'?'list':'canvas';}catch{return'canvas';}}
