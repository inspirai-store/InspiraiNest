package store.inspirai.library;
import android.content.Intent;
import android.os.Bundle;
import org.json.*;
import store.inspirai.library.core.*;
public class PendingActivity extends Screen {
 private final android.os.Handler timer=new android.os.Handler(android.os.Looper.getMainLooper());
 private final Runnable poll=new Runnable(){public void run(){String value=InputFiles.progressText(new InputFiles(PendingActivity.this).progress(getIntent().getStringExtra("id")));if(!value.isEmpty())notice(value);timer.postDelayed(this,1000);}};
 @Override public void onCreate(Bundle state){super.onCreate(state);show();}
 private void show(){page("待提交详情","内容保存在本机");String id=getIntent().getStringExtra("id");boolean draft=getIntent().getBooleanExtra("draft",false);try{
  if(draft){JSONObject row=new Drafts(this).read(id);body.addView(label(InputFiles.title(row),18,false));files(row.optJSONArray("attachments"));primary(button(body,"继续填写",()->{startActivity(new Intent(this,ShareActivity.class).putExtra("draftId",id));finish();}));button(body,"删除草稿",()->confirm("删除这份本机草稿及附件副本？",()->{new Drafts(this).remove(id);new InputFiles(this).discard(id);finish();}));return;}
  JSONObject row=null;JSONArray rows=new Outbox(this).list();for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).optString("id")))row=rows.getJSONObject(i);if(row==null){notice("这条本机记录已移除。");return;}boolean sent=row.optString("state").equals("sent");body.addView(label(sent?"已提交":"等待提交",18,true));body.addView(label(InputFiles.title(row.getJSONObject("payload")),18,false));files(row.getJSONObject("payload").optJSONArray("attachments"));body.addView(label(row.optString("server"),13,false));if(!sent){body.addView(label(row.optString("error"),14,false));primary(button(body,"重试提交",()->work(()->{new Outbox(this).retry(id);QueueJob.schedule(this);return Outbox.flush(this);},v->show())));}else timer.removeCallbacks(poll);button(body,"移除本机记录",()->confirm("移除本机记录及附件副本？已发送的远端任务不会取消。",()->work(()->{new Outbox(this).remove(id);return true;},v->finish())));
 }catch(Exception e){fail(e);}}
 private void files(JSONArray files)throws Exception{if(files!=null)for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);body.addView(label(f.optString("name")+(f.has("selected")&&!f.optBoolean("selected")?" · 未选中":""),14,false));}}
 @Override protected void onResume(){super.onResume();timer.post(poll);}
 @Override protected void onPause(){timer.removeCallbacks(poll);super.onPause();}
}
