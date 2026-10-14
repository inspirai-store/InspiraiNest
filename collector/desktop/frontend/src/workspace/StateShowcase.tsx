import { useState } from 'react';
import { Action } from '../components/Controls';
import { ContentSkeleton, ListSkeleton, StatePanel } from '../components/AsyncState';
import { RecordEditor } from '../records/RecordPage';
import { UiStateProvider } from './UiState';
import styles from './StateShowcase.module.css';

const samples = ['记录加载', '资料加载', '暂无记录', '暂无资料', '搜索无结果', '列表加载失败', '阅读加载失败', '保存失败'] as const;
export function StateShowcase() {
  const [sample, setSample] = useState<(typeof samples)[number]>('记录加载');
  const reset = () => setSample('记录加载');
  return <section className={styles.section} aria-label="页面状态">
    <h2>页面状态</h2><div className={styles.actions}>{samples.map(label => <Action key={label} aria-pressed={sample === label} onClick={() => setSample(label)}>{label}</Action>)}</div>
    <div className={styles.preview}>
      {sample === '记录加载' || sample === '资料加载' ? <div className={styles.loading}><div className={styles.list}><ListSkeleton /></div><div className={styles.content}><ContentSkeleton reader={sample === '资料加载'} /></div></div> : sample === '暂无记录' ? <StatePanel kind="records-empty" title="暂无记录" action="新建记录" primary onAction={reset} region="组件空态" /> : sample === '暂无资料' ? <StatePanel kind="library-empty" title="暂无资料" region="组件空态" /> : sample === '搜索无结果' ? <StatePanel kind="no-results" title="无匹配资料" action="清除" onAction={reset} region="组件筛选状态" /> : sample === '列表加载失败' ? <StatePanel kind="error" title="资料加载失败" action="重试" onAction={reset} region="组件错误状态" /> : sample === '阅读加载失败' ? <StatePanel kind="error" title="内容加载失败" action="重试" onAction={reset} region="组件错误状态" /> : <UiStateProvider><RecordEditor forceFailure onRetry={reset} /></UiStateProvider>}
    </div>
  </section>;
}
