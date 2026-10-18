@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package store.inspirai.library.nativeui.design

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONObject

@Composable fun NestPageHeader(title: String,actions: @Composable RowScope.()->Unit={}) {
    Row(Modifier.fillMaxWidth().padding(vertical=16.dp),verticalAlignment=Alignment.CenterVertically) {
        Text(title,style=MaterialTheme.typography.headlineLarge,modifier=Modifier.weight(1f));actions()
    }
}
@Composable fun NestSearch(value: String,placeholder: String,change: (String)->Unit) {
    OutlinedTextField(value,change,Modifier.fillMaxWidth(),placeholder={Text(placeholder)},singleLine=true,leadingIcon={Icon(Icons.Outlined.Search,null)},shape=MaterialTheme.shapes.small)
}

@Composable fun DetailScaffold(title: String,back: ()->Unit,actions: @Composable RowScope.()->Unit={},bottom: @Composable ()->Unit={},content: @Composable (PaddingValues)->Unit) {
    Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(title,style=MaterialTheme.typography.titleMedium,maxLines=1,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)},navigationIcon={IconButton(onClick=back){Icon(Icons.AutoMirrored.Outlined.ArrowBack,"返回")}},actions=actions,colors=TopAppBarDefaults.topAppBarColors(containerColor=MaterialTheme.colorScheme.background))},bottomBar=bottom,content=content)
}
@Composable fun OptionMenu(title: String,value: String,options: List<Pair<String,String>>,change: (String)->Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick={expanded=true},modifier=Modifier.fillMaxWidth()) { Text("$title：${options.firstOrNull { it.first==value }?.second?:value}",Modifier.weight(1f));Icon(Icons.Outlined.ExpandMore,null) }
        DropdownMenu(expanded,{expanded=false},modifier=Modifier.heightIn(max=400.dp)) { options.forEach { (id,label)->DropdownMenuItem(text={Text(label)},onClick={change(id);expanded=false}) } }
    }
}
@Composable fun AttachmentRow(file: JSONObject,click: ()->Unit) {
    ListItem(headlineContent={Text(file.optString("name",file.optString("path","附件")))},supportingContent={Text(listOf(file.optString("mime"),if(file.optLong("bytes")>0)"${file.optLong("bytes")/1024} KB" else "").filter { it.isNotBlank() }.joinToString(" · "))},leadingContent={Icon(Icons.Outlined.AttachFile,null)},modifier=Modifier.clickable(onClick=click))
}
