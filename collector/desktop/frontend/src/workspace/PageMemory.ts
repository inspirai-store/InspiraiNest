import type { PageMemory } from './UiState';

function focusSelector(el: Element | null): string | null {
  if (!(el instanceof HTMLElement)) return null;
  const label = el.getAttribute('aria-label');
  if (label) { const selector = `${el.tagName.toLowerCase()}[aria-label=${JSON.stringify(label)}]`; const region = el.closest<HTMLElement>('[data-region]'); return region && region !== el ? `[data-region=${JSON.stringify(region.dataset.region)}] ${selector}` : selector; }
  const row = el.getAttribute('data-row');
  if (row !== null) return `button[data-row=${JSON.stringify(row)}]`;
  if (el.getAttribute('role') === 'tab') return '[role="tab"][aria-selected="true"]';
  return null;
}
export function rememberPage(root: HTMLElement | null): PageMemory {
  const scrolls: Record<string, number> = {};
  for (const el of root?.querySelectorAll<HTMLElement>('[data-region]') ?? []) if (el.scrollHeight > el.clientHeight) scrolls[el.dataset.region!] = el.scrollTop;
  const result: PageMemory = { focus: root?.contains(document.activeElement) && document.activeElement?.closest('[data-region=内容区], [data-region=列表区]') ? focusSelector(document.activeElement) : null, scrolls };
  const editor = root?.querySelector<HTMLElement>('[aria-label="记录正文"]');
  const selection = window.getSelection();
  if (editor && selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
    const range = selection.getRangeAt(0), before = range.cloneRange(); before.selectNodeContents(editor); before.setEnd(range.startContainer, range.startOffset);
    result.caret = { start: before.toString().length, end: before.toString().length + range.toString().length };
  }
  return result;
}
export function restorePage(root: HTMLElement | null, memory: PageMemory | undefined) {
  if (!root || !memory) return;
  for (const el of root.querySelectorAll<HTMLElement>('[data-region]')) if (memory.scrolls[el.dataset.region!] !== undefined) el.scrollTop = memory.scrolls[el.dataset.region!]!;
  const target = memory.focus ? root.querySelector<HTMLElement>(memory.focus) : null;
  if (target?.getClientRects().length) target.focus({preventScroll:true});
  else if (memory.focus) { const fallback = root.querySelector<HTMLElement>('[data-region=列表区] button[data-row][aria-pressed=true], [data-region=列表区] input'); if (fallback?.getClientRects().length) fallback.focus({preventScroll:true}); }
  const editor = root.querySelector<HTMLElement>('[aria-label="记录正文"]');
  if (editor && target === editor && memory.caret) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT), range = document.createRange();
    let offset = 0, start = false, end = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (!start && offset + length >= memory.caret.start) { range.setStart(node, Math.max(0,memory.caret.start-offset)); start = true; }
      if (!end && offset + length >= memory.caret.end) { range.setEnd(node, Math.max(0,memory.caret.end-offset)); end = true; break; }
      offset += length;
    }
    if (start && end) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
  }
}
