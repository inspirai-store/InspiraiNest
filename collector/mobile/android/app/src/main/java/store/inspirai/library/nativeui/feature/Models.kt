package store.inspirai.library.nativeui.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.json.*
import store.inspirai.library.nativeui.data.*

data class PageState(val loading: Boolean=false,val error: String?=null)
open class PageModel(val repository: NestRepository): ViewModel() {
    val status=MutableStateFlow(PageState())
    private var revision=0
    protected fun work(silent: Boolean=false,block: suspend ()->Unit): Job = viewModelScope.launch {
        val ticket=++revision
        if(!silent)status.value=PageState(loading=true)
        try { block();if(ticket==revision)status.value=PageState() } catch(e: CancellationException){throw e} catch(e: Exception){if(ticket==revision)status.value=PageState(error=e.message?:"操作失败，请重试")}
    }
    fun action(block: suspend ()->Unit)=work(block=block)
}
class LibraryModel(repository: NestRepository): PageModel(repository) {
    val entries=MutableStateFlow<List<JSONObject>>(emptyList());private var generation=0
    fun refresh(query: String) { val ticket=++generation;work { val result=repository.library(query);if(ticket==generation)entries.value=result } }
}
class ReaderModel(repository: NestRepository): PageModel(repository) {
    val entry=MutableStateFlow<JSONObject?>(null);val body=MutableStateFlow("")
    private var generation=0
    fun load(id: String,file: String?=null) { val ticket=++generation;work {
        val meta=repository.request("/api/read/v1/entry?id=${encoded(id)}")
        val text=repository.content(id,file)
        if(ticket==generation) { entry.value=meta;body.value=text }
    } }
}
class RecordsModel(repository: NestRepository): PageModel(repository) {
    val rows=repository.records.stateIn(viewModelScope,SharingStarted.WhileSubscribed(5000),emptyList())
    fun refresh()=work { repository.syncRecords() }
}
class TaskModel(repository: NestRepository): PageModel(repository) {
    val state=MutableStateFlow(JSONObject());val center=MutableStateFlow(JSONObject());val detail=MutableStateFlow<JSONObject?>(null)
    private var generation=0
    fun refresh(quiet: Boolean=false)=work(quiet) {
        val ticket=++generation;val next=repository.request("/api/state");val inbox=repository.request("/api/processing-center")
        if(ticket==generation){state.value=next;center.value=inbox}
    }
    private suspend fun loadTask(id: String) {
        val ticket=++generation;val response=repository.request("/api/state");if(ticket!=generation)return
        state.value=response
        detail.value=response.optJSONArray("tasks").objects().firstOrNull { it.optString("id")==id } ?: error("任务不存在或已不可访问")
    }
    fun task(id: String,quiet: Boolean=false)=work(quiet) { loadTask(id) }
    fun mutate(id: String,verb: String,body: JSONObject=JSONObject())=work { ++generation;repository.request("/api/tasks/${encoded(id)}/$verb","POST",body);loadTask(id) }
    fun defer(item: JSONObject,action: String)=work {
        repository.request("/api/processing-center/items/${encoded(item.getString("id"))}","POST",JSONObject().put("action",action).put("revision",item.getString("revision")));refresh()
    }
}

/** Poll while visible; each refresh changes state, never recreates the page or its controls. */
@androidx.compose.runtime.Composable fun VisiblePoll(key: Any,interval: Long=5000,refresh: ()->Unit) {
    val lifecycle=androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    val current=androidx.compose.runtime.rememberUpdatedState(refresh)
    androidx.compose.runtime.LaunchedEffect(key,lifecycle) {
        lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) { while(true){delay(interval);current.value()} }
    }
}
class AccountModel(repository: NestRepository): PageModel(repository) {
    val state=MutableStateFlow(JSONObject())
    fun refresh()=work { state.value=repository.request("/api/state") }
}
