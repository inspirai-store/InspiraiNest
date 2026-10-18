package store.inspirai.library.nativeui.plugins
import android.content.Context
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONObject
import store.inspirai.library.nativeui.data.NestRepository
class PluginCatalog(private val repository: NestRepository,context: Context) {
 private val cache=context.getSharedPreferences("plugin-catalog-v1",Context.MODE_PRIVATE)
 private var space=repository.credentials.server()
 var snapshot by mutableStateOf(read(space)); private set
 var error by mutableStateOf(""); private set
 private fun read(key: String): JSONObject?=try { cache.getString(key,null)?.let { JSONObject(it) } }catch(_: Exception){null}
 fun enabled(id: String): Boolean = snapshot?.optJSONArray("plugins")?.let { rows->(0 until rows.length()).any { val p=rows.getJSONObject(it);p.optString("id")==id&&p.optBoolean("enabled")&&p.optJSONArray("platforms")?.toString()?.contains("android")==true } }?:false
 suspend fun refresh() { val before=repository.credentials.server();if(space!=before){space=before;snapshot=read(before)};try { val result=repository.request("/api/plugins");if(repository.credentials.server()==before&&result.optInt("revision")>=(snapshot?.optInt("revision")?:0)){snapshot=result;error="";cache.edit().putString(before,result.toString()).apply()} }catch(e: CancellationException){throw e}catch(e: Exception){error=e.message?:"插件读取失败"} }
 suspend fun toggle(id: String,enabled: Boolean) { val before=space;val value=snapshot?:error("资料空间未连接");try { val result=repository.request("/api/plugins/$id","PUT",JSONObject().put("enabled",enabled).put("revision",value.getInt("revision")));if(repository.credentials.server()==before&&result.optInt("revision")>=(snapshot?.optInt("revision")?:0)){snapshot=result;error="";cache.edit().putString(before,result.toString()).apply()} }catch(e: CancellationException){throw e}catch(e: Exception){error=e.message?:"插件未更新"} }
}
val LocalPlugins=staticCompositionLocalOf<PluginCatalog?> { null }
@Composable fun pluginEnabled(id: String)=LocalPlugins.current?.enabled(id)==true
