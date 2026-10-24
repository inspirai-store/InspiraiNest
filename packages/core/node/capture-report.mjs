import path from 'node:path';
import {marked} from 'marked';

export function validateCaptureReport(bundle) {
  const files=new Set(bundle.files.map(file=>file.path));
  const evidence=new Set((bundle.meta.coverage?.items??[]).map(item=>item.id));
  for(const file of bundle.files.filter(file=>['summary','analysis','scenario'].includes(file.role)&&/\.(md|markdown)$/i.test(file.path))){
    const tokens=marked.lexer(Buffer.from(file.body,'base64').toString('utf8'));
    marked.walkTokens(tokens,token=>{
      if(!['link','image'].includes(token.type))return;
      const href=token.href;
      const fail=()=>{throw Object.assign(new Error(`报告链接没有对应的已保存依据：${file.path} → ${href}`),{code:'CAPTURE_REPORT_LINK',file:file.path,href});};
      if(href.startsWith('#evidence:')){let id;try{id=decodeURIComponent(href.slice(10));}catch{fail();}if(!evidence.has(id))fail();return;}
      if(!href||href.startsWith('#')||/^(https?:|mailto:)/i.test(href))return;
      let local;try{local=decodeURIComponent(href.split(/[?#]/)[0]);}catch{fail();}
      if(/^[a-z][a-z0-9+.-]*:/i.test(local)||local.startsWith('/')||local.includes('\\'))fail();
      const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file.path),local));
      if(!files.has(resolved))fail();
    });
  }
  return bundle;
}
