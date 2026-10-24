import {createHash} from 'node:crypto';

export const captureStages = ['fetching','transcribing','analyzing','archiving','validating'];
export function captureURL(value) {
  const url=new URL(String(value).trim());
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('只支持 HTTP 或 HTTPS 网页');
  return url.href;
}
export function canonicalCaptureURL(value) {
  const url=new URL(captureURL(value));
  // Keep source semantics: video part, language, time, article identifiers and fragments.
  for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['spm','fbclid','gclid'].includes(key))url.searchParams.delete(key);
  if(/(^|\.)toutiao\.com$/i.test(url.hostname)&&/^\/article\/\d+\/?$/.test(url.pathname))url.searchParams.delete('wid');
  url.searchParams.sort();return url.href;
}
export function identifyCaptureSource(value) {
  const url=new URL(captureURL(value)),host=url.hostname.toLowerCase().replace(/^www\./,'');
  const sites=[['mp.weixin.qq.com','微信公众号','article'],['bilibili.com','哔哩哔哩','video'],['b23.tv','哔哩哔哩','video'],['youtube.com','YouTube','video'],['youtu.be','YouTube','video'],['zhihu.com','知乎','article'],['xiaohongshu.com','小红书','webpage'],['xhslink.com','小红书','webpage'],['douyin.com','抖音','video'],['tiktok.com','TikTok','video'],['twitter.com','X','webpage'],['x.com','X','webpage'],['reddit.com','Reddit','webpage'],['github.com','GitHub','repository']];
  const site=sites.find(([domain])=>host===domain||host.endsWith('.'+domain));
  return {url:url.href,canonical:canonicalCaptureURL(url.href),platform:site?.[1]??host,type:site?.[2]??(/\.pdf$/i.test(url.pathname)?'document':/\.(mp3|m4a|ogg)$/i.test(url.pathname)?'audio':'webpage')};
}
export function captureLinks(text,entries=[]) {
  const seen=new Set();
  return String(text).split(/\s+/).filter(Boolean).map(raw=>{
    try {const source=identifyCaptureSource(raw),key=source.canonical;
      const existing=entries.find(e=>[e.source_url,e.canonical_url,...(e.aliases??[])].filter(Boolean).some(u=>{try{return canonicalCaptureURL(u)===key;}catch{return false;}}));
      const duplicate=seen.has(key);seen.add(key);return {...source,raw,duplicate,existingId:existing?.id??null};
    }catch{return {raw,error:'链接无效'};}
  });
}
export function validateCaptureContext(value) {
  if(value===undefined||value===null)return null;
  if(value.version!==1||!['page','file'].includes(value.kind)||!/^[-a-f0-9]{36}$/i.test(value.sessionId)||typeof value.title!=='string'||value.title.length>500)throw Error('采集会话无效');
  return {version:1,kind:value.kind,sessionId:value.sessionId,title:value.title,source:value.kind==='page'?captureURL(value.source):null};
}
export function contentDigest(value){return createHash('sha256').update(value).digest('hex');}

export function validateCoverage(coverage,files) {
  if(coverage===undefined)return undefined;
  if(!coverage||coverage.version!==1||!Array.isArray(coverage.items)||coverage.items.length>1000)throw Error('证据覆盖记录无效');
  const ids=new Set();
  const items=coverage.items.map(item=>{
    if(!item||!['text','transcript','frame','document','image','audio'].includes(item.kind)||!['missing','saved','analyzed'].includes(item.state)||typeof item.id!=='string'||!item.id||ids.has(item.id))throw Error('证据记录无效');
    ids.add(item.id);
    const clean={id:item.id,kind:item.kind,state:item.state,label:String(item.label??'').slice(0,200)};
    if(item.state==='missing')return {...clean,reason:String(item.reason??'').slice(0,1000)};
    const file=files.find(f=>f.path===item.path);
    if(!file||!file.sha256||file.sha256!==item.sha256)throw Error('证据文件未保存或校验值不符');
    if(file.role&&['summary','analysis','scenario'].includes(file.role))throw Error('分析结果不能充当原始证据');
    Object.assign(clean,{path:file.path,sha256:file.sha256});
    for(const key of ['start','end','line','page'])if(item[key]!==undefined){if(!Number.isFinite(item[key])||item[key]<0)throw Error('证据定位无效');clean[key]=item[key];}
    if(clean.end!==undefined&&clean.start!==undefined&&clean.end<clean.start)throw Error('证据时间范围无效');
    if(item.state==='analyzed'){
      if(!item.analyzedAt||!Number.isFinite(Date.parse(item.analyzedAt)))throw Error('缺少分析时间');
      clean.analyzedAt=item.analyzedAt;
    }
    return clean;
  });
  return {version:1,items};
}
