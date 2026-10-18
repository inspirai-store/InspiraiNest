import type { LibraryFile } from './client.ts';

const readable = (file: LibraryFile) => /\.(md|markdown|txt|srt|vtt)$/i.test(file.path);
export function readingFile(files: LibraryFile[], tab: string) {
  const roles = tab === '正文' ? ['publication'] : tab === '摘要' ? ['summary'] : tab === '分析' ? ['analysis', 'scenario'] : tab === '原文' ? ['source', 'source_excerpt', 'original', 'source_snapshot'] : [];
  const file = files.find(file => roles.includes(file.role) && readable(file));
  if (file || tab !== '原文') return file;
  return files.find(file => ['transcript', 'transcript_raw'].includes(file.role) && readable(file));
}
