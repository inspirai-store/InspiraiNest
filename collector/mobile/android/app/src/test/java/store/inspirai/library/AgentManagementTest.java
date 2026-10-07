package store.inspirai.library;
import android.app.AlertDialog;
import android.content.Intent;
import android.view.*;
import android.widget.*;
import org.json.*;
import org.junit.*;
import static org.junit.Assert.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.*;
import org.robolectric.shadows.*;
import store.inspirai.library.core.*;
@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,shadows={AgentManagementTest.Paired.class,AgentManagementTest.AgentApi.class},instrumentedPackages={"store.inspirai.library.core"})
public class AgentManagementTest {
 static final String id="00000000-0000-4000-8000-000000000001";
 static Button button(View v,String text){if(v instanceof Button&&((Button)v).getText().toString().equals(text))return(Button)v;if(v instanceof ViewGroup)for(int n=0;n<((ViewGroup)v).getChildCount();n++){Button b=button(((ViewGroup)v).getChildAt(n),text);if(b!=null)return b;}return null;}
 static String text(View v){String s=v instanceof TextView?((TextView)v).getText()+"\n":"";if(v instanceof ViewGroup)for(int n=0;n<((ViewGroup)v).getChildCount();n++)s+=text(((ViewGroup)v).getChildAt(n));return s;}
 static void waitFor(java.util.function.BooleanSupplier condition)throws Exception{for(int n=0;n<150&&!condition.getAsBoolean();n++){Thread.sleep(10);ShadowLooper.idleMainLooper();}assertTrue(condition.getAsBoolean());}
 @Test public void realAgentListCreatesBoundOperationAndCancelsOfflineQueue()throws Exception{
  AgentApi.operation=null;AgentApi.created=null;
  var c=Robolectric.buildActivity(AgentsActivity.class,new Intent().putExtra("deviceId",id).putExtra("nodeName","Target").putExtra("supported",true)).create().start().resume().visible();var a=c.get();View root=a.getWindow().getDecorView();
  waitFor(()->button(root,"安装")!=null&&button(root,"安装").isEnabled());
  for(String name:new String[]{"Codex","CodeBuddy","Claude Code","Gemini CLI","OpenCode"})assertTrue(text(root).contains(name));
  button(root,"安装").performClick();AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog();assertTrue(dialog.isShowing());assertTrue("Install preview shows target",text(dialog.getWindow().getDecorView()).contains("Target"));dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
  waitFor(()->AgentApi.created!=null);assertEquals(id,AgentApi.created.getString("deviceId"));assertEquals("managed",AgentApi.created.getString("method"));assertEquals("b".repeat(64),AgentApi.created.getString("expectedFingerprint"));
  waitFor(()->text(root).contains("等待节点"));button(root,"取消").performClick();waitFor(()->AgentApi.operation!=null&&AgentApi.operation.optString("state").equals("cancelled"));c.pause().stop().destroy();
 }
 @Test public void oldClientCannotInstall()throws Exception{
  var c=Robolectric.buildActivity(AgentsActivity.class,new Intent().putExtra("deviceId",id).putExtra("supported",false)).create().start().resume().visible();View root=c.get().getWindow().getDecorView();assertTrue(text(root).contains("需更新客户端"));assertFalse(button(root,"安装").isEnabled());c.pause().stop().destroy();
 }
 @Implements(value=Credentials.class,isInAndroidSdk=false)public static class Paired {
  @Implementation protected Credentials.Snapshot snapshot()throws Exception{var constructor=Credentials.Snapshot.class.getDeclaredConstructor(String.class,String.class,String.class,String.class);constructor.setAccessible(true);return constructor.newInstance("https://fixture.invalid","fixture",id,"generation");}
 }
 @Implements(value=Api.class,isInAndroidSdk=false)public static class AgentApi {
  static volatile JSONObject created,operation;
  @Implementation protected JSONObject agentCall(Credentials.Snapshot snapshot,String path,String method,JSONObject input)throws Exception{
   if(path.endsWith("/cancel")){operation.put("state","cancelled");return operation;}
   if(method.equals("POST")){created=input;operation=new JSONObject().put("id","a".repeat(64)).put("agent",input.optString("agent")).put("state","queued");return operation;}
   if(path.contains("operations"))return new JSONObject().put("operations",operation==null?new JSONArray():new JSONArray().put(operation));
   JSONArray agents=new JSONArray();for(String agent:new String[]{"codex","codebuddy","claude","gemini","opencode"})agents.put(new JSONObject().put("id",agent).put("name",agent).put("installed",false).put("fingerprint","b".repeat(64)).put("originalSupported",false).put("probeState","not_found").put("release",new JSONObject().put("version","1.2.3")));
   return new JSONObject().put("agents",agents);
  }
 }
}
