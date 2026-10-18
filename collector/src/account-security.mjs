import {fileURLToPath} from 'node:url';
import path from 'node:path';
export * from '../../services/api/modules/account-security.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){process.argv[1]=fileURLToPath(new URL('../../services/api/modules/account-security.mjs',import.meta.url));await import(new URL('../../services/api/modules/account-security.mjs?cli',import.meta.url));}
