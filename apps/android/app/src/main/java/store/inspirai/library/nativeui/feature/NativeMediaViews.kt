package store.inspirai.library.nativeui.feature

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.media.MediaPlayer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import androidx.lifecycle.*
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.*
import java.io.File

@Composable fun NativePdf(file: File,onError: (String)->Unit) {
    var renderer by remember(file.path){mutableStateOf<PdfRenderer?>(null)}
    LaunchedEffect(file.path) { try { renderer=withContext(Dispatchers.IO){PdfRenderer(ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY))} }catch(_: Exception){onError("无法阅读此 PDF，可保存后用其他应用打开")} }
    val current=renderer?:return
    DisposableEffect(current){onDispose{synchronized(current){current.close()}}}
    LazyColumn(verticalArrangement=Arrangement.spacedBy(16.dp)) { items(current.pageCount,key={it}) { index->
        var bitmap by remember(current,index){mutableStateOf<Bitmap?>(null)}
        LaunchedEffect(current,index) { try { bitmap=withContext(Dispatchers.IO){synchronized(current){current.openPage(index).use { page->
            val scale=minOf(1000f/page.width,3000f/page.height)
            Bitmap.createBitmap((page.width*scale).toInt().coerceAtLeast(1),(page.height*scale).toInt().coerceAtLeast(1),Bitmap.Config.ARGB_8888).also { it.eraseColor(android.graphics.Color.WHITE);page.render(it,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
        }}} }catch(_: Exception){onError("第 ${index+1} 页读取失败，可以保存原件")} }
        bitmap?.let { Image(it.asImageBitmap(),"第 ${index+1} 页",Modifier.fillMaxWidth().aspectRatio(it.width.toFloat()/it.height)) }
    } }
}
@Composable fun NativeAudio(file: File,onError: (String)->Unit) {
    val player=remember(file.path){MediaPlayer()};val owner=LocalLifecycleOwner.current
    var ready by remember { mutableStateOf(false) };var playing by remember { mutableStateOf(false) }
    var duration by remember { mutableIntStateOf(0) };var position by remember { mutableIntStateOf(0) }
    DisposableEffect(player,owner) {
        player.setOnPreparedListener { duration=it.duration;ready=true }
        player.setOnCompletionListener { playing=false;position=duration }
        player.setOnErrorListener { _,_,_->playing=false;onError("无法播放此音频，可保存后用其他应用打开");true }
        runCatching { player.setDataSource(file.absolutePath);player.prepareAsync() }.onFailure { onError("无法读取音频") }
        val observer=LifecycleEventObserver { _,event->if(event==Lifecycle.Event.ON_STOP&&ready){player.pause();playing=false} }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer);player.release() }
    }
    LaunchedEffect(playing) { while(playing){position=player.currentPosition;delay(250)} }
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("${position/60000}:${(position/1000%60).toString().padStart(2,'0')} / ${duration/60000}:${(duration/1000%60).toString().padStart(2,'0')}")
        Slider(value=position.toFloat(),onValueChange={position=it.toInt();player.seekTo(position)},valueRange=0f..duration.coerceAtLeast(1).toFloat(),enabled=ready)
        Button(onClick={if(playing)player.pause() else player.start();playing=!playing},enabled=ready){Text(if(playing)"暂停" else "播放")}
    }
}
