import fs from 'node:fs';
import path from 'node:path';
import {repositoryRoot} from '../layout.mjs';
import {visualDocument} from '../../plugins/learning/visuals/document.mjs';

const html=visualDocument();
for(const relative of ['apps/ios/LearningVisuals/index.html','apps/android/app/src/main/assets/learning-visuals/index.html','artifacts/learning/visuals/index.html']){
  const target=path.join(repositoryRoot,relative);
  if(process.argv.includes('--check')){
    if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==html)throw Error('Learning visual assets are stale: '+relative);
  }else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,html);}
}
console.log('Learning visual assets: 16 lessons, offline document');
