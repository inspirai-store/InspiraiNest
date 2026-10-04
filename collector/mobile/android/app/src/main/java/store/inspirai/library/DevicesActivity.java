package store.inspirai.library;
import android.content.Intent;
import android.os.Bundle;
import org.json.*;
import android.widget.*;
import store.inspirai.library.core.*;
public class DevicesActivity extends Screen {
 @Override public void onCreate(Bundle state){super.onCreate(state);load();}
 private void load(){
  String selected=getIntent().getStringExtra("deviceId");page(selected==null?"授权设备":"设备详情","");notice("正在载入设备…");
  work(()->new Api(new Credentials(this)).call("/api/state","GET",null),s->{
   notice("");JSONArray devices=s.getJSONArray("devices");int visible=0;
   String[][] groups={{"desktop","电脑客户端"},{"mobile","移动端"},{"browser","浏览器登录"},{"integration","应用授权"},{"unknown","待识别"}};
   for(String[] group:groups){int count=0;for(int i=0;i<devices.length();i++)if(DevicePresentation.category(devices.getJSONObject(i)).equals(group[0])&&devices.getJSONObject(i).isNull("revokedAt"))count++;
   if(selected==null){if(count==0&&(group[0].equals("integration")||group[0].equals("unknown")))continue;body.addView(label(group[1]+" · "+count,20,true));}
   for(int i=0;i<devices.length();i++){
    JSONObject d=devices.getJSONObject(i);if(selected!=null&&!selected.equals(d.optString("id")))continue;if(selected==null&&!d.isNull("revokedAt"))continue;visible++;
    if(!DevicePresentation.category(d).equals(group[0])){visible--;continue;}
    LinearLayout c=card(body);String title=d.optString("displayName",d.optString("name"));c.addView(label(title,19,true));
    c.addView(label(d.optString("name")+" · "+DevicePresentation.status(d),14,false));
    if(d.has("browserExpiresAt"))c.addView(label("有效至："+d.optString("browserExpiresAt"),13,false));
    if(DevicePresentation.dispatchable(d))c.addView(label("Agent："+(d.optJSONArray("agents")==null?"无可用 Agent":d.optJSONArray("agents").join(" / ").replace("\"","")),13,false));
    JSONObject identity=d.optJSONObject("identity"),info=d.optJSONObject("deviceInfo");
    if(info!=null){if(!info.isNull("model"))c.addView(label(info.optString("model"),14,false));JSONObject client=info.optJSONObject("client");if(client!=null&&!client.isNull("version"))c.addView(label("版本 "+client.optString("version"),13,false));}
    if(identity!=null)c.addView(label(identitySource(identity.optString("source"))+" "+identity.optString("shortId"),13,false));
    else if(!d.optString("role").equals("reader"))c.addView(label("等待客户端补齐标识",13,false));
    c.addView(label("最近活动："+d.optString("lastSeen"),13,false));
    if(selected==null){c.setFocusable(true);c.setContentDescription("查看设备："+title);c.setOnClickListener(v->startActivity(new Intent(this,DevicesActivity.class).putExtra("deviceId",d.optString("id"))));}
    else{c.addView(label("授权时间："+d.optString("createdAt"),13,false));if(d.isNull("revokedAt"))button(body,"撤销此设备",()->confirm("撤销后，此设备不能再访问资料和任务。",()->work(()->new Api(new Credentials(this)).call("/api/devices/"+d.optString("id")+"/revoke","POST",new JSONObject()),v->finish())));}
   }}
   if(visible==0)body.addView(label("没有可显示的授权设备",16,false));
  });
 }
 private static String identitySource(String source){return switch(source){case "smbios","ioplatform"->"硬件标识";case "android-id"->"系统标识";case "keychain"->"Keychain 标识";case "browser-profile"->"浏览器档案";default->"本地标识";};}
}
