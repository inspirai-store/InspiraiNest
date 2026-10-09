import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source = path.join(root,'public/capture');
for (const target of ['mobile/android/app/src/main/assets/capture','mobile/ios/CaptureAssets']) {
  const destination = path.join(root,target);
  if(!process.argv.includes('--check'))fs.mkdirSync(destination,{recursive:true});
  for (const file of ['index.html','capture.css','capture.js','store.js','bridge.js','brand.png']) {
    if(process.argv.includes('--check')) { if(!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(destination,file))))throw new Error('Capture assets are stale: '+target+'/'+file); }
    else fs.copyFileSync(path.join(source,file),path.join(destination,file));
  }
}
