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
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.design.*

@Composable fun TaskDiagnosticsPanel(repository: NestRepository, taskId: String) {
    val scope=rememberCoroutineScope()
    var report by remember(taskId) { mutableStateOf<JSONObject?>(null) }
    var error by remember(taskId) { mutableStateOf<String?>(null) }
    var loading by remember(taskId) { mutableStateOf(false) }
    var selected by remember(taskId) { mutableStateOf("") }
    var evidence by remember(taskId) { mutableStateOf<JSONObject?>(null) }
    fun load() { scope.launch { loading=true;error=null;try { report=repository.request("/api/read/v1/tasks/${encoded(taskId)}/diagnostics") } catch(e: Exception) { error=e.message?:"执行记录读取失败" } finally { loading=false } } }
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick={load()},enabled=!loading) { Text(if(loading)"正在读取" else "执行记录与证据") }
        error?.let { Text(it,color=MaterialTheme.colorScheme.error) }
        report?.let { value ->
            value.optJSONObject("diagnosis")?.let { diagnosis ->
                diagnosis.optString("reason").takeIf { it.isNotBlank()&&it!="null" }?.let { Text(it) };diagnosis.optJSONArray("recovery_conditions").objects().forEach { Text(it.optString("action")) }
            }
            val attempts=value.optJSONArray("attempts").objects()
            if(attempts.isNotEmpty())OptionMenu("执行次数",selected,listOf("" to "全部执行")+attempts.mapIndexed { index,a -> a.getString("id") to "第 ${index+1} 次 · ${a.optString("deviceName")}" }) { selected=it }
            val complete=value.optJSONObject("completeness")
            if(complete?.optBoolean("legacy")==true)Text("旧版历史不完整")
            if(complete?.optBoolean("local_evidence_may_be_pending")==true)Text("部分证据待同步")
            if(complete?.optBoolean("truncated")==true)Text("执行历史存在缺口")
            value.optJSONArray("events").objects().filter { selected.isBlank()||it.optString("attemptId")==selected }.forEach { event ->
                TextButton(onClick={evidence=event}) { Column { Text(event.optString("message"));Text(event.optString("at"),style=MaterialTheme.typography.labelMedium) } }
            }
        }
    }
    evidence?.let { event -> AlertDialog(onDismissRequest={evidence=null},title={Text("执行证据")},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(event.optString("message"));Text(event.optString("code"));Text(event.optString("at"));Text(event.optString("reportedBy"));Text("执行 ${event.optString("attemptId")}");Text("事件 ${event.optString("id")}")
        event.optJSONArray("artifacts").objects().forEach { Text(it.optString("path"));Text(it.optString("sha256")) }
        event.optJSONObject("details")?.let { Text(it.toString(2)) }
    }},confirmButton={TextButton(onClick={evidence=null}) { Text("完成") }}) }
}

@Composable fun NodeCapabilitiesPanel(repository: NestRepository, deviceId: String, deviceName: String) {
    val scope=rememberCoroutineScope()
    var report by remember(deviceId) { mutableStateOf<JSONObject?>(null) }
    var error by remember(deviceId) { mutableStateOf<String?>(null) }
    var loading by remember(deviceId) { mutableStateOf(false) }
    val states=mapOf("ready" to "可执行","queued" to "排队","configuration" to "待配置","authorization" to "待授权","connection" to "待连接页面","offline" to "等待节点","unknown" to "待检测","disabled" to "未启用")
    val verification=mapOf("passed" to "已验证","untested" to "未实测","changed" to "待复测")
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
        OutlinedButton(enabled=!loading,onClick={scope.launch {loading=true;error=null;try {report=repository.request("/api/devices/${encoded(deviceId)}/capabilities")}catch(e: Exception){error=e.message?:"能力读取失败"}finally{loading=false}}}) {Text(if(loading)"正在读取" else "采集与写作能力")}
        error?.let { Text(it,color=MaterialTheme.colorScheme.error) }
        report?.let { value -> Text("由 $deviceName 执行");value.optJSONArray("capabilities").objects().forEach { capability ->
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)) {Text(capability.optString("label"),Modifier.weight(1f));Column {Text(states[capability.optString("state")]?:"待检测");Text(verification[capability.optString("verification")]?:"未实测",style=MaterialTheme.typography.labelMedium)}}
        } }
    }
}
