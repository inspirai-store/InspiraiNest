import fs from 'node:fs';
import path from 'node:path';
import {contentDigest} from './capture-contract.mjs';

export function validateCaptureAudits(meta,root,coverage){
  const history=fs.readdirSync(root).filter(f=>/^capture-audit-.*\.json$/.test(f)).sort().map(f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8')));
  const latest=new Map();for(const audit of history)latest.set(audit.url,audit);const audits=[...latest.values()];
  for(const audit of audits){
    if(audit.version!==2||!Array.isArray(audit.files)||!Array.isArray(audit.images))throw Error('采集完整性记录无效');
    for(const file of audit.files){
      if(typeof file.path!=='string'||path.basename(file.path)!==file.path)throw Error('采集校验路径无效');
      const actual=path.join(root,file.path);
      if(!fs.existsSync(actual)||contentDigest(fs.readFileSync(actual))!==file.sha256)throw Error('采集正文与完整性记录不一致');
    }
    if(meta.status!=='archived')continue;
    if(audit.quality?.status==='partial'||audit.quality?.status==='blocked')throw Error('采集仍有正文或配图缺口，不能完整归档');
    const expected=[...audit.files.filter(f=>f.role==='source'),...audit.images];
    for(const item of expected){
      if(item.state==='missing'||!item.path)throw Error('采集配图未补齐，不能完整归档');
      if(!coverage?.items.some(i=>i.state==='analyzed'&&i.path===item.path&&i.sha256===item.sha256))throw Error('采集正文或配图尚未分析，不能完整归档');
    }
  }
  return {audits:audits.length};
}
