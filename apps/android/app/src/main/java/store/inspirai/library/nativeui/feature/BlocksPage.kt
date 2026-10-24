package store.inspirai.library.nativeui.feature
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject
import store.inspirai.library.nativeui.data.NestRepository
import store.inspirai.library.nativeui.data.objects
import store.inspirai.library.nativeui.design.*

@Composable fun BlocksPage(repository: NestRepository,back: ()->Unit,kind: String?=null,sourceId: String?=null) {
 val scope=rememberCoroutineScope();var items by remember { mutableStateOf(emptyList<JSONObject>()) };var error by remember { mutableStateOf("") };var busy by remember { mutableStateOf(false) };var joined by remember { mutableStateOf(false) }
 val origin=repository.credentials.server()
 fun refresh(){scope.launch {busy=true;try{val value=repository.request("/api/blocks");check(repository.credentials.server()==origin){"资料空间已切换"};items=value.optJSONArray("items").objects();error=""}catch(e: kotlinx.coroutines.CancellationException){throw e}catch(e: Exception){error=e.message?:"读取积木失败"}finally{busy=false}}}
 LaunchedEffect(origin){refresh()}
 DetailScaffold(if(sourceId==null)"积木" else "加入积木",back) { padding ->
  Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
   if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
   if(error.isNotBlank())ErrorState(error){refresh()}
   if(joined)Text("已加入积木")
   if(items.isEmpty()&&!busy)Text("暂无积木")
   items.forEach { block ->
    Text(block.optString("title")+if(block.optBoolean("paused"))" · 已暂停" else "",style=MaterialTheme.typography.titleLarge)
    block.optJSONArray("goals").objects().forEach { goal ->
     Text(goal.optString("title"),style=MaterialTheme.typography.titleMedium)
     goal.optJSONArray("parts").objects().forEach { part ->
      if(sourceId!=null)OutlinedButton(enabled=!busy&&!joined,onClick={scope.launch {
       busy=true;try{check(repository.credentials.server()==origin){"资料空间已切换"};repository.request("/api/blocks/${block.getString("id")}/join","POST",JSONObject().put("revision",block.getInt("revision")).put("kind",kind).put("sourceId",sourceId).put("partId",part.getString("id")));check(repository.credentials.server()==origin){"资料空间已切换"};joined=true;error=""}catch(e: kotlinx.coroutines.CancellationException){throw e}catch(e: Exception){error=e.message?:"加入失败"}finally{busy=false}
      }}) {Text(part.optString("title"))}
      else {Text(part.optString("title"));part.optJSONArray("conditions")?.let { conditions -> for(i in 0 until conditions.length())Text("• "+conditions.getString(i)) }}
     }
    }
   }
  }
 }
}
