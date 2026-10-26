@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package store.inspirai.library.nativeui
import store.inspirai.library.nativeui.plugins.*

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.design.*
import store.inspirai.library.nativeui.feature.*

@Composable inline fun <reified T: ViewModel> model(key: String,crossinline create: ()->T): T = viewModel(key=key,factory=object: ViewModelProvider.Factory {
    override fun <R: ViewModel> create(modelClass: Class<R>): R { @Suppress("UNCHECKED_CAST") return create() as R }
})
data class Destination(val key: String,val title: String)
private val roots=listOf(Destination("records","记录"),Destination("library","资料库"),Destination("tasks","任务"),Destination("account","我的"))

@Composable fun NativeApp(repository: NestRepository,ready: Boolean,migration: String,onRetryMigration: ()->Unit,
    onTheme: (String)->Unit,theme: String,initialIntent: Intent,onFinish: ()->Unit,onConnectionChanged: ()->Unit={}) {
    val context=LocalContext.current
    val pluginCatalog=remember(repository){PluginCatalog(repository,context)}
    LaunchedEffect(repository,ready){while(true){if(ready&&repository.credentials.isPaired())pluginCatalog.refresh();kotlinx.coroutines.delay(15000)}}
    val syncLifecycle=androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    val syncScope=rememberCoroutineScope()
    val focus=LocalFocusManager.current
    val keyboard=LocalSoftwareKeyboardController.current
    val shared=initialIntent.action in listOf(Intent.ACTION_SEND,Intent.ACTION_SEND_MULTIPLE)
    var tab by rememberSaveable { mutableStateOf(initialIntent.getStringExtra("tab").takeIf { key->roots.any { it.key==key } }?:"library") }
    val stack=rememberSaveable(saver=listSaver(save={it.toList()},restore={it.toMutableStateList()})) { mutableStateListOf<String>().apply {
        if(shared || initialIntent.hasExtra("draftId"))add("share:${initialIntent.getStringExtra("draftId")?:""}")
        else initialIntent.getStringExtra("route")?.takeIf { it.matches(Regex("(task|record|reader):[a-zA-Z0-9-]+|share:[a-f0-9-]{36}")) }?.let(::add)
    } }
    val route=stack.lastOrNull()
    var session by rememberSaveable { mutableStateOf(emptyList<String>()) };var sessionIndex by rememberSaveable { mutableIntStateOf(0) }
    var update by remember { mutableStateOf<store.inspirai.library.core.AppUpdate.Release?>(null) }
    LaunchedEffect(ready) {
        if(ready&&repository is AndroidNestRepository&&!store.inspirai.library.BuildConfig.DEBUG)runCatching {
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){store.inspirai.library.core.AppUpdate.check(repository.credentials.server())}
        }.getOrNull()?.takeIf { it.newerThan(store.inspirai.library.BuildConfig.VERSION_CODE.toLong()) }?.let { update=it }
    }
    fun finishInput() { focus.clearFocus(force=true);keyboard?.hide() }
    fun open(target: String) { finishInput();stack.add(target) }
    fun back() { finishInput();if(shared && stack.size==1 && stack.last().startsWith("share:")){onFinish();return};if(stack.isNotEmpty())stack.removeAt(stack.lastIndex) else onFinish() }
    fun selectRoot(target: String) { finishInput();tab=target;stack.clear() }
    BackHandler(stack.isNotEmpty()) { back() }
    val stateHolder=rememberSaveableStateHolder()
    val connection=repository.credentials.server()+":"+repository.credentials.deviceId()
    var syncAuthorized by remember(repository,connection,ready) { mutableStateOf(true) }
    LaunchedEffect(repository,connection,ready) {
        if(ready)syncLifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            kotlinx.coroutines.supervisorScope {
                launch { repository.recordSyncSignals.collect { if(syncAuthorized)try{repository.syncRecords()}catch(e: kotlinx.coroutines.CancellationException){throw e}catch(e: Exception){if(e is store.inspirai.library.core.Api.Failure&&e.status==401)syncAuthorized=false} } }
                launch { var failures=0
                    while(kotlinx.coroutines.currentCoroutineContext().isActive&&syncAuthorized){
                        try { repository.syncRecords();val live=repository.watchRecords();failures=0;if(!live)kotlinx.coroutines.delay(15000) }
                        catch(e: kotlinx.coroutines.CancellationException){throw e}
                        catch(e: Exception){if(e is store.inspirai.library.core.Api.Failure&&e.status==401)syncAuthorized=false else kotlinx.coroutines.delay((1000L shl failures.coerceAtMost(5)).coerceAtMost(30000));failures++}
                    }
                }
                launch { while(kotlinx.coroutines.currentCoroutineContext().isActive&&syncAuthorized){kotlinx.coroutines.delay(30000);if(syncAuthorized)try{repository.checkRecordSnapshot()}catch(e: kotlinx.coroutines.CancellationException){throw e}catch(e: Exception){if(e is store.inspirai.library.core.Api.Failure&&e.status==401)syncAuthorized=false}} }
            }
        }
    }
    DisposableEffect(repository,connection,ready) {
        val manager=context.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val callback=object: android.net.ConnectivityManager.NetworkCallback(){override fun onAvailable(network: android.net.Network){syncScope.launch{if(ready&&syncAuthorized&&syncLifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED))try{repository.syncRecords()}catch(e: kotlinx.coroutines.CancellationException){throw e}catch(e: Exception){if(e is store.inspirai.library.core.Api.Failure&&e.status==401)syncAuthorized=false}}}}
        manager.registerDefaultNetworkCallback(callback)
        onDispose { manager.unregisterNetworkCallback(callback) }
    }
    val library=model("library:$connection") { LibraryModel(repository) }
    val records=model("records:$connection") { RecordsModel(repository) }
    val tasks=model("tasks:$connection") { TaskModel(repository) }
    val account=model("account:$connection") { AccountModel(repository) }
    LaunchedEffect(tab,ready) {
        if(repository.credentials.isPaired()&&ready)when(tab) { "records"->records.refresh();"tasks"->tasks.refresh();"account"->account.refresh() }
    }
    CompositionLocalProvider(LocalPlugins provides pluginCatalog) {
    Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {
        if(!ready) {
            Column(Modifier.safeDrawingPadding().padding(24.dp),verticalArrangement=Arrangement.spacedBy(24.dp)) {
                Text("保留你的资料",style=MaterialTheme.typography.headlineLarge);Text(migration)
                if(migration.contains("未完成"))Button(onClick=onRetryMigration) { Text("重新导入") } else LinearProgressIndicator(Modifier.fillMaxWidth())
            };return@Surface
        }
        BoxWithConstraints {
            val rail=maxWidth>=600.dp;val dual=maxWidth>=840.dp && route!=null && !route.startsWith("share:") && !route.startsWith("edit:")
            @Composable fun RootPage() {
                stateHolder.SaveableStateProvider(tab) {
                    when(tab) {
                        "library"->LibraryPage(library,open={open("reader:$it")},collect={open("share:${java.util.UUID.randomUUID()}")},connect={open("pair")})
                        "records"->RecordsPage(records,open={open("record:$it")},create={open("edit:${java.util.UUID.randomUUID()}")},blocks={open("blocks")},learning={open("learning")},writing={if(pluginCatalog.enabled("writing"))context.startActivity(Intent(context,store.inspirai.library.CaptureActivity::class.java).putExtra("writing",true))})
                        "tasks"->TasksPage(tasks,open={open("task:$it")},create={open("share:${java.util.UUID.randomUUID()}")},startSession={ids->if(ids.isNotEmpty()){session=ids;sessionIndex=0;open("task:${ids.first()}")}})
                        else->AccountPage(account,theme,onTheme,::open)
                    }
                }
            }
            @Composable fun DetailPage(target: String) {
                stateHolder.SaveableStateProvider(target) {
                    when {
                        target.startsWith("reader:")->ReaderPage(repository,target.removePrefix("reader:"),{back()},onTheme,theme,::open)
                        target.startsWith("record:")->RecordPage(repository,records,target.removePrefix("record:"),{back()},::open)
                        target.startsWith("edit:")->RecordEditorPage(repository,target.removePrefix("edit:"),initialIntent.takeIf { shared },{back()},::open)
                        target.startsWith("share:")->SharePage(repository,target.removePrefix("share:"),initialIntent.takeIf { shared },onFinish={back()},open=::open)
                        target.startsWith("task:")->TaskPage(repository,target.removePrefix("task:"),{back()},::open,
                            next=if(session.getOrNull(sessionIndex)==target.removePrefix("task:"))({if(sessionIndex+1<session.size){sessionIndex++;stack[stack.lastIndex]="task:${session[sessionIndex]}"}else{session=emptyList();back()}}) else null,
                            sessionLabel=if(sessionIndex+1<session.size)"下一个 · ${sessionIndex+1} / ${session.size}" else "完成本轮处理")
                        target.startsWith("bundle:")->BundlePage(repository,target.removePrefix("bundle:"),{back()},::open)
                        target=="pair"->PairPage(repository,{back()},{onConnectionChanged();back()})
                        target=="outbox"->OutboxPage(repository,{back()},::open)
                        target=="devices" || target.startsWith("device:")->DevicesPage(account,target.removePrefix("device:").takeIf { target.startsWith("device:") },{back()},::open)
                        target=="learning"->LearningPage(repository,{back()})
                        target.startsWith("learn:")->LearningPage(repository,{back()},target.removePrefix("learn:"))
                        target=="blocks"->BlocksPage(repository,{back()})
                        target.startsWith("join:")->target.split(":",limit=3).let { args->BlocksPage(repository,{back()},args[1],args[2]) }
                        target=="plugins"->PluginsPage({back()})
                        target=="components"->ComponentGallery({back()})
                        else->AccountDetail(repository,target,{back()},onTheme,theme,::open)
                    }
                }
            }
            Row(Modifier.fillMaxSize()) {
                if(rail)NavigationRail(Modifier.safeDrawingPadding()) {
                    Spacer(Modifier.height(24.dp))
                    roots.forEachIndexed { index,item -> NavigationRailItem(selected=tab==item.key,onClick={selectRoot(item.key)},icon={RootIcon(index,item.title)},label={Text(item.title)}) }
                }
                Scaffold(Modifier.weight(1f),containerColor=MaterialTheme.colorScheme.background,
                    bottomBar={if(!rail && route==null)NavigationBar { roots.forEachIndexed { index,item -> NavigationBarItem(selected=tab==item.key,onClick={selectRoot(item.key)},icon={RootIcon(index,item.title)},label={Text(item.title)}) } }}) { padding ->
                    Row(Modifier.padding(padding).consumeWindowInsets(padding).fillMaxSize()) {
                        if(route==null || dual)Box(Modifier.weight(1f)) { RootPage() }
                        if(dual)VerticalDivider()
                        if(route!=null)Box(Modifier.weight(if(dual)1.3f else 1f)) { DetailPage(route) }
                    }
                }
            }
        }
    }
    update?.let { release->AlertDialog(onDismissRequest={update=null},title={Text("发现新版本 ${release.version}")},confirmButton={TextButton(onClick={update=null;open("update")}){Text("查看更新")}},dismissButton={TextButton(onClick={update=null}){Text("稍后")}}) }
}
}
@Composable private fun RootIcon(index: Int,label: String) {
    Icon(when(index) {0->Icons.Outlined.EditNote;1->Icons.Outlined.LocalLibrary;2->Icons.Outlined.Checklist;else->Icons.Outlined.PersonOutline},contentDescription=label)
}
@Composable fun ComponentGallery(back: ()->Unit) {
    DetailScaffold("组件",back) { padding -> Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("长标题与系统字体缩放",style=MaterialTheme.typography.headlineLarge)
        OutlinedTextField("",{},label={Text("搜索")});Button(onClick={}) { Text("主要操作") };AssistChip(onClick={},label={Text("待确认")})
        ErrorState("连接中断，资料已保存在手机"){};EmptyState("还没有资料","新建记录"){}
    } }
}
