package store.inspirai.library.nativeui.data

import androidx.room.withTransaction
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import store.inspirai.library.core.Api
import java.time.Instant

/** Persist a received batch and its cursor in one Room transaction. */
class RecordSyncClient(private val database: NativeDatabase,private val repository: NestRepository,private val merge: Mutex=Mutex()) {
    private var protocol: Int?=null
    private var scope=""
    private var probed=0L
    private val dao get()=database.dao()
    private fun key()="record-sync:${repository.credentials.server()}:${repository.credentials.deviceId()}"
    suspend fun capable(): Boolean {
        val current=key()
        if(scope!=current){scope=current;protocol=null}
        if(protocol==null || System.currentTimeMillis()-probed>300000){
            protocol=try { repository.request("/api/records/capabilities").optInt("recordSyncProtocol") } catch(e: Api.Failure){if(e.status in listOf(404,405))0 else throw e}
            probed=System.currentTimeMillis()
        }
        return protocol==1
    }
    suspend fun pull(wait: Int=0,full: Boolean=false) {
        val identity=repository.credentials.snapshot()?:return
        val incremental=capable()
        val logKey=key()
        var delay=wait
        do {
            val before=dao.journal(logKey)?.let { JSONObject(it.json) }?:JSONObject()
            val cursor=before.optString("cursor")
            val data=repository.request(if(incremental)"/api/records/changes?${if(cursor.isBlank()||full)"" else "cursor=${encoded(cursor)}&"}wait=$delay&limit=200" else "/api/records")
            merge.withLock { database.withTransaction {
                check(repository.credentials.snapshot()?.generation==identity.generation){"连接已改变，请重新加载"}
                val current=dao.journal(logKey)?.let { JSONObject(it.json) }?:JSONObject()
                val received=data.optString("cursor");val live=current.optString("cursor")
                if(received.isNotBlank()&&live.isNotBlank()&&received!=live){
                    val a=received.split(':');val b=live.split(':')
                    if(a.size==2&&b.size==2&&(a[0]==b[0]&&a[1].toLong()<b[1].toLong()||a[0]!=b[0]&&live!=cursor))return@withTransaction
                }
                val changes=if(data.has("changes"))data.optJSONArray("changes").objects().map{it.getJSONObject("record").copyJson().put("changeSeq",it.getLong("seq"))}
                    else data.optJSONArray("deleted").objects()+data.optJSONArray("records").objects()
                for(remote in changes){
                    val id=remote.getString("id");val row=dao.record(identity.server,id)
                    val old=row?.let{JSONObject(it.json)}
                    val remoteTrash=remote.optLong("trashVersion");val localTrash=old?.optLong("trashVersion")?:0
                    if(remoteTrash<localTrash || old!=null&&remote.has("changeSeq")&&old.optLong("changeSeq")>remote.optLong("changeSeq"))continue
                    if(!remote.isNull("deletedAt")&&remote.optString("deletedAt").isNotBlank()){
                        val value=old?:JSONObject().put("id",id).put("text","").put("attachments",JSONArray()).put("sync","synced")
                        if(old!=null){
                            val drafts=value.optJSONArray("recoveryDrafts")?:JSONArray()
                            fun preserve(candidate: JSONObject,kind: String){
                                if(drafts.objects().none{sameRecoveryContent(it,candidate)})drafts.put(candidate.copyJson().apply{remove("recoveryDrafts");remove("editingDraft");remove("nextEdit");put("recoveryKind",kind);put("recoveryTrashVersion",remoteTrash)})
                            }
                            if(row?.draft==true || value.optString("sync")!="synced")preserve(value,"pending")
                            value.optJSONObject("editingDraft")?.let{preserve(it,"editor")}
                            value.optJSONObject("nextEdit")?.let{preserve(it,"pending")}
                            if(drafts.length()>0)value.put("recoveryDrafts",drafts)
                        }
                        value.put("deletedAt",remote.getString("deletedAt")).put("trashVersion",remoteTrash).put("server",identity.server)
                        if(remote.has("changeSeq"))value.put("changeSeq",remote.getLong("changeSeq"))
                        value.optJSONObject("pendingProcess")?.let{value.put("cancelledProcess",it)};value.remove("pendingProcess");value.optJSONObject("payload")?.let{value.put("cancelledPayload",it)};value.remove("payload");value.put("sync","synced");value.remove("error")
                        if(row?.json!=value.toString())dao.put(LocalRecord(identity.server,id,value.toString(),row?.updated?:0,false));continue
                    }
                    if(old!=null&&!old.isNull("deletedAt")&&remoteTrash<=localTrash)continue
                    if(old!=null&&old.optLong("remoteVersion")>remote.optLong("version"))continue
                    val restored=old!=null&&!old.isNull("deletedAt")&&remoteTrash>localTrash
                    if(!restored&&row!=null&&(row.draft||old!!.optString("sync")!="synced"||old.has("editingDraft")||old.has("pendingProcess")))continue
                    old?.optJSONArray("recoveryDrafts")?.let{remote.put("recoveryDrafts",it)}
                    if(!remote.has("changeSeq")&&old?.has("changeSeq")==true)remote.put("changeSeq",old.getLong("changeSeq"))
                    remote.put("server",identity.server).put("sync","synced").put("remoteVersion",remote.optLong("version"))
                    if(row?.json!=remote.toString())dao.put(LocalRecord(identity.server,id,remote.toString(),runCatching{Instant.parse(remote.optString("updatedAt",remote.optString("createdAt"))).toEpochMilli()}.getOrDefault(0)))
                }
                if(received.isNotBlank())current.put("cursor",received)
                current.put("checkedAt",data.optString("checkedAt",Instant.now().toString()))
                dao.journal(MigrationLog(logKey,current.toString()))
            } }
            delay=0
        }while(incremental&&data.optBoolean("hasMore"))
    }
}

private fun sameRecoveryContent(a: JSONObject,b: JSONObject)=a.optString("text")==b.optString("text")&&a.optJSONObject("document")?.toString()==b.optJSONObject("document")?.toString()&&a.optJSONArray("attachments")?.toString()==b.optJSONArray("attachments")?.toString()
