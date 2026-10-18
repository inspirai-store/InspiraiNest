import { scrollReader } from '../../../ui-react/src/ReaderKeyboard';
import { useUiState } from '../workspace/UiState';
import { StatePanel } from '../../../ui-react/src/AsyncState';
import { ContentHeader, SourceActions } from '../../../ui-react/src/Workspace';
import { MoreMenu } from '../../../ui-react/src/Overlays';
import { Bookmark, Ellipsis, ExternalLink } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Action, ChoiceBar, IconAction } from '../../../ui-react/src/Controls';
import { LibraryMarkdown } from './LibraryMarkdown';
import { useLocation } from 'react-router-dom';
import { library, libraryBody } from '../workspace/mock';
import styles from '../../../ui-react/src/Workbench.module.css';

export function LibraryReader({ selectedIndex, onAction, failed = false, retry }: { failed?: boolean; retry?: () => void; selectedIndex: number; onAction: (action: 'tags' | 'copy' | 'delete', invoker: HTMLButtonElement) => void }) {
  const location = useLocation();
  const markdownFixture = new URLSearchParams(location.search).has('markdown');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollFraction, setScrollFraction] = useState(0);
  const {state,setState} = useUiState();
  const reader = state.readers[selectedIndex] ?? {tab:'摘要',bookmarked:false,scroll:0};
  const tab = reader.tab;
  const setTab = (tab: string) => setState(current => ({...current,readers:{...current.readers,[selectedIndex]:{...reader,tab}}}));
  const tabId = useId();
  const bookmarked = reader.bookmarked;
  const toggleBookmark = () => setState(current => ({...current,readers:{...current.readers,[selectedIndex]:{...reader,bookmarked:!reader.bookmarked}}}));
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = reader.scroll; }, [selectedIndex, failed]);
  const entry = library[selectedIndex] ?? library[0];
  return <>
    <ContentHeader title={entry.title} reader actions={<IconAction icon={Bookmark} label="收藏资料" aria-pressed={bookmarked} onClick={toggleBookmark} />} />
    <SourceActions source="文章 · 10 月 12 日"><Action icon={ExternalLink} kind="ghost" compact>来源</Action><MoreMenu icon={Ellipsis} compact onAction={onAction} /></SourceActions>
    <ChoiceBar label="资料阅读内容" options={['摘要', '分析', '原文', '附件']} value={tab} onChange={setTab} tabs idPrefix={tabId} />
    <div className={styles.readerViewport} data-region="阅读滚动区" role="tabpanel" id="reader-panel" aria-labelledby={tabId + '-' + tab} tabIndex={0} onKeyDown={event => scrollReader(event, scrollRef.current)}>
      {failed ? <StatePanel kind="error" title="内容加载失败" action="重试" onAction={retry} region="阅读状态" /> : <><div className={styles.readerScroll} ref={scrollRef} onScroll={event => { const el = event.currentTarget; setScrollFraction(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)); setState(current => ({...current,readers:{...current.readers,[selectedIndex]:{...reader,scroll:el.scrollTop}}})); }}>
      {markdownFixture ? <LibraryMarkdown content={libraryBody} /> : <article className={styles.reader} data-region="阅读正文">
        <p><span>有效的阅读不止于收藏。用自己的语言留下要点，把新内容与已有笔记联系起来，并定期回顾，让资料成为可用的知识。</span></p>
        <h3>核心要点</h3>
        <p className={styles.points}><span>• 阅读后先记录自己的理解。<br />• 用主题把相关资料连接起来。<br />• 定期回看并补充新的想法。</span></p>
        <h3>实践方法</h3>
        <section><h4>1. 留下阅读笔记</h4><p><span>记录有价值的观点、问题和例子。保留来源，方便以后核对。</span></p></section>
        <section><h4>2. 建立内容关联</h4><p><span>把新文章与已有记录放在一起，找到共同主题和不同观点。</span></p></section>
        <section><h4>3. 定期回顾</h4><p><span>每周选一个主题，重读相关笔记，补充新的理解与应用。</span></p></section>
      </article>}
      </div>
      <div className={styles.readerTrack} data-region="阅读滚动条" aria-hidden="true"><div className={styles.readerThumb} data-region="滚动滑块" style={{ transform: `translateY(${Math.max(0, (scrollRef.current?.clientHeight ?? 96) - 96) * scrollFraction}px)` }} /></div></>}
    </div>
  </>;
}
