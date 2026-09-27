package store.inspirai.library;
import android.content.Intent;
import android.os.*;
import android.widget.*;
import org.json.*;
import store.inspirai.library.core.*;
public class TaskActivity extends Screen {
 private String id,last="";private boolean loading;private final Handler timer=new Handler(Looper.getMainLooper());
 private final Runnable poll=new Runnable(){public void run(){load();timer.postDelayed(this,5000);}};
 @Override public void onCreate(Bundle state){super.onCreate(state);id=getIntent().getStringExtra("taskId");page("采集详情","查看进度与采集结果");notice("正在载入任务…");}
 @Override protected void onResume(){super.onResume();timer.post(poll);}
 @Override protected void onPause(){timer.removeCallbacks(poll);super.onPause();}
 private void load(){if(loading||id==null)return;loading=true;io.execute(()->{try{JSONArray tasks=new Api(new Credentials(this)).call("/api/state","GET",null).getJSONArray("tasks");JSONObject found=null;for(int i=0;i<tasks.length();i++)if(id.equals(tasks.getJSONObject(i).optString("id")))found=tasks.getJSONObject(i);JSONObject task=found;ui(()->{loading=false;if(task==null){notice("任务不存在或已不可访问。");return;}notice("");if(!last.equals(task.toString())){last=task.toString();render(task);}});}catch(Exception e){ui(()->{loading=false;fail(e);});}});}
 private void render(JSONObject task){int y=scroll.getScrollY();body.removeAllViews();String state=task.optString("state");LinearLayout summary=card(body);summary.addView(label(MainActivity.stateName(state),14,true));summary.addView(label(task.optString("content",task.optString("url")),18,true));String scenario=task.optString("scenario");if(!scenario.isEmpty()&&!scenario.equals("null"))summary.addView(label(scenario,15,false));
  if(state.equals("awaiting_review"))primary(button(body,"阅读结果并审核",()->startActivity(new Intent(this,BundleActivity.class).putExtra("route","/api/tasks/"+id+"/draft").putExtra("taskId",id))));
  if(!task.isNull("archiveId"))primary(button(body,"阅读归档结果",()->startActivity(new Intent(this,BundleActivity.class).putExtra("route","/api/archives/"+task.optString("archiveId")))));
  if(state.equals("failed")||state.equals("waiting_action"))primary(button(body,"继续采集",()->action("retry")));
  body.addView(label("进度记录",18,true));JSONArray events=task.optJSONArray("events");if(events!=null)for(int i=events.length()-1;i>=0;i--){JSONObject e=events.optJSONObject(i);LinearLayout row=card(body);TextView time=label(eventTime(e.optString("at")),12,false);time.setTextColor(Appearance.muted(this));row.addView(time);row.addView(label(e.optString("message"),15,false));}
  if(!state.equals("completed")&&!state.equals("cancelled"))button(body,"取消任务",()->confirm("取消这项远端采集任务？",()->action("cancel")));scroll.post(()->scroll.scrollTo(0,y));
 }
 private static String eventTime(String value){try{return java.time.Instant.parse(value).atZone(java.time.ZoneId.of("Asia/Shanghai")).format(java.time.format.DateTimeFormatter.ofPattern("MM月dd日 HH:mm"));}catch(Exception e){return value;}}
 private void action(String verb){work(()->new Api(new Credentials(this)).call("/api/tasks/"+id+"/"+verb,"POST",new JSONObject()),v->load());}
}
