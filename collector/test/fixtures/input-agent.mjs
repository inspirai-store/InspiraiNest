import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.argv.includes('--version')){console.log('input-fixture 1.0');process.exit();}
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;fs.writeFileSync('received-prompt.txt',prompt);
const input=JSON.parse(fs.readFileSync('.task-input/manifest.json','utf8')),entry=`notes/share-${input.taskId}`;fs.mkdirSync(entry,{recursive:true});
const meta=JSON.parse(fs.readFileSync('templates/source.template.json','utf8'));
Object.assign(meta,{id:`note:share-${input.taskId}`,type:'note',platform:'fixture',title:'中文附件闭环测试',collected_at:new Date().toISOString(),organized_at:new Date().toISOString().slice(0,10),tags:['测试'],summary:'使用真实输入文字检查附件传输与解析清单。',status:'archived',verification_status:'source_only',coverage_note:'合成 Agent 测试，仅验证协议与文字内容保留。',files:[{path:'summary.md',role:'summary'}]});
const attachments=[];for(const file of input.attachments){const relative=file.id+'.txt',text=fs.readFileSync(file.extractedPath||file.path,'utf8');fs.writeFileSync(path.join(entry,relative),text);meta.files.push({path:relative,role:'source'});attachments.push({id:file.id,sha256:file.sha256,status:'parsed',files:[relative]});}
fs.writeFileSync(path.join(entry,'source.json'),JSON.stringify(meta));fs.writeFileSync(path.join(entry,'summary.md'),'# 集成测试\n\n'+attachments.length+' 份输入的全文已保留。');
if(process.argv.includes('--omit-one'))attachments.pop();fs.writeFileSync('collector-input-result.json',JSON.stringify({schemaVersion:1,attachments}));
execFileSync(process.execPath,['scripts/catalog.mjs','build']);fs.writeFileSync('collector-result.json',JSON.stringify({status:'ready',entry}));
