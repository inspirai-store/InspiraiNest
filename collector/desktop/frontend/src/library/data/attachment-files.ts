import type {LibraryFile} from './client.ts';
import {readingFile} from './reading-file.ts';
export function attachmentFiles(files:LibraryFile[]) {
 const readingPaths=new Set(['摘要','分析'].map(tab=>readingFile(files,tab)?.path).filter(Boolean));
 return files.filter(file=>!readingPaths.has(file.path));
}
