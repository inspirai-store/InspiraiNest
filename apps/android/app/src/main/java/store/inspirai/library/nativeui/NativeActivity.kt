package store.inspirai.library.nativeui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.*
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import store.inspirai.library.Appearance
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.design.NestTheme

open class NativeActivity: ComponentActivity() {
    private var incoming by mutableStateOf(Intent())
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent);setIntent(intent);incoming=shareRequest(intent)
    }
    private fun shareRequest(value: Intent)=Intent(value).apply {
        if(action in listOf(Intent.ACTION_SEND,Intent.ACTION_SEND_MULTIPLE) && !hasExtra("draftId"))putExtra("draftId",java.util.UUID.randomUUID().toString())
    }
    override fun onSaveInstanceState(outState: Bundle) {
        incoming.getStringExtra("draftId")?.let { outState.putString("shareDraftId",it) };super.onSaveInstanceState(outState)
    }
    private var migration: LegacyMigration?=null
    override fun onCreate(state: Bundle?) {
        setTheme(if(Appearance.dark(this))store.inspirai.library.R.style.AppTheme_Dark else store.inspirai.library.R.style.AppTheme)
        super.onCreate(state);enableEdgeToEdge()
        incoming=shareRequest(intent).apply { state?.getString("shareDraftId")?.let { putExtra("draftId",it) } }
        val repository=NestDependencies.repository(this)
        setContent {
            var mode by remember { mutableStateOf(Appearance.mode(this)) }
            var ready by remember { mutableStateOf(false) };var message by remember { mutableStateOf("检查历史资料…") }
            val dark=mode=="dark" || mode=="system" && isSystemInDarkTheme()
            SideEffect { enableEdgeToEdge(statusBarStyle=if(dark)SystemBarStyle.dark(android.graphics.Color.TRANSPARENT) else SystemBarStyle.light(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT),navigationBarStyle=if(dark)SystemBarStyle.dark(android.graphics.Color.TRANSPARENT) else SystemBarStyle.light(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT)) }
            DisposableEffect(Unit) {
                migration=LegacyMigration(this@NativeActivity) { text,complete -> message=text;ready=complete }
                migration!!.start();onDispose { migration?.close() }
            }
            NestTheme(mode) {
                key(incoming.getStringExtra("draftId")) { NativeApp(repository,ready,message,onRetryMigration={migration?.start()},onTheme={mode=it;Appearance.set(this,it)},theme=mode,
                    initialIntent=incoming,onFinish={finish()},onConnectionChanged={ready=false;message="检查资料空间…";migration?.start()}) }
            }
            LaunchedEffect(ready) { if(ready)runCatching { RecordAudioStore.recover(this@NativeActivity,repository);repository.syncRecords() } }
        }
    }
}
class NativeShareActivity: NativeActivity()
