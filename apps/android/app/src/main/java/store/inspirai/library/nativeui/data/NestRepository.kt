package store.inspirai.library.nativeui.data

import androidx.room.withTransaction
import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import store.inspirai.library.core.*
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.UUID

fun JSONArray?.objects(): List<JSONObject> = if(this==null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONObject.copyJson() = JSONObject(toString())
fun encoded(value: String): String = Uri.encode(value)

interface NestRepository {
    val recordSyncSignals: Flow<Unit> get()=kotlinx.coroutines.flow.emptyFlow()
    val records: Flow<List<LocalRecord>>
    val dao: NativeDao
    val credentials: Credentials
    suspend fun request(path: String, method: String="GET", body: JSONObject?=null): JSONObject
    suspend fun library(query: String): List<JSONObject>
    suspend fun content(id: String, file: String?=null): String
    suspend fun saveRecord(value: JSONObject, draft: Boolean=false)
    suspend fun attachRecoveredAudio(server: String,id: String,meta: JSONObject) {
        dao.file(RecordFile(id,meta.getString("id"),meta.toString(),server))
        val row=dao.record(server,id)
        val value=row?.let { JSONObject(it.json).let { json->json.optJSONObject("editingDraft")?:json.optJSONObject("nextEdit")?:json } }?:JSONObject().put("id",id).put("server",server).put("createdAt",Instant.now().toString()).put("text","")
        val files=value.optJSONArray("attachments").objects().filter { it.optString("id")!=meta.getString("id") }+meta
        value.put("attachments",JSONArray(files));saveRecord(value,true)
    }
    suspend fun saveRecoveryAsNew(value: JSONObject): String { error("当前存储不支持恢复草稿") }
    suspend fun watchRecords(): Boolean = false
    suspend fun checkRecordSnapshot() { syncRecords() }
    suspend fun setRecordDeleted(id: String,deleted: Boolean) { error("当前存储不支持回收站") }
    suspend fun syncRecords()
    suspend fun resolveConflict(server: String, id: String, useLocal: Boolean)
    suspend fun processRecord(server: String, id: String, preset: String, instructions: String,deviceId: String?=null,agent: String?=null)
    suspend fun download(route: String, meta: JSONObject): File
}

class AndroidNestRepository(private val context: Context,private val database: NativeDatabase=NativeDatabase.open(context),
    private val call: (suspend (String,String,JSONObject?)->JSONObject)?=null): NestRepository {
    override val credentials = Credentials(context)
    override val dao = database.dao()
    private val recordSync by lazy { RecordSyncClient(database,this,recordMutex) }
    private val syncSignals=kotlinx.coroutines.flow.MutableSharedFlow<Unit>(extraBufferCapacity=1)
    override val recordSyncSignals: Flow<Unit> = syncSignals
    override val records = dao.observeRecords()
    override suspend fun request(path: String, method: String, body: JSONObject?): JSONObject = requestBound(credentials.snapshot()?:error("请先连接资料空间"),path,method,body)
    private suspend fun requestBound(before: Credentials.Snapshot,path: String,method: String,body: JSONObject?): JSONObject = withContext(Dispatchers.IO) {
        check(before.generation==credentials.snapshot()?.generation) { "连接已改变，请重新加载" }
        val response=call?.invoke(path,method,body)?:Api(credentials).call(before,path,method,body)
        check(before.generation==credentials.snapshot()?.generation) { "连接已改变，请重新加载" }
        response
    }
    /** Read every page before applying global client filters: also works with older servers. */
    override suspend fun library(query: String): List<JSONObject> {
        val result=mutableListOf<JSONObject>(); var offset=0
        do {
            val page=request("/api/read/v1/${if(query.isBlank()) "entries" else "search"}?limit=100&offset=$offset&q=${encoded(query)}")
            val items=page.optJSONArray("items").objects();result.addAll(items);offset+=items.size
            check(items.isNotEmpty() || offset>=page.optInt("total")) { "资料分页不完整，请重试" }
        } while(offset<page.optInt("total"))
        return result
    }
    override suspend fun content(id: String,file: String?): String {
        val result=StringBuilder();var line=1;var column=0
        do {
            val page=request("/api/read/v1/content?id=${encoded(id)}${if(file==null) "" else "&file=${encoded(file)}"}&start_line=$line&start_column=$column&max_lines=1000")
            result.append(page.getString("content"))
            if(!page.optBoolean("truncated"))break
            val next=page.getInt("next_line");val col=page.optInt("next_column")
            check(next>line || next==line && col>column) { "正文分页位置无效" }
            if(next>page.optInt("end_line"))result.append('\n')
            line=next;column=col
        }while(true)
        return result.toString()
    }
    override suspend fun saveRecord(value: JSONObject,draft: Boolean) = recordMutex.withLock { saveRecordLocked(value,draft) }
    override suspend fun attachRecoveredAudio(server: String,id: String,meta: JSONObject) = recordMutex.withLock {
        dao.file(RecordFile(id,meta.getString("id"),meta.toString(),server))
        val row=dao.record(server,id)
        val value=row?.let { JSONObject(it.json).let { json->json.optJSONObject("editingDraft")?:json.optJSONObject("nextEdit")?:json.copyJson() } }?:JSONObject().put("id",id).put("server",server).put("createdAt",Instant.now().toString()).put("text","")
        value.put("attachments",JSONArray(value.optJSONArray("attachments").objects().filter { it.optString("id")!=meta.getString("id") }+meta))
        saveRecordLocked(value,true)
    }
    private suspend fun saveRecordLocked(value: JSONObject,draft: Boolean) {
        val item=value.copyJson();val id=item.getString("id");val server=item.optString("server",credentials.server())
        val oldRow=dao.record(server,id)
        val previous=oldRow?.let { JSONObject(it.json) }
        if(previous!=null&&!previous.isNull("deletedAt")&&previous.optString("deletedAt").isNotBlank()){
            check(draft) { "已在其他设备删除，请另存记录" }
            item.put("remoteDeleted",true).put("recoveryKind","editor").put("recoveryTrashVersion",previous.optLong("trashVersion"));previous.put("editingDraft",item).put("recoveryDrafts",JSONArray(previous.optJSONArray("recoveryDrafts").objects().filter { it.optString("recoveryKind")!="editor"||it.optLong("recoveryTrashVersion",-1)!=previous.optLong("trashVersion") }+item))
            dao.put(oldRow!!.copy(json=previous.toString()));return
        }
        check(previous?.optString("sync")!="conflict") { "请先处理同步冲突，再编辑" }
        previous?.optJSONObject("pendingProcess")?.let { item.put("pendingProcess",it) }
        previous?.optString("processError")?.takeIf { it.isNotBlank() }?.let { item.put("processError",it) }
        if(draft && oldRow!=null && !oldRow.draft) {
            previous!!.put("editingDraft",item)
            dao.put(oldRow.copy(json=previous.toString()))
            return
        }
        // An ambiguously acknowledged write cannot be mutated. Queue the next edit separately.
        if(previous?.optJSONObject("payload")!=null) {
            previous.put("nextEdit",item).put("updatedAt",Instant.now().toString()).remove("editingDraft")
            dao.put(LocalRecord(server,id,previous.toString(),System.currentTimeMillis(),draft))
        } else {
            item.put("server",server).put("createdAt",item.optString("createdAt",Instant.now().toString()))
            item.put("remoteVersion",previous?.optLong("remoteVersion",previous.optLong("version"))?:item.optLong("remoteVersion"))
            item.put("sync",if(draft) "draft" else "pending")
            item.remove("editingDraft")
            dao.put(LocalRecord(server,id,item.toString(),System.currentTimeMillis(),draft))
        }
        if(!draft){QueueJob.schedule(context);syncSignals.tryEmit(Unit);Unit}
    }
    private suspend fun sendRecord(original: LocalRecord) {
        var current=dao.record(original.server,original.id)?:return
        var item=JSONObject(current.json)
        if(current.draft || item.optString("sync")=="conflict" || !item.isNull("deletedAt")&&item.optString("deletedAt").isNotBlank())return
        val snapshot=credentials.snapshot()?:return
        if(current.server!=snapshot.server)return
        try {
            if(item.optString("sync")!="synced") {
                var payload=item.optJSONObject("payload")
                if(payload==null) {
                    val attachments=JSONArray();val localFiles=dao.files(current.id,current.server)
                    for(file in item.optJSONArray("attachments").objects()) {
                        val metadata=localFiles.firstOrNull { it.id==file.optString("id") }?.let { JSONObject(it.json) }
                        if(metadata!=null)withContext(Dispatchers.IO){Api(credentials).uploadInput(snapshot,File(metadata.getString("localPath")),metadata){}}
                        localFiles.firstOrNull { it.id==file.optString("id")+"-thumbnail" }?.let { thumbnail->val preview=JSONObject(thumbnail.json);withContext(Dispatchers.IO){Api(credentials).uploadInput(snapshot,File(preview.getString("localPath")),preview){}} }
                        attachments.put(JSONObject().put("id",file.getString("id")).put("name",file.getString("name")).put("sha256",file.getString("sha256")).apply {
                            val thumbnail=file.optString("thumbnailSha256").ifEmpty { file.optJSONObject("thumbnail")?.optString("sha256")?:"" };if(thumbnail.isNotEmpty())put("thumbnailSha256",thumbnail)
                        })
                    }
                    val proposed=JSONObject().put("requestId",UUID.randomUUID().toString()).put("baseVersion",item.optLong("remoteVersion",item.optLong("version")))
                        .put("text",item.optString("text")).put("attachments",attachments).put("createdAt",item.getString("createdAt"))
                    item.optJSONObject("document")?.let { proposed.put("document",it) }
                    val frozen=recordMutex.withLock {
                        val latest=dao.record(current.server,current.id)
                        if(latest?.json!=current.json || latest.draft)false
                        else { item.put("payload",proposed);current=latest.copy(json=item.toString());dao.put(current);true }
                    }
                    if(!frozen)return // Editing during media transfer takes precedence; retry the newer snapshot.
                    payload=proposed
                }
                val frozen=checkNotNull(payload)
                val response=requestBound(snapshot,"/api/records/${encoded(current.id)}","PUT",frozen)
                val remote=response.optJSONObject("record")?:response
                check(remote.optString("id")==current.id && remote.getLong("version")==frozen.getLong("baseVersion")+1) { "服务端未确认原记录版本，请使用原请求重试" }
                recordMutex.withLock {
                    check(snapshot.generation==credentials.snapshot()?.generation) { "连接已改变，请重新加载" }
                    val latest=dao.record(current.server,current.id)?:return@withLock
                    val live=JSONObject(latest.json)
                    if(!live.isNull("deletedAt"))return@withLock
                    if(live.optJSONObject("payload")?.optString("requestId")!=frozen.optString("requestId"))return@withLock
                    live.put("remoteVersion",remote.getLong("version")).put("sync","synced").remove("payload");live.remove("error")
                    val next=live.optJSONObject("nextEdit")
                    if(next!=null) {
                        next.put("remoteVersion",remote.getLong("version")).put("sync","pending").put("server",current.server)
                        live.optJSONObject("pendingProcess")?.let { next.put("pendingProcess",it) }
                        live.optJSONObject("editingDraft")?.let { next.put("editingDraft",it) }
                    }
                    item=next?:live;current=latest.copy(json=item.toString());dao.put(current)
                }
            }
            val pending=recordMutex.withLock { dao.record(current.server,current.id)?.let{JSONObject(it.json)}?.takeIf{it.isNull("deletedAt")&&it.optString("sync")=="synced"}?.optJSONObject("pendingProcess") }
            pending?.let { pending->
                try {
                    val task=requestBound(snapshot,"/api/records/${encoded(current.id)}/process","POST",pending)
                    check(task.optString("id").matches(Regex("[a-fA-F0-9-]{36}"))) { "服务端未确认加工任务，请使用原请求重试" }
                    recordMutex.withLock {
                        val latest=dao.record(current.server,current.id)?:return@withLock
                        val live=JSONObject(latest.json)
                        if(live.optJSONObject("pendingProcess")?.optString("requestId")==pending.optString("requestId")) {
                            live.remove("pendingProcess");live.remove("processError")
                            live.put("tasks",JSONArray(listOf(task)+live.optJSONArray("tasks").objects().filter{it.optString("id")!=task.getString("id")}))
                            dao.put(latest.copy(json=live.toString()))
                        }
                    }
                } catch(e: kotlinx.coroutines.CancellationException){throw e} catch(e: Exception) {
                    if(snapshot.generation!=credentials.snapshot()?.generation)return
                    recordMutex.withLock {
                        val latest=dao.record(current.server,current.id)?:return@withLock
                        val live=JSONObject(latest.json)
                        if(live.optJSONObject("pendingProcess")?.optString("requestId")==pending.optString("requestId")) {
                            live.put("processError",e.message?:"加工请求尚未确认，请重试")
                            dao.put(latest.copy(json=live.toString()))
                        }
                    }
                }
            }
        } catch(e: kotlinx.coroutines.CancellationException){throw e} catch(e: Exception) {
            if(snapshot.generation!=credentials.snapshot()?.generation)return
            recordMutex.withLock {
                val latest=dao.record(current.server,current.id)?:return@withLock
                val live=JSONObject(latest.json)
                if(!live.isNull("deletedAt")||live.optLong("trashVersion")>item.optLong("trashVersion"))return@withLock
                // Keep newer local edits and the immutable request, even if its acknowledgement was lost.
                live.put("sync",if(e is Api.Failure&&e.code=="record_version_conflict")"conflict" else "failed").put("error",e.message)
                dao.put(latest.copy(json=live.toString()))
            }
        }
    }
    override suspend fun syncRecords() = syncMutex.withLock {
        if(dao.journal("records-v1")?.json!="complete")return@withLock
        if(credentials.isPaired())recordSync.pull()
        replayRecordOperations()
        for(local in dao.records())sendRecord(local)
        if(credentials.isPaired())recordSync.pull()
    }
    override suspend fun saveRecoveryAsNew(value: JSONObject): String = recordMutex.withLock {
        val server=credentials.server();val parent=value.getString("id");val newId=UUID.randomUUID().toString()
        database.withTransaction {
            val old=dao.record(server,parent)?:error("恢复草稿不存在");val original=JSONObject(old.json)
            val fresh=value.copyJson().put("id",newId).put("remoteVersion",0).put("version",1).put("sync","pending").put("copiedFrom",parent).put("createdAt",Instant.now().toString())
            listOf("deletedAt","trashVersion","changeSeq","payload","editingDraft","nextEdit","recoveryDrafts","pendingProcess","tasks","remoteDeleted").forEach { fresh.remove(it) }
            dao.put(LocalRecord(server,newId,fresh.toString(),System.currentTimeMillis()))
            dao.files(parent,server).forEach { dao.file(it.copy(recordId=newId)) }
            original.remove("editingDraft");original.put("recoveryDrafts",JSONArray(original.optJSONArray("recoveryDrafts").objects().filter { it.optString("text")!=value.optString("text")||it.optJSONObject("document")?.toString()!=value.optJSONObject("document")?.toString()||it.optJSONArray("attachments")?.toString()!=value.optJSONArray("attachments")?.toString() }))
            dao.put(old.copy(json=original.toString()))
        }
        QueueJob.schedule(context);syncSignals.tryEmit(Unit);Unit;newId
    }
    override suspend fun checkRecordSnapshot() { if(credentials.isPaired()&&dao.journal("records-v1")?.json=="complete")recordSync.pull(full=true);syncRecords() }
    private fun operationPrefix()="record-operation:${credentials.server()}:${credentials.deviceId()}:"
    override suspend fun setRecordDeleted(id: String,deleted: Boolean) = recordMutex.withLock {
        val row=dao.record(credentials.server(),id)?:error("记录不存在")
        val value=JSONObject(row.json);val key=operationPrefix()+id
        check(dao.journal(key)==null){"请先完成上一次操作"}
        val operation=JSONObject().put("id",id).put("action",if(deleted)"delete" else "restore").put("payload",JSONObject().put("requestId",UUID.randomUUID().toString()).put("version",value.optLong("remoteVersion",value.optLong("version"))).put("trashVersion",value.optLong("trashVersion")))
        database.withTransaction {
            dao.journal(MigrationLog(key,operation.toString()))
            if(deleted){
                val recoveries=value.optJSONArray("recoveryDrafts")?:JSONArray()
                if(value.optString("sync")!="synced")recoveries.put(value.copyJson().apply { remove("recoveryDrafts");put("recoveryKind","pending") })
                value.optJSONObject("editingDraft")?.let{recoveries.put(it.copyJson().put("recoveryKind","editor"))}
                value.put("recoveryDrafts",recoveries).put("deletedAt",Instant.now().toString()).put("trashVersion",value.optLong("trashVersion")+1)
                value.optJSONObject("payload")?.let{value.put("cancelledPayload",it)};value.remove("payload");value.optJSONObject("pendingProcess")?.let{value.put("cancelledProcess",it)};value.remove("pendingProcess");value.put("sync","synced")
                dao.put(row.copy(json=value.toString()))
            }
        }
        QueueJob.schedule(context);syncSignals.tryEmit(Unit);Unit
    }
    private suspend fun replayRecordOperations() {
        if(!credentials.isPaired())return
        val identity=credentials.snapshot()?:return
        for(log in dao.journals(operationPrefix()+"%")){
            val operation=JSONObject(log.json)
            val result=requestBound(identity,"/api/content-trash/record/${encoded(operation.getString("id"))}/${operation.getString("action")}","POST",operation.getJSONObject("payload"))
            recordMutex.withLock { database.withTransaction {
                check(identity.generation==credentials.snapshot()?.generation){"连接已改变"}
                val row=dao.record(identity.server,operation.getString("id"))
                if(row!=null){val value=JSONObject(row.json);if(operation.getString("action")=="delete")value.put("deletedAt",result.opt("deletedAt")?:JSONObject.NULL).put("trashVersion",result.getLong("trashVersion"));dao.put(row.copy(json=value.toString()))}
                dao.removeJournal(log.key)
            } }
        }
    }
    override suspend fun watchRecords(): Boolean {
        if(!credentials.isPaired() || dao.journal("records-v1")?.json!="complete" || !recordSync.capable())return false
        recordSync.pull(25);return true
    }
    override suspend fun resolveConflict(server: String,id: String,useLocal: Boolean) {
        check(server==credentials.server()) { "请连接原资料空间" }
        val local=recordMutex.withLock { dao.record(server,id) } ?: return
        val remote=request("/api/records/${encoded(id)}").let { it.optJSONObject("record") ?: it }
        recordMutex.withLock {
            check(dao.record(server,id)?.json==local.json) { "本机记录已改变，请重新核对冲突" }
            val item=if(useLocal)JSONObject(local.json).let { it.optJSONObject("editingDraft") ?: it.optJSONObject("nextEdit") ?: it } else remote
            item.remove("payload");item.remove("nextEdit");item.remove("editingDraft");item.remove("error")
            item.put("server",server).put("remoteVersion",remote.getLong("version")).put("sync",if(useLocal) "pending" else "synced")
            dao.put(local.copy(json=item.toString()));QueueJob.schedule(context);syncSignals.tryEmit(Unit);Unit
        }
    }
    override suspend fun processRecord(server: String,id: String,preset: String,instructions: String,deviceId: String?,agent: String?) = recordMutex.withLock {
        val local=dao.record(server,id) ?: error("记录不存在")
        val item=JSONObject(local.json)
        check(item.optString("sync")=="synced") { "请先完成记录同步" }
        check(item.optJSONObject("pendingProcess")==null) { "已有待提交加工请求" }
        check(preset!="custom" || instructions.isNotBlank()){ "请填写自定义加工要求" }
        item.put("pendingProcess",JSONObject().put("requestId",UUID.randomUUID().toString()).put("baseVersion",item.getLong("remoteVersion")).put("preset",preset).put("instructions",instructions).apply {
            deviceId?.takeIf { it.isNotBlank() }?.let{put("deviceId",it)};agent?.takeIf { it.isNotBlank() }?.let{put("agent",it)}
        })
        item.remove("processError")
        dao.put(local.copy(json=item.toString()));QueueJob.schedule(context);syncSignals.tryEmit(Unit);Unit
    }
    override suspend fun download(route: String,meta: JSONObject): File = withContext(Dispatchers.IO) {
        val snapshot=credentials.snapshot() ?: error("请先连接资料空间")
        check(route.startsWith("/api/read/v1/file?") || route.matches(Regex("/api/(records/media/[a-f0-9]{64}|tasks/[a-f0-9-]{36}/input-files/[a-f0-9]{64}|archives/[a-f0-9]{64}/input-files/[a-f0-9]{64})")))
        val target=File(context.cacheDir,"native-files/${meta.getString("sha256")}");target.parentFile!!.mkdirs()
        if(!route.startsWith("/api/read/"))return@withContext Api(credentials).downloadInput(snapshot,route,meta,target)
        val connection=URL(snapshot.server+route).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects=false;connection.connectTimeout=15000;connection.readTimeout=30000
        connection.setRequestProperty("Authorization","Bearer ${snapshot.token}");connection.setRequestProperty("Accept-Encoding","identity")
        val temp=File(target.path+".tmp")
        try {
            check(connection.responseCode==200) { "附件下载失败，请重试" }
            val expected=meta.getLong("bytes");check(expected in 1..(128L*1024*1024)) { "附件大小无效" }
            connection.inputStream.use { input -> java.io.FileOutputStream(temp).use { out ->
                val buffer=ByteArray(65536);var total=0L
                while(true) { val n=input.read(buffer);if(n<0)break;total+=n;check(total<=expected);out.write(buffer,0,n) }
                out.fd.sync();check(total==expected) { "附件不完整" }
            } }
            check(InputFiles.sha256(temp)==meta.getString("sha256")) { "附件校验失败" }
            check(snapshot.generation==credentials.snapshot()?.generation) { "连接已改变" }
            check(temp.renameTo(target));target
        } finally { temp.delete();connection.disconnect() }
    }
    companion object { private val recordMutex=Mutex();private val syncMutex=Mutex() }
}

object NestDependencies {
    @Volatile var overrideFactory: ((Context)->NestRepository)?=null
    fun repository(context: Context): NestRepository = overrideFactory?.invoke(context) ?: AndroidNestRepository(context.applicationContext)
    @JvmStatic fun flushRecords(context: Context): Boolean = kotlinx.coroutines.runBlocking(Dispatchers.IO) {
        try {
            val repository=repository(context);repository.syncRecords()
            repository.dao.records().any { row -> !row.draft && row.server==repository.credentials.server() && JSONObject(row.json).let { it.optString("sync") in listOf("pending","failed","syncing") || it.has("pendingProcess") } }
        } catch(_: Exception) { true }
    }
}
