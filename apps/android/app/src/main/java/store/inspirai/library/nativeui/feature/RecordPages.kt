@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package store.inspirai.library.nativeui.feature

import android.content.Intent
import android.graphics.Typeface
import android.text.*
import android.text.Annotation
import android.text.style.*
import android.widget.EditText
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.*
import org.json.*
import store.inspirai.library.ShareActivity
import store.inspirai.library.nativeui.*
import store.inspirai.library.nativeui.plugins.*
import store.inspirai.library.nativeui.content.*
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.design.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

@Composable fun RecordsPage(model: RecordsModel,open: (String)->Unit,create: ()->Unit,writing: ()->Unit,blocks: ()->Unit={}) {
    var query by rememberSaveable { mutableStateOf("") };var filter by rememberSaveable { mutableStateOf("全部") };var more by remember { mutableStateOf(false) }
    val rows by model.rows.collectAsStateWithLifecycle();val state by model.status.collectAsStateWithLifecycle()
    val server=model.repository.credentials.server()
    val selected=rows.filter { it.server==server && JSONObject(it.json).let { value->value.isNull("deletedAt")||value.optString("deletedAt").isBlank() } }.filter { row -> val value=JSONObject(row.json)
        value.optString("text").contains(query,true) && when(filter) {
            "待同步"->value.optString("sync")!="synced";"待确认"->value.optJSONArray("tasks").objects().any { it.optString("state")=="awaiting_review" }
            "未加工"->value.optJSONArray("tasks").objects().isEmpty();else->true
        }
    }
    Column(Modifier.fillMaxSize().padding(horizontal=NestSpace.page)) {
        NestPageHeader("记录") {
            Box { IconButton(onClick={more=true}) { Icon(Icons.Outlined.MoreHoriz,"更多") };DropdownMenu(more,{more=false}) { if(pluginEnabled("blocks"))DropdownMenuItem(text={Text("积木")},onClick={more=false;blocks()});if(pluginEnabled("writing"))DropdownMenuItem(text={Text("写作工作台")},onClick={more=false;writing()});DropdownMenuItem(text={Text("同步记录")},onClick={more=false;model.refresh()}) } }
            IconButton(onClick=create) { Icon(Icons.Outlined.Add,"新建记录") }
        }
        NestSearch(query,"搜索记录"){query=it}
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical=12.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            listOf("全部","未加工","待确认","待同步").forEach { value -> FilterChip(selected=filter==value,onClick={filter=value},label={Text(value)}) }
        }
        state.error?.let { ErrorState(it){model.refresh()} };if(state.loading)LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(state=rememberLazyListState(),contentPadding=PaddingValues(bottom=24.dp)) {
            if(selected.isEmpty())item { EmptyState(if(query.isBlank())"还没有记录" else "没有匹配的记录",if(query.isBlank())"新建记录" else "清除搜索"){if(query.isBlank())create() else query=""} }
            val groups=selected.groupBy { row->recordDay(JSONObject(row.json).optString("createdAt")) }
            groups.toSortedMap(reverseOrder()).forEach { (date,group)->
                item("date:$date") { Text(date,style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(top=20.dp,bottom=8.dp)) }
                group.forEach { row->val value=JSONObject(row.json)
                item(row.id) {
                    Column(Modifier.fillMaxWidth().clickable { open(row.id) }.padding(vertical=16.dp)) {
                        Text(value.optString("text").ifBlank { "附件记录" },style=MaterialTheme.typography.titleMedium,maxLines=3)
                        val files=value.optJSONArray("attachments")?.length()?:0
                        Text(listOf(if(row.draft)"草稿" else syncLabel(value.optString("sync")),processingLabel(value),if(files>0)"$files 个附件" else "").filter { it.isNotBlank() }.joinToString(" · "),color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.labelMedium,modifier=Modifier.padding(top=10.dp))
                    };HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
                }
                }
            }
        }
    }
}
fun recordDay(value: String)=runCatching { java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDate().toString() }.getOrDefault("草稿")
fun syncLabel(state: String)=when(state) {"synced"->"已上传";"conflict"->"同步冲突";"failed"->"同步失败";"draft"->"草稿";else->"待同步"}
fun processingLabel(value: JSONObject): String = when {
    value.has("pendingProcess")->if(value.optString("processError").isNotBlank())"加工提交失败" else "加工待提交"
    value.optJSONArray("tasks").objects().any{it.optString("state")=="awaiting_review"}->"待确认"
    value.optJSONArray("tasks").objects().any{it.optString("state") in listOf("queued","assigned","running","uploading")}->"加工中"
    value.optJSONArray("tasks").objects().any{it.optString("state")=="completed"}->"已归档"
    else->""
}

