package store.inspirai.library;
import android.content.Intent;
import android.os.Bundle;
import org.json.*;
import android.widget.*;
import store.inspirai.library.core.*;
public class DevicesActivity extends Screen {
 @Override public void onCreate(Bundle state){super.onCreate(state);load();}
 private void load(){String selected=getIntent().getStringExtra("deviceId");page(selected==null?"授权设备":"设备详情",selected==null?"管理可访问资料的手机与采集电脑":"");notice("正在载入设备…");work(()->new Api(new Credentials(this)).call("/api/state","GET",null),s->{notice("");JSONArray devices=s.getJSONArray("devices");int visible=0;for(int i=0;i<devices.length();i++){JSONObject d=devices.getJSONObject(i);if(selected!=null&&!selected.equals(d.optString("id")))continue;if(selected==null&&!d.isNull("revokedAt"))continue;visible++;LinearLayout c=card(body);c.addView(label(d.optString("name"),19,true));c.addView(label(!d.isNull("revokedAt")?"已撤销":d.optString("role").equals("worker")?(d.optBoolean("online")?"采集电脑 · 在线":"采集电脑 · 离线"):"管理设备",14,false));if(selected==null){c.setFocusable(true);c.setContentDescription("查看设备："+d.optString("name"));c.setOnClickListener(v->startActivity(new Intent(this,DevicesActivity.class).putExtra("deviceId",d.optString("id"))));}else{c.addView(label("授权时间："+d.optString("createdAt"),13,false));if(!d.isNull("deviceInfo"))c.addView(label(d.optJSONObject("deviceInfo").optString("model"),14,false));if(d.isNull("revokedAt"))button(body,"撤销此设备",()->confirm("撤销后，此设备不能再访问资料和任务。",()->work(()->new Api(new Credentials(this)).call("/api/devices/"+d.optString("id")+"/revoke","POST",new JSONObject()),v->finish())));}}if(visible==0)body.addView(label("没有可显示的授权设备",16,false));});}
}
