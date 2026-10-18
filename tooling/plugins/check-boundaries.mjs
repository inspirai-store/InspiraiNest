import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));let failures=[];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory()){if(!['node_modules','dist','build'].includes(item.name))walk(file);}else if(/\.(?:mjs|tsx?|js)$/.test(item.name)){const text=fs.readFileSync(file,'utf8');for(const match of text.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"\n]+)\1/g)){const target=path.resolve(path.dirname(file),match[2]);if(target.startsWith(path.join(root,'plugins')))failures.push(path.relative(root,file)+' imports plugin '+match[2]);}}}}
for(const dir of ['packages/core','packages/ui-react','packages/library-kit'])walk(path.join(root,dir));
if(fs.readFileSync(path.join(root,'collector/Dockerfile'),'utf8')!==fs.readFileSync(path.join(root,'infra/Dockerfile'),'utf8'))failures.push('Compatibility Dockerfile is stale');
if(failures.length)throw Error(failures.join('\n'));console.log('Core and shared packages have no concrete plugin dependencies.');

// Declared plugin dependencies may use only the dependency's published API.
for (const item of fs.readdirSync(path.join(root,'plugins'),{withFileTypes:true}).filter(v=>v.isDirectory())) {
 const base=path.join(root,'plugins',item.name),manifest=JSON.parse(fs.readFileSync(path.join(base,'plugin.json'),'utf8'));
 const inspect=dir=>{for(const file of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,file.name);if(file.isDirectory()){inspect(full);continue;}if(!/\.(?:mjs|tsx?|js)$/.test(file.name))continue;
  for(const match of fs.readFileSync(full,'utf8').matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"\n]+)\1/g)){
   const target=path.resolve(dir,match[2]),relative=path.relative(root,target).split(path.sep).join('/');
   if(relative.startsWith('services/')||relative.includes('/storage/'))throw Error(path.relative(root,full)+' bypasses a host storage interface');
   if(relative.startsWith('plugins/')){const [,dependency,area]=relative.split('/');if(dependency!==item.name&&(!manifest.dependencies.includes(dependency)||area!=='api'))throw Error(path.relative(root,full)+' imports a private plugin implementation');}
  }
 }};inspect(base);
}
console.log('Plugin storage access and declared public dependencies checked.');
