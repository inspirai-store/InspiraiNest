import {fileURLToPath} from 'node:url';
import path from 'node:path';
export * from '../../services/api/storage/mysql-store.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){process.argv[1]=fileURLToPath(new URL('../../services/api/storage/mysql-store.mjs',import.meta.url));await import(new URL('../../services/api/storage/mysql-store.mjs?cli',import.meta.url));}
