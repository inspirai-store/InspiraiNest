import {visualLessons} from './lessons.mjs';
import {visualPlayer} from './player.mjs';
import {visualMath} from './math.mjs';
import {visualStyles,visualDocument} from './document.mjs';

// External scripts/styles keep the host's strict CSP intact. No inline code is needed on Web.
export function visualWebAssets(){
  const data=JSON.stringify(visualLessons).replace(/</g,'\\u003c');
  const offline=visualDocument().replace('<script>',`<script>{const q=new URLSearchParams(location.search),id=q.get('lesson');if(${JSON.stringify(visualLessons.map(l=>l.id))}.includes(id))document.body.dataset.lesson=id;document.body.dataset.theme=q.get('theme')==='dark'?'dark':'light';document.body.dataset.embedded=q.get('embedded')==='true'?'true':'false';}`);
  return {
    'offline.html':offline,
    'index.html':`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><title>新知 · 图解学习</title><link rel="stylesheet" href="./player.css"><script defer src="./player.js"></script></head><body><div id="player"></div></body></html>`,
    'player.css':visualStyles,
    'player.js':`'use strict';{const q=new URLSearchParams(location.search),course=${data},id=q.get('lesson');document.body.dataset.lesson=course.some(l=>l.id===id)?id:'overview';document.body.dataset.theme=q.get('theme')==='dark'?'dark':'light';document.body.dataset.embedded=q.get('embedded')==='true'?'true':'false';(${visualPlayer.toString()})(course,(${visualMath.toString()})());}`
  };
}

export function learningVisualAssets(){
  return {name:'learning-visual-assets',generateBundle(){for(const [name,source] of Object.entries(visualWebAssets()))this.emitFile({type:'asset',fileName:'learning-visuals/'+name,source});},configureServer(server){
    server.middlewares.use((req,res,next)=>{
      const pathname=new URL(req.url,'http://localhost').pathname,base=server.config.base+'learning-visuals/';
      if(!pathname.startsWith(base))return next();const name=pathname.slice(base.length),source=visualWebAssets()[name];if(!source)return next();
      res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(source);
    });
  }};
}
