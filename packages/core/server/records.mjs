import {assertExecutionAgent,activeExecutionAgents,isExecutionAgent} from '../shared/execution-policy.mjs';
import { hash, id, now, requireValue } from '../node/common.mjs';
import { workerAuthorized } from '../node/device-metadata.mjs';
import { documentExtensions, validDocument } from '../node/input-attachments.mjs';
import { validateDocument } from '../node/record-document.mjs';
import {lockRecordChanges,appendRecordChange,readRecordChanges} from '../node/record-changes.mjs';

export const MEDIA_LIMIT = 32 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
export const mediaExtensions = { ...documentExtensions, 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','audio/mp4':'m4a','audio/aac':'aac','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/webm':'webm','audio/ogg':'ogg','audio/flac':'flac','video/mp4':'mp4','video/webm':'webm','video/ogg':'ogv','application/pdf':'pdf','text/plain':'txt','text/markdown':'md','text/csv':'csv','application/json':'json','application/octet-stream':'bin' };
export const recordPresets = { summary:'整理摘要', extract:'转写 / 识字', actions:'提炼行动项', custom:'自定义' };
const identify = value => { requireValue(typeof value === 'string' && uuid.test(value), 'Invalid record/request ID'); return value.toLowerCase(); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const recordCheck = (condition, code, message, status=409) => {
  if (!condition) throw Object.assign(new Error(message), {status, code});
};
function validMedia(buffer, mime) {
  const ascii = (start, end) => buffer.toString('ascii',start,end);
  switch (mime) {
    case 'image/png': return buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
    case 'image/jpeg': return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    case 'image/webp': return ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP';
    case 'image/gif': return /^GIF8[79]a$/.test(ascii(0,6));
    case 'video/mp4': case 'audio/mp4': return ascii(4,8) === 'ftyp';
    case 'video/webm': case 'audio/webm': return buffer.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'));
    case 'video/ogg': case 'audio/ogg': return ascii(0,4) === 'OggS';
    case 'audio/flac': return ascii(0,4) === 'fLaC';
    case 'audio/wav': case 'audio/x-wav': return ascii(0,4) === 'RIFF' && ascii(8,12) === 'WAVE';
    case 'audio/mpeg': return ascii(0,3) === 'ID3' || buffer[0] === 255 && (buffer[1] & 224) === 224;
    case 'audio/aac': return buffer[0] === 255 && (buffer[1] & 246) === 240;
    case 'application/pdf': return ascii(0,5)==='%PDF-';
    case 'text/plain': case 'text/markdown': case 'text/csv': case 'application/json': {try{new TextDecoder('utf-8',{fatal:true}).decode(buffer);return !buffer.includes(0);}catch{return false;}}
    case 'application/octet-stream': return buffer.length>0;
    default: return false;
  }
}
export function createRecords({store,storage,serialized,authenticate,owner,assigned,body,send,saveTask}) {
  async function readMedia(req, res, sha) {
    const media = await store.get('record-media', sha); requireValue(media,'Media not found',404);
    const bytes = await storage.get(media.key); await authenticate(req);
    requireValue(hash(bytes) === sha && bytes.length === media.bytes,'Media checksum mismatch',500);
    res.writeHead(200,{'Content-Type':media.mime,'Content-Length':bytes.length,'X-Content-Type-Options':'nosniff','Content-Disposition':`${media.mime.startsWith('text/')||['application/json','application/octet-stream'].includes(media.mime)?'attachment':'inline'}; filename="${sha}.${mediaExtensions[media.mime]}"`,'X-Content-SHA256':sha}); res.end(bytes);
  }
  async function handle(req,res,route,device) {
    const inputFile=route.match(/^\/api\/tasks\/([^/]+)\/input-files\/([a-f0-9]{64})$/);
    if(inputFile&&req.method==='GET'){
      let task;
      if(device.role==='owner'){owner(device);task=await store.get('task',inputFile[1]);requireValue(task,'Task not found',404);}
      else {requireValue(device.inputAttachmentProtocol===1,'Input attachment protocol required',403);task=await assigned(device,inputFile[1],req);requireValue(['assigned','running','uploading'].includes(task.state),'Task is no longer active',403);}
      requireValue(task.inputAttachments?.some(file=>file.sha256===inputFile[2]),'Input file not assigned to this task',403);
      const media=await store.get('record-media',inputFile[2]);requireValue(media,'Input file not found',404);
      const bytes=await storage.get(media.key);await authenticate(req);
      if(device.role!=='owner')requireValue(['assigned','running','uploading'].includes((await assigned(device,task.id,req)).state),'Task is no longer active',403);
      requireValue(bytes.length===media.bytes&&hash(bytes)===media.id,'Input file checksum mismatch',500);
      res.writeHead(200,{'Content-Type':media.mime,'Content-Length':bytes.length,'X-Content-SHA256':media.id});res.end(bytes);return true;
    }
    const taskMedia = route.match(/^\/api\/tasks\/([^/]+)\/record-media\/([a-f0-9]{64})$/);
    if (taskMedia && req.method === 'GET') {
      const task = await assigned(device,taskMedia[1],req);
      requireValue(['assigned','running','uploading'].includes(task.state) && task.recordSnapshot?.attachments.some(a => a.sha256 === taskMedia[2]),'Media not assigned to this task',403);
      const media = await store.get('record-media',taskMedia[2]); requireValue(media,'Media not found',404);
      const bytes = await storage.get(media.key); await authenticate(req); requireValue(['assigned','running','uploading'].includes((await assigned(device,task.id,req)).state),'Task is no longer active',403);
      requireValue(hash(bytes) === media.id,'Media checksum mismatch',500);
      res.writeHead(200,{'Content-Type':media.mime,'Content-Length':bytes.length,'X-Content-SHA256':media.id}); res.end(bytes); return true;
    }
    if (!route.startsWith('/api/records')) return false;
    owner(device);
    const exportRoute=route.match(/^\/api\/records\/([a-f0-9-]{36})\/export$/);
    if(exportRoute&&req.method==='GET'){
      const record=await store.get('capture',exportRoute[1]);requireValue(record&&!record.deletedAt,'Record not found',404);
      const files=[];
      for(const attachment of record.attachments){const media=await store.get('record-media',attachment.sha256);requireValue(media,'Media not found',404);const bytes=await storage.get(media.key);requireValue(hash(bytes)===attachment.sha256&&bytes.length===media.bytes,'Media checksum mismatch',500);files.push({name:attachment.name,mime:media.mime,sha256:attachment.sha256,bytes:media.bytes,body:bytes.toString('base64')});}
      await authenticate(req);send(res,200,{schema_version:1,kind:'inspirainest-record',record,files});return true;
    }
    if (route === '/api/records/capabilities' && req.method === 'GET') {
      send(res,200,{protocol:1,documentVersions:[1],structuredErrors:true,contentTrashProtocol:1,recordSyncProtocol:1}); return true;
    }
    if(route==='/api/records/changes'&&req.method==='GET'){await readRecordChanges({store,req,res,authenticate});return true;}
    const mediaRoute = route.match(/^\/api\/records\/media\/([a-f0-9]{64})$/);
    if (mediaRoute) {
      const sha = mediaRoute[1];
      if (req.method === 'HEAD') {
        const media = await store.get('record-media',sha); requireValue(media,'Media not found',404);
        res.setHeader('Content-Length',media.bytes); res.setHeader('Content-Type',media.mime); res.setHeader('X-Content-SHA256',sha); res.end(); return true;
      }
      if (req.method === 'GET') { await readMedia(req,res,sha); return true; }
      requireValue(req.method === 'PUT','Method not allowed',405);
      const mime = req.headers['content-type']?.split(';')[0]; requireValue(mediaExtensions[mime],'Unsupported media type',415);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; requireValue(size <= MEDIA_LIMIT,'Media exceeds 32 MiB',413); chunks.push(chunk); }
      const buffer = Buffer.concat(chunks); requireValue(size > 0 && hash(buffer) === sha,'Media checksum mismatch');
      requireValue(documentExtensions[mime]?await validDocument(buffer,mime):validMedia(buffer,mime),'File does not match its media type',415);
      const result = await serialized(`record-media:${sha}`,async () => {
        const old = await store.get('record-media',sha);
        if (old) { recordCheck(old.mime === mime,'record_media_type_mismatch','附件类型与已保存的文件不一致'); return old; }
        const key = `record-media/${sha}`; await storage.put(key,buffer); await authenticate(req);
        return store.put('record-media',{id:sha,mime,bytes:size,key,createdAt:now()});
      }); send(res,200,{sha256:result.id,mime:result.mime,bytes:result.bytes}); return true;
    }
    if (route === '/api/records' && req.method === 'GET') {
      const tasks=await store.list('task');
      const rows=await store.list('capture');
      send(res,200,{excluded:rows.filter(r=>r.origin==='collection_input').map(({id,origin})=>({id,origin})),deleted:rows.filter(r=>r.origin!=='collection_input'&&r.deletedAt).map(({id,version,deletedAt,trashVersion})=>({id,version,deletedAt,trashVersion})),records:rows.filter(r=>r.origin!=='collection_input'&&!r.deletedAt).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(record=>({...record,tasks:tasks.filter(task=>task.recordId===record.id).map(({id,state,recordVersion,createdAt,events})=>({id,state,recordVersion,createdAt,events:events.slice(-1)}))}))}); return true;
    }
    const recordRoute = route.match(/^\/api\/records\/([^/]+)(\/process)?$/);
    requireValue(recordRoute,'Not found',404);
    const recordId = identify(recordRoute[1]);
    if (req.method === 'GET' && !recordRoute[2]) {
      const record = await store.get('capture',recordId); requireValue(record&&!record.deletedAt,'Record not found',404);
      send(res,200,{...record,tasks:(await store.list('task')).filter(t => t.recordId === recordId).sort((a,b) => b.createdAt.localeCompare(a.createdAt))}); return true;
    }
    const input = await body(req), requestId = identify(input.requestId);
    requireValue(Number.isInteger(input.baseVersion) && input.baseVersion >= 0,'Invalid base version');
    const payloadHash = hash(JSON.stringify(canonical({method:req.method,input})));
    const operationId = `${recordId}:${requestId}`;
    const response = await serialized(`capture:${recordId}`,async () => store.transaction(async tx => {
      const syncState=await lockRecordChanges(tx);
      const credential = await tx.getForUpdate('device',device.credentialId || device.id);
      const live = await tx.get('device',device.id);
      requireValue(credential && live && !credential.revokedAt && !live.revokedAt && [credential.tokenHash,credential.ownerTokenHash].includes(device.credentialTokenHash || hash(req.authToken)), 'Device authorization required',401);
      const previous = await tx.getForUpdate('capture-operation',operationId);
      if (previous) { recordCheck(previous.hash === payloadHash,'record_request_reused','请求编号对应的内容已改变；原请求已保留，请重新保存修改'); return previous.result; }
      const current = await tx.getForUpdate('capture',recordId);
      recordCheck(!current?.deletedAt,'record_deleted','记录已删除，请从回收站恢复');
      let result;
      if (recordRoute[2]) {
        requireValue(req.method === 'POST','Method not allowed',405);
        requireValue(current,'Record not found',404);
        const snapshot=current.version===input.baseVersion?current:await tx.get('capture-version',`${recordId}:${input.baseVersion}`);
        recordCheck(snapshot,'record_version_missing','记录版本不存在，请刷新后再加工');
        requireValue(recordPresets[input.preset],'Invalid processing preset');
        const instructions = input.instructions || ''; requireValue(typeof instructions === 'string' && instructions.length <= 10000,'Invalid instructions');
        requireValue(input.preset !== 'custom' || instructions.trim(),'请填写自定义加工要求');
        if (input.deviceId) requireValue(workerAuthorized(await tx.get('device',input.deviceId)),'Invalid dispatch device');
        assertExecutionAgent(input.agent);
        const task = {id:id(),submissionId:`record:${operationId}`,recordId,recordVersion:snapshot.version,recordSnapshot:{...snapshot,id:recordId},processing:{preset:input.preset,instructions},content:snapshot.text || '整理这条媒体记录',url:null,type:'note',autoArchive:false,tags:[],scenario:null,preferredDeviceId:input.deviceId || null,preferredAgent:input.agent || null,deviceId:null,archiveId:null,createdAt:now()};
        result = await saveTask(task,'queued','等待可用电脑加工记录',tx);
      } else {
        requireValue(req.method === 'PUT','Method not allowed',405);
        recordCheck((current?.version || 0) === input.baseVersion,'record_version_conflict','云端记录已更新，本机内容已保留，请比较内容后同步');
        recordCheck(!current?.document || input.document !== undefined,'record_document_required','此记录包含完整排版，请使用支持排版的新版客户端编辑',422);
        requireValue(typeof input.text === 'string' && input.text.length <= 50000,'Record text exceeds 50000 characters');
        requireValue(Array.isArray(input.attachments) && input.attachments.length <= 20,'At most 20 attachments per record');
        const attachments = []; let total = 0;
        for (const attachment of input.attachments) {
          requireValue(attachment && digest.test(attachment.sha256) && typeof attachment.name === 'string' && attachment.name.length > 0 && attachment.name.length <= 200,'Invalid attachment');
          const media = await tx.get('record-media',attachment.sha256); recordCheck(media,'record_media_missing','附件尚未完整上传，请重试同步');
          let thumbnailSha256;if(attachment.thumbnailSha256){requireValue((media.mime.startsWith('image/')||media.mime.startsWith('video/'))&&digest.test(attachment.thumbnailSha256),'Invalid thumbnail');const preview=await tx.get('record-media',attachment.thumbnailSha256);recordCheck(preview?.mime.startsWith('image/')&&preview.bytes<=256*1024,'record_media_missing','附件预览尚未上传或超过大小限制，请重试同步');thumbnailSha256=preview.id;}attachments.push({id:identify(attachment.id),sha256:media.id,name:attachment.name,mime:media.mime,bytes:media.bytes,...(thumbnailSha256?{thumbnailSha256}:{})}); total += media.bytes;
        }
        requireValue(new Set(attachments.map(a=>a.id)).size === attachments.length,'Duplicate attachment ID');
        requireValue(total <= 128 * 1024 * 1024,'Record media exceeds 128 MiB',413);
        requireValue(input.text.trim() || attachments.length,'Record is empty');
        const createdAt = current?.createdAt || input.createdAt || now();
        requireValue(typeof createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(createdAt) && /(Z|[+-]\d{2}:\d{2})$/.test(createdAt) && Number.isFinite(Date.parse(createdAt)),'Invalid creation time');
        if(input.document!==undefined)validateDocument(input.document,attachments);
        result = {id:recordId,...(current?current.origin?{origin:current.origin}:{}:{origin:'user'}),text:input.text,...(input.document?{document:input.document}:{}),attachments,version:input.baseVersion+1,trashVersion:current?.trashVersion??0,createdAt,updatedAt:now()};
        await tx.put('capture-version',{...result,id:`${recordId}:${result.version}`,recordId}); await tx.put('capture',result);
        await appendRecordChange(tx,result,syncState);
      }
      await tx.put('capture-operation',{id:operationId,hash:payloadHash,result}); return result;
    }));
    send(res,200,response);
    return true;
  }
  return {handle};
}
