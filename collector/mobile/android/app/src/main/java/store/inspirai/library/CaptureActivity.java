package store.inspirai.library;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Handler;
import android.net.Uri;
import android.webkit.*;
import android.util.Base64;
import android.graphics.Bitmap;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import store.inspirai.library.core.Credentials;

/** Bundled UI only: credentials stay native and the bridge is restricted to record routes. */
public class CaptureActivity extends Activity {
 private WebView web;
 private final ExecutorService io=Executors.newSingleThreadExecutor();
 private final Handler handler=new Handler();
 private Credentials credentials;
 private ValueCallback<Uri[]> picker;
 private JSONObject pendingPermission,pendingPhoto;
 private File photoFile;
 private MediaRecorder recorder;
 private File segment;
 private File mediaRoot;
 private boolean recording;
 private final Runnable rotate=new Runnable(){public void run(){if(!recording)return;try{stopSegment();startSegment();handler.postDelayed(this,10000);}catch(Exception e){recording=false;stopSegment();}}};
 @Override public void onCreate(Bundle state){super.onCreate(state);credentials=new Credentials(this);mediaRoot=new File(getFilesDir(),"capture-media");mediaRoot.mkdirs();
  web=new WebView(this);setContentView(web);web.setBackgroundColor(0xfffaf9f6);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  web.addJavascriptInterface(new Object(){@JavascriptInterface public void postMessage(String message){io.execute(()->{try{dispatch(new JSONObject(message));}catch(Exception ignored){}});}},"CaptureNative");
  web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}@Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){Uri uri=request.getUrl();if(!"https".equals(uri.getScheme())||!"capture.local".equals(uri.getHost()))return new WebResourceResponse("text/plain","utf-8",new ByteArrayInputStream(new byte[0]));String name=uri.getLastPathSegment();if(!Arrays.asList("index.html","capture.js","capture.css","store.js","bridge.js","brand.png").contains(name))return null;try{return new WebResourceResponse(name.endsWith(".js")?"application/javascript":name.endsWith(".css")?"text/css":name.endsWith(".png")?"image/png":"text/html","utf-8",getAssets().open("capture/"+name));}catch(IOException e){return null;}}});
  web.setWebChromeClient(new WebChromeClient(){@Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(picker!=null)picker.onReceiveValue(null);picker=callback;Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/jpeg","image/png","image/webp","image/gif","audio/*"}).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);try{startActivityForResult(intent,82);return true;}catch(Exception e){picker.onReceiveValue(null);picker=null;return false;}}});
  web.loadUrl("https://capture.local/index.html");
 }
 private void reply(JSONObject request,Object value,String error){try{JSONObject result=new JSONObject().put("id",request.getString("id"));if(error!=null)result.put("error",error);else result.put("value",value==null?JSONObject.NULL:value);runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.captureReply("+result.toString()+")",null);});}catch(Exception ignored){}}
 private void dispatch(JSONObject request){try{String action=request.getString("action");Object result;
  if(action.equals("status")){Credentials.Snapshot c=credentials.snapshot();result=new JSONObject().put("paired",c!=null).put("server",c==null?credentials.lastOrigin():c.server).put("nativeMedia",true).put("theme",Appearance.dark(this)?"dark":"light");}
  else if(action.equals("request"))result=network(request.getJSONObject("input"));
  else if(action.equals("navigate")){String target=request.getString("input");if(!Arrays.asList("library","tasks","settings").contains(target))throw new Exception("页面无效");runOnUiThread(()->startActivity(new Intent(this,MainActivity.class).putExtra("legacy",true).putExtra("captureTab",target.equals("library")?"资料库":target.equals("tasks")?"采集":"我的")));result=new JSONObject();}
  else if(action.equals("recover"))result=new JSONObject().put("files",recover());
  else if(action.equals("mediaAck")){String id=request.getString("input");if(!id.matches("[0-9a-fA-F-]{36}"))throw new Exception("媒体编号无效");File[] files=mediaRoot.listFiles();if(files!=null)for(File file:files)if(file.getName().startsWith(id+"."))file.delete();result=new JSONObject();}
  else if(action.equals("recordStart")||action.equals("photo")){runOnUiThread(()->permission(request,action.equals("recordStart")?Manifest.permission.RECORD_AUDIO:Manifest.permission.CAMERA));return;}
  else if(action.equals("recordStop")){runOnUiThread(()->{recording=false;handler.removeCallbacks(rotate);stopSegment();io.execute(()->{try{reply(request,new JSONObject().put("files",recover()),null);}catch(Exception e){reply(request,null,e.getMessage());}});});return;}
  else throw new Exception("不支持的操作");reply(request,result,null);
 }catch(Exception e){reply(request,null,e.getMessage());}}
 private static boolean allowed(String path,String method){return method.equals("GET")&&(path.equals("/api/state")||path.equals("/api/records")||path.matches("/api/records/[a-zA-Z0-9-]+")||path.matches("/api/records/media/[a-f0-9]{64}")||path.matches("/api/tasks/[a-zA-Z0-9-]+/draft"))||method.equals("PUT")&&(path.matches("/api/records/[a-zA-Z0-9-]+")||path.matches("/api/records/media/[a-f0-9]{64}"))||method.equals("POST")&&(path.matches("/api/records/[a-zA-Z0-9-]+/process")||path.matches("/api/tasks/[a-zA-Z0-9-]+/(approve|retry|cancel)"));}
 private JSONObject network(JSONObject input)throws Exception{Credentials.Snapshot c=credentials.snapshot();if(c==null)throw new Exception("请先连接资料空间，记录已保存在本机");String expected=input.optString("server");if(!expected.isEmpty()&&!expected.equals(c.server))throw new Exception("此记录属于另一资料空间，请恢复原连接");String route=input.getString("route"),method=input.optString("method","GET");if(!allowed(route,method))throw new Exception("接口无效");HttpURLConnection connection=(HttpURLConnection)new URL(c.server+route).openConnection();try{connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(120000);connection.setRequestMethod(method);connection.setRequestProperty("Authorization","Bearer "+c.token);
  if(input.has("bytes")||input.has("json")){byte[] bytes=input.has("bytes")?Base64.decode(input.getString("bytes"),Base64.NO_WRAP):input.getJSONObject("json").toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>32*1024*1024)throw new Exception("附件超过32 MiB");connection.setDoOutput(true);connection.setRequestProperty("Content-Type",input.has("bytes")?input.getString("mime"):"application/json");connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream output=connection.getOutputStream()){output.write(bytes);}}
  int code=connection.getResponseCode();byte[] bytes;try(InputStream stream=code<400?connection.getInputStream():connection.getErrorStream()){bytes=read(stream,64*1024*1024);}Credentials.Snapshot live=credentials.snapshot();if(live==null||!c.generation.equals(live.generation)||!c.token.equals(live.token)||!c.server.equals(live.server))throw new Exception("登录状态已改变，本机记录保留");String mime=connection.getContentType();JSONObject result=new JSONObject().put("status",code);if(mime!=null&&mime.startsWith("application/json"))result.put("json",new JSONObject(new String(bytes,StandardCharsets.UTF_8)));else result.put("bytes",Base64.encodeToString(bytes,Base64.NO_WRAP)).put("mime",mime==null?"application/octet-stream":mime);return result;
 }finally{connection.disconnect();}}
 private static byte[] read(InputStream input,int limit)throws Exception{ByteArrayOutputStream output=new ByteArrayOutputStream();if(input==null)return new byte[0];byte[] chunk=new byte[8192];int count;while((count=input.read(chunk))!=-1){if(output.size()+count>limit)throw new Exception("文件过大");output.write(chunk,0,count);}return output.toByteArray();}
 private void permission(JSONObject request,String permission){if(checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED){performMedia(request);return;}pendingPermission=request;requestPermissions(new String[]{permission},83);}
 @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){super.onRequestPermissionsResult(code,permissions,grants);if(code==83&&pendingPermission!=null){JSONObject request=pendingPermission;pendingPermission=null;if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)performMedia(request);else reply(request,null,"权限未允许，可以继续输入文字或导入文件");}}
 private void performMedia(JSONObject request){try{if(request.getString("action").equals("recordStart")){if(recording)throw new Exception("录音已开始");recording=true;startSegment();handler.postDelayed(rotate,10000);reply(request,new JSONObject(),null);}else{pendingPhoto=request;photoFile=new File(mediaRoot,UUID.randomUUID()+".camera");Uri uri=androidx.core.content.FileProvider.getUriForFile(this,getPackageName()+".capture",photoFile);Intent intent=new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).putExtra(android.provider.MediaStore.EXTRA_OUTPUT,uri).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivityForResult(intent,84);}}catch(Exception e){recording=false;reply(request,null,e.getMessage());}}
 private void startSegment()throws Exception{segment=new File(mediaRoot,UUID.randomUUID()+".active");recorder=new MediaRecorder();recorder.setAudioSource(MediaRecorder.AudioSource.MIC);recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);recorder.setOutputFile(segment.getAbsolutePath());recorder.prepare();recorder.start();}
 private void stopSegment(){if(recorder==null)return;boolean complete=false;try{recorder.stop();complete=true;}catch(RuntimeException ignored){}finally{recorder.release();recorder=null;}if(complete)segment.renameTo(new File(mediaRoot,segment.getName().replace(".active",".m4a")));}
 private JSONArray recover()throws Exception{JSONArray files=new JSONArray();File[] saved=mediaRoot.listFiles();if(saved!=null){Arrays.sort(saved,Comparator.comparingLong(File::lastModified).thenComparing(File::getName));for(File file:saved)if(file.getName().endsWith(".m4a")||file.getName().endsWith(".jpg")){String id=file.getName().substring(0,36);try(InputStream input=new FileInputStream(file)){files.put(new JSONObject().put("id",id).put("name",file.getName()).put("mime",file.getName().endsWith(".jpg")?"image/jpeg":"audio/mp4").put("bytes",Base64.encodeToString(read(input,32*1024*1024),Base64.NO_WRAP)));}}}return files;}
 @Override protected void onActivityResult(int code,int result,Intent data){super.onActivityResult(code,result,data);if(code==82&&picker!=null){Uri[] values=null;if(result==RESULT_OK&&data!=null){if(data.getClipData()!=null){values=new Uri[data.getClipData().getItemCount()];for(int i=0;i<values.length;i++)values[i]=data.getClipData().getItemAt(i).getUri();}else if(data.getData()!=null)values=new Uri[]{data.getData()};}picker.onReceiveValue(values);picker=null;}if(code==84&&pendingPhoto!=null){JSONObject request=pendingPhoto;pendingPhoto=null;if(result!=RESULT_OK){reply(request,null,null);return;}try{if(photoFile==null||photoFile.length()==0)throw new Exception("相机未返回照片");File file=new File(mediaRoot,photoFile.getName().replace(".camera",".jpg"));if(!photoFile.renameTo(file))throw new Exception("无法保存照片");io.execute(()->{try{JSONArray files=recover();for(int i=0;i<files.length();i++){JSONObject saved=files.getJSONObject(i);if(saved.getString("name").equals(file.getName())){reply(request,saved,null);return;}}}catch(Exception e){reply(request,null,e.getMessage());}});}catch(Exception e){reply(request,null,e.getMessage());}}}
 @Override protected void onPause(){super.onPause();if(recording){recording=false;handler.removeCallbacks(rotate);stopSegment();}}
 @Override protected void onDestroy(){handler.removeCallbacks(rotate);recording=false;stopSegment();if(picker!=null)picker.onReceiveValue(null);if(web!=null){web.removeJavascriptInterface("CaptureNative");web.destroy();web=null;}io.shutdown();super.onDestroy();}
}
