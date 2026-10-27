import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {repositoryRoot} from '../layout.mjs';
import {visualDocument} from '../../plugins/learning/visuals/document.mjs';
import {visualLessons} from '../../plugins/learning/visuals/lessons.mjs';
const folder=path.join(repositoryRoot,'artifacts/learning/visuals');fs.mkdirSync(folder,{recursive:true});
fs.writeFileSync(path.join(folder,'index.html'),visualDocument());
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'||!['/','/index.html'].includes(req.url.split('?')[0])){res.writeHead(404);res.end();return;}
  const query=new URL(req.url,'http://localhost').searchParams,id=visualLessons.some(l=>l.id===query.get('lesson'))?query.get('lesson'):'overview';
  const html=fs.readFileSync(path.join(folder,'index.html'),'utf8').replace('data-lesson="overview"','data-lesson="'+id+'"').replace('data-theme="light"',query.get('theme')==='dark'?'data-theme="dark"':'data-theme="light"');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({origin:'http://127.0.0.1:'+server.address().port,html:path.join(folder,'index.html')})));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
