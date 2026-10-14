import mediaStyles from './RecordMedia.module.css';
import {DraftAttachments,RecordingBar} from './RecordMedia';
import { useUiState } from '../workspace/UiState';
import { AttachmentCard } from '../components/AttachmentCard';
import { ContentHeader } from '../components/Workspace';
import { MoreMenu } from '../components/Overlays';
import { Camera, Check, Ellipsis, Mic, Paperclip, Pencil, RotateCw, Sparkles } from 'lucide-react';
import { Action, Badge } from '../components/Controls';
import { recordBody, records } from '../workspace/mock';
import { useCallback, useEffect, useRef } from 'react';
import styles from '../app/Workbench.module.css';

export function RecordEditor({ forceFailure = false, onRetry, media }: { forceFailure?: boolean; onRetry?: () => void; media?: string | null }) {
  const editor = useRef<HTMLDivElement>(null);
  const {state, setState} = useUiState();
  const initialText = useRef(state.draft.text).current;
  const dirty = state.draft.text !== state.draft.savedText;
  const empty = !state.draft.text.trim();
  const failed = forceFailure || state.draft.failed;
  const updateText = (text: string) => setState(current => ({...current,draft:{...current.draft,text}}));
  const save = useCallback((retry = false) => {
    if(media==='recording')return;
    const text = editor.current?.innerText ?? '';
    if (!text.trim()) return;
    const failed = forceFailure && !retry;
    setState(current => ({...current,draft:{...current.draft,text,failed,savedText:failed ? current.draft.savedText : text}}));
    if (retry) onRetry?.();
  }, [forceFailure,onRetry,setState,media]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !document.querySelector('[aria-modal="true"]')) { event.preventDefault(); save(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [save]);
  return <>
    <ContentHeader title="新记录" actions={<Badge role="status" aria-live="polite" kind={failed ? 'danger' : dirty ? 'neutral' : 'accent'}>{failed ? '保存失败' : dirty ? '未保存' : '已保存在本机'}</Badge>} />
    <div className={styles.editor} data-region="记录编辑器">
      <div className={styles.editorInput} data-region="记录输入区" onClick={event => { if (event.target === event.currentTarget) editor.current?.focus(); }}><div className={styles.editorText} data-region="记录正文" ref={editor} role="textbox" aria-label="记录正文" aria-multiline="true" contentEditable suppressContentEditableWarning onInput={event => { const text = event.currentTarget.innerText; updateText(text); }} onPaste={event => { event.preventDefault(); const text = event.clipboardData.getData('text/plain'); const selection = window.getSelection(); if (!selection?.rangeCount) return; const range = selection.getRangeAt(0); range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); updateText(editor.current?.innerText ?? ''); }}><span>{initialText}</span></div></div>
      {media==='attachments'&&<DraftAttachments attachments={[{id:'photo',name:'阅读摘记.jpg',mime:'image/jpeg',sha256:'',bytes:0},{id:'audio',name:'阅读想法.m4a',mime:'audio/mp4',sha256:'',bytes:0}]} remove={()=>{}}/>}
      {media==='recording'&&<RecordingBar seconds={18} finish={()=>{}}/>}
      <footer className={styles.editorToolbar} data-region="编辑器工具栏">
        <div className={styles.editorTools} data-region="内容工具"><Action icon={Paperclip} kind="ghost">添加</Action><Action icon={Mic} kind="ghost">录音</Action><Action icon={Camera} kind="ghost">拍照</Action></div>
        <Action icon={failed ? RotateCw : Check} kind="primary" className={media==='recording'?mediaStyles.recordingSave:undefined} onClick={() => save(failed)} disabled={empty||media==='recording'}>{failed ? '重试保存' : '保存记录'}</Action>
      </footer>
    </div>
  </>;
}
export function RecordDetail({ go, selectedIndex, onAction }: { onAction: (action: 'tags' | 'copy' | 'delete', invoker: HTMLButtonElement) => void; go: (path: string) => void; selectedIndex: number }) {
  const entry = records[selectedIndex] ?? records[0];
  return <>
    <ContentHeader title={entry.title} actions={<Badge>{entry.state}</Badge>} />
    <div className={styles.recordInfo} data-region="记录信息"><span>{entry.date}</span><span className={styles.accentText}>已同步</span></div>
    <div className={styles.recordActions} data-region="记录操作"><Action icon={Sparkles} kind="primary">加工</Action><Action icon={Pencil} onClick={() => go('/records/new')}>编辑</Action><MoreMenu icon={Ellipsis} onAction={onAction} /></div>
    <div className={styles.divider} data-region="内容分隔线" />
    <div className={styles.original} data-region="原始内容"><p><span>{selectedIndex === 0 ? recordBody : entry.excerpt}</span></p></div>
    <h3 className={styles.attachmentTitle}>附件</h3>
    <AttachmentCard name="阅读想法.m4a" duration="02:18" />
  </>;
}
