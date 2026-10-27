package store.inspirai.library.nativeui.feature

import android.util.Base64
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.widget.VideoView
import android.widget.MediaController
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.util.UUID
import store.inspirai.library.core.Api
import store.inspirai.library.core.InputFiles
import store.inspirai.library.nativeui.data.NestRepository
import store.inspirai.library.nativeui.data.objects
import store.inspirai.library.nativeui.content.*
import store.inspirai.library.nativeui.design.*

val learningMasteryLabels=linkedMapOf("pending" to "待学","learning" to "学习中","review" to "待复习","mastered" to "已掌握")
private fun sourceKey(s:JSONObject)=s.optString("kind")+":"+s.optString("sourceId")+":"+s.optString("version")
@Composable private fun LearningCard(content:@Composable ColumnScope.()->Unit) {
 OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp),content=content) }
}
@Composable private fun LearningActionCard(title:String,icon:ImageVector,onClick:()->Unit,enabled:Boolean=true,body:String="") {
 OutlinedCard(onClick=onClick,enabled=enabled,modifier=Modifier.fillMaxWidth()) { Row(Modifier.fillMaxWidth().padding(20.dp),horizontalArrangement=Arrangement.spacedBy(14.dp)) { Icon(icon,null,tint=MaterialTheme.colorScheme.primary);Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(8.dp)){Text(title,style=MaterialTheme.typography.titleMedium);if(body.isNotBlank())Text(body,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)};Icon(Icons.Outlined.ChevronRight,null) } }
}
@Composable private fun LearningDialog(title:String,close:()->Unit,content:@Composable ColumnScope.()->Unit) {
 Dialog(onDismissRequest=close,properties=DialogProperties(usePlatformDefaultWidth=false)) { Surface(Modifier.fillMaxWidth().padding(12.dp).widthIn(max=840.dp).fillMaxHeight(.94f),shape=MaterialTheme.shapes.large) { Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) { Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(title,style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f));IconButton(onClick=close){Icon(Icons.Outlined.Close,"关闭")}};content() } } }
}
@Composable fun LearningPage(repository:NestRepository,back:()->Unit,initialSource:String?=null) {
 val scope=rememberCoroutineScope();val identity=repository.credentials.snapshot()?.generation
 var goals by remember(identity){mutableStateOf(emptyList<JSONObject>())};var candidates by remember(identity){mutableStateOf(emptyList<JSONObject>())};var sources by remember(identity){mutableStateOf(emptyList<JSONObject>())}
 var goal by remember(identity){mutableStateOf<JSONObject?>(null)};var nodeID by remember(identity){mutableStateOf<String?>(null)}
 var notes by remember(identity,nodeID){mutableStateOf("")};var answer by remember(identity,nodeID){mutableStateOf("")};var question by remember(identity,nodeID){mutableStateOf("")};var notesRevision by remember(identity,nodeID){mutableStateOf<Int?>(null)};var attemptID by remember(identity,nodeID){mutableStateOf(UUID.randomUUID().toString())}
 var tab by remember(identity,nodeID){mutableStateOf("概念")};var answering by remember(identity,nodeID){mutableStateOf(false)};var noting by remember(identity,nodeID){mutableStateOf(false)}
 var pendingOnly by remember(identity){mutableStateOf(false)};var collecting by remember(identity){mutableStateOf(initialSource!=null)};var manual by remember(identity){mutableStateOf(false)};var goalName by remember(identity){mutableStateOf("")};var intakeTask by remember(identity){mutableStateOf<String?>(null)}
 var error by remember(identity){mutableStateOf("")};var busy by remember(identity){mutableStateOf(false)};var artifact by remember(identity,nodeID){mutableStateOf<Pair<JSONObject,ByteArray>?>(null)};var sourceReading by remember(identity,nodeID){mutableStateOf<JSONObject?>(null)}
 suspend fun load() {
  val index=repository.request("/api/learning");val materials=repository.request("/api/learning/sources");check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"}
  goals=index.optJSONArray("goals").objects();candidates=index.optJSONArray("candidates").objects().filter{it.optString("state")=="pending"};sources=materials.optJSONArray("items").objects()
  goal?.let{current->val result=repository.request("/api/learning/goals/"+current.getString("id"));check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};goal=result}
 }
 fun perform(work:suspend ()->Unit) {if(busy)return;busy=true;scope.launch {try{check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};work();check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};error=""}catch(e:kotlinx.coroutines.CancellationException){throw e}catch(e:Exception){if(repository.credentials.snapshot()?.generation==identity)error=e.message?:"新知操作失败"}finally{if(repository.credentials.snapshot()?.generation==identity)busy=false}}}
 fun mutate(action:String,input:JSONObject,done:()->Unit={}) {val current=goal?:return;perform {input.put("revision",if(input.has("notes"))notesRevision?:current.getInt("revision") else current.getInt("revision")).put("nodeId",nodeID);repository.request("/api/learning/goals/"+current.getString("id")+"/"+action,"POST",input);check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};if(input.has("notes"))notesRevision=null;load();done()}}
 LaunchedEffect(identity){perform{load()}}
 val pageScroll=rememberScrollState()
 LaunchedEffect(identity,goal?.optString("id"),nodeID,tab){pageScroll.scrollTo(0)}
 val nodes=goal?.optJSONArray("nodes").objects();val node=nodes.firstOrNull{it.optString("id")==nodeID}
 LaunchedEffect(nodeID){notes=node?.optString("notes")?:"";question=node?.optJSONArray("recall")?.optString(0)?:node?.optJSONArray("exercises")?.optString(0)?:"";artifact=null}
 DetailScaffold(node?.optString("title")?:goal?.optString("title")?:"新知",{if(nodeID!=null){nodeID=null;artifact=null}else if(goal!=null)goal=null else back()}) { padding ->
  Column(Modifier.padding(padding).fillMaxSize().verticalScroll(pageScroll).padding(20.dp).widthIn(max=1000.dp),verticalArrangement=Arrangement.spacedBy(18.dp)) {
   if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
   if(error.isNotBlank())ErrorState(error){perform{load()}}
   goal?.optJSONArray("jobs").objects().filter{it.optString("state") !in listOf("completed","cancelled")}.forEach{LearningTaskCard(repository,it.getString("id"))}
   if(goal==null) {
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={collecting=true}){Icon(Icons.Outlined.Add,null);Text("添加材料")};OutlinedButton(onClick={pendingOnly=!pendingOnly}){Icon(Icons.Outlined.Inbox,null);Text(if(pendingOnly)"全部目标" else "待确认 ${candidates.size}")};var menu by remember{mutableStateOf(false)};Box{IconButton(onClick={menu=true}){Icon(Icons.Outlined.MoreHoriz,"更多")};DropdownMenu(expanded=menu,onDismissRequest={menu=false}){DropdownMenuItem(text={Text("手动建立")},onClick={menu=false;goalName="";manual=true});DropdownMenuItem(text={Text("刷新")},onClick={menu=false;perform{load()}})}}}
    intakeTask?.let{LearningTaskCard(repository,it)}
    Text(if(pendingOnly)"待确认目标" else "学习目标",style=MaterialTheme.typography.titleLarge)
    if(pendingOnly){
     if(candidates.isEmpty())LearningCard{Text("暂无待确认目标")}
     candidates.forEach{c->LearningCandidateCard(c,goals,busy,onAction={input,done->perform{input.put("revision",c.getInt("revision"));repository.request("/api/learning/candidates/"+c.getString("id"),"POST",input);load();done()}})}
    }else{
     goals.filter{it.optString("state")!="archived"}.forEach { g->
      LearningCard{Text(g.optString("title"),style=MaterialTheme.typography.titleLarge);if(g.optString("expectedAbility").isNotBlank())Text(g.optString("expectedAbility"));val goalNodes=g.optJSONArray("nodes").objects();val mastered=goalNodes.count{it.optString("mastery")=="mastered"};LinearProgressIndicator(progress={mastered.toFloat()/goalNodes.size.coerceAtLeast(1)},modifier=Modifier.fillMaxWidth());Text("$mastered / ${goalNodes.size} 已掌握");goalNodes.firstOrNull{it.optString("id")==g.optString("nextNodeId")}?.let{Text("下一步 · "+it.optString("title"))};Button(enabled=!busy,onClick={perform{val value=repository.request("/api/learning/goals/"+g.getString("id"));check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};goal=value}}){Icon(Icons.Outlined.ArrowForward,null);Text("继续学习")}}
     }
     if(goals.isEmpty())LearningActionCard("从一份材料开始",Icons.Outlined.Add,{collecting=true})
    }
   } else if(node==null) {
    LearningCard{Text(goal?.optString("expectedAbility")?:"");if(goal?.optString("foundation")?.isNotBlank()==true){var foundationOpen by remember{mutableStateOf(false)};TextButton(onClick={foundationOpen=!foundationOpen}){Text("已有基础")};if(foundationOpen)Text(goal!!.optString("foundation"))};nodes.firstOrNull{it.optString("id")==goal?.optString("nextNodeId")}?.let{next->Button(onClick={nodeID=next.getString("id")}){Icon(Icons.Outlined.ArrowForward,null);Text("继续学习")}}}
    nodes.groupBy{it.optString("stage")}.forEach{(stage,items)->LearningCard{Text(stage,style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);items.forEach{n->LearningActionCard(n.optString("title"),Icons.Outlined.School,{nodeID=n.getString("id")},body=(learningMasteryLabels[n.optString("mastery")]?:"待学")+if(goal?.optString("nextNodeId")==n.optString("id"))" · 下一步" else "")}}}
   } else {
    FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){learningMasteryLabels.forEach{(value,label)->FilterChip(selected=node.optString("mastery")==value,enabled=!busy,onClick={mutate("progress",JSONObject().put("mastery",value))},label={Text(label)})}}
    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("概念","练习","笔记","成果").forEach{label->FilterChip(selected=tab==label,onClick={tab=label},label={Text(label)})}}
    if(tab=="概念"){
     LearningCard{Text("学习目标",style=MaterialTheme.typography.titleMedium);node.optJSONArray("objectives")?.let{for(i in 0 until it.length())Text(it.getString(i))};node.optJSONArray("dependsOn")?.let{deps->for(i in 0 until deps.length()){val prior=nodes.firstOrNull{it.optString("id")==deps.getString(i)};if(prior!=null)TextButton(onClick={nodeID=prior.getString("id")}){Text("先修 · "+prior.optString("title"))}}}}
     LearningCard{MarkdownContent.parse(node.optString("explanation")).blocks.forEach{MarkdownBlock(it)}}
     LearningCard{var showSources by remember(nodeID){mutableStateOf(false)};TextButton(onClick={showSources=!showSources}){Icon(Icons.Outlined.FolderOpen,null);Text("来源资料 · ${goal?.optJSONArray("sources")?.length()?:0}")};if(showSources){goal?.optJSONArray("sources").objects().forEach{s->LearningActionCard(s.optString("title"),Icons.Outlined.Description,{sourceReading=s})};node.optJSONArray("citations").objects().forEach{Text(it.optString("title"));Text(it.optString("quote"))}}}
    }else if(tab=="练习"){
     LearningCard{Text("复述与练习",style=MaterialTheme.typography.titleMedium);listOf("recall","exercises").forEach{key->node.optJSONArray(key)?.let{questions->for(i in 0 until questions.length()){val q=questions.getString(i);OutlinedCard(onClick={question=q;attemptID=UUID.randomUUID().toString()},enabled=!busy,modifier=Modifier.fillMaxWidth(),colors=CardDefaults.outlinedCardColors(containerColor=if(question==q)MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)){Row(Modifier.padding(16.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)){Icon(if(question==q)Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked,null);Text(q)}}}}}
      if(answering){OutlinedTextField(answer,{answer=it;attemptID=UUID.randomUUID().toString()},enabled=!busy,label={Text("我的回答")},modifier=Modifier.fillMaxWidth(),minLines=5);Button(enabled=!busy&&answer.isNotBlank()&&question.isNotBlank(),onClick={mutate("attempts",JSONObject().put("requestId",attemptID).put("question",question).put("answer",answer)){answer="";answering=false;attemptID=UUID.randomUUID().toString()}}){Text("保存并获取反馈")};TextButton(enabled=!busy,onClick={answering=false}){Text("取消")}}else{Button(enabled=question.isNotBlank(),onClick={answering=true}){Icon(Icons.Outlined.Edit,null);Text("开始回答")}}
     }
     goal?.optJSONArray("attempts").objects().filter{it.optString("nodeId")==nodeID}.forEach{a->LearningCard{Text(a.optString("question"),style=MaterialTheme.typography.titleMedium);Text(a.optString("answer"));Text(if(a.isNull("feedback"))"等待练习反馈" else a.optString("feedback"))}}
    }else if(tab=="笔记"){
     LearningCard{Text("个人理解",style=MaterialTheme.typography.titleMedium)
      if(noting){OutlinedTextField(notes,{notes=it},enabled=!busy,label={Text("我的理解")},modifier=Modifier.fillMaxWidth(),minLines=6);Button(enabled=!busy&&notes!=node.optString("notes"),onClick={mutate("progress",JSONObject().put("notes",notes)){noting=false}}){Text("保存笔记")};TextButton(enabled=!busy,onClick={notes=node.optString("notes");notesRevision=null;noting=false}){Text("取消")};if(notesRevision!=null&&notesRevision!=goal?.optInt("revision")){Text("云端笔记");Text(node.optString("notes"));OutlinedButton(enabled=!busy,onClick={notesRevision=goal?.optInt("revision");mutate("progress",JSONObject().put("notes",notes)){noting=false}}){Text("以当前版本保存")}}}else{if(node.optString("notes").isNotBlank())MarkdownContent.parse(node.optString("notes")).blocks.forEach{MarkdownBlock(it)};Button(onClick={notes=node.optString("notes");notesRevision=goal?.optInt("revision");noting=true}){Icon(Icons.Outlined.Edit,null);Text(if(node.optString("notes").isBlank())"记下理解" else "修改笔记")}}
     }
    }else{
     val artifacts=goal?.optJSONArray("artifacts").objects().filter{it.optString("nodeId")==nodeID}
     if(artifacts.isEmpty())LearningCard{Text("暂无教学成果")}
     artifacts.forEach{a->LearningActionCard(a.optString("title"),if(a.optString("kind")=="video")Icons.Outlined.PlayCircle else Icons.Outlined.Description,{perform{val result=repository.request("/api/learning/artifacts/"+a.getString("id"));val bytes=Base64.decode(result.getString("bytes"),Base64.DEFAULT);val sha=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)};check(sha==a.getString("sha256")){"教学文件校验失败"};check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};artifact=a to bytes}},!busy,if(a.optInt("nodeRevision")!=node.optInt("contentRevision"))"历史节点版本" else "")}
     artifact?.let{(meta,bytes)->LearningArtifactPreview(meta,bytes)}
    }
   }
  }
 }
 if(collecting)LearningIntakeDialog(repository,sources,initialSource,{collecting=false}){value->collecting=false;pendingOnly=true;intakeTask=value.optString("sourceTaskId").ifBlank{if(value.optString("state")=="queued")value.optString("id") else ""}.ifBlank{null};perform{load()}}
 if(manual)LearningDialog("手动建立目标",{manual=false}){OutlinedTextField(goalName,{goalName=it},label={Text("目标名称")},modifier=Modifier.fillMaxWidth());Button(enabled=!busy&&goalName.isNotBlank(),onClick={perform{repository.request("/api/learning/goals","POST",JSONObject().put("title",goalName));manual=false;load()}}){Text("建立目标")}}
 sourceReading?.let{s->LearningDialog(s.optString("title"),{sourceReading=null}){MarkdownContent.parse(s.optString("text").ifBlank{s.optString("quote")}).blocks.forEach{MarkdownBlock(it)}}}
}
@Composable private fun LearningCandidateCard(candidate:JSONObject,goals:List<JSONObject>,busy:Boolean,onAction:(JSONObject,()->Unit)->Unit) {
 var title by remember(candidate.optString("id")){mutableStateOf(candidate.optString("title"))};var ability by remember(candidate.optString("id")){mutableStateOf(candidate.optString("expectedAbility"))}
 var edit by remember{mutableStateOf(false)};var join by remember{mutableStateOf(false)};var citations by remember{mutableStateOf(false)};var draftTitle by remember{mutableStateOf("")};var draftAbility by remember{mutableStateOf("")}
 fun confirm(g:JSONObject?=null){val value=JSONObject().put("action","confirm").put("title",title).put("expectedAbility",ability);g?.let{value.put("goalId",it.getString("id")).put("goalRevision",it.getInt("revision"))};onAction(value){join=false}}
 LearningCard{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){Text(title,style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f));IconButton(enabled=!busy,onClick={draftTitle=title;draftAbility=ability;edit=true}){Icon(Icons.Outlined.Edit,"修改目标")}};Text(ability);Text(candidate.optString("reason"),color=MaterialTheme.colorScheme.onSurfaceVariant);TextButton(onClick={citations=!citations}){Text("来源依据")};if(citations)candidate.optJSONArray("citations").objects().forEach{Text(it.optString("title"));Text(it.optString("quote"))};FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(enabled=!busy,onClick={confirm()}){Icon(Icons.Outlined.Add,null);Text("建立目标")};OutlinedButton(enabled=!busy&&goals.any{it.optString("state")!="archived"},onClick={join=true}){Text("加入已有目标")};TextButton(enabled=!busy,onClick={onAction(JSONObject().put("action","ignore")){}}){Text("忽略")}}}
 if(join)LearningDialog("加入已有目标",{if(!busy)join=false}){var query by remember{mutableStateOf("")};OutlinedTextField(query,{query=it},label={Text("搜索学习目标")},modifier=Modifier.fillMaxWidth());goals.filter{it.optString("state")!="archived"&&it.optString("title").contains(query,true)}.forEach{g->LearningActionCard(g.optString("title"),Icons.Outlined.School,{confirm(g)},!busy)}}
 if(edit)LearningDialog("修改学习目标",{edit=false}){OutlinedTextField(draftTitle,{draftTitle=it},label={Text("目标名称")},modifier=Modifier.fillMaxWidth());OutlinedTextField(draftAbility,{draftAbility=it},label={Text("预期能力")},modifier=Modifier.fillMaxWidth(),minLines=4);Button(enabled=draftTitle.isNotBlank(),onClick={title=draftTitle;ability=draftAbility;edit=false}){Text("完成")}}
}
@Composable private fun LearningIntakeDialog(repository:NestRepository,sources:List<JSONObject>,initialSource:String?,close:()->Unit,done:(JSONObject)->Unit) {
 val context=LocalContext.current;val scope=rememberCoroutineScope();val identity=repository.credentials.snapshot()?.generation
 var mode by remember{mutableStateOf(if(initialSource!=null)"sources" else "")};var keys by remember{mutableStateOf(listOfNotNull(initialSource))};var files by remember{mutableStateOf(emptyList<JSONObject>())};val requestID=remember{UUID.randomUUID().toString()};val store=remember{InputFiles(context)}
 var query by remember{mutableStateOf("")};var limit by remember{mutableIntStateOf(20)};var text by remember{mutableStateOf("")};var title by remember{mutableStateOf("")};var extra by remember{mutableStateOf("")};var advanced by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(false)};var error by remember{mutableStateOf("")}
 fun work(action:suspend()->Unit){if(busy)return;busy=true;scope.launch{try{check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};action();error=""}catch(e:kotlinx.coroutines.CancellationException){throw e}catch(e:Exception){error=e.message?:"材料保存失败"}finally{busy=false}}}
 val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()){uris->work{for(uri in uris){check(files.size<20){"每次最多导入 20 个文件"};val meta=withContext(Dispatchers.IO){store.copy(requestID,JSONObject().put("id",UUID.randomUUID().toString()),uri)};check(meta.optString("state")=="ready"){meta.optString("error","文件读取失败")};check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};files=files+meta}}}
 fun submit(){work{val input=JSONObject().put("requestId",requestID);if(mode=="sources")input.put("sourceKeys",JSONArray(keys)) else{var content=if(mode=="paste")text else "";val attachments=JSONArray();if(mode=="files")for(meta in files){val snapshot=repository.credentials.snapshot()?:throw IllegalStateException("请先连接资料空间");check(snapshot.generation==identity){"资料空间已切换"};withContext(Dispatchers.IO){Api(repository.credentials).uploadInput(snapshot,store.file(requestID,meta.getString("id")),meta){}};check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};attachments.put(JSONObject().put("id",meta.getString("id")).put("name",meta.getString("name")).put("sha256",meta.getString("sha256")));if(meta.optString("name").substringAfterLast('.').lowercase() in listOf("md","txt","csv","json")){content+="\n\n# "+meta.getString("name")+"\n"+withContext(Dispatchers.IO){store.file(requestID,meta.getString("id")).readText()}}};content=(content+"\n\n"+extra).trim();check(content.length<=60000){"材料正文超过 60000 字符，请拆分导入"};input.put("text",content.ifBlank{"导入文件："+files.joinToString("、"){it.optString("name")}}).put("attachments",attachments).put("contentReady",content.isNotBlank());if(title.isBlank()&&files.isNotEmpty())input.put("title",files.joinToString("、"){it.optString("name")}.take(200))};if(title.isNotBlank())input.put("title",title);val result=repository.request("/api/learning/intake","POST",input);check(repository.credentials.snapshot()?.generation==identity){"资料空间已切换"};done(result)}}
 LearningDialog("添加学习材料",{if(!busy)close()}){
  if(busy)LinearProgressIndicator(Modifier.fillMaxWidth());if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error)
  if(mode.isBlank()){LearningActionCard("选择资料",Icons.Outlined.FolderOpen,{mode="sources"});LearningActionCard("导入文件",Icons.Outlined.UploadFile,{mode="files";picker.launch(arrayOf("*/*"))});LearningActionCard("粘贴内容",Icons.Outlined.ContentPaste,{mode="paste"})}
  else{TextButton(enabled=!busy,onClick={mode=""}){Text("更换来源方式")}
   if(mode=="sources"){OutlinedTextField(query,{query=it;limit=20},label={Text("搜索资料")},modifier=Modifier.fillMaxWidth());val filtered=sources.filter{it.optString("title").contains(query,true)};filtered.take(limit).forEach{s->val key=sourceKey(s);OutlinedCard(onClick={keys=if(key in keys)keys-key else if(keys.size<30)keys+key else keys},modifier=Modifier.fillMaxWidth(),enabled=!busy,colors=CardDefaults.outlinedCardColors(containerColor=if(key in keys)MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)){Row(Modifier.padding(16.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)){Icon(if(key in keys)Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked,null);Column(Modifier.weight(1f)){Text(s.optString("title"),style=MaterialTheme.typography.titleMedium);Text(if(s.optString("coverage")=="full")"完整来源" else "部分来源",color=MaterialTheme.colorScheme.onSurfaceVariant)}}}};if(filtered.size>limit)TextButton(onClick={limit+=20}){Text("加载更多")};Text("已选 ${keys.size} 份资料")}
   else if(mode=="files"){OutlinedButton(enabled=!busy,onClick={picker.launch(arrayOf("*/*"))}){Icon(Icons.Outlined.UploadFile,null);Text("选择文件")};files.forEach{file->LearningCard{Text(file.optString("name"));TextButton(enabled=!busy,onClick={files=files-file}){Text("移除")}}}}
   else OutlinedTextField(text,{text=it},label={Text("材料内容")},modifier=Modifier.fillMaxWidth(),minLines=6)
   TextButton(onClick={advanced=!advanced}){Text("修改标题或补充说明")};if(advanced){OutlinedTextField(title,{title=it},label={Text("材料标题")},modifier=Modifier.fillMaxWidth());if(mode!="sources")OutlinedTextField(extra,{extra=it},label={Text("补充说明")},modifier=Modifier.fillMaxWidth(),minLines=3)}
   Button(enabled=!busy&&when(mode){"sources"->keys.isNotEmpty();"files"->files.isNotEmpty();else->text.isNotBlank()},onClick={submit()}){Icon(Icons.Outlined.AutoAwesome,null);Text("提取目标")}
  }
 }
}
@Composable private fun LearningTaskCard(repository:NestRepository,id:String) {
 val scope=rememberCoroutineScope();val generation=repository.credentials.snapshot()?.generation
 var report by remember(id,generation){mutableStateOf<JSONObject?>(null)};var error by remember(id,generation){mutableStateOf("")};var busy by remember(id,generation){mutableStateOf(false)}
 fun load(retry:Boolean=false){if(busy)return;busy=true;scope.launch{try{check(repository.credentials.snapshot()?.generation==generation){"资料空间已切换"};if(retry)repository.request("/api/tasks/$id/retry","POST",JSONObject());val value=repository.request("/api/read/v1/tasks/$id/diagnostics");check(repository.credentials.snapshot()?.generation==generation){"资料空间已切换"};report=value;error=""}catch(e:kotlinx.coroutines.CancellationException){throw e}catch(e:Exception){if(repository.credentials.snapshot()?.generation==generation)error=e.message?:"任务读取失败"}finally{busy=false}}}
 LaunchedEffect(id,generation){load()}
 LearningCard{val state=report?.optJSONObject("task")?.optString("state")?:"";val labels=mapOf("queued" to "等待电脑处理","assigned" to "已分配","running" to "处理中","uploading" to "保存结果中","completed" to "已完成","waiting_action" to "需要处理","failed" to "处理失败","cancelled" to "已取消");Text(labels[state]?:"材料已保存",style=MaterialTheme.typography.titleMedium);report?.optJSONObject("diagnosis")?.optString("reason")?.takeIf{it.isNotBlank()&&it!="null"}?.let{Text(it)};if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error);Row{TextButton(enabled=!busy,onClick={load()}){Text("刷新")};if(state in listOf("failed","waiting_action"))TextButton(enabled=!busy,onClick={load(true)}){Text("重试")}}}
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
