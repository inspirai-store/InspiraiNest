package store.inspirai.library.nativeui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.ParcelFileDescriptor
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import store.inspirai.library.Appearance
import store.inspirai.library.nativeui.design.*
import store.inspirai.library.nativeui.feature.NativePdf
import store.inspirai.library.nativeui.feature.NativeAudio
import java.io.File

class NativePreviewActivity: ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val dark=Appearance.dark(this)
        setTheme(if(dark)store.inspirai.library.R.style.AppTheme_Dark else store.inspirai.library.R.style.AppTheme)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle=if(dark)SystemBarStyle.dark(android.graphics.Color.TRANSPARENT) else SystemBarStyle.light(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT),navigationBarStyle=if(dark)SystemBarStyle.dark(android.graphics.Color.TRANSPARENT) else SystemBarStyle.light(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT))
        val file=File(intent.getStringExtra("path")?:"").canonicalFile
        val permitted=listOf(cacheDir,noBackupFilesDir,File(filesDir,"capture-media")).any { file.path.startsWith(it.canonicalPath+File.separator) }
        if(!permitted || !file.isFile){finish();return}
        val name=File((intent.getStringExtra("name")?:"附件").replace('\\','/')).name.replace(Regex("[\\p{Cntrl}]")," ").ifBlank { "附件" };val mime=intent.getStringExtra("mime")?:"application/octet-stream"
        setContent { NestTheme(Appearance.mode(this)) {
            var error by remember { mutableStateOf<String?>(null) };val scope=rememberCoroutineScope()
            val saver=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(mime)) { uri -> if(uri!=null)scope.launch { runCatching { withContext(Dispatchers.IO){contentResolver.openOutputStream(uri,"w")!!.use { out->file.inputStream().use { it.copyTo(out) } }} }.onFailure { error=it.message } } }
            DetailScaffold(name,{finish()},actions={TextButton(onClick={saver.launch(name)}){Text("保存")}}) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().padding(20.dp)) {
                    error?.let { Text(it,color=MaterialTheme.colorScheme.error) }
                    when {
                        mime.startsWith("image/")-> {
                            val bitmap=remember(file.path){val options=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(file.path,options);options.inSampleSize=1;while(maxOf(options.outWidth,options.outHeight)/options.inSampleSize>2048)options.inSampleSize*=2;options.inJustDecodeBounds=false;BitmapFactory.decodeFile(file.path,options)}
                            if(bitmap!=null)Image(bitmap.asImageBitmap(),name,Modifier.weight(1f).fillMaxWidth())
                        }
                        mime=="application/pdf"->Box(Modifier.weight(1f)){NativePdf(file){error=it}}
                        mime.startsWith("audio/")->NativeAudio(file){error=it}
                        mime.startsWith("video/")->androidx.compose.ui.viewinterop.AndroidView(factory={context->android.widget.VideoView(context).apply { setVideoPath(file.path);setMediaController(android.widget.MediaController(context).also { it.setAnchorView(this) });setOnErrorListener { _,_,_->error="无法播放，可保存后用其他应用打开";true } }},onRelease={it.stopPlayback()},modifier=Modifier.fillMaxWidth().height(320.dp))
                        mime.startsWith("text/")-> { val text=remember(file.path){String(store.inspirai.library.core.InputFiles.preview(file,512*1024),Charsets.UTF_8)};if(file.length()>512*1024)Text("预览前 512 KB，保存后可查看完整文件");androidx.compose.foundation.text.selection.SelectionContainer { Text(text,Modifier.verticalScroll(rememberScrollState()),style=MaterialTheme.typography.bodyLarge) } }
                        else->Text("${file.length()/1024} KB")
                    }
                    if(!mime.startsWith("text/"))TextButton(onClick={try {
                        scope.launch { try { val target=withContext(Dispatchers.IO){val target=File(cacheDir,"native-open/${java.util.UUID.randomUUID()}/$name");target.parentFile!!.mkdirs();file.copyTo(target,true);target}
                        val uri=androidx.core.content.FileProvider.getUriForFile(this@NativePreviewActivity,"$packageName.capture",target)
                        startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                        }catch(_: Exception){error="没有可打开此文件的应用，可以先保存"} }
                    }catch(_: Exception){error="没有可打开此文件的应用，可以先保存"}}){Text("用其他应用打开")}
                }
            }
        } }
    }
}
