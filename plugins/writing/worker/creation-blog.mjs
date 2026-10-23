import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {atomicJson,hash,requireValue} from '../../../packages/core/node/common.mjs';
const run=promisify(execFile);
export class CreationBlog {
  constructor({directory,skillDirectory=path.join(os.homedir(),'.codex','skills','blog-publish'),execute=run,fetcher=fetch}={}){this.directory=directory;this.skillDirectory=skillDirectory;this.execute=execute;this.fetcher=fetcher;}
  async command(args){
    const script=path.join(this.skillDirectory,'scripts','blog.mjs');requireValue(fs.existsSync(script),'请在执行电脑安装 blog-publish Skill',409);
    const {stdout}=await this.execute(process.execPath,[script,...args],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});return JSON.parse(stdout);
  }
  folder(p){const folder=path.join(this.directory,p.id);fs.mkdirSync(folder,{recursive:true,mode:0o700});return folder;}
  async prepare(p){
    const folder=this.folder(p),receiptFile=path.join(folder,'review.json');
    if(fs.existsSync(receiptFile))return JSON.parse(fs.readFileSync(receiptFile,'utf8'));
    const d=p.snapshot,article={title:d.title,slug:'creation-'+p.sessionId,locale:d.locale||'zh',excerpt:d.excerpt||'',tags:d.tags||[],markdown:d.markdown,media:[]};
    const status=await this.command(['auth','status']);requireValue(status.connected,'博客授权不可用，请在执行电脑重新连接',409);
    for(const media of d.media||[]){
      requireValue(media.localPath&&/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(media.ref),'缺少固定媒体文件');
      const mediaReceipt=path.join(folder,'media-'+media.ref+'.json');let receipt;
      try{receipt=JSON.parse(fs.readFileSync(mediaReceipt,'utf8'));}catch{}
      if(!receipt?.media?.length)receipt=await this.command(['media','upload',media.localPath,'--name',media.name||media.ref,'--ref',media.ref,'--alt',media.alt||media.name||media.ref,...(media.caption?['--caption',media.caption]:[]),...(media.attribution?['--attribution',media.attribution]:[]),'--out',mediaReceipt,'--idempotency-key','creation-media-'+p.id+'-'+media.ref]);
      requireValue(receipt.media?.length&&receipt.markdown,'博客媒体尚未准备完成');article.media.push(...receipt.media);if(!article.markdown.includes(receipt.markdown))article.markdown+='\n\n'+receipt.markdown+'\n';
    }
    const articleFile=path.join(folder,'article.json');atomicJson(articleFile,article);
    // Each fixed document revision has its own recoverable publication attempt;
    // retries use the same idempotency key and never overwrite a newer draft.
    const pushedFile=path.join(folder,'draft.json');let pushed;
    if(fs.existsSync(pushedFile))pushed=JSON.parse(fs.readFileSync(pushedFile,'utf8'));
    else {
      const mappingFile=path.join(this.directory,p.sessionId+'.json');let mapping;
      try{mapping=JSON.parse(fs.readFileSync(mappingFile,'utf8'));}catch{}
      const args=['draft','push',articleFile,'--idempotency-key','creation-'+p.id];
      if(mapping){const current=await this.command(['article','show',mapping.articleId]);requireValue(current.etag===mapping.etag,'博客草稿已被其他客户端更新，请重新审阅',412);args.push('--id',mapping.articleId,'--if-match',mapping.etag);}
      else args.push('--external-id','creation-'+p.sessionId);
      pushed=await this.command(args);atomicJson(pushedFile,pushed);
      const a=pushed.article;requireValue(a?.id&&a?.draft?.id&&pushed.etag,'博客未返回草稿版本');atomicJson(mappingFile,{articleId:a.id,etag:pushed.etag});
    }
    const receipt=await this.command(['review',pushed.article.id,'--revision',pushed.article.draft.id,'--out',receiptFile]);
    return receipt;
  }
  async publish(p){
    requireValue(p.approvedBy&&p.approvedAt,'缺少用户对固定版本的批准',409);
    const folder=this.folder(p),file=path.join(folder,'review.json');let receipt=JSON.parse(fs.readFileSync(file,'utf8'));
    for(const key of ['origin','article_id','revision_id','content_sha256'])requireValue(receipt[key]===p.preview[key],'本机回执与批准版本不匹配',409);
    if(!receipt.approval_id)receipt=await this.command(['review',receipt.article_id,'--receipt',file,'--approve','--idempotency-key','creation-approve-'+p.id]);
    let resultFile=path.join(folder,'published.json'),result;
    if(fs.existsSync(resultFile))result=JSON.parse(fs.readFileSync(resultFile,'utf8'));
    else if(receipt.published_at)result={};
    else{result=await this.command(['publish',receipt.article_id,'--receipt',file,'--idempotency-key','creation-publish-'+p.id]);atomicJson(resultFile,result);}
    const checked=await this.command(['article','show',receipt.article_id]),a=checked.article;
    requireValue(a?.published?.id===receipt.revision_id&&a.published.content_sha256===receipt.content_sha256,'博客尚未确认已批准版本公开',409);
    const url=a.public_url||result.article?.public_url||a.url||`/${encodeURIComponent(a.locale)}/articles/${encodeURIComponent(a.slug)}`;
    requireValue(typeof url==='string'&&new URL(url,receipt.origin).origin===new URL(receipt.origin).origin,'博客没有返回同站公开链接',409);
    const absolute=new URL(url,receipt.origin).href,response=await this.fetcher(absolute,{redirect:'error',signal:AbortSignal.timeout(15000)});requireValue(response.ok,'公开页面尚不可见',409);
    atomicJson(path.join(this.directory,p.sessionId+'.json'),{articleId:a.id,etag:checked.etag});
    return {url:absolute,revisionId:receipt.revision_id,sha256:receipt.content_sha256};
  }
}
