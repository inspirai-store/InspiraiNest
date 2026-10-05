package store.inspirai.library;
import android.content.*;
import android.net.Uri;
import android.webkit.*;
import android.view.View;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import store.inspirai.library.core.*;

/** Bundled presentation at the original library origin preserves existing bookmarks. */
final class LibraryPane {
 final WebView web;
 private final Screen host;
 private final Credentials credentials;
 private final java.util.function.Consumer<Boolean> depth;
 private String exportUrl;
 private boolean deep;
 LibraryPane(Screen host,String entry,java.util.function.Consumer<Boolean> depth){
  this.host=host;this.depth=depth;credentials=new Credentials(host);web=new WebView(host);web.setBackgroundColor(Appearance.background(host));web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);web.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);web.getSettings().setSupportZoom(false);web.getSettings().setBuiltInZoomControls(false);web.getSettings().setDisplayZoomControls(false);web.getSettings().setTextZoom(Math.round(host.getResources().getConfiguration().fontScale*100));CookieManager.getInstance().setAcceptCookie(false);
  web.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
    String address=r.getUrl().toString();if(!PrivateFiles.allowed(credentials.server(),address))return response("text/plain",403,"外部资源不可用".getBytes(StandardCharsets.UTF_8));
    String p=r.getUrl().getPath();try{
     if(p.startsWith("/library/mobile-next/")){String name=p.substring("/library/".length());if(!name.matches("mobile-next/(index\\.html|mobile\\.(css|js)|brand\\.png|vendor/(marked|purify)\\.js)"))return response("text/plain",404,new byte[0]);try(InputStream in=host.getAssets().open(name)){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1)out.write(block,0,n);byte[] bytes=out.toByteArray();if(name.endsWith("index.html"))bytes=new String(bytes,StandardCharsets.UTF_8).replace("<html lang=\"zh-CN\">","<html lang=\"zh-CN\" data-theme=\""+(Appearance.dark(host)?"dark":"light")+"\">").getBytes(StandardCharsets.UTF_8);return response(mime(p),200,bytes);}}
     if(p.startsWith("/library/mobile/")){String name=p.substring("/library/".length());if(!name.matches("mobile/(index\\.html|mobile\\.(css|js)|icons/(library|collect|person|bookmark|scan|update)\\.png|vendor/(marked|purify|lucide)\\.js)"))return response("text/plain",404,new byte[0]);try(InputStream in=host.getAssets().open(name)){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1)out.write(block,0,n);byte[] bytes=out.toByteArray();if(name.endsWith("index.html"))bytes=new String(bytes,StandardCharsets.UTF_8).replace("<html lang=\"zh-CN\">","<html lang=\"zh-CN\" data-theme=\""+(Appearance.dark(host)?"dark":"light")+"\" data-mode=\""+Appearance.mode(host)+"\">").getBytes(StandardCharsets.UTF_8);return response(mime(p),200,bytes);}}
     return response(mime(p),200,PrivateFiles.read(credentials,address));
    }catch(Exception e){return response("text/plain",401,"读取失败，请检查连接或重新配对".getBytes(StandardCharsets.UTF_8));}
   }
   @Override public void onPageFinished(WebView v,String url){applyTheme();updateDepth(url);}
   @Override public void doUpdateVisitedHistory(WebView v,String url,boolean reload){updateDepth(url);}
   @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){
    Uri u=r.getUrl();if("nook".equals(u.getScheme())&&r.isForMainFrame()){action(u);return true;}
    if(PrivateFiles.allowed(credentials.server(),u.toString())){if(u.getPath().startsWith("/library/files/")||u.getPath().startsWith("/library/bundle/")){save(u.toString());return true;}return false;}
    if(r.isForMainFrame()&&r.hasGesture()&&Arrays.asList("https","http").contains(u.getScheme()))try{host.startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception e){host.notice("没有可用的浏览器");}return true;
   }
  });
  web.setDownloadListener((u,a,d,m,l)->save(u));
  web.loadUrl(credentials.server()+"/library/mobile-next/index.html"+(entry==null?"":"#entry="+Uri.encode(entry)));
 }
 private void updateDepth(String address){deep=Uri.parse(address).getFragment()!=null&&!Uri.parse(address).getFragment().isEmpty();depth.accept(deep);}
 private void action(Uri uri){try{switch(uri.getHost()){
  case "theme":host.appearance();break;
  case "new":host.startActivity(new Intent(host,ShareActivity.class));break;
  case "exit":host.finish();break;
  case "copy":String entry=uri.getQueryParameter("entry");if(entry!=null){((android.content.ClipboardManager)host.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("资料地址",credentials.server()+"/library/#entry="+Uri.encode(entry)));android.widget.Toast.makeText(host,"资料地址已复制",android.widget.Toast.LENGTH_SHORT).show();}break;
  case "save":String file=uri.getQueryParameter("file");if(file!=null&&file.startsWith("files/"))save(credentials.server()+"/library/"+Uri.encode(file,"/"));break;
  case "attachment":String archive=uri.getQueryParameter("archive"),f=uri.getQueryParameter("file");if(archive==null||!archive.matches("[a-f0-9]{64}")||f==null||!f.startsWith("files/"+archive+"/"))return;String relative=f.substring(("files/"+archive+"/").length());
   if(relative.toLowerCase(Locale.ROOT).endsWith(".pdf"))host.startActivity(new Intent(host,PdfActivity.class).putExtra("route","/api/archives/"+archive).putExtra("file",relative));
   else host.startActivity(new Intent(host,BundleActivity.class).putExtra("route","/api/archives/"+archive).putExtra("file",relative));break;
 }}catch(Exception e){host.fail(e);}}
 void applyTheme(){web.setBackgroundColor(Appearance.background(host));web.getSettings().setTextZoom(Math.round(host.getResources().getConfiguration().fontScale*100));web.evaluateJavascript("window.NookTheme && window.NookTheme("+org.json.JSONObject.quote(Appearance.mode(host))+","+Appearance.dark(host)+")",null);}
 boolean isDeep(){return deep;}
 boolean back(){web.evaluateJavascript("window.NookBack && window.NookBack()",null);return true;}
 private void save(String url){if(!PrivateFiles.allowed(credentials.server(),url))return;exportUrl=url;host.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(mime(Uri.parse(url).getPath())).addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,Uri.parse(url).getLastPathSegment()),80);}
 void result(int request,int result,Intent data){if(request==80&&result==android.app.Activity.RESULT_OK&&data!=null&&exportUrl!=null){String u=exportUrl;Uri uri=data.getData();host.work(()->{byte[] bytes=PrivateFiles.read(credentials,u);try(OutputStream out=host.getContentResolver().openOutputStream(uri,"w")){if(out==null)throw new IOException("无法保存附件");out.write(bytes);}return true;},v->android.widget.Toast.makeText(host,"附件已保存",android.widget.Toast.LENGTH_SHORT).show());}}
 void destroy(){web.stopLoading();web.clearCache(true);web.destroy();}
 private static String mime(String p){p=p.toLowerCase(Locale.ROOT);if(p.endsWith(".html"))return "text/html";if(p.endsWith(".js"))return "text/javascript";if(p.endsWith(".css"))return "text/css";if(p.endsWith(".jpg")||p.endsWith(".jpeg"))return "image/jpeg";if(p.endsWith(".png"))return "image/png";if(p.endsWith(".webp"))return "image/webp";if(p.endsWith(".avif"))return "image/avif";if(p.endsWith(".gif"))return "image/gif";if(p.endsWith(".pdf"))return "application/pdf";if(p.endsWith("/data")||p.endsWith(".json"))return "application/json";return "text/plain";}
 private static WebResourceResponse response(String type,int code,byte[] bytes){Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");return new WebResourceResponse(type,"utf-8",code,code==200?"OK":"Blocked",headers,new ByteArrayInputStream(bytes));}
}
