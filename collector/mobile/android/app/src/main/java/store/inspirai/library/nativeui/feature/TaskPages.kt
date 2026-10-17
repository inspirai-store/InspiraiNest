package store.inspirai.library.nativeui.feature

import android.util.Base64
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import store.inspirai.library.core.*
import store.inspirai.library.nativeui.*
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.content.*
import store.inspirai.library.nativeui.design.*

@Composable fun TasksPage(model: TaskModel,open: (String)->Unit,create: ()->Unit,startSession: (List<String>)->Unit={}) {
    val center by model.center.collectAsStateWithLifecycle();val state by model.status.collectAsStateWithLifecycle()
    VisiblePoll("tasks") { if(!state.loading&&model.repository.credentials.isPaired())model.refresh(true) }
    var section by rememberSaveable { mutableStateOf("attention") };var history by rememberSaveable { mutableStateOf(false) }
    val sections=listOf("attention" to "需要处理","running" to "后台进行","results" to "处理结果","later" to "稍后")
    val rows=center.optJSONArray("items").objects().filter { it.optString("section")==if(history)"history" else section }
    Column(Modifier.fillMaxSize().padding(horizontal=NestSpace.page)) {
        NestPageHeader("任务") {
            IconButton(onClick={model.refresh()}) { Icon(Icons.Outlined.Refresh,"刷新任务") };IconButton(onClick=create) { Icon(Icons.Outlined.Add,"新建采集") }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            sections.forEach { (key,label)->FilterChip(section==key&&!history,{section=key;history=false},label={Text(label+center.optJSONObject("counts")?.optInt(key).let { if(it==null||it==0)"" else " $it" })}) }
        }
        TextButton(onClick={history=!history}) { Text(if(history)"返回新结果" else "历史任务") }
        if(rows.isNotEmpty()&&!history&&section in listOf("attention","results"))OutlinedButton(onClick={startSession(rows.flatMap { it.optJSONArray("taskIds")?.let { ids->(0 until ids.length()).map { index->ids.getString(index) } }?:emptyList() }.distinct())}) { Text("连续处理") }
        state.error?.let { ErrorState(it){model.refresh()} };if(state.loading)LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(state=rememberLazyListState(),contentPadding=PaddingValues(bottom=24.dp)) {
            if(rows.isEmpty())item { EmptyState(when(section){"attention"->"当前没有待办";"running"->"当前没有后台任务";"later"->"没有稍后处理的内容";else->"没有新结果"}) }
            items(rows,key={it.getString("id")}) { row ->
                Column(Modifier.fillMaxWidth().clickable {
                    row.optJSONArray("taskIds")?.optString(0)?.takeIf{it.isNotBlank()}?.let(open)
                    if(row.optBoolean("unread"))model.defer(row,"read")
                }.padding(vertical=20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    Text(row.optString("title"),style=MaterialTheme.typography.titleMedium)
                    val message=row.optString("message");if(message.isNotBlank())Text(message,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2)
                    if(row.optString("deviceName").isNotEmpty())Text(listOf(row.optString("deviceName"),row.optString("projectName")).filter { it.isNotBlank() }.joinToString(" · "),style=MaterialTheme.typography.labelMedium)
                    if(section in listOf("attention","later"))TextButton(onClick={model.defer(row,if(section=="later")"restore" else "defer")}) { Text(if(section=="later")"移回待处理" else "稍后") }
                };HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@Composable fun TaskPage(repository: NestRepository,id: String,back: ()->Unit,open: (String)->Unit,next: (() ->Unit)?=null,sessionLabel: String="") {
    val model=model("task:$id") { TaskModel(repository) };val task by model.detail.collectAsStateWithLifecycle();val status by model.status.collectAsStateWithLifecycle()
    var report by remember { mutableStateOf<JSONObject?>(null) };var confirm by remember { mutableStateOf<String?>(null) }
    var more by remember { mutableStateOf(false) };val context=LocalContext.current
    LaunchedEffect(id) { model.task(id) }
    VisiblePoll(id) { if(!status.loading&&confirm==null)model.task(id,true) }
    LaunchedEffect(task?.optJSONObject("report")?.optString("digest")) { if(task?.optJSONObject("report")!=null)model.action { report=repository.request("/api/tasks/${encoded(id)}/trial-report") } }
    DetailScaffold("任务详情",back,actions={
        IconButton(onClick={model.task(id)}) { Icon(Icons.Outlined.Refresh,"刷新任务") }
        Box { IconButton(onClick={more=true}){Icon(Icons.Outlined.MoreHoriz,"更多")};DropdownMenu(more,{more=false}) { DropdownMenuItem(text={Text("取消任务")},onClick={more=false;confirm="cancel"});if(report!=null)DropdownMenuItem(text={Text("重新实测")},onClick={more=false;confirm="trial-rerun"}) } }
    },bottom={if(next!=null)OutlinedButton(onClick=next,modifier=Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal=20.dp,vertical=12.dp)){Text(sessionLabel)}}) { padding ->
        LazyColumn(state=rememberLazyListState(),contentPadding=PaddingValues(24.dp),modifier=Modifier.padding(padding),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            status.error?.let { item { ErrorState(it){model.task(id)} } }
            task?.let { value ->
                item { Text(value.optString("title").ifBlank { InputFiles.title(value) },style=MaterialTheme.typography.headlineLarge);Text(taskState(value.optString("state")),color=MaterialTheme.colorScheme.secondary,modifier=Modifier.padding(top=12.dp)) }
                item { val text=value.optString("scenario");if(text.isNotBlank()&&text!="null")Text(text) }
                if(value.optString("state")=="awaiting_review")item { Button(onClick={open("bundle:/api/tasks/$id/draft")}) { Text("阅读结果并审核") } }
                val action=value.optJSONObject("actionRequired")
                if(action!=null)item {
                    Text(action.optString("label","需要处理"),style=MaterialTheme.typography.titleLarge)
                    if(action.optString("kind")=="choose_target") {
                        action.optJSONArray("candidates").objects().forEach { candidate -> OutlinedButton(onClick={model.mutate(id,"trial-choice",JSONObject().put("targetId",candidate.getString("id")))}) { Text(candidate.optString("name",candidate.optString("repository",candidate.optString("id")))) } }
                        var custom by rememberSaveable { mutableStateOf(false) };var kind by rememberSaveable { mutableStateOf("plugin") };var repositoryUrl by rememberSaveable { mutableStateOf("") };var directory by rememberSaveable { mutableStateOf("") }
                        TextButton(onClick={custom=!custom}){Text("指定其他对象")}
                        if(custom) {
                            OptionMenu("类型",kind,listOf("plugin" to "插件","skill" to "Skill","mcp" to "MCP")){kind=it}
                            OutlinedTextField(repositoryUrl,{repositoryUrl=it},Modifier.fillMaxWidth(),label={Text("GitHub 仓库")},singleLine=true)
                            OutlinedTextField(directory,{directory=it},Modifier.fillMaxWidth(),label={Text("仓库内目录")},singleLine=true)
                            Button(enabled=repositoryUrl.isNotBlank()&&!status.loading,onClick={model.mutate(id,"trial-choice",JSONObject().put("target",JSONObject().put("kind",kind).put("repository",repositoryUrl).put("directory",directory)))}){Text("确认对象并继续")}
                        }
                    } else {
                        action.optString("message").takeIf { it.isNotEmpty() }?.let { Text(it) }
                        if(action.optString("kind")=="trial_login")TextButton(onClick={open("devices")}) { Text("查看 Agent 环境") }
                    }
                }
                if(value.optString("state") in listOf("waiting_action","failed"))item { Button(onClick={model.mutate(id,"retry")}){Text("继续任务")} }
                value.optString("archiveId").takeIf { it.isNotBlank()&&it!="null" }?.let { archive -> item { Button(onClick={open("bundle:/api/archives/$archive")}) { Text("阅读归档结果") } } }
                value.optString("recordId").takeIf { it.isNotBlank()&&it!="null" }?.let { record -> item { OutlinedButton(onClick={open("record:$record")}) { Text("返回原记录 · 版本 ${value.optLong("recordVersion")}") } } }
                value.optJSONObject("trial")?.optString("parentTaskId")?.takeIf { it.isNotBlank() }?.let { parent -> item { OutlinedButton(onClick={open("task:$parent")}) { Text("查看原资料") } } }
                items(value.optJSONArray("linkedTrials").objects()) { linked -> TextButton(onClick={open("task:${linked.optString("id")}")}) { Text(linked.optString("title","Codex 实测报告")) } }
                report?.let { result ->
                    val markdown=result.optString("markdown").ifEmpty { result.optString("report") }
                    item { Text("实测报告",style=MaterialTheme.typography.titleLarge) }
                    if(markdown.isNotEmpty())items(MarkdownContent.parse(markdown).blocks) { MarkdownBlock(it) }
                    else item { Text(result.optString("summary",result.optJSONObject("meta")?.optString("summary")?:"")) }
                    items(result.optJSONArray("files").objects()) { file ->
                        if(file.optString("path").endsWith(".md") && file.has("body")) {
                            val content=String(Base64.decode(file.getString("body"),Base64.DEFAULT),Charsets.UTF_8)
                            Column { MarkdownContent.parse(content).blocks.forEach { MarkdownBlock(it) } }
                        }
                    }
                }
                items(value.optJSONArray("inputAttachments").objects()) { file -> AttachmentRow(file) { model.action { openNativeFile(context,repository,"/api/tasks/$id/input-files/${file.getString("sha256")}",file) } } }
                item { Text("进度",style=MaterialTheme.typography.titleLarge) }
                items(value.optJSONArray("events").objects().asReversed()) { event -> Column { Text(event.optString("at").replace('T',' ').take(16),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(event.optString("message"),Modifier.padding(top=8.dp));HorizontalDivider(Modifier.padding(top=16.dp)) } }
            }
        }
    }
    if(confirm!=null)AlertDialog(onDismissRequest={confirm=null},title={Text(if(confirm=="cancel")"取消此任务？" else "重新实测？")},confirmButton={TextButton(onClick={val verb=confirm!!;confirm=null;model.mutate(id,verb,if(verb=="trial-rerun")JSONObject().put("requestId",java.util.UUID.randomUUID().toString()) else JSONObject())}) { Text("确认") }},dismissButton={TextButton(onClick={confirm=null}) { Text("返回") }})
}
fun taskState(state: String)=when(state){"completed"->"已完成";"failed"->"失败";"waiting_action"->"需要处理";"awaiting_review"->"待审核";"queued"->"等待电脑";"cancelled"->"已取消";"uploading"->"上传中";else->"后台进行"}

@Composable fun BundlePage(repository: NestRepository,route: String,back: ()->Unit,open: (String)->Unit) {
    val model=model("bundle:$route") { PageModel(repository) };val status by model.status.collectAsStateWithLifecycle();val context=LocalContext.current
    var bundle by remember { mutableStateOf<JSONObject?>(null) };var file by rememberSaveable { mutableStateOf("") };var approve by remember { mutableStateOf(false) };var draftId by remember { mutableStateOf<String?>(null) }
    fun load() { model.action {
        if(route.endsWith("/draft")) {
            val task=repository.request("/api/state").optJSONArray("tasks").objects().firstOrNull { it.optString("id")==route.split('/')[3] }?:error("任务不存在")
            draftId=task.getString("draftId")
        }
        bundle=repository.request(route)
    } }
    LaunchedEffect(route) { load() }
    val files=bundle?.optJSONArray("files").objects();val texts=files.filter { it.optString("path").substringAfterLast('.').lowercase() in listOf("md","txt","srt","vtt","json","csv") }
    val selected=texts.firstOrNull { it.optString("path")==file }?:texts.firstOrNull { it.optString("role")=="summary" }?:texts.firstOrNull()
    val body=remember(selected?.toString()) { selected?.let { runCatching { String(Base64.decode(it.getString("body"),Base64.DEFAULT),Charsets.UTF_8) }.getOrDefault("") }?:"" }
    DetailScaffold("${bundle?.optJSONObject("meta")?.optString("title")?:"阅读结果"}",back,bottom={if(route.endsWith("/draft"))Button(onClick={approve=true},modifier=Modifier.fillMaxWidth().navigationBarsPadding().padding(20.dp)) { Text("确认归档") }}) { padding ->
        LazyColumn(Modifier.padding(padding).widthIn(max=720.dp),state=rememberLazyListState(),contentPadding=PaddingValues(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            status.error?.let { item { ErrorState(it){load()} } }
            if(texts.size>1)item { OptionMenu("文件",selected?.optString("path")?:"",texts.map { it.getString("path") to it.getString("path").substringAfterLast('/') }) { file=it } }
            items(MarkdownContent.parse(body).blocks) { MarkdownBlock(it) }
            items(files.filter { it !in texts }) { attachment -> AttachmentRow(attachment) { model.action {
                val target=withContext(Dispatchers.IO) {
                    val bytes=Base64.decode(attachment.getString("body"),Base64.DEFAULT)
                    val digest=java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
                    check(!attachment.has("sha256")||attachment.optString("sha256")==digest){"附件校验失败"}
                    check(!attachment.has("bytes")||attachment.getLong("bytes")==bytes.size.toLong()){ "附件大小不符" }
                    java.io.File(context.cacheDir,"native-files/$digest").apply { parentFile!!.mkdirs();writeBytes(bytes) }
                }
                openCachedFile(context,target,attachment.getString("path").substringAfterLast('/'),mimeFor(attachment.getString("path")))
            } } }
            items(bundle?.optJSONArray("inputAttachments").objects()) { attachment -> AttachmentRow(attachment) { model.action { val prefix=if(route.endsWith("/draft"))route.removeSuffix("/draft") else route;openNativeFile(context,repository,"$prefix/input-files/${attachment.getString("sha256")}",attachment) } } }
            items(bundle?.optJSONArray("linkedTrials").objects()) { trial -> TextButton(onClick={open("task:${trial.optString("id")}")}) { Text(trial.optString("title","实测报告")) } }
        }
    }
    if(approve)AlertDialog(onDismissRequest={approve=false},title={Text("确认归档当前结果？")},confirmButton={TextButton(onClick={approve=false;model.action { val expected=draftId?:error("请先载入完整结果");repository.request(route.removeSuffix("/draft")+"/approve","POST",JSONObject().put("draftId",expected));back() }}){Text("归档")}},dismissButton={TextButton(onClick={approve=false}){Text("返回阅读")}})
}
