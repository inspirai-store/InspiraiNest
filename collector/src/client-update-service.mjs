import {fileURLToPath} from 'node:url';
import path from 'node:path';
export * from '../../services/api/modules/client-update-service.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){process.argv[1]=fileURLToPath(new URL('../../services/api/modules/client-update-service.mjs',import.meta.url));await import(new URL('../../services/api/modules/client-update-service.mjs?cli',import.meta.url));}