@Composable fun RecordPage(repository: NestRepository,model: RecordsModel,id: String,back: ()->Unit,open: (String)->Unit) {
    val rows by model.rows.collectAsStateWithLifecycle();val row=rows.firstOrNull { it.id==id && it.server==repository.credentials.server() }
    var more by remember { mutableStateOf(false) };var process by remember { mutableStateOf(false) };var confirm by remember { mutableStateOf<String?>(null) }
    val state by model.status.collectAsStateWithLifecycle();val context=LocalContext.current
    val value=row?.let { JSONObject(it.json) }
    DetailScaffold("记录",back,actions={
        IconButton(enabled=value?.isNull("deletedAt")!=false,onClick={open("edit:$id")}) { Icon(Icons.Outlined.Edit,"编辑记录") }
        Box { IconButton(onClick={more=true}) { Icon(Icons.Outlined.MoreHoriz,"更多") };DropdownMenu(more,{more=false}) {
            if(pluginEnabled("ai-assistant"))DropdownMenuItem(enabled=value?.isNull("deletedAt")!=false,text={Text("交给 Agent 加工")},onClick={more=false;process=true})
            if(pluginEnabled("blocks"))DropdownMenuItem(enabled=value?.optString("sync")=="synced",text={Text("加入积木")},onClick={more=false;open("join:record:$id")})
            DropdownMenuItem(text={Text("同步")},onClick={more=false;model.refresh()})
            DropdownMenuItem(enabled=value?.isNull("deletedAt")!=false,text={Text("删除")},onClick={more=false;confirm="delete"})
        } }
    }) { padding ->
        Column(Modifier.padding(padding).widthIn(max=720.dp).verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
            state.error?.let { ErrorState(it){model.refresh()} }
            if(value==null) { EmptyState("正在读取记录");return@Column }
            if(!value.isNull("deletedAt")){Text("已在其他设备删除",style=MaterialTheme.typography.titleLarge);if(value.optJSONArray("recoveryDrafts").objects().isNotEmpty())Button(onClick={open("edit:$id")}){Text("恢复草稿")};TextButton(onClick={open("record-trash")}){Text("查看回收站")};return@Column}
            Text("${value.optString("createdAt").take(16).replace('T',' ')} · ${syncLabel(value.optString("sync"))}",color=MaterialTheme.colorScheme.onSurfaceVariant)
            RecordDocument(value,value.optString("text"))
            value.optJSONObject("pendingProcess")?.let {
                Text(processingLabel(value),style=MaterialTheme.typography.titleMedium)
                value.optString("processError").takeIf{message->message.isNotBlank()}?.let{message->Text(message,color=MaterialTheme.colorScheme.error)}
                OutlinedButton(onClick={model.refresh()}){Text("重试加工提交")}
            }
            value.optJSONArray("attachments").objects().forEach { file -> AttachmentRow(file) { model.action {
                val local=repository.dao.files(id,repository.credentials.server()).firstOrNull { it.id==file.optString("id") }?.let { JSONObject(it.json) }
                if(local!=null)openCachedFile(context,java.io.File(local.getString("localPath")),file.optString("name"),local.optString("mime"))
                else openNativeFile(context,repository,"/api/records/media/${file.getString("sha256")}",file)
            } } }
            if(value.optString("sync")=="conflict") {
                Text("同步冲突",style=MaterialTheme.typography.titleLarge)
                Text(value.optString("error"))
                Button(onClick={confirm="local"}) { Text("保留本机版本") };OutlinedButton(onClick={confirm="remote"}) { Text("使用远端版本") }
                var remote by remember { mutableStateOf<JSONObject?>(null) }
                LaunchedEffect(id) { model.action { remote=repository.request("/api/records/${encoded(id)}").let { it.optJSONObject("record")?:it } } }
                remote?.let { Text("远端版本 ${it.optLong("version")}",style=MaterialTheme.typography.titleMedium);RecordDocument(it,it.optString("text")) }
            }
            value.optJSONArray("tasks").objects().forEach { task -> TextButton(onClick={open("task:${task.getString("id")}")}) { Text(task.optString("title",task.optString("state","加工任务"))) } }
            if(pluginEnabled("ai-assistant"))Button(onClick={process=true}) { Text("加工记录") }
        }
    }
    if(confirm!=null)AlertDialog(onDismissRequest={confirm=null},title={Text(if(confirm=="delete")"删除这条记录？" else "确认采用${if(confirm=="local")"本机" else "远端"}版本？")},confirmButton={TextButton(onClick={val choice=confirm;confirm=null;model.action { if(choice=="delete")repository.setRecordDeleted(id,true) else repository.resolveConflict(repository.credentials.server(),id,choice=="local");repository.syncRecords() }}) { Text("确认") }},dismissButton={TextButton(onClick={confirm=null}){Text("取消")}})
    if(process) {
        var preset by rememberSaveable { mutableStateOf("summary") };var instruction by rememberSaveable { mutableStateOf("") }
        var devices by remember { mutableStateOf<List<JSONObject>>(emptyList()) };var device by rememberSaveable { mutableStateOf("") };var agent by rememberSaveable { mutableStateOf("") }
        LaunchedEffect(Unit){model.action { devices=repository.request("/api/state").optJSONArray("devices").objects().filter { store.inspirai.library.core.DevicePresentation.dispatchable(it) } }}
        ModalBottomSheet(onDismissRequest={process=false}) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp).imePadding(),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                Text("加工记录",style=MaterialTheme.typography.titleLarge)
                OptionMenu("加工方式",preset,listOf("summary" to "总结","extract" to "整理要点","actions" to "提取待办","custom" to "自定义")){preset=it}
                OutlinedTextField(instruction,{instruction=it},Modifier.fillMaxWidth(),label={Text("补充要求")})
                OptionMenu("电脑",device,listOf("" to "自动")+devices.map { it.getString("id") to it.optString("name") }){device=it}
                OptionMenu("Agent",agent,listOf("" to "自动","codex" to "Codex")){agent=it}
                Button(onClick={model.action { repository.processRecord(repository.credentials.server(),id,preset,instruction,device,agent);process=false;repository.syncRecords() }},Modifier.fillMaxWidth()) { Text("交给后台") }
            }
        }
    }
}

