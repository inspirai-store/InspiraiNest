import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Element, Root } from 'hast';
import styles from '../app/Workbench.module.css';
import markdownStyles from './LibraryMarkdown.module.css';

function readingSections() {
  return (tree: Root) => {
    const grouped: Root['children'] = [];
    for (let index = 0; index < tree.children.length; index++) {
      const node = tree.children[index];
      if (node.type !== 'element' || node.tagName !== 'h4') { grouped.push(node); continue; }
      const children: Element['children'] = [node];
      while (index + 1 < tree.children.length) {
        const next = tree.children[index + 1];
        if (next.type === 'doctype') break;
        if (next.type === 'element' && /^h[1-4]$/.test(next.tagName)) break;
        children.push(next); index++;
      }
      grouped.push({ type: 'element', tagName: 'section', properties: {}, children });
    }
    tree.children = grouped;
  };
}

export function LibraryMarkdown({ content }: { content: string }) {
  return <article className={styles.reader} data-region="阅读正文">
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[readingSections]} components={{
      p: ({ children }) => <p><span>{children}</span></p>,
      ul: ({ children }) => <ul className={markdownStyles.list}>{children}</ul>,
      ol: ({ children }) => <ol className={markdownStyles.ordered}>{children}</ol>,
      a: ({ children, href }) => <a href={href} onClick={event => { event.preventDefault(); if (href && /^https?:\/\//i.test(href)) void window.library?.openUrl?.(href); }}>{children}</a>,
    }}>{content}</Markdown>
  </article>;
}
