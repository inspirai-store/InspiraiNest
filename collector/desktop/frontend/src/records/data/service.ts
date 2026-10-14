import type { Attachment, Connection, LocalDraft, LocalRecord, ProcessRequest, RecordStore, RecordTask } from './types.ts';
import type { RecordTransport } from './types.ts';
import { blobBase64, RequestError, requestJson, sha256 } from './transport.ts';
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])])):value;
export const newDraft = (): LocalDraft => ({id:'draft',recordId:crypto.randomUUID(),text:'',attachments:[]});
export const recordState = (item: LocalRecord) => {
  if (item.sync === 'conflict') return '版本冲突';
  if (item.sync === 'failed') return '同步失败';
  if (item.sync === 'syncing') return '同步中';
  if (item.sync === 'pending') return '待同步';
  if (item.pendingProcess) return '加工待提交';
  if (item.tasks?.some(t => t.state === 'awaiting_review')) return '待确认';
  if (item.tasks?.some(t => ['queued','assigned','running','uploading'].includes(t.state))) return '加工中';
  if (item.tasks?.some(t => t.state === 'completed')) return '已归档';
  return '未加工';
};
export class RecordsService {
  private queue: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private activeTaskCount = 0;
  private connection: Connection = {paired:false,server:''};
  private flushing: Promise<void> | null = null;
  readonly store: RecordStore; readonly transport: RecordTransport;
  constructor(store: RecordStore, transport: RecordTransport) {this.store=store;this.transport=transport;}
  private serial<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.then(work); this.queue = result.catch(() => {}); return result; }
  invalidateSession() { this.activeTaskCount = 0; this.epoch++; this.connection = {paired:false,server:''}; }
  private async status() { const epoch = this.epoch; const status = await this.transport.status(); if (epoch !== this.epoch) throw new Error('登录状态已改变'); if (status.server !== this.connection.server || status.paired !== this.connection.paired) this.epoch++; this.connection = status; return {...status,epoch:this.epoch}; }
  private assertSession(epoch: number) { if (epoch !== this.epoch) throw new Error('登录状态已改变，记录仍保存在本机'); }
  async load() { const all = await this.store.all();let draft=all.find(i=>i.id==='draft') as LocalDraft|undefined;if(!draft)draft=await this.serial(async()=>{let stored=await this.store.get('draft') as LocalDraft|undefined;if(!stored){stored=newDraft();await this.store.put(stored);}return stored;});return {draft,taskCount:this.activeTaskCount,records:all.filter(i=>i.id!=='draft') as LocalRecord[]}; }
  saveDraft(draft: LocalDraft) { const snapshot = structuredClone(draft); return this.serial(async()=>{const current=await this.store.get('draft') as LocalDraft|undefined;if(current?.recordId&&current.recordId!==snapshot.recordId)return;await this.store.put(snapshot);}); }
  saveRecord(draft: LocalDraft) {
    const snapshot = structuredClone(draft);
    return this.serial(async () => {
      if (!snapshot.text.trim() && !snapshot.attachments.length) throw new Error('记录内容为空');
      const previous = snapshot.editingId ? await this.store.get(snapshot.editingId) as LocalRecord | undefined : undefined;
      if (previous && ['syncing','conflict'].includes(previous.sync)) throw new Error(previous.sync === 'conflict' ? '请先处理版本冲突' : '正在同步，请稍后补充');
      const item: LocalRecord = {...previous,id:snapshot.editingId ?? snapshot.recordId,text:snapshot.text,document:snapshot.document,attachments:snapshot.attachments,createdAt:previous?.createdAt ?? new Date().toISOString(),version:previous?.version ?? 1,remoteVersion:snapshot.baseVersion ?? previous?.remoteVersion ?? 0,server:previous?.server ?? (this.connection.server || null),sync:'pending',error:''};
      delete item.payload;
      const next = newDraft(); await this.store.commit(item,next); return {item,draft:next};
    });
  }
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const session = await this.status(); if (!session.paired) return;
      const api = <T>(route: string, method: 'GET' | 'PUT' | 'POST', json?: unknown) => requestJson<T>(this.transport,{route,method,json,server:session.server});
      for (const stored of await this.store.all()) {
        if (stored.id === 'draft') continue; const item = stored as LocalRecord;
        if (item.server && item.server !== session.server) continue;
        if (['pending','failed','syncing'].includes(item.sync)) {
          const latest=await this.serial(async()=>{const current=await this.store.get(item.id) as LocalRecord|undefined;if(!current||!['pending','failed','syncing'].includes(current.sync))return null;current.server=session.server;current.sync='syncing';await this.store.put(current);return current;});if(!latest)continue;Object.assign(item,latest);
          try {
            for (const a of item.attachments) {
              const uploads = [...(a.thumbnail?.blob ? [a.thumbnail] : []), ...(a.blob ? [a] : [])];
              for (const media of uploads) {
                this.assertSession(session.epoch); const blob = media.blob!;
                if (blob.size !== media.bytes || await sha256(blob) !== media.sha256) throw new Error('本机附件校验失败');
                const reply = await requestJson<{sha256:string;bytes:number}>(this.transport,{route:'/api/records/media/'+media.sha256,method:'PUT',server:session.server,bytes:await blobBase64(blob),mime:media.mime});
                this.assertSession(session.epoch); if (reply.sha256 !== media.sha256 || reply.bytes !== media.bytes) throw new Error('服务端未确认附件完整性');
              }
            }
            item.payload ??= {requestId:crypto.randomUUID(),baseVersion:item.remoteVersion || 0,text:item.text,...(item.document?{document:item.document}:{}),createdAt:item.createdAt,attachments:item.attachments.map(a => ({id:a.id,name:a.name,sha256:a.sha256,...(a.thumbnail?.sha256 || a.thumbnailSha256 ? {thumbnailSha256:a.thumbnail?.sha256 ?? a.thumbnailSha256} : {})}))};
            await this.store.put(item); this.assertSession(session.epoch);
            const remote = await api<{id:string;version:number;document?:import('./types.ts').RichDocument}>('/api/records/'+item.id,'PUT',item.payload);
            this.assertSession(session.epoch); if (remote.id !== item.id || remote.version !== item.payload.baseVersion+1) throw new Error('服务端未确认记录版本');
            if(item.document&&JSON.stringify(canonical(remote.document))!==JSON.stringify(canonical(item.document)))throw new RequestError('资料空间未确认完整排版，请更新服务端后处理冲突',409);
            item.sync='synced'; item.remoteVersion=remote.version; item.version=remote.version; item.error=''; delete item.payload;
          } catch (error) { item.sync=error instanceof RequestError && error.status===409 ? 'conflict':'failed';item.error=error instanceof Error ? error.message:String(error); }
          await this.store.put(item); this.assertSession(session.epoch);
        }
      }
      for(const stored of await this.store.all()){
        if(stored.id==='draft')continue;const item=stored as LocalRecord;if(!item.pendingProcess||item.sync!=='synced'||item.server!==session.server)continue;const request=item.pendingProcess;
        try{const task=await api<RecordTask>('/api/records/'+item.id+'/process','POST',request);this.assertSession(session.epoch);await this.serial(async()=>{const latest=await this.store.get(item.id) as LocalRecord|undefined;this.assertSession(session.epoch);if(!latest||latest.pendingProcess?.requestId!==request.requestId)return;latest.tasks=[task,...(latest.tasks??[]).filter(t=>t.id!==task.id)];delete latest.pendingProcess;if(latest.sync==='synced')latest.error='';await this.store.put(latest);});}
        catch(error){await this.serial(async()=>{const latest=await this.store.get(item.id) as LocalRecord|undefined;if(latest?.pendingProcess?.requestId===request.requestId){latest.error=error instanceof Error?error.message:String(error);await this.store.put(latest);}});}this.assertSession(session.epoch);
      }
    })().finally(() => {this.flushing=null;}); return this.flushing;
  }
  async refresh() {
    const session=await this.status();if(!session.paired)return;
    const data=await requestJson<{records:LocalRecord[]}>(this.transport,{route:'/api/records',server:session.server});this.assertSession(session.epoch);
    this.activeTaskCount=data.records.flatMap(record=>record.tasks??[]).filter(task=>!['completed','cancelled','failed'].includes(task.state)).length;
    for(const remote of data.records)await this.serial(async()=>{this.assertSession(session.epoch);const existing=await this.store.get(remote.id) as LocalRecord|undefined;if(existing && (existing.sync!=='synced' || existing.server && existing.server!==session.server))return;this.assertSession(session.epoch);await this.store.put({...existing,...remote,server:session.server,sync:'synced',remoteVersion:remote.version,error:'',attachments:remote.attachments.map(a=>({...a,blob:existing?.attachments.find(old=>old.sha256===a.sha256)?.blob,thumbnail:existing?.attachments.find(old=>old.sha256===a.sha256)?.thumbnail ?? a.thumbnail}))});});
  }
  edit(id:string) {return this.serial(async()=>{const item=await this.store.get(id) as LocalRecord|undefined;if(!item)throw new Error('记录不存在');if(item.sync==='syncing'||item.sync==='conflict')throw new Error('请先完成同步或处理版本冲突');const attachments=[];for(const a of item.attachments)attachments.push({...a,blob:await this.attachment(item,a)});const draft:LocalDraft={id:'draft',recordId:item.id,editingId:item.id,baseVersion:item.remoteVersion,text:item.text,document:item.document,attachments};await this.store.put(draft);return draft;});}
  resolveConflict(id:string) {return this.serial(async()=>{const session=await this.status();const item=await this.store.get(id) as LocalRecord|undefined;if(!item||item.server!==session.server||!session.paired)throw new Error('请恢复原资料空间连接');const remote=await requestJson<{version:number}>(this.transport,{route:'/api/records/'+id,server:session.server});this.assertSession(session.epoch);item.remoteVersion=remote.version;item.payload=null;item.sync='pending';await this.store.put(item);});}
  async queueProcess(id: string, options: Omit<ProcessRequest,'requestId'|'baseVersion'>) {
    const session=await this.status();
    await this.serial(async () => {const item=await this.store.get(id) as LocalRecord | undefined;this.assertSession(session.epoch);if(!item || item.sync!=='synced')throw new Error('请先完成记录同步');if(!session.paired || item.server!==session.server)throw new Error('请恢复原资料空间连接');if(options.preset==='custom'&&!options.instructions.trim())throw new Error('请填写自定义加工要求');item.pendingProcess ??= {...options,requestId:crypto.randomUUID(),baseVersion:item.remoteVersion};await this.store.put(item);});
  }
  async submitProcess(id:string){
    await this.flush();
    const pending=await this.store.get(id) as LocalRecord|undefined;if(pending?.pendingProcess && !pending.error)await this.flush();
  }
  async process(id:string,options:Omit<ProcessRequest,'requestId'|'baseVersion'>){await this.queueProcess(id,options);await this.submitProcess(id);}
  async attachment(item: LocalRecord, a: Attachment) {
    if (a.blob) {if(a.blob.size!==a.bytes || await sha256(a.blob)!==a.sha256)throw new Error('本机附件校验失败');return a.blob;}
    const session=await this.status();if(!session.paired || item.server!==session.server)throw new Error('请恢复原资料空间连接');
    const reply=await this.transport.request({route:'/api/records/media/'+a.sha256,server:session.server});this.assertSession(session.epoch);
    if(reply.status!==200||!reply.bytes)throw new Error('附件读取失败');const blob=new Blob([Uint8Array.from(atob(reply.bytes),c=>c.charCodeAt(0))],{type:reply.mime});if(await sha256(blob)!==a.sha256)throw new Error('附件校验失败');return blob;
  }
}
