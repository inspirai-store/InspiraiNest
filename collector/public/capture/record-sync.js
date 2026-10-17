(() => {
 'use strict';
 const content=value=>JSON.stringify([value.text,value.document??null,(value.attachments??[]).map(a=>[a.id,a.sha256,a.name])]);
 const scope=identity=>JSON.stringify([identity.server,identity.deviceId??'']);
 class RecordSyncEngine {
  constructor({store,api,status,changed}){Object.assign(this,{store,api,status,changed});this.protocol=null;this.probed=0;this.scope='';}
  async capable(){const identity=this.status();if(this.scope!==scope(identity)){this.scope=scope(identity);this.protocol=null;}
   if(this.protocol===null||Date.now()-this.probed>300000){try{this.protocol=(await this.api('/api/records/capabilities')).recordSyncProtocol===1;}catch(error){if([404,405].includes(error.status))this.protocol=false;else throw error;}this.probed=Date.now();}return this.protocol;
  }
  async pull(wait=0,full=false){const identity={...this.status()};if(!identity.paired)return;const incremental=await this.capable(),key='__record-sync__:'+scope(identity);
   for(;;){const cursor=(await this.store.get(key))?.cursor;
    const data=await this.api(incremental?'/api/records/changes?'+(cursor&&!full?'cursor='+encodeURIComponent(cursor)+'&':'')+'wait='+wait+'&limit=200':'/api/records');
    if(scope(this.status())!==scope(identity))return;
    await this.store.mutate(rows=>{
     const map=new Map(rows.map(row=>[row.id,row])),meta=map.get(key)??{id:key},current=meta.cursor,updates=new Map();
     if(data.cursor&&current&&data.cursor!==current){const [epoch,n]=data.cursor.split(':'),[oldEpoch,oldN]=current.split(':');if(epoch===oldEpoch&&Number(n)<Number(oldN)||epoch!==oldEpoch&&current!==cursor)return [];}
     const records=data.changes?data.changes.map(change=>({...change.record,changeSeq:change.seq})):[...(data.deleted??[]),...(data.records??[])];
     for(const remote of records){let local=updates.get(remote.id)??map.get(remote.id);if(local?.server&&local.server!==identity.server)continue;
      const a=Number(remote.trashVersion??0),b=Number(local?.trashVersion??0);
      if(a<b||local?.changeSeq&&remote.changeSeq&&local.changeSeq>remote.changeSeq)continue;
      if(remote.deletedAt){local??={id:remote.id,text:'',attachments:[],createdAt:remote.deletedAt,version:remote.version??0,remoteVersion:remote.version??0,server:identity.server,sync:'synced'};const draft=updates.get('draft')??map.get('draft'),recovery=[...(local.recoveryDrafts??[])];
       if(local.sync!=='synced'&&!recovery.some(row=>content(row)===content(local)))recovery.push({id:'draft',recordId:local.id,editingId:local.id,text:local.text,document:local.document,attachments:local.attachments,remoteDeleted:true,recoveryKind:"pending"});
       if(draft?.editingId===local.id){const saved={...draft,remoteDeleted:true,recoveryKind:"editor",recoveryTrashVersion:a};updates.set('draft',saved);if(!recovery.some(row=>content(row)===content(saved)))recovery.push(saved);}
       updates.set(local.id,{...local,deletedAt:remote.deletedAt,trashVersion:a,changeSeq:remote.changeSeq??local.changeSeq,recoveryDrafts:recovery,cancelledProcess:local.pendingProcess??local.cancelledProcess,pendingProcess:undefined,cancelledPayload:local.payload??local.cancelledPayload,payload:undefined,sync:"synced",error:""});continue;
      }
      if(local?.deletedAt&&a<=b||local?.remoteVersion>remote.version||local&&local.sync!=='synced')continue;
      updates.set(remote.id,{...local,...remote,deletedAt:null,server:identity.server,sync:'synced',remoteVersion:remote.version,attachments:remote.attachments.map(file=>({...file,blob:local?.attachments?.find(old=>old.sha256===file.sha256)?.blob}))});
     }
     updates.set(key,{...meta,...(data.cursor?{cursor:data.cursor}:{}),checkedAt:data.checkedAt??new Date().toISOString()});return [...updates.values()];
    });
    await this.changed();if(!data.hasMore||full||!incremental)return;wait=0;
   }
  }
  async sync(upload,full=false){this.again=true;this.full ||= full;if(this.running)return this.running;
   this.running=(async()=>{do{this.again=false;const force=this.full;this.full=false;await this.pull(0,force);await upload();await this.pull();}while(this.again);})().finally(()=>{this.running=null;});return this.running;
  }
 }
 window.RecordSyncEngine=RecordSyncEngine;
})();
