package store.inspirai.library.nativeui.content

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import org.json.JSONObject
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.feature.openCachedFile

/** Resolve only paths already registered in this entry; never fetch arbitrary Markdown URLs. */
fun documentImage(files: List<JSONObject>,current: String?,destination: String): JSONObject? {
    val path=android.net.Uri.decode(destination.substringBefore('#').substringBefore('?'))
    if(path.contains(":")||path.startsWith("/"))return null
    fun normalized(value: String): String? { val parts=mutableListOf<String>();for(part in value.replace('\\','/').split('/'))when(part){"","."->Unit;".."->if(parts.isEmpty())return null else parts.removeAt(parts.lastIndex);else->parts+=part};return parts.joinToString("/") }
    val parent=current?.substringBeforeLast('/',"")?.takeIf { it.isNotBlank() }?.plus("/")?:""
    val candidates=listOfNotNull(normalized(parent+path),normalized(path))
    return candidates.firstNotNullOfOrNull { candidate->files.firstOrNull { it.optString("path")==candidate } }
}
@Composable fun ReaderImage(repository: NestRepository,id: String,file: JSONObject?,alt: String) {
    val context=LocalContext.current;val scope=rememberCoroutineScope()
    var cached by remember(file?.toString()) { mutableStateOf<java.io.File?>(null) }
    var bitmap by remember(file?.toString()) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var error by remember(file?.toString()) { mutableStateOf<String?>(null) };var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(file?.toString(),retry) {
        if(file==null){error="图片未收录";return@LaunchedEffect}
        try {
            val downloaded=repository.download("/api/read/v1/file?id=${encoded(id)}&file=${encoded(file.getString("path"))}",file)
            bitmap=withContext(Dispatchers.IO){val options=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true};android.graphics.BitmapFactory.decodeFile(downloaded.path,options);options.inSampleSize=1;while(maxOf(options.outWidth,options.outHeight)/options.inSampleSize>1440)options.inSampleSize*=2;options.inJustDecodeBounds=false;android.graphics.BitmapFactory.decodeFile(downloaded.path,options)}
            cached=downloaded;check(bitmap!=null){"无法预览图片"}
        }catch(e: Exception){error=e.message?:"图片加载失败"}
    }
    bitmap?.let { image->Image(image.asImageBitmap(),alt.ifBlank{"正文图片"},Modifier.fillMaxWidth().heightIn(max=600.dp).clickable { cached?.let { openCachedFile(context,it,file!!.getString("path").substringAfterLast('/'),"image/"+file.getString("path").substringAfterLast('.')) } }) }
    if(bitmap==null)TextButton(onClick={error=null;retry++},enabled=file!=null) { Text(error?:"正在读取图片…") }
}
