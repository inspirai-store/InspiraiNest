package store.inspirai.library.nativeui.data

import android.content.Context
import android.media.MediaMetadataRetriever
import android.util.AtomicFile
import kotlinx.coroutines.*
import org.json.JSONObject
import store.inspirai.library.core.InputFiles
import java.io.File
import java.util.UUID

/** A sidecar is written before recording. Finalization survives leaving the editor. */
object RecordAudioStore {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    fun begin(context: Context,server: String,record: String): File {
        val folder=File(context.noBackupFilesDir,"record-audio/${UUID.nameUUIDFromBytes(server.toByteArray())}/$record").apply { mkdirs() }
        val file=File(folder,"${UUID.randomUUID()}.m4a")
        val journal=JSONObject().put("server",server).put("recordId",record).put("id",file.nameWithoutExtension).put("path",file.absolutePath).put("createdAt",java.time.Instant.now().toString())
        write(File(file.path+".json"),journal);return file
    }
    private fun write(file: File,value: JSONObject) {
        val atomic=AtomicFile(file);val stream=atomic.startWrite()
        try { stream.write(value.toString().toByteArray());atomic.finishWrite(stream) }catch(e: Exception){atomic.failWrite(stream);throw e}
    }
    fun finish(context: Context,repository: NestRepository,file: File,onFile: (JSONObject)->Unit,onError: (String)->Unit) {
        scope.launch {
            try { val meta=recoverOne(repository,File(file.path+".json"));withContext(Dispatchers.Main){onFile(meta)} }
            catch(e: Exception){withContext(Dispatchers.Main){onError(e.message?:"录音片段已保留，可在记录同步中重试")}}
        }
    }
    suspend fun recover(context: Context,repository: NestRepository) = withContext(Dispatchers.IO) {
        File(context.noBackupFilesDir,"record-audio").walkTopDown().filter { it.isFile&&it.extension=="json" }.forEach { sidecar ->
            runCatching { recoverOne(repository,sidecar);repository.dao.removeJournal("audio-recovery:${sidecar.nameWithoutExtension}") }.onFailure {
                repository.dao.journal(MigrationLog("audio-recovery:${sidecar.nameWithoutExtension}",JSONObject().put("path",sidecar.absolutePath).put("error","录音未完成，原始片段已保留").toString()))
            }
        }
        val known=repository.dao.records().flatMap { JSONObject(it.json).optJSONArray("attachments").objects().map { attachment->attachment.optString("id") } }.toSet()
        File(context.filesDir,"capture-media").listFiles()?.filter { it.extension in listOf("m4a","jpg","active")&&it.nameWithoutExtension.matches(Regex("[a-f0-9-]{36}")) }?.forEach { file->
            val key="legacy-media:${file.name}"
            if(file.nameWithoutExtension !in known && repository.dao.journal(key)==null)runCatching {
                check(file.extension!="active"){"旧录音未完成，原件已保留"}
                val id=UUID.nameUUIDFromBytes("legacy-media:${file.name}".toByteArray()).toString()
                val meta=JSONObject().put("id",file.nameWithoutExtension).put("name",file.name).put("mime",if(file.extension=="jpg")"image/jpeg" else "audio/mp4").put("sha256",InputFiles.sha256(file)).put("bytes",file.length()).put("localPath",file.absolutePath)
                repository.attachRecoveredAudio(repository.credentials.server(),id,meta)
                repository.dao.journal(MigrationLog(key,"recovered"))
                repository.dao.removeJournal("audio-recovery:${file.name}")
            }.onFailure { repository.dao.journal(MigrationLog("audio-recovery:${file.name}",JSONObject().put("originalPath",file.absolutePath).put("error","旧录音未完成，原件已保留").toString())) }
        }
    }
    private suspend fun recoverOne(repository: NestRepository,sidecar: File): JSONObject {
        val source=JSONObject(sidecar.readText());val file=File(source.getString("path"))
        check(file.length() in 1..InputFiles.FILE_LIMIT) { "录音片段不完整，原件已保留" }
        val retriever=MediaMetadataRetriever()
        val duration=try { retriever.setDataSource(file.absolutePath);retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?:0 }finally { retriever.release() }
        check(duration>0) { "录音未完成，原始片段已保留" }
        val meta=JSONObject().put("id",source.getString("id")).put("name","录音 ${source.getString("createdAt").take(19).replace(':','-')}.m4a")
            .put("sha256",InputFiles.sha256(file)).put("mime","audio/mp4").put("bytes",file.length()).put("duration",duration).put("localPath",file.absolutePath)
        repository.attachRecoveredAudio(source.getString("server"),source.getString("recordId"),meta)
        check(sidecar.delete()) { "录音已保存，待清理恢复标记" };return meta
    }
}
