package store.inspirai.library.nativeui.data

import android.content.Context
import android.webkit.*
import androidx.room.withTransaction
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.*
import java.io.ByteArrayInputStream

/** App-supplied migration page only. No credentials, old capture scripts or network requests. */
class LegacyMigration(private val context: Context,private val onState: (String,Boolean)->Unit) {
    private val database=NativeDatabase.open(context);private val dao=database.dao()
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO);private val mutex=Mutex()
    private val importer=MigrationImporter(context,database) { store.inspirai.library.core.Credentials(context).server() }
    private var web: WebView?=null;private var origin="https://capture.local";private var mode="records"
    private var timeout: Job?=null
    @Volatile private var generation=0
    fun start() { scope.launch { mutex.withLock {
        importer.abort()
        if(dao.journal("records-v1")?.json=="complete")withContext(Dispatchers.Main){favorites()}
        else withContext(Dispatchers.Main){origin="https://capture.local";mode="records";load()}
    } } }
    private fun armTimeout() { timeout?.cancel();timeout=scope.launch { delay(45000);withContext(Dispatchers.Main){onState("导入未完成：读取超时，可以重试",false)} } }
    private fun load() {
        generation++;web?.removeJavascriptInterface("Migration");web?.destroy();armTimeout()
        web=WebView(context).apply {
            settings.javaScriptEnabled=true;settings.domStorageEnabled=true;settings.allowFileAccess=false;settings.allowContentAccess=false
            addJavascriptInterface(Bridge(generation),"Migration")
            webViewClient=object: WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView,request: WebResourceRequest)=true
                override fun shouldInterceptRequest(view: WebView,request: WebResourceRequest): WebResourceResponse =
                    if(request.url.toString()=="$origin/native-migration.html")WebResourceResponse("text/html","utf-8",context.assets.open("native-migration.html"))
                    else WebResourceResponse("text/plain","utf-8",403,"Blocked",emptyMap(),ByteArrayInputStream(byteArrayOf()))
                override fun onPageFinished(view: WebView,url: String) { if(url=="$origin/native-migration.html")view.evaluateJavascript("run(${JSONObject.quote(mode)})",null) }
                override fun onReceivedError(view: WebView,request: WebResourceRequest,error: WebResourceError) { if(request.isForMainFrame){timeout?.cancel();onState("导入未完成：无法读取历史存储",false)} }
            }
            loadUrl("$origin/native-migration.html")
        }
    }
    private fun favorites() {
        val server=store.inspirai.library.core.Credentials(context).server()
        scope.launch {
            if(dao.journal("favorites:$server")!=null)withContext(Dispatchers.Main){timeout?.cancel();onState("",true)}
            else withContext(Dispatchers.Main){origin=server;mode="favorites";load()}
        }
    }
    inner class Bridge(private val token: Int) {
        @JavascriptInterface fun postMessage(raw: String) { scope.launch { mutex.withLock {
            if(token!=generation)return@withLock
            var id=0
            try {
                // A full document can coexist with its frozen payload and an editing draft.
                check(raw.length<2_000_000);val message=JSONObject(raw);id=message.getInt("id");val kind=message.getString("kind")
                withContext(Dispatchers.Main){armTimeout()}
                when(kind) {
                    "favorites"->{
                        val values=message.getJSONArray("data");check(values.length()<=100000)
                        database.withTransaction { for(i in 0 until values.length())dao.favorite(Favorite(origin,values.getString(i)));dao.journal(MigrationLog("favorites:$origin",values.toString())) }
                        withContext(Dispatchers.Main){timeout?.cancel();onState("",true)}
                    }
                    "error"->error(message.getJSONObject("data").optString("message","迁移失败"))
                    else->{importer.accept(kind,message.getJSONObject("data"))
                        if(kind=="recordEnd")withContext(Dispatchers.Main){onState("导入记录 ${importer.progress}",false)}
                        if(kind=="complete")withContext(Dispatchers.Main){favorites()}
                    }
                }
                withContext(Dispatchers.Main){web?.evaluateJavascript("ack($id,null)",null)}
            } catch(e: Exception) {
                importer.abort();withContext(Dispatchers.Main){timeout?.cancel();onState("导入未完成：${e.message}",false);web?.evaluateJavascript("ack($id,${JSONObject.quote(e.message?:"迁移失败")})",null)}
            }
        } } }
    }
    fun close() { generation++;importer.abort();timeout?.cancel();scope.cancel();web?.removeJavascriptInterface("Migration");web?.destroy();web=null }
}
