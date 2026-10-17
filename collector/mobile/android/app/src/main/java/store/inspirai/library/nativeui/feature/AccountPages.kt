package store.inspirai.library.nativeui.feature

import android.content.Intent
import android.net.Uri
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.*
import org.json.*
import store.inspirai.library.*
import store.inspirai.library.core.*
import store.inspirai.library.nativeui.*
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.design.*

@Composable fun AccountPage(model: AccountModel,theme: String,themeChange: (String)->Unit,open: (String)->Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        NestPageHeader("我的")
        ListItem(headlineContent={Text(if(model.repository.credentials.isPaired())"资料空间" else "连接资料空间")},supportingContent={Text(model.repository.credentials.server())},trailingContent={Icon(Icons.Outlined.ChevronRight,null)},modifier=Modifier.clickable { open("pair") })
        listOf("记录同步" to "sync","发件箱" to "outbox","授权设备" to "devices","Agent 管理" to "agents","扫码连接" to "pair","外观" to "theme","应用更新" to "update").forEach { (label,target) ->
            ListItem(headlineContent={Text(label)},trailingContent={Icon(Icons.Outlined.ChevronRight,null)},modifier=Modifier.clickable { open(target) });HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
        }
        if(BuildConfig.DEBUG)TextButton(onClick={open("components")}) { Text("组件展示") }
        if(model.repository.credentials.isPaired())TextButton(onClick={open("logout")}) { Text("退出登录") }
    }
}
@Composable fun ThemeChoices(theme: String,change: (String)->Unit) {
    Column { listOf("system" to "跟随系统","light" to "日间","dark" to "夜间").forEach { (mode,title)->
        Row(Modifier.fillMaxWidth().clickable { change(mode) }.heightIn(min=56.dp),verticalAlignment=Alignment.CenterVertically) { RadioButton(theme==mode,{change(mode)});Text(title) }
    } }
}
@Composable fun PairPage(repository: NestRepository,back: ()->Unit,connected: ()->Unit=back) {
    val context=LocalContext.current;val model=model("pair") { PageModel(repository) };val state by model.status.collectAsStateWithLifecycle()
    var server by rememberSaveable { mutableStateOf(repository.credentials.server()) };var key by remember { mutableStateOf("") }
    var manual by rememberSaveable { mutableStateOf(false) };var scanned by remember { mutableStateOf<PairingCode?>(null) }
    var factor by remember { mutableStateOf("") };var recovery by rememberSaveable { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { key="";factor="";scanned=null } }
    val scanner=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val raw=result.data?.getStringExtra("pairingCode");if(raw!=null)model.action { scanned=PairingCode.parse(raw);server=scanned!!.server;key=scanned!!.key }
    }
    fun pair() { model.action {
        val response=withContext(Dispatchers.IO){Api.pair(context,Credentials.normalizeServer(server),key,android.os.Build.MODEL,factor.takeIf { !recovery&&it.isNotBlank() },factor.takeIf { recovery&&it.isNotBlank() })}
        val device=response.getJSONObject("device");check(device.optString("role")=="owner") { "配对角色不支持" }
        withContext(Dispatchers.IO){repository.credentials.save(server,response.getString("token"),device.getString("id"))}
        QueueJob.schedule(context)
        key="";factor="";scanned=null;android.webkit.CookieManager.getInstance().removeAllCookies(null);connected()
    } }
    DetailScaffold("连接资料空间",back) { padding ->
        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(24.dp).imePadding(),verticalArrangement=Arrangement.spacedBy(24.dp)) {
            Text("让资料随身",style=MaterialTheme.typography.headlineLarge)
            state.error?.let { ErrorState(it){pair()} }
            Button(onClick={scanner.launch(Intent(context,ScanPairingActivity::class.java))},modifier=Modifier.fillMaxWidth()) { Icon(Icons.Outlined.QrCodeScanner,null);Spacer(Modifier.width(12.dp));Text("扫描配对二维码") }
            TextButton(onClick={manual=!manual}) { Text("手动输入配对码") }
            if(manual || scanned!=null) {
                OutlinedTextField(server,{server=it},Modifier.fillMaxWidth(),label={Text("服务器")},singleLine=true,readOnly=scanned!=null)
                if(scanned==null)OutlinedTextField(key,{key=it},Modifier.fillMaxWidth(),label={Text("配对码")},visualTransformation=PasswordVisualTransformation(),singleLine=true)
                OutlinedTextField(factor,{factor=it},Modifier.fillMaxWidth(),label={Text(if(recovery)"恢复码（如已启用）" else "动态验证码（如已启用）")},visualTransformation=PasswordVisualTransformation(),singleLine=true)
                TextButton(onClick={recovery=!recovery;factor=""}) { Text(if(recovery)"使用动态验证码" else "使用恢复码") }
                Button(onClick={pair()},enabled=key.isNotBlank()&&!state.loading,modifier=Modifier.fillMaxWidth()) { Text("确认连接") }
            }
        }
    }
}
@Composable fun DevicesPage(model: AccountModel,id: String?,back: ()->Unit,open: (String)->Unit) {
    val state by model.state.collectAsStateWithLifecycle();val status by model.status.collectAsStateWithLifecycle();var revoke by remember { mutableStateOf(false) }
    LaunchedEffect(id) { model.refresh() }
    val rows=state.optJSONArray("devices").objects().filter { if(id==null)it.isNull("revokedAt") else it.optString("id")==id }
    DetailScaffold(if(id==null)"授权设备" else "设备详情",back,actions={IconButton(onClick={model.refresh()}) { Icon(Icons.Outlined.Refresh,"刷新") }}) { padding ->
        LazyColumn(Modifier.padding(padding),contentPadding=PaddingValues(NestSpace.page),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            status.error?.let { item { ErrorState(it){model.refresh()} } }
            items(rows,key={it.getString("id")}) { item ->
                Column(Modifier.fillMaxWidth().then(if(id==null)Modifier.clickable { open("device:${item.getString("id")}") } else Modifier).padding(vertical=12.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    Text(item.optString("displayName",item.optString("name")),style=MaterialTheme.typography.titleLarge)
                    Text(DevicePresentation.status(item),color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(item.optString("lastSeen"))
                    if(id!=null) {
                        Text("授权时间 ${item.optString("createdAt")}")
                        item.optJSONObject("deviceInfo")?.optString("model")?.let { Text(it) }
                        if(DevicePresentation.dispatchable(item))OutlinedButton(onClick={open("agents:$id")}) { Text("Agent 环境") }
                        if(DevicePresentation.dispatchable(item))OutlinedButton(onClick={open("skills:$id")}) { Text("节点技能") }
                        TextButton(onClick={revoke=true}) { Text("撤销设备") }
                    }
                };HorizontalDivider()
            }
        }
    }
    if(revoke)AlertDialog(onDismissRequest={revoke=false},title={Text("撤销此设备？")},confirmButton={TextButton(onClick={revoke=false;model.action { model.repository.request("/api/devices/${encoded(id!!)}/revoke","POST",JSONObject());back() }}) { Text("撤销") }},dismissButton={TextButton(onClick={revoke=false}) { Text("取消") }})
}
@Composable fun OutboxPage(repository: NestRepository,back: ()->Unit,open: (String)->Unit) {
    val context=LocalContext.current;val model=model("outbox") { PageModel(repository) };val state by model.status.collectAsStateWithLifecycle()
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) };var drafts by remember { mutableStateOf<List<JSONObject>>(emptyList()) };var remove by remember { mutableStateOf<String?>(null) }
    fun load() { model.action { withContext(Dispatchers.IO){rows=Outbox(context).list().objects();drafts=Drafts(context).list().objects()} } }
    LaunchedEffect(Unit){load()}
    VisiblePoll("outbox",2000){if(!state.loading)load()}
    DetailScaffold("发件箱",back,actions={IconButton(onClick={load()}){Icon(Icons.Outlined.Refresh,"刷新发件箱")}}) { padding ->
        LazyColumn(Modifier.padding(padding),contentPadding=PaddingValues(NestSpace.page),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            state.error?.let { item { ErrorState(it){load()} } }
            if(rows.isEmpty()&&drafts.isEmpty())item { EmptyState("没有待提交内容") }
            items(drafts,key={"draft:"+it.getString("id")}) { draft->ListItem(headlineContent={Text(InputFiles.title(draft))},supportingContent={Text("草稿")},modifier=Modifier.clickable { open("share:${draft.getString("id")}") }) }
            items(rows,key={it.getString("id")}) { row ->
                Column { Text(InputFiles.title(row.getJSONObject("payload")),style=MaterialTheme.typography.titleMedium);Text(if(row.optString("state")=="sent")"已提交" else row.optString("error","等待提交"))
                    val progress=InputFiles.progressText(row.optJSONObject("progress")?:JSONObject());if(progress.isNotBlank())Text(progress)
                    if(row.optString("state")!="sent")TextButton(onClick={model.action { withContext(Dispatchers.IO){Outbox(context).retry(row.getString("id"));QueueJob.schedule(context);Outbox.flush(context)};load() }}){Text("重试")}
                    TextButton(onClick={remove=row.getString("id")}){Text("移除")};HorizontalDivider()
                }
            }
        }
    }
    if(remove!=null)AlertDialog(onDismissRequest={remove=null},title={Text("从发件箱移除此项？")},confirmButton={TextButton(onClick={val id=remove!!;remove=null;model.action { withContext(Dispatchers.IO){Outbox(context).remove(id)};load() }}) { Text("移除") }},dismissButton={TextButton(onClick={remove=null}){Text("保留")}})
}
@Composable fun AccountDetail(repository: NestRepository,route: String,back: ()->Unit,onTheme: (String)->Unit,theme: String,open: (String)->Unit) {
    when {
        route=="theme"->DetailScaffold("外观",back) { padding->Column(Modifier.padding(padding).padding(20.dp)){ThemeChoices(theme,onTheme)} }
        route=="update"->UpdatePage(repository,back)
        route=="record-trash"->RecordTrashPage(repository,back,open)
        route=="sync"->{
            val model=model("sync") { RecordsModel(repository) };val rows by model.rows.collectAsStateWithLifecycle();val status by model.status.collectAsStateWithLifecycle()
            val context=LocalContext.current;var recovery by remember { mutableStateOf<List<MigrationLog>>(emptyList()) };var imported by remember { mutableStateOf<JSONObject?>(null) };val syncLog by repository.dao.observeJournal("record-sync:${repository.credentials.server()}:${repository.credentials.deviceId()}").collectAsStateWithLifecycle(null);val checked=syncLog?.let{JSONObject(it.json).optString("checkedAt")}?:""
            fun recover() { model.action { RecordAudioStore.recover(context,repository);recovery=repository.dao.journals("audio-recovery:%");imported=repository.dao.journal("records-v1-report")?.let { JSONObject(it.json) } } }
            LaunchedEffect(Unit){recover()}

            DetailScaffold("记录同步",back) { padding->LazyColumn(Modifier.padding(padding),contentPadding=PaddingValues(NestSpace.page)) {
                status.error?.let { item { ErrorState(it){model.refresh()} } }
                item { if(checked.isNotBlank())Text("最近同步 ${runCatching{java.time.Instant.parse(checked).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))}.getOrDefault(checked)}");Button(onClick={model.refresh()}){Text("立即同步")};TextButton(onClick={open("record-trash")}){Text("回收站")} }
                items(rows.filter{it.server==repository.credentials.server()&&JSONObject(it.json).optJSONArray("recoveryDrafts").objects().isNotEmpty()},key={"recovery:"+it.id}){row->ListItem(headlineContent={Text(JSONObject(row.json).optString("text").take(100))},supportingContent={Text("恢复草稿")},modifier=Modifier.clickable{open("edit:${row.id}")})}
                imported?.let { report->item { Text("历史资料导入",style=MaterialTheme.typography.titleMedium);Text("${report.optInt("records")} 条记录 · ${report.optInt("files")} 个附件 · ${report.optLong("bytes")/1024} KB");Text("大小与 SHA-256 已核对",style=MaterialTheme.typography.bodyMedium) } }
                items(recovery) { row->val info=JSONObject(row.json)
                    val path=info.optString("originalPath").ifEmpty { runCatching { JSONObject(java.io.File(info.getString("path")).readText()).getString("path") }.getOrDefault("") }
                    ListItem(headlineContent={Text("未完成的录音")},supportingContent={Text(info.optString("error"))},modifier=Modifier.clickable { if(path.isNotBlank())openCachedFile(context,java.io.File(path),java.io.File(path).name,"audio/mp4") })
                }
                if(recovery.isNotEmpty())item { OutlinedButton(onClick={recover()}){Text("重新读取录音片段")} }
                items(rows.filter { it.server==repository.credentials.server() && JSONObject(it.json).let{value->value.isNull("deletedAt")&&value.optString("sync")!="synced"} }) { row -> val value=JSONObject(row.json);ListItem(headlineContent={Text(value.optString("text").take(100))},supportingContent={Text(syncLabel(value.optString("sync")))},modifier=Modifier.clickable { open("record:${row.id}") }) }
            } }
        }
        route.startsWith("agents")->AgentsPage(repository,route.substringAfter(':',""),back,open)
        route.startsWith("skills:")->SkillsPage(repository,route.substringAfter(':'),back)
        route=="logout"->{
            val model=model("logout") { PageModel(repository) };val status by model.status.collectAsStateWithLifecycle()
            DetailScaffold("退出登录",back) { padding->Column(Modifier.padding(padding).padding(24.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
                Text("退出当前资料空间？",style=MaterialTheme.typography.titleLarge)
                status.error?.let { ErrorState(it){} }
                Button(onClick={model.action { withContext(Dispatchers.IO){repository.credentials.clear()};android.webkit.CookieManager.getInstance().removeAllCookies(null);back() }}) { Text("退出登录") }
            } }
        }
    }
}
@Composable private fun AgentsPage(repository: NestRepository,device: String,back: ()->Unit,open: (String)->Unit) {
    val model=model("agents:$device") { PageModel(repository) };val status by model.status.collectAsStateWithLifecycle()
    var devices by remember { mutableStateOf<List<JSONObject>>(emptyList()) };var agents by remember { mutableStateOf<List<JSONObject>>(emptyList()) };var operations by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var selected by remember { mutableStateOf<JSONObject?>(null) };var method by remember { mutableStateOf("managed") };var catalog by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    fun load() { model.action {
        if(device.isEmpty())devices=repository.request("/api/state").optJSONArray("devices").objects().filter { DevicePresentation.dispatchable(it) }
        else { agents=repository.request("/api/agents/devices/${encoded(device)}/environment").optJSONArray("agents").objects();operations=repository.request("/api/agents/operations?deviceId=${encoded(device)}").optJSONArray("operations").objects();catalog=repository.request("/api/agents/catalog").optJSONArray("agents").objects() }
    } }
    LaunchedEffect(device){load()}
    VisiblePoll("agents:$device",5000){if(!status.loading&&selected==null)load()}
    DetailScaffold("Agent 管理",back,actions={IconButton(onClick={load()}){Icon(Icons.Outlined.Refresh,"刷新 Agent 环境")}}) { padding ->
        LazyColumn(Modifier.padding(padding),contentPadding=PaddingValues(NestSpace.page),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            status.error?.let { item { ErrorState(it){load()} } }
            if(device.isNotEmpty())item {
                val operation=operations.firstOrNull { it.optString("action")=="refresh"&&it.optString("state") in listOf("queued","running","cancel_requested") }
                OutlinedButton(enabled=!status.loading,onClick={model.action {
                    if(operation!=null)repository.request("/api/agents/operations/${operation.getString("id")}/cancel","POST",JSONObject())
                    else repository.request("/api/agents/operations","POST",JSONObject().put("deviceId",device).put("requestId",java.util.UUID.randomUUID().toString()).put("action","refresh"))
                    load()
                }}) { Text(if(operation==null)"重新检测环境" else "取消检测") }
            }
            items(devices) { node -> ListItem(headlineContent={Text(node.optString("name"))},supportingContent={Text(DevicePresentation.status(node))},modifier=Modifier.clickable { open("agents:${node.getString("id")}") }) }
            items(agents) { agent ->
                Column { Text(agent.optString("name",agent.optString("id")),style=MaterialTheme.typography.titleLarge);Text(agent.optString("version","未安装"))
                    val operation=operations.firstOrNull { it.optString("agent")==agent.optString("id") && it.optString("state") in listOf("queued","running","cancel_requested") }
                    if(operation!=null)TextButton(onClick={model.action { repository.request("/api/agents/operations/${operation.getString("id")}/cancel","POST",JSONObject());load() }}){Text("取消${taskState(operation.optString("state"))}")}
                    else if(!agent.optBoolean("custom") && catalog.any { it.optString("id")==agent.optString("id") && it.optJSONObject("release")!=null })OutlinedButton(onClick={selected=agent}){Text(if(agent.optBoolean("installed"))"更新" else "安装")}
                };HorizontalDivider()
            }
        }
    }
    if(selected!=null)AlertDialog(onDismissRequest={selected=null},title={Text(selected!!.optString("id"))},text={Column { val release=catalog.firstOrNull { it.optString("id")==selected!!.optString("id") }?.optJSONObject("release");Text("目标版本 ${release?.optString("version")}");OptionMenu("安装方式",method,listOf("managed" to "灵藏托管")+if(selected!!.optBoolean("originalSupported"))listOf("original" to "原有安装") else emptyList()){method=it} }},confirmButton={TextButton(onClick={val agent=selected!!;selected=null;model.action { repository.request("/api/agents/operations","POST",JSONObject().put("deviceId",device).put("requestId",java.util.UUID.randomUUID().toString()).put("action",if(agent.optBoolean("installed"))"update" else "install").put("agent",agent.getString("id")).put("method",method).put("expectedFingerprint",agent.getString("fingerprint")));load() }}){Text("确认")}},dismissButton={TextButton(onClick={selected=null}){Text("取消")}})
}
@Composable private fun SkillsPage(repository: NestRepository,device: String,back: ()->Unit) {
    val model=model("skills:$device"){PageModel(repository)};val status by model.status.collectAsStateWithLifecycle()
    var skills by remember { mutableStateOf<List<JSONObject>>(emptyList()) };var scanned by remember { mutableStateOf("") }
    fun load() { model.action {
        val all=mutableListOf<JSONObject>();var offset=0;var snapshot: String?=null
        do {
            val page=repository.request("/api/skills/devices/${encoded(device)}/environment?offset=$offset${snapshot?.let { "&snapshotId=${encoded(it)}" }?:""}")
            all+=page.optJSONArray("items").objects();snapshot=page.optString("snapshotId").takeIf { it!="null"&&it.isNotEmpty() };scanned=page.optString("scannedAt")
            val next=if(page.isNull("nextOffset"))-1 else page.getInt("nextOffset");check(next<0||next>offset){"技能分页无效，请重新加载"};offset=next
        }while(offset>=0)
        skills=all
    } }
    LaunchedEffect(device){load()}
    DetailScaffold("节点技能",back,actions={IconButton(onClick={load()}){Icon(Icons.Outlined.Refresh,"刷新技能清单")}}) { padding->
        LazyColumn(Modifier.padding(padding),contentPadding=PaddingValues(NestSpace.page),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            status.error?.let { item{ErrorState(it){load()}} };if(status.loading)item{LinearProgressIndicator(Modifier.fillMaxWidth())}
            if(scanned.isNotBlank()&&scanned!="null")item { Text(scanned,color=MaterialTheme.colorScheme.onSurfaceVariant) }
            if(skills.isEmpty()&&!status.loading)item { EmptyState("此节点尚未上报技能","重新加载"){load()} }
            items(skills) { skill->Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text(skill.optString("name"),style=MaterialTheme.typography.titleMedium)
                Text(listOf(skill.optString("agent"),skill.optString("source"),when(skill.optString("loadState")){"loaded"->"可加载";"configured"->"已配置";"disabled"->"已禁用";"not_loaded"->"未加载";"shadowed"->"被覆盖";"agent_unavailable"->"Agent 未安装";else->"加载未确认"}).filter { it.isNotBlank() }.joinToString(" · "))
                skill.optString("issue").takeIf { it.isNotBlank()&&it!="null" }?.let { Text(it,color=MaterialTheme.colorScheme.error) }
                val dependencies=skill.optJSONObject("dependencies");listOf("missing","unknown").forEach { key->dependencies?.optJSONArray(key)?.let { values->for(i in 0 until values.length())Text(values.getString(i)) } }
            };HorizontalDivider() }
        }
    }
}
@Composable private fun UpdatePage(repository: NestRepository,back: ()->Unit) {
    val context=LocalContext.current;val model=model("update") { PageModel(repository) };val status by model.status.collectAsStateWithLifecycle()
    var release by remember { mutableStateOf<AppUpdate.Release?>(null) };var progress by remember { mutableIntStateOf(0) };var ready by remember { mutableStateOf(false) }
    val settings=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { }
    fun check() { model.action { release=withContext(Dispatchers.IO){AppUpdate.check(repository.credentials.server())} } }
    LaunchedEffect(Unit){check()}
    DetailScaffold("应用更新",back) { padding -> Column(Modifier.padding(padding).padding(24.dp),verticalArrangement=Arrangement.spacedBy(24.dp)) {
        Text("灵藏 ${BuildConfig.VERSION_NAME}",style=MaterialTheme.typography.headlineLarge)
        status.error?.let { ErrorState(it){check()} }
        release?.let { current ->
            Text(if(current.newerThan(BuildConfig.VERSION_CODE.toLong()))"新版本 ${current.version}" else "当前已是最新版本")
            if(current.newerThan(BuildConfig.VERSION_CODE.toLong()))Button(enabled=!status.loading,onClick={model.action {
                if(!ready) { withContext(Dispatchers.IO){AppUpdate.download(context,current){progress=it}};ready=true }
                withContext(Dispatchers.IO){AppUpdate.verify(context,current,AppUpdate.file(context,current))}
                if(!context.packageManager.canRequestPackageInstalls())settings.launch(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${context.packageName}")))
                else { val uri=androidx.core.content.FileProvider.getUriForFile(context,"${context.packageName}.updates",AppUpdate.file(context,current));context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
            }}){Text(if(ready)"安装更新" else "下载并安装")}
        }
        if(status.loading)LinearProgressIndicator(progress={progress/100f},modifier=Modifier.fillMaxWidth())
        OutlinedButton(onClick={check()},enabled=!status.loading){Text("检查更新")}
    } }
}
