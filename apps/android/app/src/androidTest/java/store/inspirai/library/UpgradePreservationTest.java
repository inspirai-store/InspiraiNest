package store.inspirai.library;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
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
}
