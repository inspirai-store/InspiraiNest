package store.inspirai.library.nativeui.feature

import android.util.Base64
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.widget.VideoView
import android.widget.MediaController
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.util.UUID
import store.inspirai.library.nativeui.data.NestRepository
import store.inspirai.library.nativeui.data.objects
import store.inspirai.library.nativeui.content.*
import store.inspirai.library.nativeui.design.*

val learningMasteryLabels=linkedMapOf("pending" to "待学","learning" to "学习中","review" to "待复习","mastered" to "已掌握")

@Composable fun LearningPage(repository:NestRepository,back:()->Unit,initialSource:String?=null) {
 val scope=rememberCoroutineScope();val identity=repository.credentials.snapshot()?.generation
 var goals by remember(identity){mutableStateOf(emptyList<JSONObject>())};var candidates by remember(identity){mutableStateOf(emptyList<JSONObject>())};var sources by remember(identity){mutableStateOf(emptyList<JSONObject>())}
 var goal by remember(identity){mutableStateOf<JSONObject?>(null)};var nodeID by remember(identity){mutableStateOf<String?>(null)}
 var text by remember(identity){mutableStateOf("")};var title by remember(identity){mutableStateOf("")};var selectedSource by remember(identity){mutableStateOf(initialSource?:"")}
 var notes by remember(identity,nodeID){mutableStateOf("")};var answer by remember(identity,nodeID){mutableStateOf("")};var question by remember(identity,nodeID){mutableStateOf("")};var notesRevision by remember(identity,nodeID){mutableStateOf<Int?>(null)};var attemptID by remember(identity,nodeID){mutableStateOf(UUID.randomUUID().toString())};var intakeID by remember(identity){mutableStateOf(UUID.randomUUID().toString())}
 var error by remember(identity){mutableStateOf("")};var busy by remember(identity){mutableStateOf(false)};var artifact by remember(identity,nodeID){mutableStateOf<Pair<JSONObject,ByteArray>?>(null)}
 suspend fun load() {
  val index=repository.request("/api/learning");val materials=repository.request("/api/learning/sources");check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"}
  goals=index.optJSONArray("goals").objects();candidates=index.optJSONArray("candidates").objects().filter{it.optString("state")=="pending"};sources=materials.optJSONArray("items").objects()
  goal?.let{current->val result=repository.request("/api/learning/goals/"+current.getString("id"));check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};goal=result}
 }
 fun perform(work:suspend ()->Unit) {scope.launch {busy=true;try{check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};work();check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};error=""}catch(e:kotlinx.coroutines.CancellationException){throw e}catch(e:Exception){if(repository.credentials.snapshot()?.generation==identity)error=e.message?:"新知操作失败"}finally{if(repository.credentials.snapshot()?.generation==identity)busy=false}}}
 fun mutate(action:String,input:JSONObject) {val current=goal?:return;perform {input.put("revision",if(input.has("notes"))notesRevision?:current.getInt("revision") else current.getInt("revision")).put("nodeId",nodeID);repository.request("/api/learning/goals/"+current.getString("id")+"/"+action,"POST",input);if(input.has("notes"))notesRevision=null;load()}}
 LaunchedEffect(identity){perform{load()}}
 val nodes=goal?.optJSONArray("nodes").objects();val node=nodes.firstOrNull{it.optString("id")==nodeID}
 LaunchedEffect(nodeID){notes=node?.optString("notes")?:"";question=node?.optJSONArray("recall")?.optString(0)?:"";artifact=null}
 DetailScaffold(node?.optString("title")?:goal?.optString("title")?:"新知",{if(nodeID!=null){nodeID=null;artifact=null}else if(goal!=null)goal=null else back()}) { padding ->
  Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
   if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
   if(error.isNotBlank())ErrorState(error){perform{load()}}
   TextButton(enabled=!busy,onClick={perform{load()}}){Text("刷新")}
   if(goal==null) {
    Text("学习目标",style=MaterialTheme.typography.titleLarge)
    goals.forEach { g->OutlinedButton(onClick={perform {val value=repository.request("/api/learning/goals/"+g.getString("id"));check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};goal=value}}){Text(g.optString("title"))} }
    Text("加入学习材料",style=MaterialTheme.typography.titleLarge)
    OutlinedTextField(title,{title=it},label={Text("目标或材料标题")},modifier=Modifier.fillMaxWidth())
    OutlinedTextField(text,{text=it},label={Text("学习材料内容")},modifier=Modifier.fillMaxWidth(),minLines=4)
    sources.forEach { s->val key=s.optString("kind")+":"+s.optString("sourceId")+":"+s.optString("version");FilterChip(selected=selectedSource==key,onClick={selectedSource=if(selectedSource==key)"" else key},label={Text(s.optString("title"))}) }
    Button(enabled=!busy&&(text.isNotBlank()||selectedSource.isNotBlank()),onClick={perform {val input=JSONObject().put("requestId",intakeID).put("text",text).put("title",title.ifBlank{text.take(120)});if(selectedSource.isNotBlank())input.put("sourceKeys",JSONArray().put(selectedSource));repository.request("/api/learning/intake","POST",input);text="";selectedSource="";intakeID=UUID.randomUUID().toString();load()}}){Text("提取学习目标")}
    Text("待确认",style=MaterialTheme.typography.titleLarge)
    candidates.forEach { c->Text(c.optString("title"),style=MaterialTheme.typography.titleMedium);Text(c.optString("expectedAbility"));Text(c.optString("reason"));c.optJSONArray("citations").objects().forEach{Text(it.optString("title")+"："+it.optString("quote"))};Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("confirm" to "确认加入","ignore" to "忽略").forEach{(action,label)->OutlinedButton(enabled=!busy,onClick={perform {repository.request("/api/learning/candidates/"+c.getString("id"),"POST",JSONObject().put("revision",c.getInt("revision")).put("action",action).put("foundation",""));load()}}){Text(label)}}} }
   } else if(node==null) {
    Text(goal?.optString("expectedAbility")?:"");Text(goal?.optString("foundation")?:"")
    nodes.groupBy{it.optString("stage")}.forEach{(stage,items)->Text(stage,style=MaterialTheme.typography.titleLarge);items.forEach{n->OutlinedButton(onClick={nodeID=n.getString("id");notes=n.optString("notes");question=n.optJSONArray("recall")?.optString(0)?:""}){Text(n.optString("title")+" · "+(learningMasteryLabels[n.optString("mastery")]?:"待学")+if(goal?.optString("nextNodeId")==n.optString("id"))" · 下一步" else "")}}}
   } else {
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)){learningMasteryLabels.forEach{(value,label)->FilterChip(selected=node.optString("mastery")==value,enabled=!busy,onClick={mutate("progress",JSONObject().put("mastery",value))},label={Text(label)})}}
    node.optJSONArray("objectives")?.let{for(i in 0 until it.length())Text("• "+it.getString(i))}
    node.optJSONArray("dependsOn")?.let{deps->for(i in 0 until deps.length()){val prior=nodes.firstOrNull{it.optString("id")==deps.getString(i)};if(prior!=null)TextButton(onClick={nodeID=prior.getString("id")}){Text("先修 · "+prior.optString("title"))}}}
    MarkdownContent.parse(node.optString("explanation")).blocks.forEach{MarkdownBlock(it)}
    Text("来源资料",style=MaterialTheme.typography.titleLarge);node.optJSONArray("citations").objects().forEach{Text(it.optString("title"));Text(it.optString("quote"))}
    Text("复述与练习",style=MaterialTheme.typography.titleLarge)
    listOf("recall","exercises").forEach{key->node.optJSONArray(key)?.let{questions->for(i in 0 until questions.length()){val q=questions.getString(i);FilterChip(selected=question==q,onClick={question=q},label={Text(q)})}}}
    OutlinedTextField(answer,{answer=it},label={Text("我的回答")},modifier=Modifier.fillMaxWidth(),minLines=4)
    Button(enabled=!busy&&answer.isNotBlank()&&question.isNotBlank(),onClick={val current=goal?:return@Button;perform{repository.request("/api/learning/goals/"+current.getString("id")+"/attempts","POST",JSONObject().put("revision",current.getInt("revision")).put("nodeId",nodeID).put("requestId",attemptID).put("question",question).put("answer",answer));answer="";attemptID=UUID.randomUUID().toString();load()}}){Text("保存并获取反馈")}
    goal?.optJSONArray("attempts").objects().filter{it.optString("nodeId")==nodeID}.forEach{a->Text(a.optString("question"));Text(a.optString("answer"));Text(if(a.isNull("feedback"))"等待练习反馈" else a.optString("feedback"))}
    OutlinedTextField(notes,{if(notesRevision==null)notesRevision=goal?.optInt("revision");notes=it},label={Text("我的理解")},modifier=Modifier.fillMaxWidth(),minLines=4)
    Button(enabled=!busy&&notes!=node.optString("notes"),onClick={mutate("progress",JSONObject().put("notes",notes))}){Text("保存笔记")}
    if(notesRevision!=null&&notesRevision!=goal?.optInt("revision")){Text("云端笔记");Text(node.optString("notes"));OutlinedButton(enabled=!busy,onClick={notesRevision=goal?.optInt("revision");mutate("progress",JSONObject().put("notes",notes))}){Text("以当前版本保存")}}
    Text("教学成果",style=MaterialTheme.typography.titleLarge)
    goal?.optJSONArray("artifacts").objects().filter{it.optString("nodeId")==nodeID}.forEach{a->OutlinedButton(enabled=!busy,onClick={perform {val result=repository.request("/api/learning/artifacts/"+a.getString("id"));val bytes=Base64.decode(result.getString("bytes"),Base64.DEFAULT);val sha=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)};check(sha==a.getString("sha256")){"教学文件校验失败"};check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};artifact=a to bytes}}){Text(a.optString("title"))}}
    artifact?.let{(meta,bytes)->LearningArtifactPreview(meta,bytes)}
   }
  }
 }
}
@Composable private fun LearningArtifactPreview(meta:JSONObject,bytes:ByteArray) {
 val context=LocalContext.current
 if(meta.optString("kind")=="web") {
  val html=remember(bytes){val policy="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\">";val content=(policy+bytes.toString(Charsets.UTF_8)).replace("&","&amp;").replace("\"","&quot;").replace("<","&lt;");"<iframe sandbox=\"allow-scripts\" referrerpolicy=\"no-referrer\" style=\"border:0;width:100%;height:95vh\" srcdoc=\"$content\"></iframe>"}
  AndroidView(modifier=Modifier.fillMaxWidth().height(440.dp),factory={ctx->WebView(ctx).apply{settings.javaScriptEnabled=true;settings.allowFileAccess=false;settings.allowContentAccess=false;settings.domStorageEnabled=false;webViewClient=object:WebViewClient(){override fun shouldOverrideUrlLoading(view:WebView?,request:WebResourceRequest?)=true;override fun shouldInterceptRequest(view:WebView?,request:WebResourceRequest?):WebResourceResponse?=if(request?.url?.scheme in listOf("http","https","file","content"))WebResourceResponse("text/plain","utf-8",ByteArrayInputStream(ByteArray(0)))else null};loadDataWithBaseURL(null,html,"text/html","utf-8",null)}},onRelease={it.destroy()})
 } else if(meta.optString("mime").startsWith("video/")) {
  val file=remember(meta.optString("sha256")){File(context.cacheDir,meta.getString("sha256")+".mp4").apply{writeBytes(bytes)}}
  AndroidView(modifier=Modifier.fillMaxWidth().height(320.dp),factory={ctx->VideoView(ctx).apply{setMediaController(MediaController(ctx));setVideoURI(Uri.fromFile(file))}},onRelease={it.stopPlayback()})
  DisposableEffect(file){onDispose{file.delete()}}
 } else if(meta.optString("mime").startsWith("text/")||meta.optString("title").substringAfterLast('.').lowercase() in listOf("md","txt","json","py","js","ts","css","swift","kt"))Text(bytes.toString(Charsets.UTF_8))
 else {
  var openError by remember{mutableStateOf("")}
  OutlinedButton(onClick={try{val ext=meta.optString("title").substringAfterLast('.').filter{it.isLetterOrDigit()}.take(8).ifBlank{"bin"};val folder=File(context.cacheDir,"input-files").apply{mkdirs()};val file=File(folder,"learning-"+meta.getString("sha256")+"."+ext).apply{writeBytes(bytes)};val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".inputs",file);context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW).setDataAndType(uri,meta.optString("mime")).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION));openError=""}catch(e:Exception){openError=e.message?:"文件暂时无法打开"}}){Text("打开文件 · "+meta.optString("title"))}
  if(openError.isNotBlank())Text(openError)
 }
}
