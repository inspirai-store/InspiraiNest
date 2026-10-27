package store.inspirai.library.nativeui.feature

import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import androidx.compose.runtime.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

private class LearningVisualWebView(context:android.content.Context):WebView(context){
 fun updateViewport(){if(height>0)evaluateJavascript("document.documentElement.style.setProperty('--viewport-height','${(height/resources.displayMetrics.density).toInt()}px')",null)}
 override fun onSizeChanged(w:Int,h:Int,oldw:Int,oldh:Int){super.onSizeChanged(w,h,oldw,oldh);updateViewport()}
}

object LearningVisualDocument {
 fun html(template:String,id:String,dark:Boolean):String? {
  if(!id.matches(Regex("^[a-z0-9-]+$")) || !template.contains("\"id\":\"$id\""))return null
  return template.replace("data-lesson=\"overview\"","data-lesson=\"$id\"")
   .replace("data-embedded=\"false\"","data-embedded=\"true\"")
   .replace("data-theme=\"light\"",if(dark)"data-theme=\"dark\"" else "data-theme=\"light\"")
 }
}
@Composable fun LearningVisual(template:String,id:String,modifier:Modifier=Modifier) {
 val context=LocalContext.current;val dark=MaterialTheme.colorScheme.surface.luminance()<.5
 val html=remember(template,id,dark){LearningVisualDocument.html(template,id,dark)}?:return
 val view=remember(context){LearningVisualWebView(context).apply{
  settings.javaScriptEnabled=true;settings.domStorageEnabled=false;settings.allowFileAccess=false;settings.allowContentAccess=false;settings.blockNetworkLoads=true
  webViewClient=object:WebViewClient(){override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=true;override fun onPageFinished(view:WebView,url:String?){(view as? LearningVisualWebView)?.updateViewport()}}
  setBackgroundColor(android.graphics.Color.TRANSPARENT)
  setOnTouchListener { view,event -> view.parent?.requestDisallowInterceptTouchEvent(event.actionMasked!=android.view.MotionEvent.ACTION_UP && event.actionMasked!=android.view.MotionEvent.ACTION_CANCEL);false }
 }}
 DisposableEffect(view){onDispose{view.stopLoading();view.destroy()}}
 AndroidView(factory={view},modifier=modifier,update={if(it.tag!=html){it.tag=html;it.loadDataWithBaseURL(null,html,"text/html","UTF-8",null)}})
}
