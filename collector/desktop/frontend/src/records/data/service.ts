import {safeUrl} from './document.ts';
import {errorMessage} from '../../shared/errors.ts';
import {AccountRecordStore,recordScope} from './account-store.ts';
import type { Attachment, Connection, LocalDraft, LocalRecord, ProcessRequest, RecordStore, RecordTask } from './types.ts';
import type { RecordTransport } from './types.ts';
import { blobBase64, RequestError, requestJson, sha256 } from './transport.ts';
import type {ConflictChoice,RecordConflict,RecordSnapshot} from './types.ts';
import {sameContent,sameProjection,snapshot} from './sync.ts';
export const newDraft = (): LocalDraft => ({id:'draft',recordId:crypto.randomUUID(),text:'',attachments:[]});
export const recordState = (item: LocalRecord) => {
  if(item.deletionQueue?.length)return item.deletionError?'操作待重试':'恢复待同步';
  if (item.sync === 'conflict') return '内容冲突';
  if (item.sync === 'failed' && item.errorCode === 'record_protocol_incompatible') return '服务端待升级';
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
  private syncing: Promise<void> | null = null;
  private syncAgain = false;
  private syncFull = false;
  private protocol: 0|1|null = null;
  private probedAt=0;
  store: RecordStore; private baseStore:RecordStore; readonly transport: RecordTransport;
  constructor(store: RecordStore, transport: RecordTransport) {this.baseStore=store;this.store=new AccountRecordStore(store,this.connection);this.transport=transport;}
  private serial<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.then(work); this.queue = result.catch(() => {}); return result; }
  invalidateSession() { this.activeTaskCount = 0; this.epoch++; this.statusPending=null; this.protocol=null; this.connection = {paired:false,server:''}; }
  private statusPending:Promise<Connection&{epoch:number}>|null=null;
  private status() { if(this.statusPending)return this.statusPending;const pending=this.readStatus();this.statusPending=pending;void pending.finally(()=>{if(this.statusPending===pending)this.statusPending=null;}).catch(()=>{});return pending; }
  private async readStatus() { const epoch=this.epoch;const status=await this.transport.status();this.assertSession(epoch);
    if(status.server!==this.connection.server||status.paired!==this.connection.paired||status.deviceId!==this.connection.deviceId){this.epoch++;this.activeTaskCount=0;this.protocol=null;}
    this.connection=status;const session={...status,epoch:this.epoch};
    const scoped=new AccountRecordStore(this.baseStore,status);await this.serial(()=>scoped.migrate(status,()=>this.assertSession(session.epoch)));this.assertSession(session.epoch);this.store=scoped;return session;
  }
  private assertSession(epoch: number) { if (epoch !== this.epoch) throw new Error('登录状态已改变，记录仍保存在本机'); }
  async load() { const session=await this.status();const all = await this.store.all();this.assertSession(session.epoch);let draft=all.find(i=>i.id==='draft') as LocalDraft|undefined;if(!draft)draft=await this.serial(async()=>{let stored=await this.store.get('draft') as LocalDraft|undefined;if(!stored){stored={...newDraft(),accountScope:recordScope(session)};await this.store.put(stored);}return stored;});const sync=await this.store.get('__record-sync__');return {draft,lastCheckedAt:sync?.checkedAt as string|undefined,taskCount:this.activeTaskCount,recoveries:all.filter(i=>i.id!=='draft'&&((i as LocalRecord).recoveryDrafts as LocalDraft[]|undefined)?.length) as LocalRecord[],records:all.filter(i=>i.id!=='draft'&&!(i as LocalRecord).deletedAt) as LocalRecord[]}; }
  async trash(){await this.status();return (await this.store.all()).filter(i=>i.id!=='draft'&&(i as LocalRecord).deletedAt&&(i as LocalRecord).deletedAt!=='restored-draft') as LocalRecord[];}
  async setDeleted(id:string,deleted:boolean){
    const session=await this.status(),store=this.store;
    return this.serial(async()=>{this.assertSession(session.epoch);const item=await store.get(id) as LocalRecord|undefined;if(!item)throw Error('记录不存在');
      if(!!item.deletedAt===deleted)return;
      if(item.discardedDraft&&!deleted){const draft=await store.get('draft') as LocalDraft|undefined;if(draft&&(draft.text.trim()||draft.attachments.length))throw Error('请先保存当前草稿，再恢复');const restored={...item.discardedDraft,accountScope:recordScope(session)};const parent=restored.editingId?await store.get(restored.editingId) as LocalRecord|undefined:null;if(parent?.deletedAt){restored.recordId=crypto.randomUUID();delete restored.editingId;delete restored.baseVersion;delete restored.baseSnapshot;delete restored.resolvingVersion;}await store.put(restored);}
      const trashVersion=item.trashVersion??0;
      if(!item.localOnly&&(item.remoteVersion>0||item.payload||item.sync==='syncing'))item.deletionQueue=[...(item.deletionQueue??[]),{requestId:crypto.randomUUID(),action:deleted?'delete':'restore',version:item.remoteVersion,trashVersion}];
      if(deleted&&item.pendingProcess){item.cancelledProcess=structuredClone(item.pendingProcess);delete item.pendingProcess;}
      if(deleted)item.tasks=item.tasks?.map(t=>['completed','cancelled','failed','interrupted'].includes(t.state)?t:{...t,state:'cancelled'});
      item.deletedAt=deleted?new Date().toISOString():null;item.trashVersion=trashVersion+1;item.deletionError='';
      // A restored draft is carried by the draft slot, never uploaded as a second record.
      if(item.discardedDraft&&!deleted)item.deletedAt='restored-draft';
      await store.put(item);
      const draft=await store.get('draft') as LocalDraft|undefined;
      if(deleted&&draft?.editingId===id)await this.discardDraftInStore(store,draft,session);
    });
  }
  private async discardDraftInStore(store:RecordStore,draft:LocalDraft,session:Connection){
    if(draft.text.trim()||draft.attachments.length){const item:LocalRecord={id:crypto.randomUUID(),accountScope:recordScope(session),text:draft.text,document:draft.document,attachments:structuredClone(draft.attachments),createdAt:new Date().toISOString(),version:1,remoteVersion:0,server:null,sync:'pending',error:'',deletedAt:new Date().toISOString(),localOnly:true,discardedDraft:structuredClone(draft)};await store.commit(item,{...newDraft(),accountScope:recordScope(session)});}
    else await store.put({...newDraft(),accountScope:recordScope(session)});
  }
  async discardDraft(){const session=await this.status(),store=this.store;await this.serial(async()=>{this.assertSession(session.epoch);const draft=await store.get('draft') as LocalDraft|undefined;if(draft)await this.discardDraftInStore(store,draft,session);});}
  private async syncDeletion(store:RecordStore,id:string,session:Connection&{epoch:number}){
    for(;;){const item=await store.get(id) as LocalRecord|undefined,operation=item?.deletionQueue?.[0];if(!item||!operation)return;
      try{
        if(operation.version===0){
          try{const remote=await this.remoteRecord(id,session);if(!item.payload||!sameContent(item.payload,remote))throw Error('云端内容已更新，请刷新后重试删除');operation.version=remote.version;await this.serial(async()=>{const live=await store.get(id) as LocalRecord;if(live.deletionQueue?.[0]?.requestId===operation.requestId){live.remoteVersion=remote.version;live.deletionQueue[0]=operation;await store.put(live);}});}
          catch(error){if(!(error instanceof RequestError&&error.status===404))throw error;await this.serial(async()=>{const live=await store.get(id) as LocalRecord;live.deletionQueue=[];await store.put(live);});return;}
        }
        await requestJson<{trashVersion:number}>(this.transport,{route:'/api/content-trash/record/'+id+'/'+operation.action,method:'POST',server:session.server,deviceId:session.deviceId,json:{requestId:operation.requestId,version:operation.version,trashVersion:operation.trashVersion}});this.assertSession(session.epoch);
        await this.serial(async()=>{const live=await store.get(id) as LocalRecord;this.assertSession(session.epoch);if(live.deletionQueue?.[0]?.requestId!==operation.requestId)return;live.deletionQueue.shift();if(live.deletionQueue[0])live.deletionQueue[0].version=operation.version;live.deletionError='';await store.put(live);});
      }catch(error){this.assertSession(session.epoch);
        const latest=await store.get(id) as LocalRecord;
        if(error instanceof RequestError&&error.status===409&&latest.deletionQueue?.at(-1)?.action==='restore'){
          try{const remote=await requestJson<{deletedAt?:string;trashVersion:number}>(this.transport,{route:'/api/content-trash/record/'+id,server:session.server,deviceId:session.deviceId});this.assertSession(session.epoch);if(!remote.deletedAt){await this.serial(async()=>{const live=await store.get(id) as LocalRecord;if(live.deletionQueue?.at(-1)?.action==='restore'){live.deletionQueue=[];live.deletedAt=null;live.trashVersion=remote.trashVersion;live.deletionError='';await store.put(live);}});return;}}catch{/* Retain the queue and local contents until the account can be checked. */}
        }
        await this.serial(async()=>{const live=await store.get(id) as LocalRecord;live.deletionError=error instanceof RequestError&&(error.status===405||error.status===404&&/not found/i.test(error.message))?'服务端待升级':errorMessage(error);await store.put(live);});return;}
    }
  }
  async saveDraft(draft: LocalDraft) { const snapshot=structuredClone(draft);const session=await this.status();if(snapshot.accountScope&&snapshot.accountScope!==recordScope(session))return; snapshot.accountScope=recordScope(session);return this.serial(async()=>{this.assertSession(session.epoch);const current=await this.store.get('draft') as LocalDraft|undefined;if(current?.recordId&&current.recordId!==snapshot.recordId)return;const parent=snapshot.editingId?await this.store.get(snapshot.editingId) as LocalRecord|undefined:undefined;if(parent?.deletedAt){snapshot.remoteDeleted=true;snapshot.recoveryKind="editor";snapshot.recoveryTrashVersion=parent.trashVersion;parent.recoveryDrafts=[...(parent.recoveryDrafts as LocalDraft[]??[]).filter(d=>d.recoveryKind!=="editor"||d.recoveryTrashVersion!==parent.trashVersion),snapshot];await this.store.putMany!([parent,snapshot]);}else await this.store.put(snapshot);}); }
  async saveRecord(draft: LocalDraft,recoveryParent?:string) {
    const snapshot=structuredClone(draft);const session=await this.status();if(snapshot.accountScope&&snapshot.accountScope!==recordScope(session))throw Error('资料空间已切换，记录仍保存在本机');
    return this.serial(async () => {
      this.assertSession(session.epoch);if (!snapshot.text.trim() && !snapshot.attachments.length) throw new Error('记录内容为空');
      const previous = snapshot.editingId ? await this.store.get(snapshot.editingId) as LocalRecord | undefined : undefined;
      if(previous?.deletedAt)throw Error('记录已删除，请从回收站恢复');
      if (previous && (previous.sync==='syncing'||previous.sync==='conflict'&&snapshot.resolvingVersion===undefined)) throw new Error(previous.sync === 'conflict' ? '请先比较冲突内容' : '正在同步，请稍后补充');
      if(snapshot.resolvingVersion!==undefined){const remote=await this.remoteRecord(snapshot.editingId!,session);this.assertSession(session.epoch);if(remote.version!==snapshot.resolvingVersion)throw new Error('云端再次更新，合并草稿已保存在本机，请重新比较');}
      const item: LocalRecord = {...previous,accountScope:recordScope(session),id:snapshot.editingId ?? snapshot.recordId,text:snapshot.text,document:snapshot.document,attachments:snapshot.attachments,createdAt:previous?.createdAt ?? new Date().toISOString(),version:previous?.version ?? 1,remoteVersion:snapshot.baseVersion ?? previous?.remoteVersion ?? 0,server:previous?.server ?? (this.connection.server || null),sync:'pending',error:''};
      delete item.payload;
      delete item.repair;
      item.baseSnapshot=snapshot.baseSnapshot??previous?.baseSnapshot;item.errorCode=undefined;
      const next={...newDraft(),accountScope:recordScope(session)}; const parent=recoveryParent?await this.store.get(recoveryParent) as LocalRecord|undefined:undefined;
      if(parent){parent.recoveryDrafts=(parent.recoveryDrafts as LocalDraft[]??[]).filter(d=>!sameContent(d,snapshot));await this.store.putMany!([item,next,parent]);}else await this.store.commit(item,next); return {item,draft:next};
    });
  }
  private async remoteRecord(id:string,session:Connection&{epoch:number}) {
    const remote=await requestJson<LocalRecord>(this.transport,{route:'/api/records/'+id,server:session.server,deviceId:session.deviceId});this.assertSession(session.epoch);
    if(remote.id!==id||!Number.isInteger(remote.version)||remote.version<1||typeof remote.text!=='string'||!Array.isArray(remote.attachments))throw new RequestError('服务端返回了无效的记录，请稍后重试',502,'record_ack_mismatch');
    return remote;
  }
  private backup(item:LocalRecord,reason:string,remote?:RecordSnapshot) {item.backups=[...(item.backups??[]),{at:new Date().toISOString(),reason,local:snapshot(item),payload:structuredClone(item.payload),remote:remote?structuredClone(remote):undefined}];}
  private accept(item:LocalRecord,remote:LocalRecord) {
    const attachments=remote.attachments.map(a=>({...a,blob:item.attachments.find(old=>old.sha256===a.sha256)?.blob,thumbnail:item.attachments.find(old=>old.sha256===a.sha256)?.thumbnail??a.thumbnail}));
    Object.assign(item,{text:remote.text,document:remote.document,attachments,version:remote.version,remoteVersion:remote.version,updatedAt:remote.updatedAt,sync:'synced',error:'',errorCode:undefined});delete item.payload;delete item.repair;item.baseSnapshot=snapshot(item);
  }
  private reconcile(item:LocalRecord,remote:LocalRecord):boolean {
    if(sameContent(item,remote)){this.accept(item,remote);return true;}
    if(item.baseSnapshot&&sameContent(item,item.baseSnapshot)){this.backup(item,'采用云端唯一修改',remote);this.accept(item,remote);return true;}
    if(item.baseSnapshot&&sameContent(remote,item.baseSnapshot)){this.backup(item,'仅本机修改，更新同步基线',remote);item.remoteVersion=remote.version;item.baseSnapshot={...snapshot(remote),version:remote.version};delete item.payload;item.sync='pending';return true;}
    return false;
  }
  async createFromSelection(text:string,title?:string,url?:string,quote=true,expectedScope?:string){
    const session=await this.status();if(expectedScope&&expectedScope!==recordScope(session))throw Error('资料空间已切换');if(!text.trim())throw Error('请选择文字');url=safeUrl(url??'')??undefined;
    const document:import('./types.ts').RichDocument={version:1,doc:{type:'doc',content:[...(quote?[{type:'blockquote',content:text.split('\n').map(line=>({type:'paragraph',content:line?[{type:'text',text:line}]:[]}))}]:text.split('\n').map(line=>({type:'paragraph',content:line?[{type:'text',text:line}]:[]}))),...(title?[{type:'paragraph',content:[{type:'text',text:'来源：'+title}]}]:[]),...(url?[{type:'paragraph',content:[{type:'text',text:url,marks:[{type:'link',attrs:{href:url}}]}]}]:[])]}};
    return this.serial(async()=>{this.assertSession(session.epoch);const item:LocalRecord={id:crypto.randomUUID(),accountScope:recordScope(session),text:[text,title?'来源：'+title:'',url??''].filter(Boolean).join('\n'),document,attachments:[],createdAt:new Date().toISOString(),version:1,remoteVersion:0,server:session.server||null,sync:'pending',error:''};await this.store.put(item);return item;});
  }
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing=(async()=>{
      const session=await this.status();if(!session.paired)return;const store=this.store;
      const syncPut=async(item:LocalRecord)=>this.serial(async()=>{const live=await store.get(item.id) as LocalRecord|undefined;if(live?.deletedAt||live?.deletionQueue?.length||Number(live?.trashVersion??0)>Number(item.trashVersion??0))return;if(session.epoch!==this.epoch){if(live&&item.sync==='failed')await store.put({...live,sync:'failed',error:item.error,errorCode:item.errorCode});return;}await store.put(item);});
      const api=<T>(route:string,method:'GET'|'PUT'|'POST'='GET',json?:unknown)=>requestJson<T>(this.transport,{route,method,json,server:session.server,deviceId:session.deviceId});
      let capabilities:Promise<void>|undefined;
      const requireRich=()=>capabilities??=(async()=>{
        let value:{protocol:number;documentVersions:number[]};
        const incompatible=()=>new RequestError('资料空间尚不支持完整排版，请升级服务端；本机内容已保留',422,'record_protocol_incompatible');
        try{value=await api('/api/records/capabilities');}
        catch(error){
          if(error instanceof RequestError){if([404,405].includes(error.status))throw incompatible();if(error.status>=500)throw new RequestError('资料空间服务暂不可用，请稍后重试；本机内容已保留',error.status,'record_service_unavailable');throw error;}
          throw new RequestError('暂时无法连接资料空间，请恢复网络后重试；本机内容已保留',0,'record_network_error');
        }
        this.assertSession(session.epoch);if(value?.protocol!==1||!value.documentVersions?.includes(1))throw incompatible();
      })();
      for(const stored of await store.all()){
        if(stored.id==='draft')continue;await this.syncDeletion(store,stored.id,session);const item=await store.get(stored.id) as LocalRecord;
        if(item.deletedAt||item.deletionQueue?.length||item.localOnly)continue;
        if(item.accountScope!==recordScope(session)||!['pending','failed','syncing','conflict'].includes(item.sync))continue;
        try{
          if(item.document)await requireRich();this.assertSession(session.epoch);
          if(item.sync==='conflict'){
            const remote=await this.remoteRecord(item.id,session);
            if(this.reconcile(item,remote)){await syncPut(item);if(String(item.sync)==='synced')continue;}
            // Legacy clients used this state for a committed, incomplete rich-text receipt.
            else if(!(item.document&&!remote.document&&item.payload&&sameProjection(item.payload,remote)))continue;
          }
          item.server=session.server;item.sync='syncing';await syncPut(item);
          for(const a of item.attachments){
            const uploads=[...(a.thumbnail?.blob?[a.thumbnail]:[]),...(a.blob?[a]:[])];
            for(const media of uploads){this.assertSession(session.epoch);const blob=media.blob!;if(blob.size!==media.bytes||await sha256(blob)!==media.sha256)throw new RequestError('本机附件校验失败，原件已保留',422,'record_media_invalid');
              const reply=await requestJson<{sha256:string;bytes:number}>(this.transport,{route:'/api/records/media/'+media.sha256,method:'PUT',server:session.server,deviceId:session.deviceId,bytes:await blobBase64(blob),mime:media.mime});this.assertSession(session.epoch);if(reply.sha256!==media.sha256||reply.bytes!==media.bytes)throw new RequestError('服务端未确认附件完整性',502,'record_media_invalid');}
          }
          for(let attempt=0;attempt<2;attempt++){
            item.payload??={requestId:crypto.randomUUID(),baseVersion:item.remoteVersion||0,text:item.text,...(item.document?{document:item.document}:{}),createdAt:item.createdAt,attachments:item.attachments.map(a=>({id:a.id,name:a.name,sha256:a.sha256,...(a.thumbnail?.sha256||a.thumbnailSha256?{thumbnailSha256:a.thumbnail?.sha256??a.thumbnailSha256}:{})}))};
            await syncPut(item);this.assertSession(session.epoch);
            let remote:LocalRecord;
            const live=await store.get(item.id) as LocalRecord;if(live.deletedAt||live.deletionQueue?.length)break;
            try{remote=await api<LocalRecord>('/api/records/'+item.id,'PUT',item.payload);}
            catch(error){
              if(error instanceof RequestError&&error.status===409&&(error.code==='record_version_conflict'||!error.code)){
                const latest=await this.remoteRecord(item.id,session);
                if(latest.version!==item.payload.baseVersion){
                  if(this.reconcile(item,latest)){if(String(item.sync)==='synced')break;if(attempt===0)continue;}
                  throw new RequestError('本机与云端内容均有修改，请比较后同步',409,'record_version_conflict');
                }
              }throw error;
            }
            this.assertSession(session.epoch);
            if(remote.id!==item.id||remote.version!==item.payload.baseVersion+1||typeof remote.text!=='string'||!Array.isArray(remote.attachments))throw new RequestError('服务端未确认完整记录，请重试；本机内容已保留',502,'record_ack_mismatch');
            item.acknowledged={...snapshot(remote),version:remote.version};
            if(!sameContent(item.payload,remote)){
              if(item.document&&!remote.document&&sameProjection(item.payload,remote)){
                const latest=await this.remoteRecord(item.id,session);
                if(sameContent(item,latest)){this.accept(item,latest);break;}
                if(latest.version!==remote.version||latest.document||!sameProjection(item.payload,latest))throw new RequestError('云端内容已有其他修改，请比较后恢复排版',409,'record_version_conflict');
                if(attempt===0&&!item.repair&&latest.version===remote.version&&!latest.document&&sameProjection(item.payload,latest)){
                  this.backup(item,'修复旧成功回执缺失的排版',latest);item.repair={fromVersion:latest.version};item.remoteVersion=latest.version;item.baseSnapshot={...snapshot(latest),version:latest.version};delete item.payload;continue;
                }
                throw new RequestError('云端排版尚未完整保存，请重试或比较内容',502,'record_ack_mismatch');
              }
              throw new RequestError('云端保存内容与本机不一致，请重试；原内容已保留',502,'record_ack_mismatch');
            }
            this.accept(item,remote);break;
          }
        }catch(error){item.sync=error instanceof RequestError&&error.code==='record_version_conflict'?'conflict':'failed';item.errorCode=error instanceof RequestError?error.code:'record_network_error';item.error=errorMessage(error);}
        await syncPut(item);this.assertSession(session.epoch);
      }
      for(const stored of await store.all())if(stored.id!=='draft')await this.syncDeletion(store,stored.id,session);
      for(const stored of await store.all()){
        if(stored.id==='draft')continue;const item=stored as LocalRecord;if(item.deletedAt||item.deletionQueue?.length||!item.pendingProcess||item.sync!=='synced'||item.server!==session.server)continue;const request=item.pendingProcess;
        try{const task=await api<RecordTask>('/api/records/'+item.id+'/process','POST',request);this.assertSession(session.epoch);await this.serial(async()=>{const latest=await store.get(item.id) as LocalRecord|undefined;this.assertSession(session.epoch);if(!latest||latest.deletedAt||latest.deletionQueue?.length||latest.pendingProcess?.requestId!==request.requestId)return;latest.tasks=[task,...(latest.tasks??[]).filter(t=>t.id!==task.id)];delete latest.pendingProcess;if(latest.sync==='synced')latest.error='';await store.put(latest);});}
        catch(error){await this.serial(async()=>{const latest=await store.get(item.id) as LocalRecord|undefined;if(latest?.pendingProcess?.requestId===request.requestId){latest.error=errorMessage(error);await store.put(latest);}});}this.assertSession(session.epoch);
      }
    })().finally(()=>{this.flushing=null;});return this.flushing;
  }
  sync(full=false):Promise<void> {
    this.syncAgain=true;this.syncFull ||= full;
    if(this.syncing)return this.syncing;
    this.syncing=(async()=>{do{this.syncAgain=false;const forceFull=this.syncFull;this.syncFull=false;const session=await this.status();if(!session.paired)return;
      if(this.protocol===null||this.protocol===0&&Date.now()-this.probedAt>300000){this.probedAt=Date.now();try{const caps=await requestJson<{recordSyncProtocol?:number}>(this.transport,{route:'/api/records/capabilities',server:session.server,deviceId:session.deviceId});this.assertSession(session.epoch);this.protocol=caps.recordSyncProtocol===1?1:0;}catch(error){if(error instanceof RequestError&&[404,405].includes(error.status))this.protocol=0;else throw error;}}
      await this.refresh(0,forceFull);await this.flush();await this.refresh();
    }while(this.syncAgain);})().finally(()=>{this.syncing=null;});return this.syncing;
  }
  async watch(){if(this.protocol!==1)return false;await this.refresh(25);return true;}
  async refresh(wait=0,full=false) {
    const session=await this.status();if(!session.paired)return;
    const store=this.store;
    const incremental=this.protocol===1;
    for(;;){
      const meta=await store.get('__record-sync__'),cursor=meta?.cursor as string|undefined;
      const route=incremental?'/api/records/changes?'+(cursor&&!full?'cursor='+encodeURIComponent(cursor)+'&':'')+'wait='+wait+'&limit=200':'/api/records';
      const data=await requestJson<{mode?:string;cursor?:string;hasMore?:boolean;checkedAt?:string;records?:LocalRecord[];deleted?:Partial<LocalRecord>[];changes?:{seq:number;record:LocalRecord}[]}>(this.transport,{route,server:session.server,deviceId:session.deviceId});this.assertSession(session.epoch);
      await this.serial(async()=>{
        this.assertSession(session.epoch);
        const latest=await store.get('__record-sync__'),current=latest?.cursor as string|undefined;
        if(data.cursor&&current&&data.cursor!==current){const [epoch,sequence]=data.cursor.split(':'),[currentEpoch,currentSequence]=current.split(':');if(epoch===currentEpoch&&Number(sequence)<Number(currentSequence)||epoch!==currentEpoch&&current!==cursor)return;}
        const updates=new Map<string,import('./types.ts').StoredItem>();
        const get=async(id:string)=>(updates.get(id)??await store.get(id)) as LocalRecord|undefined;
        const remoteRows=data.changes?data.changes.map(change=>({...change.record,changeSeq:change.seq})):[...(data.deleted??[]),...(data.records??[])];
        for(const value of remoteRows){const remote=value as LocalRecord;if(!remote.id)throw Error('服务端返回了无效的记录变化');const existing=await get(remote.id);
          if(existing?.deletionQueue?.length||existing?.discardedDraft)continue;
          const remoteTrash=Number(remote.trashVersion??0),localTrash=Number(existing?.trashVersion??0);
          if(remoteTrash<localTrash||existing?.changeSeq&&remote.changeSeq&&Number(remote.changeSeq)<Number(existing.changeSeq))continue;
          if(remote.deletedAt){
            const previous=existing??{id:remote.id,text:"",attachments:[],createdAt:remote.deletedAt,version:remote.version??0,remoteVersion:remote.version??0,server:session.server,sync:"synced",error:"",accountScope:recordScope(session)} as LocalRecord;
            const activeDraft=(updates.get('draft')??await store.get('draft')) as LocalDraft|undefined;
            const recoveries=[...(previous.recoveryDrafts as LocalDraft[]??[])];
            if(previous.sync!=='synced'&&!recoveries.some(d=>sameContent(d,previous)))recoveries.push({id:'draft',recordId:previous.id,editingId:previous.id,text:previous.text,document:previous.document,attachments:previous.attachments,accountScope:recordScope(session),remoteDeleted:true,recoveryKind:"pending"});
            if(activeDraft?.editingId===previous.id){const saved={...activeDraft,remoteDeleted:true,recoveryKind:"editor",recoveryTrashVersion:remoteTrash};updates.set('draft',saved);if(!recoveries.some(d=>sameContent(d,saved)))recoveries.push(saved);}
            updates.set(previous.id,{...previous,deletedAt:remote.deletedAt,trashVersion:remoteTrash,changeSeq:remote.changeSeq??previous.changeSeq,...(recoveries.length?{recoveryDrafts:recoveries}:{}),cancelledProcess:previous.pendingProcess??previous.cancelledProcess,pendingProcess:undefined,cancelledPayload:previous.payload??previous.cancelledPayload,payload:undefined,sync:"synced",error:""});continue;
          }
          if(existing?.deletedAt&&remoteTrash<=localTrash)continue;
          if(existing&&Number(existing.remoteVersion)>remote.version)continue;
          if(existing&&existing.sync!=='synced'){
            if(this.reconcile(existing,remote))updates.set(existing.id,existing);
            else if(existing.remoteVersion<remote.version){this.backup(existing,'云端与本机均有修改',remote);updates.set(existing.id,{...existing,sync:'conflict',error:'本机与云端内容均有修改，请比较后同步'});}continue;
          }
          if(existing?.document&&!remote.document){updates.set(existing.id,{...existing,sync:'failed',error:'云端返回的记录缺少完整排版；本机版本已保留，请检查服务端兼容性',errorCode:'record_protocol_incompatible'});continue;}
          updates.set(remote.id,{...existing,...remote,deletedAt:null,accountScope:recordScope(session),server:session.server,sync:'synced',remoteVersion:remote.version,error:'',errorCode:undefined,baseSnapshot:{...snapshot(remote),version:remote.version},attachments:remote.attachments.map(a=>({...a,blob:existing?.attachments.find(old=>old.sha256===a.sha256)?.blob,thumbnail:existing?.attachments.find(old=>old.sha256===a.sha256)?.thumbnail??a.thumbnail}))});
        }
        updates.set('__record-sync__',{id:'__record-sync__',...latest,...(data.cursor?{cursor:data.cursor}:{}),checkedAt:data.checkedAt??new Date().toISOString()} as unknown as import('./types.ts').StoredItem);
        this.assertSession(session.epoch);await store.putMany!([...updates.values()]);
      });
      this.activeTaskCount=(await store.all()).filter(r=>r.id!=='draft'&&!(r as LocalRecord).deletedAt).flatMap(record=>(record as LocalRecord).tasks??[]).filter(task=>!['completed','cancelled','failed'].includes(task.state)).length;
      if(!incremental||!data.hasMore)return;wait=0;
    }
  }
  async saveRecoveryAsNew(draft:LocalDraft){return this.saveRecord({...draft,recordId:crypto.randomUUID(),editingId:undefined,baseVersion:undefined,baseSnapshot:undefined,remoteDeleted:false},draft.editingId);}
  async openRecovery(id:string,index=0){await this.status();const current=await this.store.get('draft') as LocalDraft|undefined;if(current&&(current.text.trim()||current.attachments.length))throw Error('请先保存当前草稿');const item=await this.store.get(id) as LocalRecord|undefined;const draft=(item?.recoveryDrafts as LocalDraft[]|undefined)?.[index];if(!draft)throw Error('恢复草稿不存在');await this.store.put({...draft,recordId:id,editingId:id,remoteDeleted:true});}
  async edit(id:string) {const session=await this.status();return this.serial(async()=>{this.assertSession(session.epoch);const item=await this.store.get(id) as LocalRecord|undefined;if(!item||item.deletedAt)throw new Error('记录不存在或已删除');if(item.deletionQueue?.length)throw Error('请先完成删除或恢复同步');if(item.sync==='syncing'||item.sync==='conflict')throw new Error('请先完成同步或比较冲突内容');const attachments=[];for(const a of item.attachments)attachments.push({...a,blob:await this.readAttachment(item,a,session)});const draft:LocalDraft={accountScope:recordScope(session),id:'draft',recordId:item.id,editingId:item.id,baseVersion:item.remoteVersion,baseSnapshot:item.baseSnapshot??snapshot(item),text:item.text,document:item.document,attachments};await this.store.put(draft);return draft;});}
  async loadConflict(id:string):Promise<RecordConflict> {
    const session=await this.status(),item=await this.store.get(id) as LocalRecord|undefined;
    if(!item||item.server!==session.server||!session.paired)throw new Error('请恢复原资料空间连接');
    const remote=await this.remoteRecord(id,session);return {id,local:snapshot(item),remote:{...snapshot(remote),version:remote.version},base:item.baseSnapshot};
  }
  async resolveConflict(id:string,choice:ConflictChoice,remoteVersion:number) {
    const session=await this.status(),store=this.store;return this.serial(async()=>{
      const item=await store.get(id) as LocalRecord|undefined;
      if(!item||item.server!==session.server||!session.paired)throw new Error('请恢复原资料空间连接');
      const remote=await this.remoteRecord(id,session);this.assertSession(session.epoch);
      if(remote.version!==remoteVersion)throw new Error('云端再次更新，请重新加载比较；本机内容已保留');
      if(!['local','remote','copy','merge'].includes(choice))throw new Error('请选择处理方式');
      this.backup(item,'用户选择：'+choice,{...snapshot(remote),version:remote.version});
      if(choice==='copy'){
        const copy:LocalRecord={accountScope:recordScope(session),id:crypto.randomUUID(),text:item.text,document:item.document,attachments:structuredClone(item.attachments),version:1,remoteVersion:0,server:session.server,sync:'pending',error:'',createdAt:new Date().toISOString(),copiedFrom:item.id};
        this.accept(item,remote);await store.putMany!([item,copy]);return {copyId:copy.id};
      }
      if(choice==='merge'){
        const current=await store.get('draft') as LocalDraft|undefined;
        if(current&&(current.text.trim()||current.attachments.length)&&current.editingId!==item.id)throw new Error('请先保存现有草稿，再合并这条记录');
        const draft:LocalDraft={accountScope:recordScope(session),id:'draft',recordId:item.id,editingId:item.id,baseVersion:remote.version,resolvingVersion:remote.version,baseSnapshot:{...snapshot(remote),version:remote.version},text:item.text,document:item.document,attachments:structuredClone(item.attachments)};
        await store.commit(item,draft);return {draft};
      }
      if(choice==='remote')this.accept(item,remote);
      else {item.remoteVersion=remote.version;item.baseSnapshot={...snapshot(remote),version:remote.version};delete item.payload;item.sync='pending';item.error='';item.errorCode=undefined;}
      await store.put(item);return {};
    });
  }
  async queueProcess(id: string, options: Omit<ProcessRequest,'requestId'|'baseVersion'>) {
    const session=await this.status();
    await this.serial(async () => {const item=await this.store.get(id) as LocalRecord | undefined;this.assertSession(session.epoch);if(!item||item.deletedAt||item.deletionQueue?.length||item.sync!=='synced')throw new Error('请先完成记录同步');if(!session.paired || item.server!==session.server)throw new Error('请恢复原资料空间连接');if(options.preset==='custom'&&!options.instructions.trim())throw new Error('请填写自定义加工要求');item.pendingProcess ??= {...options,requestId:crypto.randomUUID(),baseVersion:item.remoteVersion};await this.store.put(item);});
  }
  async submitProcess(id:string){
    await this.flush();
    const pending=await this.store.get(id) as LocalRecord|undefined;if(pending?.pendingProcess && !pending.error)await this.flush();
  }
  async process(id:string,options:Omit<ProcessRequest,'requestId'|'baseVersion'>){await this.queueProcess(id,options);await this.submitProcess(id);}
  async attachment(item:LocalRecord,a:Attachment){return this.readAttachment(item,a,await this.status());}
  private async readAttachment(item:LocalRecord,a:Attachment,session:Connection&{epoch:number}) {
    if(item.accountScope!==recordScope(session))throw Error('资料空间已切换');
    if (a.blob) {if(a.blob.size!==a.bytes || await sha256(a.blob)!==a.sha256)throw new Error('本机附件校验失败');return a.blob;}
    if(!session.paired || item.server!==session.server)throw new Error('请恢复原资料空间连接');
    const reply=await this.transport.request({route:'/api/records/media/'+a.sha256,server:session.server,deviceId:session.deviceId});this.assertSession(session.epoch);
    if(reply.status!==200||!reply.bytes)throw new Error('附件读取失败');const blob=new Blob([Uint8Array.from(atob(reply.bytes),c=>c.charCodeAt(0))],{type:reply.mime});if(await sha256(blob)!==a.sha256)throw new Error('附件校验失败');return blob;
  }
}
