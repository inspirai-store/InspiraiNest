import {requireValue} from '../../../packages/core/node/common.mjs';
export const creationRoot='/api/creation/v1';
export const normalizeCreation=value=>String(value??'').normalize('NFKC').toLowerCase();
export function creationRoute(route,method='GET') {
  if(typeof route!=='string'||route.includes('#')||route.includes('..'))return false;
  const pathname=route.split('?')[0],root='/api/creation/v1';
  if(method==='GET')return [root+'/sessions',root+'/nodes'].includes(pathname)||/^\/api\/creation\/v1\/sessions\/[a-f0-9-]{36}(?:\/(?:events|search|source|source-media|versions|workflow|runs))?$/.test(pathname);
  if(method==='POST')return pathname===root+'/sessions'||/^\/api\/creation\/v1\/sessions\/[a-f0-9-]{36}\/(?:turns|stop|move|prepare|approve|retry-publication)$/.test(pathname);
  return method==='PUT'&&/^\/api\/creation\/v1\/sessions\/[a-f0-9-]{36}\/(?:document|workflow)$/.test(pathname);
}
export function creationText(value,label,max=100000) {
  requireValue(typeof value==='string'&&value.length<=max,`${label}无效或过长`);return value;
}
export function contextRefs(value=[]) {
  requireValue(Array.isArray(value)&&value.length<=30,'最多选择30份材料');
  return value.map(v=>{
    requireValue(v&&['record','entry','text'].includes(v.kind),'材料类型无效');
    if(v.kind==='text')return {kind:'text',title:creationText(v.title||'当前内容','标题',200),text:creationText(v.text,'材料',50000)};
    requireValue(typeof v.id==='string'&&v.id.length<=300,'材料编号无效');
    if(v.kind==='record')requireValue(Number.isSafeInteger(v.version)&&v.version>0,'记录必须绑定版本');
    if(v.kind==='entry')requireValue(/^[a-f0-9]{64}$/.test(v.archiveId||''),'资料必须绑定归档版本');
    return {...v,selectedText:creationText(v.selectedText||'','选中文字',20000)};
  });
}
export const filmQueries=q=>/欢迎.*龙餐|龙餐[馆厅]/.test(q)?[...new Set([q,'欢迎来龙餐馆','欢迎来到龙餐厅','龙餐馆','龙餐厅'])]: [q];
