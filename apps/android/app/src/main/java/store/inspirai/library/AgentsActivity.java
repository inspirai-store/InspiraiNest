package store.inspirai.library;
import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.*;
import org.json.*;
import java.util.*;
import store.inspirai.library.core.*;

public class AgentsActivity extends Screen {
 private final Handler poll=new Handler(Looper.getMainLooper());
 private final String[] ids={"codex","codebuddy","claude","gemini","opencode"};
 private final String[] names={"Codex","CodeBuddy","Claude Code","Gemini CLI","OpenCode"};
 private final Map<String,Row> rows=new HashMap<>();
 private Credentials.Snapshot pairing;private String deviceId,nodeName;private boolean supported,loading,busy,resumed;
 private JSONArray agents=new JSONArray(),catalog=new JSONArray(),operations=new JSONArray();
 private Button refresh;private AlertDialog installDialog;
 private final Runnable ticker=new Runnable(){public void run(){if(!resumed)return;load(false);poll.postDelayed(this,3000);}};
 private static class Row {TextView version,state,error;Button action,cancel;}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);deviceId=getIntent().getStringExtra("deviceId");nodeName=getIntent().getStringExtra("nodeName");supported=getIntent().getBooleanExtra("supported",false);
  try{pairing=new Credentials(this).snapshot();}catch(Exception e){finish();return;}
  page("Agent","");refresh=button(body,"刷新",()->{JSONObject op=find(operations,"action","refresh");if(pending(op))cancel("refresh");else submit(null,"managed");});
  for(int n=0;n<ids.length;n++){
   String id=ids[n];LinearLayout row=new LinearLayout(this);row.setPadding(0,dp(12),0,dp(12));row.setGravity(android.view.Gravity.CENTER_VERTICAL);body.addView(row);
   LinearLayout identity=new LinearLayout(this);identity.setOrientation(LinearLayout.VERTICAL);row.addView(identity,new LinearLayout.LayoutParams(0,-2,1));identity.addView(label(names[n],16,true));
   Row value=new Row();value.version=label("—",14,false);identity.addView(value.version);value.state=label("未上报",14,false);row.addView(value.state);
   LinearLayout actions=new LinearLayout(this);row.addView(actions);value.action=button(actions,"安装",()->choose(id));value.cancel=button(actions,"取消",()->cancel(id));
   value.error=label("",14,false);body.addView(value.error);rows.put(id,value);rule(body);
  }
  render();load(true);
 }
 @Override protected void onResume(){super.onResume();resumed=true;poll.postDelayed(ticker,3000);}
 @Override protected void onPause(){resumed=false;poll.removeCallbacks(ticker);super.onPause();}
 @Override protected void onDestroy(){poll.removeCallbacks(ticker);if(installDialog!=null)installDialog.dismiss();super.onDestroy();}
 private JSONObject find(JSONArray list,String key,String value){for(int n=0;n<list.length();n++){JSONObject o=list.optJSONObject(n);if(o!=null&&value.equals(o.optString(key)))return o;}return null;}
 private boolean pending(JSONObject op){return op!=null&&Arrays.asList("queued","running","cancel_requested").contains(op.optString("state"));}
 private String stateLabel(String value){return switch(value){case "queued"->"等待节点";case "running"->"执行中";case "cancel_requested"->"取消中";case "cancelled"->"已取消";case "expired"->"已过期";case "failed"->"失败";default->"已完成";};}
 private void render(){
  JSONObject refreshOp=find(operations,"action","refresh");refresh.setText(pending(refreshOp)?"取消刷新":"刷新");refresh.setEnabled(supported&&!busy&&(refreshOp==null||!refreshOp.optString("state").equals("cancel_requested")));
  for(String id:ids){Row row=rows.get(id);JSONObject agent=find(agents,"id",id),op=find(operations,"agent",id),entry=find(catalog,"id",id);
   row.version.setText(agent==null||agent.isNull("version")?"—":agent.optString("version"));
   row.state.setText(!supported?"需更新客户端":pending(op)?stateLabel(op.optString("state")):agent==null?"未上报":agent.optBoolean("installed")?"已安装":agent.optString("probeState").equals("not_found")?"未安装":"检测失败");
   row.action.setText(agent!=null&&agent.optBoolean("installed")?"更新":"安装");row.action.setEnabled(supported&&!busy&&!pending(op)&&agent!=null&&!agent.optBoolean("custom")&&entry!=null&&entry.optJSONObject("release")!=null);
   row.action.setVisibility(pending(op)?android.view.View.GONE:android.view.View.VISIBLE);row.cancel.setVisibility(pending(op)?android.view.View.VISIBLE:android.view.View.GONE);row.cancel.setEnabled(!busy&&op!=null&&!op.optString("state").equals("cancel_requested"));
   String error=op!=null&&op.optString("state").equals("failed")&&op.optJSONObject("result")!=null?op.optJSONObject("result").optString("error",""):"";row.error.setText(error);row.error.setVisibility(error.isEmpty()?android.view.View.GONE:android.view.View.VISIBLE);
  }
 }
 private void load(boolean initial){if(loading)return;loading=true;final boolean fetchCatalog=initial||catalog.length()==0;
  work(()->{Api api=new Api(new Credentials(this));JSONObject response=api.agentCall(pairing,"/api/agents/devices/"+deviceId+"/environment","GET",null);response.put("operations",api.agentCall(pairing,"/api/agents/operations?deviceId="+deviceId,"GET",null).getJSONArray("operations"));if(fetchCatalog)response.put("catalog",api.agentCall(pairing,"/api/agents/catalog","GET",null).getJSONArray("agents"));return response;},response->{loading=false;agents=response.getJSONArray("agents");operations=response.getJSONArray("operations");if(fetchCatalog)catalog=response.getJSONArray("catalog");render();});
 }
 private void choose(String id){JSONObject agent=find(agents,"id",id),entry=find(catalog,"id",id);if(agent==null||entry==null)return;
  LinearLayout form=new LinearLayout(this);form.setPadding(dp(24),dp(12),dp(24),dp(12));form.setOrientation(LinearLayout.VERTICAL);
  form.addView(label("目标节点",14,true));form.addView(label(nodeName,16,false));form.addView(label("目标版本",14,true));form.addView(label(entry.optJSONObject("release").optString("version"),16,false));form.addView(label("安装方式",14,true));
  Spinner method=new Spinner(this);String[] choices=agent.optBoolean("originalSupported")?new String[]{"灵藏托管","原有安装"}:new String[]{"灵藏托管"};method.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,choices));form.addView(method);
  installDialog=new AlertDialog.Builder(this).setTitle(names[Arrays.asList(ids).indexOf(id)]).setView(form).setNegativeButton("取消",null).setPositiveButton(agent.optBoolean("installed")?"更新":"安装",null).create();roundedDialog(installDialog);
  installDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{if(!busy){installDialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);submit(agent,method.getSelectedItemPosition()==1?"original":"managed");}});
 }
 private void submit(JSONObject agent,String method){if(busy)return;busy=true;render();
  work(()->{JSONObject input=new JSONObject().put("deviceId",deviceId).put("requestId",UUID.randomUUID().toString()).put("action",agent==null?"refresh":agent.optBoolean("installed")?"update":"install");if(agent!=null)input.put("agent",agent.getString("id")).put("method",method).put("expectedFingerprint",agent.getString("fingerprint"));return new Api(new Credentials(this)).agentCall(pairing,"/api/agents/operations","POST",input);},value->{busy=false;if(installDialog!=null)installDialog.dismiss();notice("");render();load(false);});
 }
 private void cancel(String id){JSONObject op=id.equals("refresh")?find(operations,"action","refresh"):find(operations,"agent",id);if(!pending(op)||busy)return;busy=true;render();work(()->new Api(new Credentials(this)).agentCall(pairing,"/api/agents/operations/"+op.optString("id")+"/cancel","POST",new JSONObject()),value->{busy=false;render();load(false);});}
 @Override protected void fail(Exception e){loading=false;busy=false;render();if(installDialog!=null&&installDialog.isShowing())installDialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);super.fail(e);}
}
