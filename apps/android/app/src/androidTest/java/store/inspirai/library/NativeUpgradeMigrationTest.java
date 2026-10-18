package store.inspirai.library;

import android.app.Instrumentation;
import android.content.*;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.SystemClock;
import android.webkit.*;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import java.io.File;
import java.util.concurrent.atomic.AtomicReference;
import store.inspirai.library.core.InputFiles;
import static org.junit.Assert.*;

/** Seed through the original WebView engine on 1.3.13, verify after same-key replacement. */
public class NativeUpgradeMigrationTest {
 private static final String ID="461ad3c1-ea14-4d79-93a6-52e257ba84a1",FILE="10f7c1cb-303e-41bf-9627-260253908a2c",SERVER="https://overlay.example.test";
 @Test public void legacyIndexedDbAndFavoritesSurviveNativeMigration() throws Exception {
  String stage=InstrumentationRegistry.getArguments().getString("stage");if(stage==null)return;
  Instrumentation test=InstrumentationRegistry.getInstrumentation();Context context=test.getTargetContext();
  if(stage.equals("seed")) {
   final WebView[] web={null};
   test.runOnMainSync(()->{web[0]=new WebView(context);web[0].getSettings().setJavaScriptEnabled(true);web[0].getSettings().setDomStorageEnabled(true);web[0].setWebViewClient(new WebViewClient(){@Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return new WebResourceResponse("text/html","utf-8",new java.io.ByteArrayInputStream("<html>seed</html>".getBytes(java.nio.charset.StandardCharsets.UTF_8)));}});web[0].loadUrl("https://capture.local/native-seed.html");});
   SystemClock.sleep(1500);
   String row=new JSONObject().put("id",ID).put("server",SERVER).put("text","升级前的完整中文记录").put("createdAt","2026-10-16T10:00:00Z").put("remoteVersion",7).put("sync","pending")
    .put("payload",new JSONObject().put("requestId","upgrade-same-write").put("baseVersion",7).put("text","未确认正文"))
    .put("pendingProcess",new JSONObject().put("requestId","upgrade-same-process").put("baseVersion",7)).toString();
   String script="window.seedDone=false;(async()=>{const r="+row+";r.attachments=[{id:'"+FILE+"',name:'原始中文.txt',mime:'text/plain',blob:new Blob(['真实迁移附件正文'],{type:'text/plain'}),bytes:new TextEncoder().encode('真实迁移附件正文').length}];const db=await new Promise((a,b)=>{const q=indexedDB.open('inspirainest-capture-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('items',{keyPath:'id'});q.onsuccess=()=>a(q.result);q.onerror=()=>b(q.error)});await new Promise((a,b)=>{const tx=db.transaction('items','readwrite');tx.objectStore('items').put(r);tx.oncomplete=a;tx.onerror=()=>b(tx.error)});db.close();window.seedDone=true})().catch(e=>window.seedError=String(e));";
   test.runOnMainSync(()->web[0].evaluateJavascript(script,null));awaitJs(test,web[0],"window.seedDone===true");
   test.runOnMainSync(()->web[0].loadUrl(SERVER+"/native-seed.html"));SystemClock.sleep(1000);
   test.runOnMainSync(()->web[0].evaluateJavascript("localStorage.setItem('personal-library-favorites',JSON.stringify(['upgrade-original-favorite']));window.favoriteDone=true",null));awaitJs(test,web[0],"window.favoriteDone===true");
   // LocalStorage commits asynchronously. Keep the document alive through its flush,
   // and verify persistence across a renderer/document reload before replacing the APK.
   SystemClock.sleep(6000);test.runOnMainSync(()->web[0].reload());SystemClock.sleep(1000);
   awaitJs(test,web[0],"localStorage.getItem('personal-library-favorites')===JSON.stringify(['upgrade-original-favorite'])");
   test.runOnMainSync(()->web[0].destroy());
   File previous=new File(context.getNoBackupFilesDir(),"native-records.sqlite");
   if(previous.isFile())try(SQLiteDatabase db=SQLiteDatabase.openDatabase(previous.getPath(),null,SQLiteDatabase.OPEN_READWRITE)){
    db.beginTransaction();try {
     for(String key:new String[]{"records-v1","records-v1-report","legacy:"+SERVER+":"+ID,"favorites:"+SERVER})db.delete("migration","`key`=?",new String[]{key});
     db.delete("records","server=? AND id=?",new String[]{SERVER,ID});
     db.delete("record_files","server=? AND recordId=?",new String[]{SERVER,ID});
     db.delete("favorites","server=? AND id=?",new String[]{SERVER,"upgrade-original-favorite"});
     db.setTransactionSuccessful();
    }finally{db.endTransaction();}
   }
   context.getSharedPreferences("native-upgrade-qa",Context.MODE_PRIVATE).edit().putLong("seededAt",System.currentTimeMillis()).commit();
   return;
  }
  test.startActivitySync(new Intent().setClassName(context,"store.inspirai.library.nativeui.NativeActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  File dbFile=new File(context.getNoBackupFilesDir(),"native-records.sqlite");long until=SystemClock.uptimeMillis()+45000;
  boolean complete=false;
  while(SystemClock.uptimeMillis()<until){
   if(dbFile.isFile())try(SQLiteDatabase db=SQLiteDatabase.openDatabase(dbFile.getPath(),null,SQLiteDatabase.OPEN_READONLY);Cursor c=db.rawQuery("SELECT json FROM migration WHERE `key`='records-v1'",null)){if(c.moveToFirst()&&c.getString(0).equals("complete")){complete=true;break;}}catch(Exception ignored){}
   SystemClock.sleep(250);
  }
  assertTrue("Native migration did not finish",complete);
  try(SQLiteDatabase db=SQLiteDatabase.openDatabase(dbFile.getPath(),null,SQLiteDatabase.OPEN_READONLY)) {
   try(Cursor rows=db.rawQuery("SELECT json FROM records WHERE server=? AND id=?",new String[]{SERVER,ID})){
    assertTrue(rows.moveToFirst());JSONObject row=new JSONObject(rows.getString(0));assertEquals("升级前的完整中文记录",row.getString("text"));assertEquals(7,row.getInt("remoteVersion"));assertEquals("upgrade-same-write",row.getJSONObject("payload").getString("requestId"));assertEquals("upgrade-same-process",row.getJSONObject("pendingProcess").getString("requestId"));
   }
   try(Cursor files=db.rawQuery("SELECT json FROM record_files WHERE server=? AND recordId=?",new String[]{SERVER,ID})){assertTrue(files.moveToFirst());JSONObject file=new JSONObject(files.getString(0));File original=new File(file.getString("localPath"));assertEquals(file.getLong("bytes"),original.length());assertEquals(file.getString("sha256"),InputFiles.sha256(original));}
   // Favorites follow the server origin rather than capture.local.
   boolean favorite=false;until=SystemClock.uptimeMillis()+15000;
   while(SystemClock.uptimeMillis()<until){try(Cursor favorites=db.rawQuery("SELECT id FROM favorites WHERE server=? AND id=?",new String[]{SERVER,"upgrade-original-favorite"})){favorite=favorites.moveToFirst();}if(favorite)break;SystemClock.sleep(250);}assertTrue("Favorite missing",favorite);
   File audit=new File(context.getExternalFilesDir(null),"native-qa/migration-audit.json");audit.getParentFile().mkdirs();
   try(Cursor report=db.rawQuery("SELECT json FROM migration WHERE `key`='records-v1-report'",null)){
    assertTrue(report.moveToFirst());JSONObject result=new JSONObject(report.getString(0));
    assertTrue("Migration must run after this baseline seed",java.time.Instant.parse(result.getString("verifiedAt")).toEpochMilli()>=context.getSharedPreferences("native-upgrade-qa",Context.MODE_PRIVATE).getLong("seededAt",Long.MAX_VALUE));
    result.put("upgradeVerifiedAt",java.time.Instant.now().toString()).put("recordIdPreserved",true).put("writeRequestIdPreserved",true).put("processRequestIdPreserved",true).put("versionPreserved",true).put("fileSizeAndSha256Verified",true).put("serverFavoritePreserved",true);
    try(java.io.FileOutputStream out=new java.io.FileOutputStream(audit)){out.write(result.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
   }
  }
 }
 private static void awaitJs(Instrumentation test,WebView web,String expression) throws Exception {
  long until=SystemClock.uptimeMillis()+15000;AtomicReference<String> value=new AtomicReference<>("");
  while(SystemClock.uptimeMillis()<until){test.runOnMainSync(()->web.evaluateJavascript(expression,value::set));SystemClock.sleep(100);if("true".equals(value.get()))return;}
  fail("Web storage seeding failed");
 }
}
