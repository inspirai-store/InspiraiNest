package store.inspirai.library.nativeui.feature

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.*
import store.inspirai.library.*
import store.inspirai.library.core.*
import store.inspirai.library.nativeui.*
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.design.*
import java.time.Instant
import java.util.UUID

@Composable fun SharePage(repository: NestRepository,savedId: String,shared: Intent?,onFinish: ()->Unit,open: (String)->Unit) {
    val context=LocalContext.current;val model=model("share:$savedId") { PageModel(repository) };val status by model.status.collectAsStateWithLifecycle()
    val id=rememberSaveable { savedId.ifBlank { UUID.randomUUID().toString() } }
    var draft by remember { mutableStateOf<JSONObject?>(null) };var mode by rememberSaveable { mutableStateOf("agent") }
    var filter by rememberSaveable { mutableStateOf("全部") };var advanced by rememberSaveable { mutableStateOf(false) }
    var state by remember { mutableStateOf(JSONObject()) };var importing by remember { mutableStateOf(false) };var receipt by rememberSaveable { mutableStateOf(false) }
    val scope=rememberCoroutineScope();val mutex=remember { Mutex() }
    fun update(key: String,value: Any) { val next=draft?.copyJson()?.put(key,value)?:return;draft=next;model.action { mutex.withLock { withContext(Dispatchers.IO){Drafts(context).save(next)} } } }
    fun importUris(uris: List<android.net.Uri>) { model.action {
        importing=true
        try { for(uri in uris) {
            val item=JSONObject().put("id",UUID.randomUUID().toString()).put("state","reading").put("selected",true)
            val list=JSONArray(draft!!.optJSONArray("attachments")?.toString()?:"[]");list.put(item)
            val pending=draft!!.copyJson().put("attachments",list);draft=pending
            mutex.withLock { withContext(Dispatchers.IO){Drafts(context).save(pending)} }
            val copied=withContext(Dispatchers.IO){InputFiles(context).copyShared(id,item,uri)}
            val current=draft!!.optJSONArray("attachments")?:JSONArray();for(i in 0 until current.length())if(current.getJSONObject(i).optString("id")==item.getString("id")){copied.put("selected",current.getJSONObject(i).optBoolean("selected",true));current.put(i,copied)}
            update("attachments",current)
        } } finally { importing=false }
    } }
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> importUris(uris) }
    LaunchedEffect(id) { model.action {
        val queued=withContext(Dispatchers.IO){Outbox(context).list().objects().firstOrNull { it.optString("id")==id }}
        if(queued!=null) { receipt=true;return@action }
        val existing=withContext(Dispatchers.IO){runCatching { Drafts(context).read(id) }.getOrNull()}
        val row=existing?:JSONObject().put("id",id).put("original",shared?.let { ShareActivity.sharedText(it) }?:"").put("content",shared?.let { ShareActivity.sharedText(it) }?:"")
            .put("extra","").put("tags","").put("autoArchive",true).put("recordId",UUID.randomUUID().toString())
        mode=row.optString("destination","agent").takeIf { it in listOf("agent","record") }?:"agent"
        if(mode=="record"&&row.optString("savedRecordId").isNotEmpty())receipt=true
        val restored=JSONArray(row.optJSONArray("attachments").objects().map { previous ->
            runCatching { InputFiles(context).read(id,previous.getString("id")).put("selected",previous.optBoolean("selected",true)) }.getOrElse {
                previous.copyJson().apply { if(optString("state")=="reading")put("state","error").put("error","读取已中断，请重新添加") }
            }
        });row.put("attachments",restored);draft=row
        withContext(Dispatchers.IO){Drafts(context).save(row)}
        if(existing==null&&shared!=null)importUris(ShareActivity.sharedUris(shared))
        if(repository.credentials.isPaired())state=repository.request("/api/state")
    } }
    val files=draft?.optJSONArray("attachments").objects()
    val selection=runCatching {
        if(mode=="agent")check(files.none { it.optBoolean("selected",true)&&!it.optBoolean("agentSupported",true) }) { "此附件仅可存为记录，采集前请取消勾选" }
        InputFiles.selected(JSONArray(files))
    }
    fun submit() { model.action {
        check(!importing);val row=draft!!.copyJson();val selected=InputFiles.selected(row.optJSONArray("attachments")?:JSONArray())
        val raw=row.optString("original").ifEmpty { row.optString("content") }
        if(mode=="record") {
            val recordId=row.optString("recordId").ifEmpty { UUID.randomUUID().toString().also { row.put("recordId",it);withContext(Dispatchers.IO){Drafts(context).save(row)} } }
            check(raw.isNotBlank()||selected.length()>0){"请填写文字或选择附件"}
            val recordFiles=JSONArray()
            for(file in files.filter { it.optBoolean("selected",true) }) {
                val retained=withContext(Dispatchers.IO) {
                    val original=InputFiles(context).file(id,file.getString("id"))
                    val target=java.io.File(context.noBackupFilesDir,"record-media/${UUID.nameUUIDFromBytes(repository.credentials.server().toByteArray())}/$recordId/${file.getString("id")}.bin")
                    target.parentFile!!.mkdirs();val temporary=java.io.File(target.path+".tmp")
                    try { java.io.FileOutputStream(temporary).use { out->original.inputStream().use { it.copyTo(out) };out.fd.sync() };check(temporary.length()==file.getLong("bytes")&&InputFiles.sha256(temporary)==file.getString("sha256")){"附件校验失败"};check(temporary.renameTo(target));target }finally { temporary.delete() }
                }
                val metadata=file.copyJson().put("localPath",retained.absolutePath)
                repository.dao.file(RecordFile(recordId,file.getString("id"),metadata.toString(),repository.credentials.server()));recordFiles.put(file)
            }
            repository.saveRecord(JSONObject().put("id",recordId).put("server",repository.credentials.server()).put("text",raw).put("createdAt",row.optString("createdAt",Instant.now().toString())).put("attachments",recordFiles),false)
            row.put("savedRecordId",recordId)
            mutex.withLock { withContext(Dispatchers.IO){Drafts(context).save(row)} }
            draft=row;receipt=true
        } else {
            check(files.none { it.optBoolean("selected",true)&&!it.optBoolean("agentSupported",true) }) { "此附件仅可存为记录，采集前请取消勾选" }
            val full=raw+row.optString("extra").let { if(it.isBlank())"" else "\n\n补充要求：\n$it" }
            check((full.isNotBlank()||selected.length()>0)&&full.length<=10000){"请填写文字或选择附件；文字最多 10000 字符"}
            check(repository.credentials.isPaired()){"请先连接资料空间，内容已保存在手机"}
            val tags=row.optString("tags").split(',', '，').map { it.trim() }.filter { it.isNotEmpty() };check(tags.size<=20&&tags.all { it.length<=60 }){"标签超出限制"}
            val payload=JSONObject().put("submissionId",id).put("content",full).put("autoArchive",row.optBoolean("autoArchive",true)).put("tags",JSONArray(tags))
            if(selected.length()>0)payload.put("attachments",selected)
            listOf("agent","deviceId").forEach { key -> if(row.optString(key).isNotEmpty())payload.put(key,row.getString(key)) }
            if(row.optBoolean("trialEnabled")) {
                check(row.optString("trialDeviceId").isNotEmpty()){"请选择实测电脑"}
                payload.put("codexTrial",JSONObject().put("deviceId",row.getString("trialDeviceId")).apply { if(row.optString("trialProjectId").isNotEmpty())put("projectId",row.getString("trialProjectId")) })
            }
            withContext(Dispatchers.IO){Outbox(context).enqueue(payload,repository.credentials.server());Drafts(context).remove(id);QueueJob.schedule(context)}
            receipt=true
        }
    } }
    DetailScaffold(if(receipt)"已保存" else "保存分享",onFinish,bottom={if(!receipt)Surface(shadowElevation=2.dp) {
        Button(onClick={submit()},enabled=draft!=null&&!importing&&selection.isSuccess&&!status.loading,
            modifier=Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(horizontal=20.dp,vertical=12.dp)) { Text(if(mode=="record")"存为记录" else "交给后台采集") }
    }}) { padding ->
        if(receipt)Column(Modifier.padding(padding).padding(24.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
            Text(if(mode=="record")"记录已保存" else "任务已保存到发件箱",style=MaterialTheme.typography.headlineLarge)
            Button(onClick=onFinish) { Text("完成") };TextButton(onClick={open(if(mode=="record")"record:${draft?.optString("recordId")}" else "outbox")}) { Text(if(mode=="record")"查看记录" else "查看提交进度") }
        } else Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            status.error?.let { ErrorState(it){model.action { if(repository.credentials.isPaired())state=repository.request("/api/state") }} }
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) { FilterChip(selected=mode=="record",onClick={mode="record";filter="全部";update("destination",mode)},label={Text("存为记录")});FilterChip(selected=mode=="agent",onClick={mode="agent";filter="全部";update("destination",mode)},label={Text("Agent 采集")}) }
            val current=draft
            if(current!=null) {
                OutlinedTextField(current.optString("content"),{update("content",it)},Modifier.fillMaxWidth(),label={Text("分享内容")},minLines=4,readOnly=current.optString("original").isNotEmpty())
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) { Text("附件",style=MaterialTheme.typography.titleMedium);TextButton(onClick={picker.launch(arrayOf("*/*"))}) { Text("添加文件") } }
                Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) { (listOf("全部","文档","图片","音频")+if(mode=="record")listOf("视频") else emptyList()).forEach { value->FilterChip(filter==value,{filter=value},label={Text(value)}) } }
                Row { TextButton(onClick={val rows=JSONArray(files.map { it.copyJson().apply { if(filter=="全部"||InputFiles.category(it)==filter)put("selected",true) } });update("attachments",rows)}) { Text("全选") };TextButton(onClick={update("attachments",JSONArray(files.map { it.copyJson().apply { if(filter=="全部"||InputFiles.category(it)==filter)put("selected",false) } }))}) { Text("取消选择") } }
                files.filter { filter=="全部"||InputFiles.category(it)==filter }.forEach { file ->
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                        Checkbox(file.optBoolean("selected",true),{ checked->update("attachments",JSONArray(files.map { if(it.optString("id")==file.optString("id"))it.copyJson().put("selected",checked) else it })) })
                        Column(Modifier.weight(1f)) { Text(file.optString("name","读取文件…"));Text(if(file.optString("state")=="ready")"${file.optLong("bytes")/1024} KB" else file.optString("error","正在保存本机副本"),color=if(file.optString("state")=="error")MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
                selection.exceptionOrNull()?.message?.let { Text(it,color=MaterialTheme.colorScheme.error) }
                if(mode=="agent") {
                    OutlinedTextField(current.optString("extra"),{update("extra",it)},Modifier.fillMaxWidth(),label={Text("补充要求")},minLines=2)
                    Row(verticalAlignment=Alignment.CenterVertically) { Checkbox(current.optBoolean("trialEnabled"),{update("trialEnabled",it)});Text("在 Codex 中实测") }
                    val devices=state.optJSONArray("devices").objects().filter { DevicePresentation.dispatchable(it) }
                    if(current.optBoolean("trialEnabled")) {
                        OptionMenu("实测电脑",current.optString("trialDeviceId"),listOf("" to "选择电脑")+devices.filter { it.optJSONObject("trialEnvironment")!=null }.map { it.getString("id") to it.optString("name") }) { update("trialDeviceId",it);update("trialProjectId","") }
                        val projects=devices.firstOrNull { it.optString("id")==current.optString("trialDeviceId") }?.optJSONObject("trialEnvironment")?.optJSONArray("projects").objects()
                        OptionMenu("关联项目",current.optString("trialProjectId"),listOf("" to "不关联项目")+projects.map { it.getString("id") to it.optString("name") }) { update("trialProjectId",it) }
                    }
                    TextButton(onClick={advanced=!advanced}) { Text("高级选项") }
                    if(advanced) {
                        OutlinedTextField(current.optString("tags"),{update("tags",it)},Modifier.fillMaxWidth(),label={Text("标签")})
                        Row(verticalAlignment=Alignment.CenterVertically) { Checkbox(current.optBoolean("autoArchive",true),{update("autoArchive",it)});Text("自动归档") }
                        OptionMenu("电脑",current.optString("deviceId"),listOf("" to "自动")+devices.map { it.getString("id") to it.optString("name") }) { update("deviceId",it) }
                        OptionMenu("Agent",current.optString("agent"),listOf("" to "自动","codex" to "Codex")) { update("agent",it) }
                    }
                }
            }
        }
    }
}
