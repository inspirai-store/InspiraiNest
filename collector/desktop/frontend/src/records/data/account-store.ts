import type {Connection,LocalDraft,LocalRecord,RecordStore,StoredItem} from './types.ts';

export const recordScope=(connection:Connection)=>connection.paired&&connection.server?JSON.stringify([connection.server,connection.deviceId??'']):'local';
const prefix='account-records-v1:';
const key=(scope:string,id:string)=>prefix+encodeURIComponent(scope)+':'+encodeURIComponent(id);
const marker=(name:string,value:string)=>({id:prefix+'migration:'+name,value}) as unknown as StoredItem;
const isDraft=(item:StoredItem)=>item.id==='draft';
const hasContent=(draft:LocalDraft|undefined)=>!!draft&&(!!draft.text.trim()||draft.attachments.length>0);

/** Keeps v1 items and Blob backups; only the active account's copies are exposed. */
export class AccountRecordStore implements RecordStore {
  readonly scope:string;
  private base:RecordStore;
  constructor(base:RecordStore,connection:Connection){this.base=base;this.scope=recordScope(connection);}
  private pack(item:StoredItem):StoredItem {return {...item,id:key(item.accountScope as string??this.scope,item.id),localId:item.id,accountScope:item.accountScope??this.scope} as StoredItem;}
  private unpack(item:StoredItem):StoredItem {return {...item,id:String(item.localId)} as StoredItem;}
  async all(){return (await this.base.all()).filter(item=>item.accountScope===this.scope&&typeof item.localId==='string'&&!item.transferredTo).map(item=>this.unpack(item));}
  async get(id:string){const item=await this.base.get(key(this.scope,id));return item&&!item.transferredTo?this.unpack(item):undefined;}
  put(item:StoredItem){return this.base.put(this.pack(item));}
  async commit(item:LocalRecord,draft:LocalDraft){if(item.accountScope!==this.scope||draft.accountScope!==this.scope)throw Error('资料空间已切换，记录仍保存在本机');await this.base.commit(this.pack(item) as LocalRecord,this.pack(draft) as LocalDraft);}
  private async batch(items:StoredItem[],assertSession:()=>void){assertSession();if(this.base.putMany)await this.base.putMany(items);else for(const item of items){assertSession();await this.base.put(item);}assertSession();}
  async migrate(connection:Connection,assertSession:()=>void){
    const all=await this.base.all();assertSession();const updates:StoredItem[]=[];
    const add=async(item:StoredItem)=>{if(!await this.get(item.id))updates.push(this.pack({...item,accountScope:this.scope}));assertSession();};
    // A server's unscoped cache belongs only to its first connected account.
    const server=connection.paired?connection.server:'';
    const ownerId=prefix+'migration:legacy:'+encodeURIComponent(server);
    if(!await this.base.get(ownerId)){
      for(const item of all){if(item.id==='draft'||item.id.startsWith(prefix))continue;const record=item as LocalRecord;if((record.server??'')===server)await add(record);}
      updates.push({id:ownerId,value:this.scope} as unknown as StoredItem);
    }
    // The old single draft is preserved once, not re-imported after every logout.
    const draftOwner=prefix+'migration:legacy-draft';
    if(!await this.base.get(draftOwner)){
      const legacy=all.find(isDraft) as LocalDraft|undefined;
      if(legacy)await add(legacy);
      updates.push(marker('legacy-draft',this.scope));
    }
    await this.batch(updates,assertSession);
    updates.length=0;
    if(!connection.paired)return;
    const unboundOwner=prefix+'migration:legacy:';
    if(!await this.base.get(unboundOwner)){
      for(const item of all)if(item.id!=='draft'&&!item.id.startsWith(prefix)&&!(item as LocalRecord).server)await add(item);
      updates.push({id:unboundOwner,value:this.scope} as unknown as StoredItem);
    }
    // Work created before signing in is adopted once. Old copies remain recoverable.
    const local=new AccountRecordStore(this.base,{paired:false,server:''});
    const localItems=await local.all();assertSession();const transfers:StoredItem[]=[];
    for(const item of localItems){
      if(isDraft(item))continue;
      await add(item);
      transfers.push({...local.pack(item),transferredTo:this.scope} as StoredItem);
    }
    const localDraft=localItems.find(isDraft) as LocalDraft|undefined;
    const current=await this.get('draft') as LocalDraft|undefined;
    if(hasContent(localDraft)&&!hasContent(current)){
      // Replace only an empty target draft; never overwrite unsaved account work.
      updates.push(this.pack({...localDraft!,accountScope:this.scope}));
      transfers.push(local.pack({id:'draft',recordId:crypto.randomUUID(),text:'',attachments:[],accountScope:'local'}));
    }
    await this.batch([...updates.splice(0),...transfers],assertSession);
  }
}
