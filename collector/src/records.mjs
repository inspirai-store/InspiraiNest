import { hash, id, now, requireValue } from './common.mjs';
import { workerAuthorized } from './device-metadata.mjs';

export const MEDIA_LIMIT = 32 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
export const mediaExtensions = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','audio/mp4':'m4a','audio/aac':'aac','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/webm':'webm','audio/ogg':'ogg','audio/flac':'flac' };
export const recordPresets = { summary:'整理摘要', extract:'转写 / 识字', actions:'提炼行动项', custom:'自定义' };
const identify = value => { requireValue(typeof value === 'string' && uuid.test(value), 'Invalid record/request ID'); return value.toLowerCase(); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
function validMedia(buffer, mime) {
  const ascii = (start, end) => buffer.toString('ascii',start,end);
  switch (mime) {
    case 'image/png': return buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
    case 'image/jpeg': return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    case 'image/webp': return ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP';
    case 'image/gif': return /^GIF8[79]a$/.test(ascii(0,6));
    case 'audio/mp4': return ascii(4,8) === 'ftyp';
    case 'audio/webm': return buffer.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'));
    case 'audio/ogg': return ascii(0,4) === 'OggS';
    case 'audio/flac': return ascii(0,4) === 'fLaC';
    case 'audio/wav': case 'audio/x-wav': return ascii(0,4) === 'RIFF' && ascii(8,12) === 'WAVE';
    case 'audio/mpeg': return ascii(0,3) === 'ID3' || buffer[0] === 255 && (buffer[1] & 224) === 224;
    case 'audio/aac': return buffer[0] === 255 && (buffer[1] & 246) === 240;
    default: return false;
  }
}
export function createRecords({store,storage,serialized,authenticate,owner,assigned,body,send,saveTask}) {
  async function readMedia(req, res, sha) {
    const media = await store.get('record-media', sha); requireValue(media,'Media not found',404);
    const bytes = await storage.get(media.key); await authenticate(req);
    requireValue(hash(bytes) === sha && bytes.length === media.bytes,'Media checksum mismatch',500);
    res.writeHead(200,{'Content-Type':media.mime,'Content-Length':bytes.length,'Content-Disposition':`inline; filename="${sha}.${mediaExtensions[media.mime]}"`,'X-Content-SHA256':sha}); res.end(bytes);
  }
  async function handle(req,res,route,device) {
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
    const mediaRoute = route.match(/^\/api\/records\/media\/([a-f0-9]{64})$/);
    if (mediaRoute) {
      const sha = mediaRoute[1];
      if (req.method === 'GET') { await readMedia(req,res,sha); return true; }
      requireValue(req.method === 'PUT','Method not allowed',405);
      const mime = req.headers['content-type']?.split(';')[0]; requireValue(mediaExtensions[mime],'Unsupported media type',415);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; requireValue(size <= MEDIA_LIMIT,'Media exceeds 32 MiB',413); chunks.push(chunk); }
      const buffer = Buffer.concat(chunks); requireValue(size > 0 && hash(buffer) === sha,'Media checksum mismatch');
      requireValue(validMedia(buffer,mime),'File does not match its media type',415);
      const result = await serialized(`record-media:${sha}`,async () => {
        const old = await store.get('record-media',sha);
        if (old) { requireValue(old.mime === mime,'Media type mismatch',409); return old; }
        const key = `record-media/${sha}`; await storage.put(key,buffer); await authenticate(req);
        return store.put('record-media',{id:sha,mime,bytes:size,key,createdAt:now()});
      }); send(res,200,{sha256:result.id,mime:result.mime,bytes:result.bytes}); return true;
    }
    if (route === '/api/records' && req.method === 'GET') {
      const tasks=await store.list('task');
      send(res,200,{records:(await store.list('capture')).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(record=>({...record,tasks:tasks.filter(task=>task.recordId===record.id).map(({id,state,recordVersion,createdAt,events})=>({id,state,recordVersion,createdAt,events:events.slice(-1)}))}))}); return true;
    }
    const recordRoute = route.match(/^\/api\/records\/([^/]+)(\/process)?$/);
    requireValue(recordRoute,'Not found',404);
    const recordId = identify(recordRoute[1]);
    if (req.method === 'GET' && !recordRoute[2]) {
      const record = await store.get('capture',recordId); requireValue(record,'Record not found',404);
      send(res,200,{...record,tasks:(await store.list('task')).filter(t => t.recordId === recordId).sort((a,b) => b.createdAt.localeCompare(a.createdAt))}); return true;
    }
    const input = await body(req), requestId = identify(input.requestId);
    requireValue(Number.isInteger(input.baseVersion) && input.baseVersion >= 0,'Invalid base version');
    const payloadHash = hash(JSON.stringify(canonical({method:req.method,input})));
    const operationId = `${recordId}:${requestId}`;
    const response = await serialized(`capture:${recordId}`,async () => store.transaction(async tx => {
      const credential = await tx.getForUpdate('device',device.credentialId || device.id);
      const live = await tx.get('device',device.id);
      requireValue(credential && live && !credential.revokedAt && !live.revokedAt && [credential.tokenHash,credential.ownerTokenHash].includes(device.credentialTokenHash || hash(req.authToken)), 'Device authorization required',401);
      const previous = await tx.getForUpdate('capture-operation',operationId);
      if (previous) { requireValue(previous.hash === payloadHash,'Request ID reused with different content',409); return previous.result; }
      const current = await tx.getForUpdate('capture',recordId);
      let result;
      if (recordRoute[2]) {
        requireValue(req.method === 'POST','Method not allowed',405);
        requireValue(current,'Record not found',404);
        const snapshot=current.version===input.baseVersion?current:await tx.get('capture-version',`${recordId}:${input.baseVersion}`);
        requireValue(snapshot,'记录版本不存在，请刷新后再加工',409);
        requireValue(recordPresets[input.preset],'Invalid processing preset');
        const instructions = input.instructions || ''; requireValue(typeof instructions === 'string' && instructions.length <= 10000,'Invalid instructions');
        requireValue(input.preset !== 'custom' || instructions.trim(),'请填写自定义加工要求');
        if (input.deviceId) requireValue(workerAuthorized(await tx.get('device',input.deviceId)),'Invalid dispatch device');
        requireValue(!input.agent || ['codex','codebuddy'].includes(input.agent),'Unknown agent');
        const task = {id:id(),submissionId:`record:${operationId}`,recordId,recordVersion:snapshot.version,recordSnapshot:{...snapshot,id:recordId},processing:{preset:input.preset,instructions},content:snapshot.text || '整理这条媒体记录',url:null,type:'note',autoArchive:false,tags:[],scenario:null,preferredDeviceId:input.deviceId || null,preferredAgent:input.agent || null,deviceId:null,archiveId:null,createdAt:now()};
        result = await saveTask(task,'queued','等待可用电脑加工记录',tx);
      } else {
        requireValue(req.method === 'PUT','Method not allowed',405);
        requireValue((current?.version || 0) === input.baseVersion,'记录已被其他设备修改，本机内容已保留，请刷新后重新提交',409);
        requireValue(typeof input.text === 'string' && input.text.length <= 50000,'Record text exceeds 50000 characters');
        requireValue(Array.isArray(input.attachments) && input.attachments.length <= 20,'At most 20 attachments per record');
        const attachments = []; let total = 0;
        for (const attachment of input.attachments) {
          requireValue(attachment && digest.test(attachment.sha256) && typeof attachment.name === 'string' && attachment.name.length > 0 && attachment.name.length <= 200,'Invalid attachment');
          const media = await tx.get('record-media',attachment.sha256); requireValue(media,'Attachment has not been uploaded',409);
          let thumbnailSha256;if(attachment.thumbnailSha256){requireValue(media.mime.startsWith('image/')&&digest.test(attachment.thumbnailSha256),'Invalid thumbnail');const preview=await tx.get('record-media',attachment.thumbnailSha256);requireValue(preview?.mime.startsWith('image/')&&preview.bytes<=256*1024,'Thumbnail has not been uploaded or exceeds 256 KiB',409);thumbnailSha256=preview.id;}attachments.push({id:identify(attachment.id),sha256:media.id,name:attachment.name,mime:media.mime,bytes:media.bytes,...(thumbnailSha256?{thumbnailSha256}:{})}); total += media.bytes;
        }
        requireValue(new Set(attachments.map(a=>a.id)).size === attachments.length,'Duplicate attachment ID');
        requireValue(total <= 128 * 1024 * 1024,'Record media exceeds 128 MiB',413);
        requireValue(input.text.trim() || attachments.length,'Record is empty');
        const createdAt = current?.createdAt || input.createdAt || now();
        requireValue(typeof createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(createdAt) && /(Z|[+-]\d{2}:\d{2})$/.test(createdAt) && Number.isFinite(Date.parse(createdAt)),'Invalid creation time');
        result = {id:recordId,text:input.text,attachments,version:input.baseVersion+1,createdAt,updatedAt:now()};
        await tx.put('capture-version',{...result,id:`${recordId}:${result.version}`,recordId}); await tx.put('capture',result);
      }
      await tx.put('capture-operation',{id:operationId,hash:payloadHash,result}); return result;
    }));
    send(res,200,response);
    return true;
  }
  return {handle};
}
