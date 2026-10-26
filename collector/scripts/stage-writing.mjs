import {repositoryRoot,collectorRoot,collectorPath} from '../../tooling/layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=collectorRoot,frontend=collectorPath('desktop/frontend');
const result=spawnSync(process.execPath,[path.join(repositoryRoot,'node_modules/vite/bin/vite.js'),'build','--config','vite.writing.config.ts'],{cwd:frontend,stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
for(const target of ['mobile/android/app/src/main/assets/capture/writing']){
 const dest=collectorPath(target);fs.mkdirSync(dest,{recursive:true});
 fs.copyFileSync(path.join(frontend,'writing/index.html'),path.join(dest,'index.html'));
 fs.copyFileSync(collectorPath('public/capture/bridge.js'),path.join(dest,'bridge.js'));
 for(const file of ['writing.js','writing.css'])fs.copyFileSync(path.join(frontend,'dist-writing',file),path.join(dest,file));
 // Remove only obsolete generated asset files from the previous module bundle.
 const oldAssets=path.join(dest,'assets');if(fs.existsSync(oldAssets))for(const name of fs.readdirSync(oldAssets))if(fs.statSync(path.join(oldAssets,name)).isFile())fs.unlinkSync(path.join(oldAssets,name));
}
