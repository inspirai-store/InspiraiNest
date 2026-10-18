import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));let failures=[];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory()){if(!['node_modules','dist','build'].includes(item.name))walk(file);}else if(/\.(?:mjs|tsx?|js)$/.test(item.name)){const text=fs.readFileSync(file,'utf8');for(const match of text.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"\n]+)\1/g)){const target=path.resolve(path.dirname(file),match[2]);if(target.startsWith(path.join(root,'plugins')))failures.push(path.relative(root,file)+' imports plugin '+match[2]);}}}}
for(const dir of ['packages/core','packages/ui-react','packages/library-kit'])walk(path.join(root,dir));
if(fs.readFileSync(path.join(root,'collector/Dockerfile'),'utf8')!==fs.readFileSync(path.join(root,'infra/Dockerfile'),'utf8'))failures.push('Compatibility Dockerfile is stale');
if(failures.length)throw Error(failures.join('\n'));console.log('Core and shared packages have no concrete plugin dependencies.');
