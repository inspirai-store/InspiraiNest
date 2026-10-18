import path from 'node:path';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
export function desktopFrontend({directory,test=false,qaFile,qaRoute}){
 const file=test&&qaFile?path.resolve(qaFile):path.join(directory,'frontend/dist/index.html');
 if(!fs.existsSync(file))throw Error('桌面界面尚未构建：运行 npm run build:desktop-ui');
 return {file,url:pathToFileURL(file).href,route:test&&qaRoute?qaRoute:'/records?data=local',compactRoute:'/status'};
}
export function documentURL(value){try{const url=new URL(value);url.search='';url.hash='';return url.href;}catch{return '';}}
export function desktopPermission({permission,url,isMainFrame,main,urlAllowed}){return main&&isMainFrame===true&&documentURL(url)===urlAllowed&&['clipboard-sanitized-write','media'].includes(permission);}
