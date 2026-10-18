import {fileURLToPath} from 'node:url';
import path from 'node:path';
export * from '../../packages/core/node/record-changes.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){process.argv[1]=fileURLToPath(new URL('../../packages/core/node/record-changes.mjs',import.meta.url));await import(new URL('../../packages/core/node/record-changes.mjs?cli',import.meta.url));}
