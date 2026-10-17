package store.inspirai.library.nativeui.feature

import android.content.*
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.*
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.*
import org.json.JSONObject
import store.inspirai.library.core.InputFiles
import store.inspirai.library.nativeui.data.*
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

fun mimeFor(name: String): String = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.').lowercase()) ?: when(name.substringAfterLast('.').lowercase()) { "md"->"text/markdown";"srt","vtt"->"text/plain";else->"application/octet-stream" }
fun recordMime(name: String,reported: String?): String = InputFiles.mime(name,reported)?:reported?.takeIf { it in setOf("video/mp4","video/webm","video/ogg","text/csv","application/json") }?:"application/octet-stream"
suspend fun importRecordFile(context: Context,repository: NestRepository,record: String,uri: Uri,selected: List<JSONObject>?=null): JSONObject = withContext(Dispatchers.IO) {
    var name="附件";var reported=-1L
    context.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE),null,null,null)?.use { cursor->
        if(cursor.moveToFirst()){name=cursor.getString(0)?:name;if(!cursor.isNull(1))reported=cursor.getLong(1)}
    }
    check(reported<=InputFiles.FILE_LIMIT) { "单个文件最多 32 MiB" }
    val id=UUID.randomUUID().toString();val file=File(context.noBackupFilesDir,"record-media/${UUID.nameUUIDFromBytes(repository.credentials.server().toByteArray())}/$record/$id.bin");file.parentFile!!.mkdirs();val temporary=File(file.path+".tmp")
    try {
        var bytes=0L
        context.contentResolver.openInputStream(uri).use { input -> checkNotNull(input){"无法读取文件"};FileOutputStream(temporary).use { output->
            val buffer=ByteArray(65536);while(true){val n=input.read(buffer);if(n<0)break;bytes+=n;check(bytes<=InputFiles.FILE_LIMIT){"单个文件最多 32 MiB"};output.write(buffer,0,n)};output.fd.sync()
        } }
        check(bytes>0 && (reported<0 || bytes==reported)) { "文件为空或读取期间发生变化" }
        val hash=InputFiles.sha256(temporary);check(temporary.renameTo(file)) { "无法保存附件" };check(InputFiles.sha256(file)==hash)
        val metadata=JSONObject().put("id",id).put("name",name.take(200)).put("sha256",hash).put("bytes",bytes).put("mime",recordMime(name,context.contentResolver.getType(uri))).put("localPath",file.absolutePath)
        val existing=selected?:repository.dao.files(record,repository.credentials.server()).filter { !it.id.endsWith("-thumbnail") }.map { JSONObject(it.json) }
        check(existing.size<20 && existing.sumOf { it.optLong("bytes") }+bytes<=InputFiles.TOTAL_LIMIT) { "附件最多 20 个，合计最多 128 MiB" }
        repository.dao.file(RecordFile(record,id,metadata.toString(),repository.credentials.server()));metadata
    } finally { temporary.delete() }
}
suspend fun openNativeFile(context: Context,repository: NestRepository,route: String,meta: JSONObject) {
    val file=repository.download(route,meta)
    openCachedFile(context,file,meta.optString("name",meta.optString("path","附件")).substringAfterLast('/'),meta.optString("mime").ifBlank { mimeFor(meta.optString("path")) })
}
fun openCachedFile(context: Context,file: File,name: String,mime: String) {
    context.startActivity(Intent(context,store.inspirai.library.nativeui.NativePreviewActivity::class.java).putExtra("path",file.absolutePath).putExtra("name",name).putExtra("mime",mime))
}

/** Segments are committed independently; backgrounding stops the current segment safely. */
@Composable fun RecordMicrophone(context: Context,repository: NestRepository,record: String,onFile: (JSONObject)->Unit) {
    val scope=rememberCoroutineScope();val lifecycle=LocalLifecycleOwner.current
    var recording by remember { mutableStateOf(false) };var error by remember { mutableStateOf<String?>(null) }
    var recorder by remember { mutableStateOf<android.media.MediaRecorder?>(null) };var current by remember { mutableStateOf<File?>(null) }
    var started by remember { mutableLongStateOf(0) }
    fun stop() {
        if(!recording)return
        recording=false;val file=current;val duration=System.currentTimeMillis()-started
        try { recorder?.stop();recorder?.release();recorder=null
            if(file!=null)RecordAudioStore.finish(context,repository,file,onFile={onFile(it)},onError={error=it})
        } catch(_: Exception){recorder?.release();recorder=null;error="录音未完成，已保存的片段仍可试听"}
    }
    fun start() { scope.launch {
        try {
            val files=repository.dao.files(record,repository.credentials.server()).filter { !it.id.endsWith("-thumbnail") }
            check(files.size<20 && files.sumOf { JSONObject(it.json).optLong("bytes") }<InputFiles.TOTAL_LIMIT) { "附件最多 20 个，合计最多 128 MiB" }
            val file=withContext(Dispatchers.IO){RecordAudioStore.begin(context,repository.credentials.server(),record)};current=file
            @Suppress("DEPRECATION") val audio=android.media.MediaRecorder()
            audio.setAudioSource(android.media.MediaRecorder.AudioSource.MIC);audio.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4)
            audio.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC);audio.setOutputFile(file.absolutePath);audio.setMaxFileSize(InputFiles.FILE_LIMIT)
            audio.setOnInfoListener { _,what,_->if(what==android.media.MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED)stop() }
            audio.prepare();audio.start();started=System.currentTimeMillis();recorder=audio;recording=true
        } catch(_: Exception){recorder?.release();recorder=null;error="无法开始录音，请检查权限、附件数量和可用空间"}
    } }
    LaunchedEffect(recording) {
        while(recording) { delay(30000);if(recording) { stop();start() } }
    }
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed->if(allowed)start() else error="未允许麦克风，可以添加已有音频" }
    DisposableEffect(lifecycle) {
        val observer=LifecycleEventObserver { _,event->if(event==Lifecycle.Event.ON_STOP)stop() };lifecycle.lifecycle.addObserver(observer)
        onDispose { stop();lifecycle.lifecycle.removeObserver(observer) }
    }
    TextButton(onClick={if(recording)stop() else if(context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED)start() else permission.launch(android.Manifest.permission.RECORD_AUDIO)}) { Text(if(recording)"暂停录音" else "录音") }
    error?.let { TextButton(onClick={error=null}) { Text(it) } }
}
