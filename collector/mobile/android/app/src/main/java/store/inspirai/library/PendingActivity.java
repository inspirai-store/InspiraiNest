package store.inspirai.library;
import android.content.Intent;
import android.os.Bundle;
import org.json.*;
import store.inspirai.library.core.*;
public class PendingActivity extends Screen {
 @Override public void onCreate(Bundle state){super.onCreate(state);show();}
 private void show(){page("待提交详情","内容保存在本机");String id=getIntent().getStringExtra("id");boolean draft=getIntent().getBooleanExtra("draft",false);try{
  if(draft){JSONObject row=new Drafts(this).read(id);body.addView(label(row.optString("content"),18,false));primary(button(body,"继续填写",()->{startActivity(new Intent(this,ShareActivity.class).putExtra("draftId",id));finish();}));button(body,"删除草稿",()->confirm("删除这份本机草稿？",()->{new Drafts(this).remove(id);finish();}));return;}
  JSONObject row=null;JSONArray rows=new Outbox(this).list();for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).optString("id")))row=rows.getJSONObject(i);if(row==null){notice("这条本机记录已移除。");return;}boolean sent=row.optString("state").equals("sent");body.addView(label(sent?"已提交":"等待提交",18,true));body.addView(label(row.getJSONObject("payload").optString("content"),18,false));body.addView(label(row.optString("server"),13,false));if(!sent){body.addView(label(row.optString("error"),14,false));primary(button(body,"重试提交",()->work(()->{new Outbox(this).retry(id);QueueJob.schedule(this);return Outbox.flush(this);},v->show())));}button(body,"移除本机记录",()->confirm("移除本机记录？已发送的远端任务不会取消。",()->work(()->{new Outbox(this).remove(id);return true;},v->finish())));
 }catch(Exception e){fail(e);}}
}
