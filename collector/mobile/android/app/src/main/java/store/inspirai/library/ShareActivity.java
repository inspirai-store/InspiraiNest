package store.inspirai.library;

import android.content.*;
import android.os.Bundle;
import android.net.Uri;
import android.text.*;
import android.view.View;
import android.widget.*;
import java.util.*;
import org.json.*;
import store.inspirai.library.core.*;

public class ShareActivity extends Screen {
    private JSONObject draft;
    private String id,original;
    private TextView content;
    private EditText extra,tags;
    private CheckBox archive;
    private Spinner agent,device;
    private final List<String> deviceIds=new ArrayList<>();
    private boolean ready=false,submitted=false;
    private Button send;
    private JSONArray attachments=new JSONArray();
    private LinearLayout attachmentList;
    private TextView attachmentSummary;
    private String filter="全部";
    private final android.os.Handler progressTimer=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable progressPoll=new Runnable(){public void run(){if(submitted){String value=InputFiles.progressText(new InputFiles(ShareActivity.this).progress(id));if(!value.isEmpty())notice(value);}progressTimer.postDelayed(this,1000);}};
    public static String sharedText(Intent intent) {
        Set<String> parts=new LinkedHashSet<>();
        for(String key:new String[]{Intent.EXTRA_SUBJECT,Intent.EXTRA_TITLE,Intent.EXTRA_TEXT}) {CharSequence value=intent.getCharSequenceExtra(key); if(value!=null&&!value.toString().isEmpty())parts.add(value.toString());}
        if(intent.getClipData()!=null) for(int i=0;i<intent.getClipData().getItemCount();i++){ClipData.Item item=intent.getClipData().getItemAt(i); if(item.getText()!=null&&!item.getText().toString().isEmpty())parts.add(item.getText().toString());if(item.getUri()!=null&&Arrays.asList("https","http").contains(item.getUri().getScheme()))parts.add(item.getUri().toString());}
        return String.join("\n",parts);
    }
    @SuppressWarnings("deprecation") public static List<Uri> sharedUris(Intent intent){Set<Uri> uris=new LinkedHashSet<>();Object stream=intent.getExtras()==null?null:intent.getExtras().get(Intent.EXTRA_STREAM);if(stream instanceof Uri)uris.add((Uri)stream);if(stream instanceof List<?>)for(Object value:(List<?>)stream)if(value instanceof Uri)uris.add((Uri)value);if(intent.getClipData()!=null)for(int i=0;i<intent.getClipData().getItemCount();i++){Uri uri=intent.getClipData().getItemAt(i).getUri();if(uri!=null)uris.add(uri);}uris.removeIf(u->u==null||!Arrays.asList("content","file").contains(u.getScheme()));return new ArrayList<>(uris);}
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); page("新建采集","保存一段灵感，留待慢慢阅读");
        try {
            id=state!=null?state.getString("draftId"):getIntent().getStringExtra("draftId");
            if(id!=null) {
                JSONObject queued=queuedRecord(id);
                if(queued!=null){submitted=true;showQueued(queued);return;}
                draft=new Drafts(this).read(id);
            }
            else { id=UUID.randomUUID().toString(); original=Arrays.asList(Intent.ACTION_SEND,Intent.ACTION_SEND_MULTIPLE).contains(getIntent().getAction())?sharedText(getIntent()):""; draft=new JSONObject().put("id",id).put("original",original).put("content",original).put("extra","").put("tags","").put("autoArchive",true).put("agent","").put("deviceId",""); new Drafts(this).save(draft); }
            if(draft.optJSONArray("attachments")!=null)attachments=draft.getJSONArray("attachments");
            for(int i=0;i<attachments.length();i++){JSONObject saved=attachments.getJSONObject(i);try{JSONObject fresh=new InputFiles(this).read(id,saved.getString("id"));fresh.put("selected",saved.optBoolean("selected",true));attachments.put(i,fresh);}catch(Exception ignored){if("reading".equals(saved.optString("state")))saved.put("state","error").put("error","读取已中断，请重新添加此文件");}}
            original=draft.optString("original");
            body.addView(label("分享原文",14,true));
            if(!original.isEmpty()) {content=label(original,16,false);content.setTextIsSelectable(true);body.addView(content);body.addView(label("原文完整保留，要求可填在下方。",12,false));}
            else content=input("粘贴文字、标题和链接",draft.optString("content"),true);
            body.addView(label("附件",18,true));body.addView(label("每个 32 MiB · 合计 128 MiB · 最多 20 个",12,false));
            button(body,"添加文件",()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),92));
            LinearLayout filters=new LinearLayout(this);for(String value:new String[]{"全部","文档","图片","音频"}){Button b=new Button(this);b.setText(value);b.setAllCaps(false);b.setTextColor(ink);b.setMinHeight(dp(48));filters.addView(b,new LinearLayout.LayoutParams(0,-2,1));b.setOnClickListener(v->{filter=value;renderAttachments();});}body.addView(filters);
            button(body,"全选显示的附件",()->selectVisible(true));button(body,"取消勾选显示的附件",()->selectVisible(false));
            attachmentSummary=label("",13,false);body.addView(attachmentSummary);attachmentList=new LinearLayout(this);attachmentList.setOrientation(LinearLayout.VERTICAL);body.addView(attachmentList);
            extra=input("补充要求或使用场景（可选）",draft.optString("extra"),true);
            LinearLayout mainBody=body,advanced=new LinearLayout(this);advanced.setOrientation(LinearLayout.VERTICAL);
            button(body,"高级选项 · 标签与派发",()->advanced.setVisibility(advanced.getVisibility()==View.GONE?View.VISIBLE:View.GONE));
            body.addView(advanced);advanced.setVisibility(View.GONE);body=advanced;
            tags=input("标签（逗号分隔，可选）",draft.optString("tags"),false);
            archive=new CheckBox(this);archive.setText("完成分析后自动归档");archive.setChecked(draft.optBoolean("autoArchive",true));body.addView(archive);
            agent=spinner("Agent",new String[]{"自动","codex","codebuddy"}); String preferred=draft.optString("agent");agent.setSelection(preferred.equals("codex")?1:preferred.equals("codebuddy")?2:0);
            deviceIds.add("");device=spinner("派发电脑",new String[]{"自动选择在线电脑"});
            body=mainBody;
            LinearLayout footer=new LinearLayout(this);footer.setPadding(dp(24),dp(8),dp(24),dp(12));footer.setOrientation(LinearLayout.VERTICAL);footer.setBackgroundColor(Appearance.background(this));root.addView(footer);
            send=button(footer,"提交采集任务",this::submit);primary(send);
            button(body,"稍后提交 · 返回资料库",()->{if(persist()){startActivity(new Intent(this,MainActivity.class));finish();}});
            TextWatcher watcher=new TextWatcher(){public void beforeTextChanged(CharSequence s,int st,int c,int a){} public void onTextChanged(CharSequence s,int st,int b,int c){if(ready)persist();} public void afterTextChanged(Editable e){}};
            content.addTextChangedListener(watcher);extra.addTextChangedListener(watcher);tags.addTextChangedListener(watcher);archive.setOnCheckedChangeListener((v,c)->{if(ready)persist();});
            agent.setOnItemSelectedListener(listener()); device.setOnItemSelectedListener(listener()); ready=true;
            renderAttachments();
            if(state==null&&!getIntent().hasExtra("draftId"))addUris(sharedUris(getIntent()));
            Credentials credentials=new Credentials(this);
            if(credentials.isPaired()) work(()->new Api(credentials).call("/api/state","GET",null),stateJSON->{
                JSONArray devices=stateJSON.getJSONArray("devices"); List<String> names=new ArrayList<>();names.add("自动选择在线电脑"); String selected=draft.optString("deviceId"); int selection=0;
                for(int i=0;i<devices.length();i++){JSONObject d=devices.getJSONObject(i);if(DevicePresentation.dispatchable(d)){deviceIds.add(d.getString("id"));names.add(d.getString("name")+" · "+DevicePresentation.status(d));if(d.getString("id").equals(selected))selection=names.size()-1;}}
                if(!selected.isEmpty()&&selection==0){deviceIds.add(selected);names.add("先前选择的电脑（当前不可用）");selection=names.size()-1;}
                device.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,names));device.setSelection(selection);
            }); else notice("尚未配对。草稿已保存在手机，可先保存再到资料库登录。");
        } catch(Exception e){fail(e);}
    }
    private Spinner spinner(String title,String[] values){body.addView(label(title,13,true));Spinner s=new Spinner(this);s.setMinimumHeight(dp(48));s.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,values));body.addView(s);return s;}
    private AdapterView.OnItemSelectedListener listener(){return new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> a,View v,int p,long l){if(ready)persist();}public void onNothingSelected(AdapterView<?> a){}};}
    private boolean persist(){if(submitted||!ready)return true;try{draft.put("attachments",attachments).put("content",content.getText().toString()).put("extra",extra.getText().toString()).put("tags",tags.getText().toString()).put("autoArchive",archive.isChecked()).put("agent",agent.getSelectedItemPosition()==0?"":agent.getSelectedItem().toString()); if(device.getSelectedItemPosition()>0)draft.put("deviceId",deviceIds.get(device.getSelectedItemPosition()));else if(deviceIds.size()>1)draft.put("deviceId","");new Drafts(this).save(draft);return true;}catch(Exception e){fail(e);return false;}}
    private boolean visible(JSONObject f){return "全部".equals(filter)||filter.equals(InputFiles.category(f));}
    private void selectVisible(boolean selected){try{for(int i=0;i<attachments.length();i++){JSONObject f=attachments.getJSONObject(i);if(visible(f))f.put("selected",selected);}persist();renderAttachments();}catch(Exception e){fail(e);}}
    private void renderAttachments(){if(attachmentList==null)return;attachmentList.removeAllViews();try{for(int i=0;i<attachments.length();i++){JSONObject f=attachments.getJSONObject(i);if(!visible(f))continue;LinearLayout row=card(attachmentList);CheckBox check=new CheckBox(this);check.setText(f.optString("name","正在读取文件…"));check.setTextColor(ink);check.setMinHeight(dp(48));check.setChecked(f.optBoolean("selected",true));row.addView(check);long size=f.optLong("bytes",-1);row.addView(label(InputFiles.category(f)+" · "+(size<0?"大小待确认":String.format(Locale.ROOT,"%.2f MiB",size/1048576.0))+" · "+("ready".equals(f.optString("state"))?"本机副本已校验":"reading".equals(f.optString("state"))?"正在保存本机副本":f.optString("error","无法读取")),12,false));check.setOnCheckedChangeListener((b,value)->{try{f.put("selected",value);persist();updateAttachmentSummary();}catch(Exception e){fail(e);}});}updateAttachmentSummary();}catch(Exception e){fail(e);}}
    private void updateAttachmentSummary(){try{JSONArray selected=InputFiles.selected(attachments);attachmentSummary.setText("已选 "+selected.length()+" 个 · 筛选只改变显示，不会取消勾选");send.setEnabled(!submitted);}catch(Exception e){attachmentSummary.setText(e.getMessage());send.setEnabled(false);}}
    private void addUris(List<Uri> uris){for(Uri uri:uris){try{JSONObject pending=new JSONObject().put("id",UUID.randomUUID().toString()).put("name","正在读取文件…").put("state","reading").put("selected",true);int position=attachments.length();attachments.put(pending);persist();renderAttachments();work(()->new InputFiles(this).copy(id,pending,uri),copied->{if(submitted)return;copied.put("selected",copied.optBoolean("selected",true)&&attachments.getJSONObject(position).optBoolean("selected",true));attachments.put(position,copied);persist();renderAttachments();});}catch(Exception e){fail(e);}}}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==92&&result==RESULT_OK&&data!=null){Set<Uri> uris=new LinkedHashSet<>(sharedUris(data));if(data.getData()!=null)uris.add(data.getData());for(Uri uri:uris)try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception ignored){}addUris(new ArrayList<>(uris));}}
    private void submit(){
        if(submitted||!persist())return;
        try {
            String raw=original.isEmpty()?draft.getString("content"):original,addition=draft.getString("extra");String full=raw+(addition.isEmpty()?"":"\n\n补充要求：\n"+addition);
            JSONArray selected=InputFiles.selected(attachments);
            if((full.trim().isEmpty()&&selected.length()==0)||full.length()>10000)throw new Exception("请填写文字或选择附件；文字最多 10000 字符。");
            Credentials c=new Credentials(this); if(!c.isPaired()){notice("请先返回资料库，用设备配对码登录；草稿已保存。");return;}
            JSONArray tagArray=new JSONArray();for(String t:draft.getString("tags").split("[,，]"))if(!t.trim().isEmpty())tagArray.put(t.trim());
            if(tagArray.length()>20)throw new Exception("最多填写 20 个标签");for(int i=0;i<tagArray.length();i++)if(tagArray.getString(i).length()>60)throw new Exception("单个标签最多 60 字符");
            JSONObject payload=new JSONObject().put("content",full).put("submissionId",id).put("autoArchive",draft.getBoolean("autoArchive")).put("tags",tagArray);
            if(selected.length()>0)payload.put("attachments",selected);
            if(!draft.optString("agent").isEmpty())payload.put("agent",draft.getString("agent"));if(!draft.optString("deviceId").isEmpty())payload.put("deviceId",draft.getString("deviceId"));
            new Outbox(this).enqueue(payload,c.server()); submitted=true;new Drafts(this).remove(id);send.setEnabled(false);ready=false;notice("已保存到手机，正在提交…");progressTimer.post(progressPoll);QueueJob.schedule(this);
            work(()->{Outbox.flush(getApplicationContext());return new Outbox(this).list();},rows->{progressTimer.removeCallbacks(progressPoll);for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(id.equals(row.optString("id")))notice(row.optString("state").equals("sent")?"提交成功，电脑将开始处理。":"尚未提交成功，内容已保存在待提交列表。"+row.optString("error"));}});
        }catch(Exception e){fail(e);}
    }
    private JSONObject queuedRecord(String id)throws Exception{JSONArray rows=new Outbox(this).list();for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(id.equals(row.optString("id")))return row;}return null;}
    private void showQueued(JSONObject row)throws Exception{
        body.addView(label(row.getJSONObject("payload").getString("content"),16,false));
        notice(row.optString("state").equals("sent")?"已提交成功。":"内容已保存到待提交列表，使用原编号继续提交。");
        button(body,"查看待提交与任务进度",()->{startActivity(new Intent(this,MainActivity.class).putExtra("tab","待提交"));finish();});
        if(!row.optString("state").equals("sent"))button(body,"重试提交",()->work(()->{new Outbox(this).retry(id);QueueJob.schedule(this);Outbox.flush(this);return queuedRecord(id);},value->{body.removeAllViews();showQueued(value);}));
    }
    @Override protected void onSaveInstanceState(Bundle out){out.putString("draftId",id);super.onSaveInstanceState(out);}
    @Override protected void onPause(){progressTimer.removeCallbacks(progressPoll);if(ready)persist();super.onPause();}
}
