@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package store.inspirai.library.nativeui.feature

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.json.JSONObject
import store.inspirai.library.nativeui.*
import store.inspirai.library.nativeui.content.*
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.design.*

@Composable fun LibraryPage(model: LibraryModel,open: (String)->Unit,collect: ()->Unit,connect: ()->Unit) {
    var query by rememberSaveable { mutableStateOf("") };var favoriteOnly by rememberSaveable { mutableStateOf(false) }
    var type by rememberSaveable { mutableStateOf("") };var status by rememberSaveable { mutableStateOf("") };var tag by rememberSaveable { mutableStateOf("") };var sort by rememberSaveable { mutableStateOf("collected_desc") }
    var filters by rememberSaveable { mutableStateOf(false) }
    val entries by model.entries.collectAsStateWithLifecycle();val progress by model.status.collectAsStateWithLifecycle()
    val favorites by model.repository.dao.favorites(model.repository.credentials.server()).collectAsStateWithLifecycle(emptyList())
    val scope=rememberCoroutineScope()
    LaunchedEffect(query) { kotlinx.coroutines.delay(300);if(model.repository.credentials.isPaired())model.refresh(query) }
    val items=remember(entries,favoriteOnly,favorites,type,status,tag,sort) {
        val selected=entries.filter { (!favoriteOnly || it.optString("id") in favorites) && (type.isEmpty() || it.optString("type")==type) && (status.isEmpty()||it.optString("status")==status) && (tag.isEmpty()||it.optJSONArray("tags")?.let { a->(0 until a.length()).any { i->a.optString(i)==tag } }==true) }
        LibrarySelection.sorted(selected,sort)
    }
    val list=rememberLazyListState()
    Column(Modifier.fillMaxSize().padding(horizontal=NestSpace.page)) {
        NestPageHeader("资料库") {
            IconButton(onClick={model.refresh(query)}) { Icon(Icons.Outlined.Refresh,"刷新资料库") }
            IconButton(onClick=collect) { Icon(Icons.Outlined.Add,"新建采集") }
        }
        NestSearch(query,"搜索资料"){query=it}
        Row(Modifier.fillMaxWidth().padding(vertical=12.dp),verticalAlignment=Alignment.CenterVertically) {
            SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                listOf("全部","收藏").forEachIndexed { i,label -> SegmentedButton(selected=favoriteOnly==(i==1),onClick={favoriteOnly=i==1},shape=SegmentedButtonDefaults.itemShape(i,2)) { Text(label) } }
            }
            IconButton(onClick={filters=true}) { Icon(Icons.Outlined.Tune,"筛选与排序") }
        }
        if(!model.repository.credentials.isPaired()) { EmptyState("连接资料空间后查看资料","扫码连接",connect);return@Column }
        progress.error?.let { ErrorState(it) { model.refresh(query) } }
        if(progress.loading)LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(state=list,verticalArrangement=Arrangement.spacedBy(0.dp),contentPadding=PaddingValues(bottom=24.dp)) {
            if(items.isEmpty()&&!progress.loading)item { EmptyState(if(query.isBlank())"还没有资料" else "没有匹配的资料") }
            items(items,key={it.getString("id")}) { item ->
                Column(Modifier.fillMaxWidth().clickable { open(item.getString("id")) }.padding(vertical=20.dp)) {
                    Text(item.optString("title","未命名资料"),style=MaterialTheme.typography.titleMedium,maxLines=3,overflow=TextOverflow.Ellipsis)
                    val summary=item.optString("summary").takeUnless { it=="null" }?:""
                    if(summary.isNotBlank())Text(summary,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2,overflow=TextOverflow.Ellipsis,modifier=Modifier.padding(top=8.dp))
                    Text(listOf(item.optString("platform"),item.optString("collected_at").take(10),if(item.optString("status")=="archived")"" else "待补齐").filter { it.isNotBlank()&&it!="null" }.joinToString(" · "),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(top=10.dp))
                };HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
    if(filters)ModalBottomSheet(onDismissRequest={filters=false}) {
        Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text("筛选与排序",style=MaterialTheme.typography.titleLarge)
            OptionMenu("类型",type,listOf("" to "全部")+entries.map { it.optString("type") }.filter { it.isNotBlank() }.distinct().map { it to LibrarySelection.typeLabel(it) }){type=it}
            OptionMenu("完整度",status,listOf("" to "全部","archived" to "已归档","partial" to "待补齐","pending" to "待处理")){status=it}
            OptionMenu("标签",tag,listOf("" to "全部")+entries.flatMap { it.optJSONArray("tags")?.let { a->(0 until a.length()).map { i->a.optString(i) } }?:emptyList() }.distinct().map { it to it }){tag=it}
            OptionMenu("排序",sort,listOf("collected_desc" to "最近采集","collected_asc" to "最早采集","title" to "标题")){sort=it}
            Button(onClick={filters=false},Modifier.fillMaxWidth()) { Text("完成") }
        }
    }
}
@Composable fun ReaderPage(repository: NestRepository,id: String,back: ()->Unit,themeChange: (String)->Unit,theme: String,open: (String)->Unit) {
    val model=model("reader:$id") { ReaderModel(repository) };val entry by model.entry.collectAsStateWithLifecycle();val text by model.body.collectAsStateWithLifecycle();val state by model.status.collectAsStateWithLifecycle()
    val favorites by repository.dao.favorites(repository.credentials.server()).collectAsStateWithLifecycle(emptyList())
    var file by rememberSaveable { mutableStateOf<String?>(null) };var more by remember { mutableStateOf(false) };var panel by rememberSaveable { mutableStateOf("") }
    val content=remember(text){MarkdownContent.parse(text)};val list=rememberLazyListState();val scope=rememberCoroutineScope();val context=LocalContext.current
    LaunchedEffect(id,file) { model.load(id,file) }
    DetailScaffold("",back,actions={
        IconButton(onClick={scope.launch { if(id in favorites)repository.dao.unfavorite(repository.credentials.server(),id) else repository.dao.favorite(Favorite(repository.credentials.server(),id)) }}) { Icon(if(id in favorites)Icons.Outlined.Bookmark else Icons.Outlined.BookmarkBorder,"收藏") }
        Box { IconButton(onClick={more=true}) { Icon(Icons.Outlined.MoreHoriz,"更多") };DropdownMenu(more,{more=false}) {
            listOf("大纲" to "outline","文件与附件" to "files","归档信息" to "info","外观" to "theme").forEach { (label,key)->DropdownMenuItem(text={Text(label)},onClick={panel=key;more=false}) }
        } }
    }) { padding ->
        Column(Modifier.padding(padding).widthIn(max=NestSpace.reader).fillMaxWidth()) {
            state.error?.let { ErrorState(it){model.load(id,file)} };if(state.loading)LinearProgressIndicator(Modifier.fillMaxWidth())
            LazyColumn(state=list,contentPadding=PaddingValues(horizontal=24.dp,vertical=16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                item("title") {
                    Text(entry?.optString("title")?:"",style=MaterialTheme.typography.headlineLarge)
                    val metadata=listOfNotNull(entry?.optString("platform"),entry?.optString("published_at")?.take(10)).filter { it.isNotBlank()&&it!="null" }.joinToString(" · ")
                    if(metadata.isNotBlank())Text(metadata,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(top=12.dp,bottom=16.dp))
                }
                itemsIndexed(content.blocks) { _,block ->
                    CompositionLocalProvider(LocalMarkdownImage provides { destination,alt->
                        ReaderImage(repository,id,documentImage(entry?.optJSONArray("files").objects(),file?:entry?.optJSONArray("files").objects().firstOrNull { it.optString("role")=="summary" }?.optString("path"),destination),alt)
                    }) { SelectionContainer { MarkdownBlock(block) } }
                }
            }
        }
    }
    var relatedTrials by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    LaunchedEffect(panel,entry?.optString("archive_id")) {
        if(panel=="info" && entry!=null)model.action {
            relatedTrials=repository.request("/api/state").optJSONArray("tasks").objects().filter { it.optJSONObject("trial")?.optString("sourceArchiveId")==entry!!.optString("archive_id") }
        }
    }
    if(panel.isNotEmpty())ModalBottomSheet(onDismissRequest={panel=""}) {
        LazyColumn(Modifier.padding(horizontal=NestSpace.page),contentPadding=PaddingValues(bottom=24.dp)) {
            item { Text(when(panel){"outline"->"大纲";"files"->"文件与附件";"theme"->"外观";else->"归档信息"},style=MaterialTheme.typography.titleLarge) }
            when(panel) {
                "outline"->items(content.headings) { heading -> TextButton(onClick={panel="";scope.launch { list.scrollToItem(heading.index+1) }}) { Text(heading.title) } }
                "files"->{items(entry?.optJSONArray("files").objects()) { attachment ->
                    val path=attachment.getString("path")
                    ListItem(headlineContent={Text(path.substringAfterLast('/'))},supportingContent={Text(attachment.optString("role"))},modifier=Modifier.clickable {
                        if(path.substringAfterLast('.').lowercase() in listOf("md","txt","srt","vtt","csv","json")) { file=path;panel="" }
                        else model.action { openNativeFile(context,repository,"/api/read/v1/file?id=${encoded(id)}&file=${encoded(path)}",attachment) }
                    })
                }
                    items(entry?.optJSONArray("inputAttachments").objects()) { attachment ->
                        AttachmentRow(attachment) { model.action {
                            val archive=entry?.getString("archive_id")?:error("归档信息尚未载入")
                            openNativeFile(context,repository,"/api/archives/$archive/input-files/${attachment.getString("sha256")}",attachment)
                        } }
                    }
                }
                "theme"->item { ThemeChoices(theme,themeChange) }
                else->item { entry?.let { info ->
                    listOf("source_url","collected_at","organized_at","status","verification_status","coverage_note").forEach { key -> val value=info.optString(key);if(value.isNotBlank()&&value!="null")SelectionContainer { Text(value,Modifier.padding(vertical=12.dp)) } }
                    (info.optJSONArray("linkedTrials").objects()+relatedTrials).distinctBy { it.optString("id") }.forEach { trial->TextButton(onClick={panel="";open("task:${trial.optString("id")}")}) { Text(trial.optString("title","Codex 实测")) } }
                } }
            }
        }
    }
}
