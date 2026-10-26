import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createService} from '../../services/api/server.mjs';
import {importStarter} from './import-starter.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),directory=path.join(root,'artifacts/learning/local-review');fs.mkdirSync(directory,{recursive:true,mode:0o700});
const previous=path.join(directory,'connection.json');
const masterKey=fs.existsSync(previous)?JSON.parse(fs.readFileSync(previous,'utf8')).key:randomBytes(32).toString('hex'),app=createService({dataDir:path.join(directory,'data'),masterKey});
await new Promise(resolve=>app.server.listen(Number(process.env.LEARNING_REVIEW_PORT||0),'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+app.server.address().port;
const paired=await fetch(origin+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:masterKey,name:'新知本地验收'})}).then(r=>r.json());
const request=async(route,input,method=input===undefined?'GET':'POST')=>{const response=await fetch(origin+route,{method,headers:{Authorization:'Bearer '+paired.token,'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw Error(value.error||'请求失败');return value;};
for(const id of ['learning','writing']){const config=await request('/api/plugins');if(!config.enabled[id])await request('/api/plugins/'+id,{enabled:true,revision:config.revision},'PUT');}
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
let goal;
if(option('--handbook'))goal=await importStarter({request,handbook:option('--handbook'),jd:option('--jd'),jdUrl:option('--jd-url')});
fs.writeFileSync(path.join(directory,'connection.json'),JSON.stringify({origin,token:paired.token,key:masterKey,goalId:goal?.id}),{mode:0o600});
console.log(JSON.stringify({origin,url:origin+'/workbench/#/learning'+(goal?'/'+goal.id:''),goalId:goal?.id,connectionFile:path.join(directory,'connection.json')}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void app.close().finally(()=>process.exit(0));});
