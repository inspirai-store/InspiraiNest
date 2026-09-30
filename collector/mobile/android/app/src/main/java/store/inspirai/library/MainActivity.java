package store.inspirai.library;
import android.content.*;
import android.os.*;
import android.text.InputType;
import android.view.*;
import android.webkit.CookieManager;
import android.widget.*;
import org.json.*;
import store.inspirai.library.core.*;

public class MainActivity extends Screen {
 private Credentials credentials;
 private JSONObject snapshot;
 private LinearLayout listing,navigation,pairingManual;
 private LibraryPane library;
 private String tab="资料库",collectionTab="任务",taskFilter="all",lastRender="",reportedDeviceId,loginGeneration;
 private boolean refreshing,resumed,homeVisible;
 private AppUpdate.Release pendingUpdate;
 private static boolean updateChecked;
 private static final java.util.concurrent.atomic.AtomicBoolean pairing=new java.util.concurrent.atomic.AtomicBoolean();
 private EditText pairingServer,pairingKey;
 private final Handler timer=new Handler(Looper.getMainLooper());
 private final Runnable poll=new Runnable(){public void run(){if(homeVisible&&credentials.isPaired())refresh();timer.postDelayed(this,5000);}};
 @Override public void onCreate(Bundle state){super.onCreate(state);credentials=new Credentials(this);if(state!=null){tab=state.getString("tab","资料库");collectionTab=state.getString("collectionTab","任务");taskFilter=state.getString("filter","all");}if("待提交".equals(getIntent().getStringExtra("tab"))){tab="采集";collectionTab="待提交";}if(credentials.isPaired())home();else login();if(!updateChecked&&credentials.isPaired()){updateChecked=true;io.execute(()->{try{AppUpdate.Release found=AppUpdate.check(credentials.server());if(found.newerThan(BuildConfig.VERSION_CODE))ui(()->{pendingUpdate=found;showUpdate();});}catch(Exception ignored){}});}}
 @Override protected void onResume(){super.onResume();timer.post(poll);if(credentials!=null&&credentials.isPaired()){scheduleQueue();work(()->Outbox.flush(this),v->{if(homeVisible&&tab.equals("采集"))renderData(false);});}}
 @Override protected void onPostResume(){super.onPostResume();resumed=true;showUpdate();}
 @Override protected void onPause(){resumed=false;timer.removeCallbacks(poll);super.onPause();}
 private void showUpdate(){if(!resumed||pendingUpdate==null)return;AppUpdate.Release f=pendingUpdate;pendingUpdate=null;roundedDialog(new android.app.AlertDialog.Builder(this).setTitle("发现新版本 "+f.version).setMessage("当前版本 "+BuildConfig.VERSION_NAME+"，更新后保留登录和本机草稿。").setNegativeButton("稍后",null).setPositiveButton("立即更新",(d,w)->startActivity(new Intent(this,UpdateActivity.class).putExtra("download",true))).create());}
 @Override protected void onSaveInstanceState(Bundle state){state.putString("tab",tab);state.putString("collectionTab",collectionTab);state.putString("filter",taskFilter);super.onSaveInstanceState(state);}
 @Override protected void onAppearanceChanged(){if(library!=null)library.applyTheme();if(homeVisible)home();else login();}
 private void home(){
  homeVisible=true;if(library!=null&&library.web.getParent()!=null)((ViewGroup)library.web.getParent()).removeView(library.web);
  page(tab,"");heading.setVisibility(tab.equals("资料库")?View.GONE:View.VISIBLE);
  if(library==null&&credentials.isPaired())library=new LibraryPane(this,null,deep->{if(navigation!=null)navigation.setVisibility(deep?View.GONE:View.VISIBLE);});
  if(library!=null){root.addView(library.web,root.indexOfChild(scroll),new LinearLayout.LayoutParams(-1,0,1));library.web.setVisibility(tab.equals("资料库")?View.VISIBLE:View.GONE);library.applyTheme();}
  scroll.setVisibility(tab.equals("资料库")&&library!=null?View.GONE:View.VISIBLE);
  navigation=new LinearLayout(this);navigation.setPadding(dp(16),dp(6),dp(16),dp(6));navigation.setBackgroundColor(Appearance.surface(this));rule(root);root.addView(navigation);
  String[] tabs={"资料库","采集","我的"},names={"library","collect","person"};for(int i=0;i<tabs.length;i++){String t=tabs[i];Button b=button(navigation,t,()->{if(!tab.equals(t)){tab=t;home();}});b.setTextSize(12);b.setBackgroundColor(android.graphics.Color.TRANSPARENT);b.setTextColor(t.equals(tab)?green:Appearance.muted(this));b.setCompoundDrawablesRelativeWithIntrinsicBounds(null,Icons.drawable(this,names[i],t.equals(tab)?green:Appearance.muted(this)),null,null);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,-2,1);navigation.updateViewLayout(b,p);}
  if(library!=null&&tab.equals("资料库")&&library.isDeep())navigation.setVisibility(View.GONE);
  if(tab.equals("我的")){mine();return;}
  if(tab.equals("资料库")){if(library==null){body.addView(label("连接资料库，开始阅读收藏的内容。",18,true));primary(button(body,"连接资料库",()->{homeVisible=false;login();}));}return;}
  primary(button(body,"新建采集",()->startActivity(new Intent(this,ShareActivity.class))));
  LinearLayout sections=new LinearLayout(this);body.addView(sections);for(String t:new String[]{"任务","待提交"}){Button b=button(sections,t,()->{collectionTab=t;home();});b.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));if(t.equals(collectionTab))primary(b);}
  if(collectionTab.equals("任务")){Spinner filter=new Spinner(this);String[] ids={"all","running","awaiting_review","failed","completed"};filter.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"全部状态","处理中","待审核","需处理","已完成"}));filter.setMinimumHeight(dp(48));filter.setSelection(java.util.Arrays.asList(ids).indexOf(taskFilter));body.addView(filter);filter.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> a,View v,int p,long id){taskFilter=ids[p];renderData(false);}public void onNothingSelected(AdapterView<?> a){}});}
  listing=new LinearLayout(this);listing.setOrientation(LinearLayout.VERTICAL);body.addView(listing);lastRender="";renderData(true);refresh();
 }
 private void mine(){
  LinearLayout info=card(body);info.addView(label(credentials.isPaired()?credentials.server():"尚未连接资料库",16,false));
  settingsRow("授权设备",()->startActivity(new Intent(this,DevicesActivity.class)));
  settingsRow("外观 · "+Appearance.title(this),this::appearance);
  settingsRow("应用更新 · v"+BuildConfig.VERSION_NAME,()->startActivity(new Intent(this,UpdateActivity.class)));
  settingsRow("连接其他资料库",()->{homeVisible=false;login();});
  if(credentials.isPaired())settingsRow("退出本机登录",()->confirm("清除本机凭据？草稿与待提交记录会保留。",()->work(()->{credentials.clear();return true;},v->{if(library!=null){library.destroy();library=null;}CookieManager.getInstance().removeAllCookies(null);snapshot=null;homeVisible=false;login();})));
 }
 private void settingsRow(String title,Runnable action){Button b=button(body,title+"  ›",action);b.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);b.setMinHeight(dp(60));b.setTextColor(ink);b.setBackgroundColor(android.graphics.Color.TRANSPARENT);rule(body);}
 private void refresh(){if(refreshing||!credentials.isPaired())return;refreshing=true;io.execute(()->{try{Api api=new Api(credentials);String id=credentials.deviceId();if(!id.equals(reportedDeviceId)){try{api.call("/api/devices/me/info","POST",DeviceIdentity.payload(this));reportedDeviceId=id;}catch(Exception ignored){}}JSONObject fresh=api.call("/api/state","GET",null);ui(()->{refreshing=false;snapshot=fresh;notice("");if(homeVisible&&tab.equals("采集"))renderData(false);});}catch(Exception e){ui(()->{refreshing=false;notice(e instanceof Api.Failure&&((Api.Failure)e).status==401?"授权已失效，请到“我的”重新连接。":"连接暂不可用，正在等待网络恢复。");});}});}
 private void renderData(boolean force){if(!homeVisible||!tab.equals("采集")||listing==null)return;try{
  String key=collectionTab+taskFilter+(collectionTab.equals("待提交")?new Drafts(this).list().toString()+new Outbox(this).list():snapshot==null?"":snapshot.optJSONArray("tasks").toString());if(!force&&key.equals(lastRender))return;lastRender=key;int y=scroll.getScrollY();listing.removeAllViews();
  if(collectionTab.equals("待提交")){outbox();scroll.post(()->scroll.scrollTo(0,y));return;}
  if(snapshot==null){listing.addView(label("正在连接资料库…",16,false));button(listing,"重试连接",this::refresh);return;}
  JSONArray tasks=snapshot.getJSONArray("tasks");int shown=0;for(int i=0;i<tasks.length();i++){JSONObject t=tasks.getJSONObject(i);String state=t.optString("state");boolean match=taskFilter.equals("all")||taskFilter.equals(state)||(taskFilter.equals("running")&&java.util.Arrays.asList("queued","assigned","uploading").contains(state))||(taskFilter.equals("failed")&&state.equals("waiting_action"));if(!match)continue;shown++;LinearLayout c=card(listing);TextView badge=label(stateName(state),12,true);badge.setTextColor(green);c.addView(badge);TextView title=label(t.optString("content",t.optString("url")),17,true);title.setMaxLines(3);c.addView(title);JSONArray events=t.optJSONArray("events");if(events!=null&&events.length()>0)c.addView(label(events.getJSONObject(events.length()-1).optString("message"),13,false));c.setContentDescription("查看任务："+title.getText());c.setFocusable(true);c.setOnClickListener(v->startActivity(new Intent(this,TaskActivity.class).putExtra("taskId",t.optString("id"))));}
  if(shown==0){listing.addView(label("这里还没有任务",21,true));listing.addView(label("保存一段文字或链接，让采集电脑整理成可阅读的资料。",15,false));}scroll.post(()->scroll.scrollTo(0,y));
 }catch(Exception e){fail(e);}}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(library!=null)library.result(request,result,data);if(request==71&&result==RESULT_OK&&data!=null)try{PairingCode code=PairingCode.parse(data.getStringExtra("pairingCode"));if(pairingServer==null||homeVisible){homeVisible=false;login();}pairingManual.setVisibility(View.VISIBLE);pairingServer.setText(code.server);pairingKey.setText(code.key);notice("已识别 "+code.server+"，请确认地址后连接。");}catch(Exception e){fail(e);}}
 @Override protected void backAction(){if(homeVisible&&tab.equals("资料库")&&library!=null&&library.back())return;if(!homeVisible&&credentials.isPaired()){home();return;}if(homeVisible&&!tab.equals("资料库")){tab="资料库";home();return;}super.backAction();}
 private void scheduleQueue(){try{QueueJob.schedule(this);}catch(Exception e){fail(e);}}
 static String stateName(String s){return switch(s){case "queued"->"待分配";case "assigned"->"待开始";case "running"->"采集中";case "uploading"->"上传中";case "waiting_action"->"待操作";case "awaiting_review"->"待审核";case "completed"->"已完成";case "cancelled"->"已取消";case "failed"->"需处理";default->s;};}
 @Override protected void onDestroy(){if(library!=null)library.destroy();super.onDestroy();}
    private void login(){
        homeVisible=false;page("InspiraiNest","浏览、分享、采集，交给自己的电脑处理");listing=null;
        try{Credentials.Snapshot saved=credentials.snapshot();loginGeneration=saved==null?null:saved.generation;}catch(Exception e){loginGeneration=null;}
        body.addView(label("让收藏的内容，成为随时可读的资料。",20,true));

        primary(button(body,"扫码连接资料库",()->startActivityForResult(new Intent(this,ScanPairingActivity.class),71)));
        LinearLayout manual=new LinearLayout(this);manual.setOrientation(LinearLayout.VERTICAL);button(body,"使用地址与配对码连接",()->manual.setVisibility(manual.getVisibility()==View.GONE?View.VISIBLE:View.GONE));LinearLayout originalBody=body;body=manual;
        EditText server=input("HTTPS 服务地址",Credentials.DEFAULT_SERVER,false);server.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        EditText name=input("设备名称",Build.MODEL+" 手机",false);
        EditText key=input("手机管理端配对码或个人密钥","",false);key.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);key.setSaveEnabled(false);
        pairingServer=server;pairingKey=key;
        button(body,"配对并登录",()->{
            String address=server.getText().toString().trim(),secret=key.getText().toString().trim(),deviceName=name.getText().toString();
            if(!pairing.compareAndSet(false,true)){notice("配对正在进行，请稍候。旋转屏幕后会自动恢复。");return;}
            notice("正在连接…");work(()->{try{JSONObject result=Api.pair(this,address,secret,deviceName);JSONObject d=result.getJSONObject("device");if(!"owner".equals(d.getString("role")))throw new Exception("这是电脑 Worker 配对码，请生成手机管理端配对码。");credentials.save(address,result.getString("token"),d.getString("id"));return result;}finally{pairing.set(false);}},r->{key.setText("");if(library!=null){library.destroy();library=null;}home();refresh();scheduleQueue();work(()->Outbox.flush(this),v->{});});
        });
        body=originalBody;body.addView(manual);manual.setVisibility(View.GONE);pairingManual=manual;
        body.addView(label("在已登录的采集中心「授权设备」中创建管理端配对码。密钥仅用于换取本机独立授权，保存在 Android Keystore 保护的存储中。",14,false));
        button(body,"查看本机草稿和待提交项",()->{tab="采集";collectionTab="待提交";home();});
        button(body,"应用更新 · v"+BuildConfig.VERSION_NAME,()->startActivity(new Intent(this,UpdateActivity.class)));
    }
    private void outbox()throws Exception{
        listing.addView(label("未提交的内容保存在手机，网络恢复后自动重试。",14,false));
        JSONArray drafts=new Drafts(this).list();for(int i=0;i<drafts.length();i++){JSONObject d=drafts.getJSONObject(i);pendingRow(d.optString("id"),"草稿 · 尚未提交",d.optString("content"),true);}
        JSONArray rows=new Outbox(this).list();for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);pendingRow(row.optString("id"),row.optString("state").equals("sent")?"已提交":"等待提交",row.getJSONObject("payload").optString("content"),false);}
        if(rows.length()+drafts.length()==0)listing.addView(label("没有待提交内容",18,true));
    }
    private void pendingRow(String id,String status,String content,boolean draft){LinearLayout c=card(listing);c.addView(label(status,13,true));TextView text=label(content.isBlank()?"未填写的草稿":content,17,false);text.setMaxLines(3);c.addView(text);c.setFocusable(true);c.setContentDescription("查看待提交内容："+text.getText());c.setOnClickListener(v->startActivity(new Intent(this,PendingActivity.class).putExtra("id",id).putExtra("draft",draft)));}
}
