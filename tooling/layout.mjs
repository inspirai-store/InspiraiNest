import path from 'node:path';
import {fileURLToPath} from 'node:url';
import map from './layout-map.json' with {type:'json'};
export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
export const collectorRoot=path.join(repositoryRoot,'collector');
const directories=[...Object.entries(map).filter(([key])=>!path.extname(key)).sort((a,b)=>b[0].length-a[0].length),['collector/desktop','apps/desktop'],['collector/mobile/android','apps/android'],['collector/mobile/ios','apps/ios'],['collector/public','apps/web/public'],['collector/brand','resources/brand'],['collector/skills','resources/skills'],['collector/cli','apps/cli'],['assets','apps/offline-reader/assets'],['templates','resources/templates']];
export function sourcePath(relative){
 const clean=relative.split(path.sep).join('/');const exact=map[clean];if(exact)return path.join(repositoryRoot,exact);
 for(const [old,target] of directories)if(clean===old||clean.startsWith(old+'/'))return path.join(repositoryRoot,target,clean.slice(old.length));
 return path.join(repositoryRoot,clean);
}
export const collectorPath=(...parts)=>sourcePath(/^(?:apps|packages|plugins|services|resources|tooling|infra|artifacts|tests)(?:[\/]|$)/.test(parts[0])?path.join(...parts):path.relative(repositoryRoot,path.resolve(collectorRoot,...parts)));
export const resourceRelative=file=>path.relative(repositoryRoot,sourcePath('collector/'+file));
