package store.inspirai.library;
import android.content.*;
import android.os.*;
import android.text.InputType;
import android.text.TextWatcher;
import android.text.Editable;
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
 private String tab="资料库",collectionTab="任务",taskFilter="all",lastRender="",reportedDeviceId;
 private boolean refreshing,resumed,homeVisible;
 private AppUpdate.Release pendingUpdate;
 private static boolean updateChecked;
 private EditText pairingServer,pairingKey,loginFactor;
 private TextView pairingKeyLabel;
 private Button loginMode;
 private Button loginButton;
 private boolean usingPairCode;
 private long loginAttempt;
 private java.util.concurrent.Future<?> loginFuture;
 private android.app.AlertDialog loginMfa;
 private String pendingPassword="";
 private String pendingAddress="";
 private final Handler timer=new Handler(Looper.getMainLooper());
 private final Runnable poll=new Runnable(){public void run(){if(homeVisible&&credentials.isPaired())refresh();timer.postDelayed(this,5000);}};
 @Override public void onCreate(Bundle state){super.onCreate(state);if(!getIntent().getBooleanExtra("legacy",false)&&!"待提交".equals(getIntent().getStringExtra("tab"))){startActivity(new Intent(this,CaptureActivity.class));finish();return;}credentials=new Credentials(this);if(getIntent().hasExtra("captureTab"))tab=getIntent().getStringExtra("captureTab");if(state!=null){tab=state.getString("tab","资料库");collectionTab=state.getString("collectionTab","任务");taskFilter=state.getString("filter","all");}if("待提交".equals(getIntent().getStringExtra("tab"))){tab="采集";collectionTab="待提交";}if(credentials.isPaired())home();else login();if(!updateChecked&&credentials.isPaired()){updateChecked=true;io.execute(()->{try{AppUpdate.Release found=AppUpdate.check(credentials.server());if(found.newerThan(BuildConfig.VERSION_CODE))ui(()->{pendingUpdate=found;showUpdate();});}catch(Exception ignored){}});}}
 @Override protected void onResume(){super.onResume();timer.post(poll);if(credentials!=null&&credentials.isPaired()){scheduleQueue();work(()->Outbox.flush(this),v->{if(homeVisible&&tab.equals("采集"))renderData(false);});}}
 @Override protected void onPostResume(){super.onPostResume();resumed=true;showUpdate();}
 @Override protected void onPause(){cancelLogin();resumed=false;timer.removeCallbacks(poll);super.onPause();}
 private void showUpdate(){if(!resumed||pendingUpdate==null)return;AppUpdate.Release f=pendingUpdate;pendingUpdate=null;roundedDialog(new android.app.AlertDialog.Builder(this).setTitle("发现新版本 "+f.version).setMessage("当前版本 "+BuildConfig.VERSION_NAME+"，更新后保留登录和本机草稿。").setNegativeButton("稍后",null).setPositiveButton("立即更新",(d,w)->startActivity(new Intent(this,UpdateActivity.class).putExtra("download",true))).create());}
 @Override protected void onSaveInstanceState(Bundle state){state.putString("tab",tab);state.putString("collectionTab",collectionTab);state.putString("filter",taskFilter);super.onSaveInstanceState(state);}
 @Override protected void onAppearanceChanged(){if(library!=null)library.applyTheme();if(homeVisible)home();else login();}
 private void home(){
  if(!homeVisible)cancelLogin();homeVisible=true;if(library!=null&&library.web.getParent()!=null)((ViewGroup)library.web.getParent()).removeView(library.web);
  page(tab,tab.equals("采集")?"把灵感交给电脑，进度在这里查看":"");heading.setVisibility(tab.equals("资料库")?View.GONE:View.VISIBLE);
  if(library==null&&credentials.isPaired())library=new LibraryPane(this,null,deep->{if(navigation!=null)navigation.setVisibility(deep?View.GONE:View.VISIBLE);});
  if(library!=null){root.addView(library.web,root.indexOfChild(scroll),new LinearLayout.LayoutParams(-1,0,1));library.web.setVisibility(tab.equals("资料库")?View.VISIBLE:View.GONE);library.applyTheme();}
  scroll.setVisibility(tab.equals("资料库")&&library!=null?View.GONE:View.VISIBLE);
  navigation=new LinearLayout(this);navigation.setPadding(dp(16),dp(6),dp(16),dp(6));navigation.setBackgroundColor(Appearance.surface(this));rule(root);root.addView(navigation);
  String[] tabs={"记录","资料库","采集","我的"},names={"collect","library","collect","person"};for(int i=0;i<tabs.length;i++){String t=tabs[i];Button b=button(navigation,t,()->{if(t.equals("记录")){finish();return;}if(!tab.equals(t)){tab=t;home();}});b.setTextSize(12);b.setBackgroundColor(android.graphics.Color.TRANSPARENT);b.setTextColor(t.equals(tab)?green:Appearance.muted(this));b.setCompoundDrawablesRelativeWithIntrinsicBounds(null,Icons.drawable(this,names[i],t.equals(tab)?green:Appearance.muted(this)),null,null);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,-2,1);navigation.updateViewLayout(b,p);}
  if(library!=null&&tab.equals("资料库")&&library.isDeep())navigation.setVisibility(View.GONE);
  if(tab.equals("我的")){mine();return;}
  if(tab.equals("资料库")){if(library==null){body.addView(label("连接资料库，开始阅读收藏的内容。",18,true));primary(button(body,"连接资料库",()->{homeVisible=false;login();}));}return;}
  primary(button(body,"新建采集",()->startActivity(new Intent(this,ShareActivity.class))));
  LinearLayout sections=new LinearLayout(this);body.addView(sections);for(String t:new String[]{"任务","待提交"}){Button b=button(sections,t,()->{collectionTab=t;home();});b.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));if(t.equals(collectionTab))primary(b);}
  if(collectionTab.equals("任务")){Spinner filter=new Spinner(this);String[] ids={"all","running","awaiting_review","failed","completed"};filter.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"全部状态","处理中","待审核","需处理","已完成"}));filter.setMinimumHeight(dp(48));filter.setSelection(java.util.Arrays.asList(ids).indexOf(taskFilter));body.addView(filter);filter.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> a,View v,int p,long id){taskFilter=ids[p];renderData(false);}public void onNothingSelected(AdapterView<?> a){}});}
  listing=new LinearLayout(this);listing.setOrientation(LinearLayout.VERTICAL);body.addView(listing);lastRender="";renderData(true);refresh();
 }
 private void mine(){
  LinearLayout info=card(body);info.addView(label("我的资料空间",21,true));info.addView(label(credentials.isPaired()?credentials.server():"尚未连接资料库",14,false));
  settingsRow("授权设备",()->startActivity(new Intent(this,DevicesActivity.class)));
  settingsRow("外观 · "+Appearance.title(this),this::appearance);
  settingsRow("应用更新 · v"+BuildConfig.VERSION_NAME,()->startActivity(new Intent(this,UpdateActivity.class)));
  settingsRow("更换资料库",()->{homeVisible=false;login();});
  if(credentials.isPaired())settingsRow("退出本机登录",()->confirm("清除本机凭据？草稿与待提交记录会保留。",()->work(()->{credentials.clear();return true;},v->{if(library!=null){library.destroy();library=null;}CookieManager.getInstance().removeAllCookies(null);snapshot=null;homeVisible=false;login();})));
 }
 private void settingsRow(String title,Runnable action){Button b=button(body,title+"  ›",action);b.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);b.setMinHeight(dp(60));b.setTextColor(ink);b.setBackgroundColor(android.graphics.Color.TRANSPARENT);rule(body);}
 private void refresh(){if(refreshing||!credentials.isPaired())return;final String generation=credentials.deviceId();refreshing=true;io.execute(()->{try{Api api=new Api(credentials);String id=credentials.deviceId();String warning="";if(!id.equals(reportedDeviceId)){try{api.call("/api/devices/me/info","POST",Api.devicePayload(this,credentials.server(),false));reportedDeviceId=id;}catch(Exception ignored){warning="设备标识暂未补齐；若身份冲突，请检查授权后重新配对。";}}JSONObject fresh=api.call("/api/state","GET",null);String identityWarning=warning;ui(()->{refreshing=false;if(!generation.equals(credentials.deviceId()))return;snapshot=fresh;notice(identityWarning);if(homeVisible&&tab.equals("采集"))renderData(false);});}catch(Exception e){ui(()->{refreshing=false;if(!generation.equals(credentials.deviceId()))return;notice(e instanceof Api.Failure&&((Api.Failure)e).status==401?"授权已失效，请到“我的”重新连接。":"连接暂不可用，正在等待网络恢复。");});}});}
 private void renderData(boolean force){if(!homeVisible||!tab.equals("采集")||listing==null)return;try{
  String key=collectionTab+taskFilter+(collectionTab.equals("待提交")?new Drafts(this).list().toString()+new Outbox(this).list():snapshot==null?"":snapshot.optJSONArray("tasks").toString());if(!force&&key.equals(lastRender))return;lastRender=key;int y=scroll.getScrollY();listing.removeAllViews();
  if(collectionTab.equals("待提交")){outbox();scroll.post(()->scroll.scrollTo(0,y));return;}
  if(snapshot==null){listing.addView(label("正在连接资料库…",16,false));button(listing,"重试连接",this::refresh);return;}
  JSONArray tasks=snapshot.getJSONArray("tasks");int shown=0;for(int i=0;i<tasks.length();i++){JSONObject t=tasks.getJSONObject(i);String state=t.optString("state");boolean match=taskFilter.equals("all")||taskFilter.equals(state)||(taskFilter.equals("running")&&java.util.Arrays.asList("queued","assigned","uploading").contains(state))||(taskFilter.equals("failed")&&state.equals("waiting_action"));if(!match)continue;shown++;LinearLayout c=card(listing);TextView badge=label(stateName(state),12,true);badge.setTextColor(green);c.addView(badge);TextView title=label(t.optString("content",t.optString("url")),17,true);title.setMaxLines(3);c.addView(title);JSONArray events=t.optJSONArray("events");if(events!=null&&events.length()>0)c.addView(label(events.getJSONObject(events.length()-1).optString("message"),13,false));c.setContentDescription("查看任务："+title.getText());c.setFocusable(true);c.setOnClickListener(v->startActivity(new Intent(this,TaskActivity.class).putExtra("taskId",t.optString("id"))));}
  if(shown==0){listing.addView(label("这里还没有任务",21,true));listing.addView(label("保存一段文字或链接，让采集电脑整理成可阅读的资料。",15,false));}scroll.post(()->scroll.scrollTo(0,y));
 }catch(Exception e){fail(e);}}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(library!=null)library.result(request,result,data);if(request==71&&result==RESULT_OK&&data!=null)try{PairingCode code=PairingCode.parse(data.getStringExtra("pairingCode"));if(pairingServer==null||homeVisible){homeVisible=false;login();}pairingManual.setVisibility(View.VISIBLE);pairingServer.setText(code.server);setLoginMode(true);pairingKey.setText(code.key);}catch(Exception e){fail(e);}}
 @Override protected void backAction(){if(homeVisible&&tab.equals("资料库")&&library!=null&&library.back())return;if(!homeVisible&&credentials.isPaired()){home();return;}if(homeVisible&&!tab.equals("资料库")){tab="资料库";home();return;}super.backAction();}
 private void scheduleQueue(){try{QueueJob.schedule(this);}catch(Exception e){fail(e);}}
 static String stateName(String s){return switch(s){case "queued"->"待分配";case "assigned"->"待开始";case "running"->"采集中";case "uploading"->"上传中";case "waiting_action"->"待操作";case "awaiting_review"->"待审核";case "completed"->"已完成";case "cancelled"->"已取消";case "failed"->"需处理";default->s;};}
 @Override protected void onDestroy(){cancelLogin();if(library!=null)library.destroy();super.onDestroy();}
    private void login(){
        cancelLogin();usingPairCode=false;homeVisible=false;page("登录资料库","");listing=null;
        pairingServer=input("资料库地址",credentials.isPaired()?credentials.server():credentials.lastOrigin(),false);
        pairingServer.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        pairingServer.setHint("https://");
        int labelIndex=body.getChildCount();
        pairingKey=input("登录密码","",false);
        pairingKeyLabel=(TextView)body.getChildAt(labelIndex);
        pairingKey.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        pairingKey.setSaveEnabled(false);
        loginButton=button(body,"登录",()->beginLogin(pairingServer.getText().toString().trim(),pairingKey.getText().toString(),null,null));primary(loginButton);
        loginMode=button(body,"使用配对码连接",()->{cancelLogin();setLoginMode(!usingPairCode);});
        button(body,"扫码连接",()->{cancelLogin();startActivityForResult(new Intent(this,ScanPairingActivity.class),71);});
        button(body,"取消",()->{cancelLogin();home();});
        button(body,"本机草稿",()->{cancelLogin();tab="采集";collectionTab="待提交";home();});
        pairingManual=body;
        pairingServer.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){} public void onTextChanged(CharSequence s,int start,int before,int count){cancelLogin();} public void afterTextChanged(Editable e){}});
    }
    private void setLoginMode(boolean code){usingPairCode=code;pairingKeyLabel.setText(code?"配对码":"登录密码");pairingKey.setHint(code?"配对码":"登录密码");loginMode.setText(code?"使用密码登录":"使用配对码连接");}
    private void cancelLogin(){
        loginAttempt++;pendingPassword="";pendingAddress="";
        if(loginFuture!=null){loginFuture.cancel(true);loginFuture=null;}
        if(pairingKey!=null)pairingKey.setText("");
        if(loginFactor!=null){loginFactor.setText("");loginFactor=null;}
        if(loginMfa!=null){android.app.AlertDialog old=loginMfa;loginMfa=null;old.dismiss();}
        if(loginButton!=null)loginButton.setEnabled(true);
    }
    private void beginLogin(String address,String secret,String otp,String recovery){
        if(loginButton==null||!loginButton.isEnabled())return;
        try {address=Credentials.normalizeServer(address);if(secret.isEmpty()||secret.length()>200)throw new Exception("请输入登录密码或配对码。");}
        catch(Exception e){fail(e);return;}
        final String origin=address;final long attempt=++loginAttempt;
        loginButton.setEnabled(false);pairingKey.setText("");notice("正在登录…");
        loginFuture=io.submit(()->{
            try {
                JSONObject result=Api.pair(this,origin,secret,Build.MODEL+" 手机",otp,recovery);
                JSONObject device=result.getJSONObject("device");
                if(!"owner".equals(device.getString("role")))throw new Exception("登录权限不匹配。");
                ui(()->{if(attempt!=loginAttempt)return;try{
                    credentials.save(origin,result.getString("token"),device.getString("id"));
                    cancelLogin();snapshot=null;reportedDeviceId=null;lastRender="";
                    if(library!=null){library.destroy();library=null;}
                    String connected=device.getString("id");CookieManager.getInstance().removeAllCookies(removed->{if(!connected.equals(credentials.deviceId())||isFinishing()||isDestroyed())return;CookieManager.getInstance().flush();home();refresh();scheduleQueue();});
                }catch(Exception e){cancelLogin();fail(e);}});
            }catch(Exception e){ui(()->{if(attempt!=loginAttempt)return;loginButton.setEnabled(true);
                if(e instanceof Api.Failure && ("mfa_required".equals(((Api.Failure)e).code)||"mfa_invalid".equals(((Api.Failure)e).code))){
                    pendingAddress=origin;pendingPassword=secret;showLoginMfa("mfa_invalid".equals(((Api.Failure)e).code)?e.getMessage():"");
                }else{pendingPassword="";pendingAddress="";fail(e);}
            });}
        });
    }
    private void showLoginMfa(String error){
        if(loginMfa!=null){android.app.AlertDialog old=loginMfa;loginMfa=null;old.dismiss();}
        LinearLayout fields=new LinearLayout(this);fields.setPadding(dp(20),dp(10),dp(20),dp(10));fields.setOrientation(LinearLayout.VERTICAL);
        EditText factor=new EditText(this);loginFactor=factor;factor.setHint("动态码");factor.setSingleLine();factor.setSaveEnabled(false);factor.setInputType(InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_VARIATION_PASSWORD);fields.addView(factor);
        CheckBox recovery=new CheckBox(this);recovery.setText("使用恢复码");fields.addView(recovery);
        recovery.setOnCheckedChangeListener((v,on)->{factor.setText("");factor.setHint(on?"恢复码":"动态码");factor.setInputType(on?InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD:InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_VARIATION_PASSWORD);});
        if(!error.isEmpty())fields.addView(label(error,15,false));
        android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(this).setTitle("验证登录").setView(fields).setNegativeButton("取消",(d,w)->cancelLogin()).setPositiveButton("验证并登录",null).create();
        loginMfa=dialog;dialog.setOnCancelListener(d->cancelLogin());roundedDialog(dialog);
        dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            if(factor.getText().toString().trim().isEmpty())return;
            String value=factor.getText().toString().trim(),password=pendingPassword,url=pendingAddress;factor.setText("");
            dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            beginLogin(url,password,recovery.isChecked()?null:value,recovery.isChecked()?value:null);
        });
    }
    private void outbox()throws Exception{
        listing.addView(label("未提交的内容保存在手机，网络恢复后自动重试。",14,false));
        JSONArray drafts=new Drafts(this).list();for(int i=0;i<drafts.length();i++){JSONObject d=drafts.getJSONObject(i);pendingRow(d.optString("id"),"草稿 · 尚未提交",d.optString("content"),true);}
        JSONArray rows=new Outbox(this).list();for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);pendingRow(row.optString("id"),row.optString("state").equals("sent")?"已提交":"等待提交",row.getJSONObject("payload").optString("content"),false);}
        if(rows.length()+drafts.length()==0)listing.addView(label("没有待提交内容",18,true));
    }
    private void pendingRow(String id,String status,String content,boolean draft){LinearLayout c=card(listing);c.addView(label(status,13,true));TextView text=label(content.isBlank()?"未填写的草稿":content,17,false);text.setMaxLines(3);c.addView(text);c.setFocusable(true);c.setContentDescription("查看待提交内容："+text.getText());c.setOnClickListener(v->startActivity(new Intent(this,PendingActivity.class).putExtra("id",id).putExtra("draft",draft)));}
}
