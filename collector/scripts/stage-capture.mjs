import {collectorRoot,collectorPath} from '../../tooling/layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = collectorRoot;
const source = collectorPath('public/capture');
for(const name of ['processing-center.js','processing-center.css']) {
  if(process.argv.includes('--check')) {if(!fs.readFileSync(collectorPath('public',name)).equals(fs.readFileSync(path.join(source,name))))throw new Error('Processing assets are stale');}
  else fs.copyFileSync(collectorPath('public',name),path.join(source,name));
}
for(const [from,name] of [['../assets/vendor/marked.js','processing-marked.js'],['../assets/vendor/purify.js','processing-purify.js'],...['library','collect','person'].map(n=>['mobile/android/app/src/main/assets/mobile/icons/'+n+'.png','processing-'+n+'.png'])]) {
  if(process.argv.includes('--check')) {if(!fs.readFileSync(collectorPath(from)).equals(fs.readFileSync(path.join(source,name))))throw new Error('Processing vendor assets are stale');}
  else fs.copyFileSync(collectorPath(from),path.join(source,name));
}
for (const target of ['mobile/android/app/src/main/assets/capture']) {
  const destination = collectorPath(target);
  if(!process.argv.includes('--check'))fs.mkdirSync(destination,{recursive:true});
  for (const file of ['index.html','capture.css','capture.js','record-sync.js','store.js','bridge.js','brand.png','processing.html','processing-center.js','processing-center.css','processing-shell.js','processing-notice.js','processing-shell.css','processing-marked.js','processing-purify.js','processing-library.png','processing-collect.png','processing-person.png']) {
    if(process.argv.includes('--check')) { if(!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(destination,file))))throw new Error('Capture assets are stale: '+target+'/'+file); }
    else fs.copyFileSync(path.join(source,file),path.join(destination,file));
  }
}
