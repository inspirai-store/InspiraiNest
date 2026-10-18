package store.inspirai.library.nativeui.data

import android.content.Context
import android.util.Base64
import androidx.room.withTransaction
import org.json.JSONObject
import store.inspirai.library.core.InputFiles
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/** Streaming importer is independent of WebView and can resume against the same journal. */
internal class MigrationImporter(private val context: Context, private val database: NativeDatabase, private val defaultServer: ()->String) {
    private val dao=database.dao()
    private var expected=0;private var imported=0;private var fileCount=0;private var totalBytes=0L
    private var row: JSONObject?=null;private var legacyId="";private var server=""
    private var stream: FileOutputStream?=null;private var temporary: File?=null;private var target: File?=null
    private var meta: JSONObject?=null;private var part="";private var received=0L;private var declared=0L
    private val files=mutableListOf<RecordFile>()
    val progress get()="$imported / $expected"
    suspend fun accept(kind: String,data: JSONObject) {
        when(kind) {
            "begin"->{abort();expected=data.getInt("count");check(expected in 0..100000);imported=0;fileCount=0;totalBytes=0}
            "recordStart"->{
                check(row==null && stream==null);row=data.copyJson();legacyId=data.getString("id")
                server=data.optString("server").takeUnless { it.isEmpty()||it=="null" }?:defaultServer()
                val id=if(legacyId=="draft")data.optString("recordId").ifEmpty { UUID.nameUUIDFromBytes("legacy-draft:$server:$legacyId".toByteArray()).toString() } else legacyId
                check(id.matches(Regex("[a-fA-F0-9-]{36}"))) { "记录编号无效" }
                row!!.put("id",id).put("server",server);files.clear()
            }
            "fileStart"->{
                check(stream==null);val current=row?:error("记录缺失")
                val fileId=data.getString("fileId");check(fileId.matches(Regex("[a-fA-F0-9-]{36}")))
                part=data.getString("part");check(part in listOf("original","thumbnail"))
                val original=current.optJSONArray("attachments").objects().firstOrNull { it.optString("id")==fileId }?:error("附件不属于当前记录")
                meta=data.getJSONObject("meta").copyJson().apply {
                    remove("blob");optJSONObject("thumbnail")?.remove("blob")
                    put("id",if(part=="original")fileId else "$fileId-thumbnail")
                    if(!has("name"))put("name",original.optString("name","附件")+if(part=="thumbnail")".jpg" else "")
                }
                declared=data.getLong("bytes");check(declared in 1..InputFiles.FILE_LIMIT) { "附件大小无效" }
                val namespace=UUID.nameUUIDFromBytes(server.toByteArray()).toString()
                target=File(context.noBackupFilesDir,"record-media/$namespace/${current.getString("id")}/$fileId-$part.bin").apply { parentFile!!.mkdirs() }
                temporary=File(target!!.path+".tmp");stream=FileOutputStream(temporary!!);received=0
            }
            "chunk"->{val bytes=Base64.decode(data.getString("body"),Base64.NO_WRAP);check(bytes.size<=49152);received+=bytes.size;check(received<=declared);(stream?:error("附件未开始")).write(bytes)}
            "fileEnd"->{
                val output=stream?:error("附件未开始");output.fd.sync();output.close();stream=null
                check(received==declared) { "附件大小不符" };val digest=InputFiles.sha256(temporary!!)
                val value=meta!!;val expectedHash=value.optString("sha256")
                check(expectedHash.isEmpty()||digest==expectedHash) { "附件哈希不符" }
                check(temporary!!.renameTo(target!!)) { "无法保存附件，请检查空间" }
                value.put("sha256",digest).put("bytes",declared).put("localPath",target!!.absolutePath)
                val current=row!!;val fileId=value.getString("id").removeSuffix("-thumbnail")
                val original=current.optJSONArray("attachments").objects().first { it.getString("id")==fileId }
                if(part=="original")original.put("sha256",digest) else original.put("thumbnailSha256",digest)
                files+=RecordFile(current.getString("id"),value.getString("id"),value.toString(),server)
                fileCount++;totalBytes+=declared;temporary=null
            }
            "recordEnd"->{
                check(stream==null);val current=row?:error("记录缺失");val key="legacy:$server:$legacyId"
                database.withTransaction {
                    if(dao.journal(key)==null) {
                        check(dao.record(server,current.getString("id"))==null) { "发现同编号记录，请先核对数据" }
                        dao.put(LocalRecord(server,current.getString("id"),current.toString(),System.currentTimeMillis(),legacyId=="draft"))
                        files.forEach { dao.file(it) }
                        dao.journal(MigrationLog(key,JSONObject().put("recordId",current.getString("id")).put("files",org.json.JSONArray(files.map { JSONObject(it.json) })).toString()))
                    }
                }
                imported++;row=null;files.clear()
            }
            "complete"->{
                check(row==null && stream==null && imported==expected && data.getInt("count")==expected) { "迁移数量不符" }
                check(data.optInt("files",fileCount)==fileCount && data.optLong("bytes",totalBytes)==totalBytes) { "迁移附件清单不符" }
                dao.journal(MigrationLog("records-v1","complete"))
                dao.journal(MigrationLog("records-v1-report",JSONObject().put("records",imported).put("files",fileCount).put("bytes",totalBytes).put("verifiedAt",java.time.Instant.now().toString()).toString()))
            }
            else->error("迁移消息无效")
        }
    }
    fun abort() { stream?.close();stream=null;temporary?.delete();temporary=null;row=null;files.clear() }
}
