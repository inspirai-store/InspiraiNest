package store.inspirai.library;
import android.app.Instrumentation;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.core.content.FileProvider;
import org.json.*;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import store.inspirai.library.core.*;
import static org.junit.Assert.*;

public class InputShareFlowTest {
 @Test public void mixedShareSelectionFiltersAndRecreationKeepPrivateCopies()throws Exception{
  Instrumentation test=InstrumentationRegistry.getInstrumentation();Context c=test.getTargetContext();File folder=new File(c.getCacheDir(),"input-files");folder.mkdirs();File a=new File(folder,"中文分享.txt"),b=new File(folder,"配图.png");
  try(FileOutputStream out=new FileOutputStream(a)){out.write("中文附件全文\n保留第二段。".getBytes(StandardCharsets.UTF_8));}try(FileOutputStream out=new FileOutputStream(b)){out.write(android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",0));}
  String shareText="比较附件内容 "+UUID.randomUUID();Uri first=FileProvider.getUriForFile(c,c.getPackageName()+".inputs",a),second=FileProvider.getUriForFile(c,c.getPackageName()+".inputs",b);ArrayList<Uri> uris=new ArrayList<>(Arrays.asList(first,second));Intent share=new Intent(c,ShareActivity.class).setAction(Intent.ACTION_SEND_MULTIPLE).setType("*/*").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_GRANT_READ_URI_PERMISSION).putExtra(Intent.EXTRA_TEXT,shareText).putParcelableArrayListExtra(Intent.EXTRA_STREAM,uris);ClipData clip=ClipData.newRawUri("one",first);clip.addItem(new ClipData.Item(second));share.setClipData(clip);
  ShareActivity activity=(ShareActivity)test.startActivitySync(share);String id=null;
  try{
   long deadline=SystemClock.uptimeMillis()+30000;JSONObject draft=null;
   while(SystemClock.uptimeMillis()<deadline){JSONArray drafts=new Drafts(c).list();for(int i=0;i<drafts.length();i++){JSONObject candidate=drafts.getJSONObject(i);if(shareText.equals(candidate.optString("original")))draft=candidate;}if(draft!=null&&draft.optJSONArray("attachments")!=null&&draft.getJSONArray("attachments").length()==2&&"ready".equals(draft.getJSONArray("attachments").getJSONObject(0).optString("state"))&&"ready".equals(draft.getJSONArray("attachments").getJSONObject(1).optString("state")))break;SystemClock.sleep(100);}
   assertNotNull(draft);id=draft.getString("id");JSONArray files=draft.getJSONArray("attachments");assertEquals(2,files.length());assertEquals(2,InputFiles.selected(files).length());
   String savedId=id;test.runOnMainSync(()->{require(activity.body,"图片",Button.class).performClick();assertNull(find(activity.body,"中文分享.txt",CheckBox.class));CheckBox image=require(activity.body,"配图.png",CheckBox.class);image.setChecked(false);require(activity.body,"全部",Button.class).performClick();assertTrue(require(activity.body,"中文分享.txt",CheckBox.class).isChecked());assertFalse(require(activity.body,"配图.png",CheckBox.class).isChecked());});
   files=new Drafts(c).read(id).getJSONArray("attachments");assertEquals(1,InputFiles.selected(files).length());String fileId=files.getJSONObject(0).getString("id");assertEquals(files.getJSONObject(0).getString("sha256"),InputFiles.sha256(new InputFiles(c).file(id,fileId)));a.delete();b.delete();
   test.runOnMainSync(activity::finish);test.waitForIdleSync();ShareActivity restored=(ShareActivity)test.startActivitySync(new Intent(c,ShareActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("draftId",savedId));
   try{test.runOnMainSync(()->{assertTrue(require(restored.body,"中文分享.txt",CheckBox.class).isChecked());assertFalse(require(restored.body,"配图.png",CheckBox.class).isChecked());});}finally{test.runOnMainSync(restored::finish);}
  }finally{test.runOnMainSync(activity::finish);if(id!=null){new Drafts(c).remove(id);new InputFiles(c).discard(id);}a.delete();b.delete();}
 }
 private static <T extends TextView>T require(View root,String text,Class<T> type){T found=find(root,text,type);assertNotNull(text,found);return found;}
 private static <T extends TextView>T find(View root,String text,Class<T> type){if(type.isInstance(root)&&text.contentEquals(((TextView)root).getText()))return type.cast(root);if(root instanceof ViewGroup){ViewGroup group=(ViewGroup)root;for(int i=0;i<group.getChildCount();i++){T found=find(group.getChildAt(i),text,type);if(found!=null)return found;}}return null;}
}
