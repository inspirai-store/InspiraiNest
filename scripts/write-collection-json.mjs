import {fileURLToPath} from 'node:url';
import path from 'node:path';
export * from '../packages/library-kit/write-collection-json.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){process.argv[1]=fileURLToPath(new URL('../packages/library-kit/write-collection-json.mjs',import.meta.url));await import(new URL('../packages/library-kit/write-collection-json.mjs?cli',import.meta.url));}
