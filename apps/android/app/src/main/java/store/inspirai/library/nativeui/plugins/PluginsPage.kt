package store.inspirai.library.nativeui.plugins
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import store.inspirai.library.nativeui.design.*
@Composable fun PluginsPage(back: ()->Unit) {
 val catalog=LocalPlugins.current;val scope=rememberCoroutineScope();var busy by remember { mutableStateOf(false) }
 Column(Modifier.fillMaxSize().padding(20.dp)) {
  TextButton(onClick=back){Text("返回")};NestPageHeader("插件")
  val rows=catalog?.snapshot?.optJSONArray("plugins")
  if(rows!=null)for(i in 0 until rows.length()){val item=rows.getJSONObject(i);ListItem(headlineContent={Text(item.getString("name"))},trailingContent={Switch(checked=item.optBoolean("enabled"),enabled=!busy,onCheckedChange={value->scope.launch{busy=true;try{catalog.toggle(item.getString("id"),value)}finally{busy=false}}})})}
  if(!catalog?.error.isNullOrBlank())Text(catalog?.error?:"",color=MaterialTheme.colorScheme.error)
  TextButton(enabled=!busy,onClick={scope.launch{catalog?.refresh()}}){Text("刷新")}
 }
}