@Composable fun RecordEditorPage(repository: NestRepository,existingId: String,shared: Intent?,back: ()->Unit,open: (String)->Unit={}) {
    val context=LocalContext.current;val scope=rememberCoroutineScope();val model=model("editor:$existingId") { PageModel(repository) }
    val state by model.status.collectAsStateWithLifecycle()
    val syncedRows by repository.records.collectAsStateWithLifecycle(emptyList())
    val remotelyDeleted=syncedRows.firstOrNull{it.id==existingId&&it.server==repository.credentials.server()}?.let{JSONObject(it.json).let{json->!json.isNull("deletedAt")&&json.optString("deletedAt").isNotBlank()}}?:false
    val id=rememberSaveable { existingId.ifBlank { UUID.randomUUID().toString() } }
    var value by remember { mutableStateOf<JSONObject?>(null) };var editor by remember { mutableStateOf<EditText?>(null) }
    var files by remember { mutableStateOf<List<JSONObject>>(emptyList()) };var error by remember { mutableStateOf<String?>(null) }
    val edits=remember { mutableListOf<SpannableString>() };val redos=remember { mutableListOf<SpannableString>() };var applying by remember { mutableStateOf(false) }
    var linkDialog by remember { mutableStateOf(false) };var link by rememberSaveable { mutableStateOf("") };var linkStart by remember { mutableIntStateOf(0) };var linkEnd by remember { mutableIntStateOf(0) }
    val color=MaterialTheme.colorScheme.onSurface.toArgbCompat();val hintColor=MaterialTheme.colorScheme.onSurfaceVariant.toArgbCompat();val accent=MaterialTheme.colorScheme.secondary.toArgbCompat()
    fun persist(draft: Boolean=true,onDone: ()->Unit={}) { model.action {
        val current=value?.copyJson()?:return@action
        check(current.optJSONObject("document")?.let { RecordCodec.supported(it) }!=false) { "此格式仅可阅读，原文已保留" }
        val text=editor?.text ?: SpannableStringBuilder(current.optString("text"))
        current.put("text",text.toString().replace("\uFFFC","").replace("\u200B","")).put("document",RecordCodec.encode(text)).put("attachments",JSONArray(files))
        val recovered=if(!draft&&remotelyDeleted)repository.saveRecoveryAsNew(current) else {repository.saveRecord(current,draft);null};value=current;onDone();if(recovered!=null)open("record:$recovered")
    } }
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> model.action {
        val current=files.toMutableList()
        for(uri in uris) { current+=importRecordFile(context,repository,id,uri,current);files=current.toList();persist() }
        files=current;persist()
    } }
    var photoPath by rememberSaveable { mutableStateOf("") }
    val camera=rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { accepted->
        if(accepted && photoPath.isNotBlank())model.action {
            val photo=java.io.File(photoPath)
            val uri=androidx.core.content.FileProvider.getUriForFile(context,"${context.packageName}.capture",photo)
            files=files+importRecordFile(context,repository,id,uri,files);persist();photo.delete();photoPath=""
        }
    }
    fun takePhoto() {
        val file=java.io.File(context.cacheDir,"native-open/camera-${UUID.randomUUID()}.jpg");file.parentFile!!.mkdirs();photoPath=file.absolutePath
        camera.launch(androidx.core.content.FileProvider.getUriForFile(context,"${context.packageName}.capture",file))
    }
    val cameraPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { if(it)takePhoto() else error="未允许相机，可以添加已有图片" }
    LaunchedEffect(id) { model.action {
        val saved=repository.dao.record(repository.credentials.server(),id)
        val row=saved?.let { JSONObject(it.json).let { json -> json.optJSONObject("editingDraft")?:json.optJSONArray("recoveryDrafts")?.optJSONObject(0)?:json } }?:JSONObject().put("id",id).put("text",shared?.let { ShareActivity.sharedText(it) }?:"").put("createdAt",Instant.now().toString()).put("server",repository.credentials.server())
        value=row;files=row.optJSONArray("attachments").objects()
        if(saved==null)repository.saveRecord(row,true)
    } }
    DetailScaffold("${if(existingId.isBlank())"新建" else "编辑"}记录",{persist(true,back)},actions={TextButton(onClick={persist(false) { back() }}) { Text(if(remotelyDeleted)"另存记录" else "保存") }},bottom={
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(horizontal=12.dp)) {
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                listOf("粗体","斜体","下划线","删除线","代码","链接","标题","列表","引用","正文","撤销","重做").forEach { action -> TextButton(onClick={
                    val view=editor?:return@TextButton;val text=view.text;val start=view.selectionStart.coerceAtLeast(0);val end=view.selectionEnd.coerceAtLeast(start)
                    if(action=="链接"){if(end>start){linkStart=start;linkEnd=end;link=text.getSpans(start,end,URLSpan::class.java).firstOrNull()?.url?:"";linkDialog=true}else error="请先选中需要添加链接的文字";return@TextButton}
                    if(action=="撤销"||action=="重做") {
                        val from=if(action=="撤销")edits else redos;val to=if(action=="撤销")redos else edits
                        if(from.isNotEmpty()){to.add(SpannableString(text));applying=true;view.setText(from.removeAt(from.lastIndex));view.setSelection(view.length());applying=false}
                    } else {
                        edits.add(SpannableString(text));redos.clear()
                        if(action in listOf("粗体","斜体","下划线","删除线","代码")) {
                            if(end>start) {
                                val existing=text.getSpans(start,end,CharacterStyle::class.java).filter { span->when(action){"粗体"->span is StyleSpan&&span.style and Typeface.BOLD!=0;"斜体"->span is StyleSpan&&span.style and Typeface.ITALIC!=0;"下划线"->span is UnderlineSpan;"删除线"->span is StrikethroughSpan;else->span is TypefaceSpan} }
                                if(existing.isNotEmpty())existing.forEach { text.removeSpan(it) }
                                else text.setSpan(when(action){"粗体"->StyleSpan(Typeface.BOLD);"斜体"->StyleSpan(Typeface.ITALIC);"下划线"->UnderlineSpan();"删除线"->StrikethroughSpan();else->TypefaceSpan("monospace")},start,end,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            }
                        }
                        else { val a=if(start==0)0 else text.toString().lastIndexOf('\n',start-1).let { if(it<0)0 else it+1 };val b=text.toString().indexOf('\n',end).let { if(it<0)text.length else it };if(b>a)RecordCodec.setBlock(text,a,b,when(action){"标题"->"heading1";"列表"->"bulletList";"正文"->"paragraph";else->"blockquote"}) }
                    };persist()
                }) { Text(action) } }
            }
            Row { TextButton(onClick={picker.launch(arrayOf("*/*"))}) { Icon(Icons.Outlined.AttachFile,null);Text("附件") };TextButton(onClick={if(context.checkSelfPermission(android.Manifest.permission.CAMERA)==android.content.pm.PackageManager.PERMISSION_GRANTED)takePhoto() else cameraPermission.launch(android.Manifest.permission.CAMERA)}) { Text("拍照") };RecordMicrophone(context,repository,id,onFile={file->files=files.filter { it.optString("id")!=file.optString("id") }+file;persist()}) }
        }
    }) { padding ->
        Column(Modifier.padding(padding).padding(horizontal=24.dp).fillMaxSize()) {
            state.error?.let { ErrorState(it){persist()} };error?.let { Text(it,color=MaterialTheme.colorScheme.error) }
            if(remotelyDeleted) { Text("已在其他设备删除");Row { TextButton(onClick={persist(false){back()}}){Text("另存记录")};TextButton(onClick={open("record-trash")}){Text("查看回收站")} } }
            val document=value?.optJSONObject("document")
            val supported=document==null||RecordCodec.supported(document)
            if(!supported) { Text("此记录使用新格式，当前版本仅可阅读。原文未更改。");value?.let { RecordDocument(it,it.optString("text")) } }
            else if(value!=null)AndroidView(factory={ c -> EditText(c).apply {
                setTextColor(color);textSize=18f;setLineSpacing(0f,1.65f);setPadding(0,0,0,0);gravity=android.view.Gravity.TOP;setBackgroundColor(android.graphics.Color.TRANSPARENT)
                hint="记下此刻的想法…";inputType=android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                setText(document?.let { RecordCodec.decode(it) }?:value!!.optString("text"));editor=this
                addTextChangedListener(object: TextWatcher {
                    private var before: SpannableString?=null
                    override fun beforeTextChanged(s: CharSequence?,start: Int,count: Int,after: Int) { if(!applying)before=SpannableString(text) }
                    override fun onTextChanged(s: CharSequence?,start: Int,before: Int,count: Int) {}
                    override fun afterTextChanged(s: Editable?) { if(!applying){before?.let { edits.add(it);if(edits.size>80)edits.removeAt(0) };redos.clear();persist()} }
                })
            } },update={it.setTextColor(color);it.setHintTextColor(hintColor);it.setLinkTextColor(accent)},modifier=Modifier.weight(1f).fillMaxWidth())
            LazyColumn(Modifier.heightIn(max=180.dp)) { items(files,key={it.optString("id")}) { file -> Row(verticalAlignment=Alignment.CenterVertically) {
                Box(Modifier.weight(1f)){AttachmentRow(file) { model.action {
                    val local=repository.dao.files(id,repository.credentials.server()).firstOrNull { it.id==file.getString("id") }?.let { JSONObject(it.json) }
                    if(local!=null)openCachedFile(context,java.io.File(local.getString("localPath")),local.optString("name"),local.optString("mime"))
                    else openNativeFile(context,repository,"/api/records/media/${file.getString("sha256")}",file)
                } } }
                IconButton(onClick={
                    applying=true
                    editor?.text?.let { text->text.getSpans(0,text.length,Annotation::class.java).filter { it.key=="attachment"&&JSONObject(it.value).optJSONObject("attrs")?.optString("attachmentId")==file.optString("id") }.sortedByDescending { text.getSpanStart(it) }.forEach { val start=text.getSpanStart(it);val end=text.getSpanEnd(it);text.removeSpan(it);text.delete(start,end) } }
                    files=files.filter { it.optString("id")!=file.optString("id") };applying=false;persist()
                }){Icon(Icons.Outlined.Close,"移除附件 ${file.optString("name")}")}
            } } }
        }
    }
    if(linkDialog)AlertDialog(onDismissRequest={linkDialog=false},title={Text("文字链接")},text={OutlinedTextField(link,{link=it},Modifier.fillMaxWidth(),label={Text("https://")},singleLine=true)},confirmButton={TextButton(onClick={
        val uri=runCatching{java.net.URI(link)}.getOrNull()
        if(uri?.scheme !in listOf("http","https")||uri?.host.isNullOrBlank()){error="请输入完整的 HTTP 或 HTTPS 链接";return@TextButton}
        editor?.text?.let { text->edits.add(SpannableString(text));text.getSpans(linkStart,linkEnd,URLSpan::class.java).forEach{text.removeSpan(it)};text.setSpan(URLSpan(link),linkStart,linkEnd,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        linkDialog=false;persist()
    }){Text("应用")}},dismissButton={TextButton(onClick={linkDialog=false}){Text("取消")}})
}

@Composable fun RecordTrashPage(repository: NestRepository,back: ()->Unit,open: (String)->Unit) {
    val model=model("record-trash"){PageModel(repository)};val state by model.status.collectAsStateWithLifecycle()
    val rows by repository.records.collectAsStateWithLifecycle(emptyList())
    val deleted=rows.filter{it.server==repository.credentials.server()&&!JSONObject(it.json).isNull("deletedAt")}
    LaunchedEffect(Unit){model.action{repository.checkRecordSnapshot()}}
    DetailScaffold("回收站",back){padding->LazyColumn(Modifier.padding(padding),contentPadding=PaddingValues(NestSpace.page)){
        state.error?.let{item{ErrorState(it){model.action{repository.syncRecords()}}}}
        if(deleted.isEmpty())item{EmptyState("回收站为空")}
        items(deleted,key={it.id}){row->val value=JSONObject(row.json)
            Column(Modifier.fillMaxWidth().padding(vertical=16.dp)){
                Text(value.optString("text").take(120).ifBlank{"已删除记录"},style=MaterialTheme.typography.titleMedium)
                Row{TextButton(enabled=!state.loading,onClick={model.action{repository.setRecordDeleted(row.id,false);repository.syncRecords()}}){Text("恢复原记录")}
                if(value.optJSONArray("recoveryDrafts").objects().isNotEmpty())TextButton(onClick={open("edit:${row.id}")}){Text("恢复草稿")}}
            };HorizontalDivider()
        }
    }}
}
