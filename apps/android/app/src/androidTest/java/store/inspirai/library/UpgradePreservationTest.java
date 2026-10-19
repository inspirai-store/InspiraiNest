package store.inspirai.library;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import android.database.Cursor;
import androidx.sqlite.db.SupportSQLiteDatabase;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import store.inspirai.library.nativeui.data.NativeDatabase;
import store.inspirai.library.core.*;
import static org.junit.Assert.*;

/** Run seed on the previous signed APK and verify after an in-place signed update. */
public class UpgradePreservationTest {
 private static final String DRAFT="690c1d56-e534-43a6-99ea-bb0e62a22051",SUBMISSION="afc05b65-f76c-4f8f-b7c1-e480abda82a0",SERVER="https://overlay.example.test",TOKEN="synthetic-overlay-token",TEXT="覆盖升级保留的中文原文";
 @Test public void signedUpdateRetainsCredentialsDraftAndImmutableQueue()throws Exception{
  String stage=InstrumentationRegistry.getArguments().getString("stage");if(stage==null)return;
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
  if("seed".equals(stage)){new Credentials(c).save(SERVER,TOKEN,"overlay-device");new Drafts(c).save(new JSONObject().put("id",DRAFT).put("original",TEXT).put("content",TEXT).put("extra","").put("tags","").put("autoArchive",false).put("agent","").put("deviceId",""));new Outbox(c).enqueue(new JSONObject().put("submissionId",SUBMISSION).put("content",TEXT).put("autoArchive",false),SERVER);}
  assertEquals(SERVER,new Credentials(c).server());assertEquals(TOKEN,new Credentials(c).token());assertEquals("overlay-device",new Credentials(c).deviceId());assertEquals(TEXT,new Drafts(c).read(DRAFT).getString("content"));
  JSONArray queue=new Outbox(c).list();JSONObject found=null;for(int i=0;i<queue.length();i++)if(SUBMISSION.equals(queue.getJSONObject(i).optString("id")))found=queue.getJSONObject(i);assertNotNull(found);assertEquals(TEXT,found.getJSONObject("payload").getString("content"));assertFalse(found.getJSONObject("payload").getBoolean("autoArchive"));assertEquals(SERVER,found.getString("server"));assertEquals("pending",found.getString("state"));
 }
 @Test public void signedUpdateRetainsNativeRoomRecordsFilesAndFavorites()throws Exception{
  String stage=InstrumentationRegistry.getArguments().getString("stage");if(stage==null)return;
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
  String server="https://room-overlay.example.test",record="91734b48-7e52-4234-8bb8-40750c1091e9",attachment="86d07079-6bda-4ed5-bcd6-c0ebc3bca804";
  File original=new File(c.getFilesDir(),"signed-upgrade-original.txt");
  byte[] bytes="原生资料库升级前的不可替代原件".getBytes(StandardCharsets.UTF_8);
  SupportSQLiteDatabase db=NativeDatabase.Companion.open(c).getOpenHelper().getWritableDatabase();
  if("seed".equals(stage)){
   Files.write(original.toPath(),bytes);
   JSONObject row=new JSONObject().put("id",record).put("server",server).put("text","原生资料库中的完整中文记录").put("remoteVersion",11).put("tags",new JSONArray().put("升级保留"))
    .put("payload",new JSONObject().put("requestId","room-original-write").put("baseVersion",11))
    .put("pendingProcess",new JSONObject().put("requestId","room-original-process").put("baseVersion",11));
   JSONObject file=new JSONObject().put("id",attachment).put("localPath",original.getAbsolutePath()).put("bytes",bytes.length).put("sha256",InputFiles.sha256(original));
   db.beginTransaction();try{
    db.execSQL("INSERT OR REPLACE INTO records (server,id,json,updated,draft) VALUES (?,?,?,?,?)",new Object[]{server,record,row.toString(),1L,0});
    db.execSQL("INSERT OR REPLACE INTO record_files (server,recordId,id,json) VALUES (?,?,?,?)",new Object[]{server,record,attachment,file.toString()});
    db.execSQL("INSERT OR REPLACE INTO favorites (server,id) VALUES (?,?)",new Object[]{server,record});
    db.setTransactionSuccessful();
   }finally{db.endTransaction();}
   c.getSharedPreferences("signed-upgrade-room",Context.MODE_PRIVATE).edit().putString("record",row.toString()).putString("attachment",file.toString()).commit();
  }
  try(Cursor rows=db.query("SELECT json FROM records WHERE server=? AND id=?",new Object[]{server,record})){
   assertTrue("Existing native record missing",rows.moveToFirst());assertEquals(c.getSharedPreferences("signed-upgrade-room",Context.MODE_PRIVATE).getString("record",null),rows.getString(0));
  }
  try(Cursor files=db.query("SELECT json FROM record_files WHERE server=? AND recordId=? AND id=?",new Object[]{server,record,attachment})){
   assertTrue("Existing native attachment reference missing",files.moveToFirst());assertEquals(c.getSharedPreferences("signed-upgrade-room",Context.MODE_PRIVATE).getString("attachment",null),files.getString(0));
   JSONObject file=new JSONObject(files.getString(0));assertEquals(file.getLong("bytes"),original.length());assertEquals(file.getString("sha256"),InputFiles.sha256(original));assertArrayEquals(bytes,Files.readAllBytes(original.toPath()));
  }
  try(Cursor favorites=db.query("SELECT id FROM favorites WHERE server=? AND id=?",new Object[]{server,record})){assertTrue("Existing native favorite missing",favorites.moveToFirst());}
 }

}
