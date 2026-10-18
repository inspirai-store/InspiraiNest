package store.inspirai.library;
import static org.junit.Assert.*;
import android.content.Intent;
import android.view.*;
import android.widget.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.*;
import org.robolectric.shadows.ShadowLooper;
import store.inspirai.library.core.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,shadows={DeviceSkillsTest.SkillApi.class,DeviceSkillsTest.Paired.class},instrumentedPackages={"store.inspirai.library.core"})
public class DeviceSkillsTest {
 static String id="00000000-0000-4000-8000-000000000001";
 static Button button(View view,String text){if(view instanceof Button&&((Button)view).getText().toString().equals(text))return (Button)view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){Button found=button(((ViewGroup)view).getChildAt(i),text);if(found!=null)return found;}return null;}
 static String text(View view){String result=view instanceof TextView?((TextView)view).getText().toString()+"\n":"";if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)result+=text(((ViewGroup)view).getChildAt(i));return result;}
 @Test public void realDeviceDetailOpensPaginatedReadOnlyInventory()throws Exception{
  SkillApi.pages=0;var controller=Robolectric.buildActivity(DevicesActivity.class,new Intent().putExtra("deviceId",id)).create().start().resume().visible();var activity=controller.get();View root=activity.getWindow().getDecorView();
  for(int i=0;i<100&&button(root,"节点技能")==null;i++){Thread.sleep(10);ShadowLooper.idleMainLooper();}assertNotNull(button(root,"节点技能"));button(root,"节点技能").performClick();
  for(int i=0;i<100&&button(activity.getWindow().getDecorView(),"刷新")==null;i++){Thread.sleep(10);ShadowLooper.idleMainLooper();}
  String visible=text(activity.getWindow().getDecorView());assertEquals(2,SkillApi.pages);assertTrue(visible.contains("wechat-fixture"));assertTrue(visible.contains("Python 模块：requests"));assertTrue(visible.contains("加载未确认"));assertTrue(visible.contains("提取未验证"));assertNull(button(activity.getWindow().getDecorView(),"同步"));controller.pause().stop().destroy();
 }
 @Implements(value=Credentials.class,isInAndroidSdk=false) public static class Paired {@Implementation protected String server(){return "https://fixture.invalid";}}
 @Implements(value=Api.class,isInAndroidSdk=false) public static class SkillApi {
  static volatile int pages;
  @Implementation protected JSONObject call(String path,String method,JSONObject body)throws Exception{return new JSONObject("{\"devices\":[{\"id\":\""+id+"\",\"name\":\"Fixture\",\"role\":\"worker\",\"clientType\":\"worker\",\"revokedAt\":null,\"workerAuthorized\":true,\"agents\":[\"codex\"]}]}");}
  @Implementation protected JSONObject skillEnvironment(String origin,String deviceId,int offset,String snapshot)throws Exception{
   assertEquals("https://fixture.invalid",origin);assertEquals(id,deviceId);pages++;
   JSONObject response=new JSONObject("{\"schemaVersion\":1,\"snapshotId\":\""+"a".repeat(64)+"\",\"scannedAt\":\"2026-10-07T00:00:00Z\",\"agents\":[],\"nextOffset\":null,\"items\":[]}");
   if(offset==0)response.put("nextOffset",40).getJSONArray("items").put(new JSONObject("{\"name\":\"wechat-fixture\",\"agent\":\"codex\",\"source\":\"user\",\"loadState\":\"unknown\",\"dependencies\":{\"missing\":[\"Python 模块：requests\"],\"unknown\":[]},\"verification\":null,\"issue\":null}"));
   else assertEquals("a".repeat(64),snapshot);return response;
  }
 }
}
