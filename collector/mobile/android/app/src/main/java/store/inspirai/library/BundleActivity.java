package store.inspirai.library;

import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.widget.*;
import android.graphics.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import store.inspirai.library.core.*;

/** Native authenticated review and attachment export. Nothing is cached without a save action. */
public class BundleActivity extends Screen {
    private JSONObject bundle;
    private String selectedPath;
    private String route;
    @Override public void onCreate(Bundle state){super.onCreate(state);page("正文与附件","所有已保存内容，按文件查看");route=getIntent().getStringExtra("route");if(state!=null)selectedPath=state.getString("selectedPath");if(route==null||!route.matches("/api/(archives/[a-f0-9]{64}|tasks/[^/]+/draft)")){notice("无效资料地址");return;}notice("加载中…");work(()->new Api(new Credentials(this)).call(route,"GET",null),value->{bundle=value;render();});}
    private void render()throws Exception{
        body.removeAllViews();JSONObject meta=bundle.getJSONObject("meta");body.addView(label(meta.getString("title"),22,true));body.addView(label(meta.optString("coverage_note"),14,false));
        JSONArray files=bundle.getJSONArray("files");for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);LinearLayout c=card(body);c.addView(label(f.getString("path"),15,true));c.addView(label(f.optString("role")+" · "+f.optInt("bytes")+" 字节",12,false));button(c,"查看附件",()->preview(f));button(c,"保存附件",()->save(f));}
        String task=getIntent().getStringExtra("taskId");if(task!=null)button(body,"确认审核，归档这份结果",()->confirm("已阅读结果，确认归档到资料库？",()->work(()->new Api(new Credentials(this)).call("/api/tasks/"+task+"/approve","POST",new JSONObject()),r->{notice("已确认归档");finish();})));
        notice("");String preferred=getIntent().getStringExtra("file");if(preferred!=null){getIntent().removeExtra("file");for(int i=0;i<files.length();i++)if(preferred.equals(files.getJSONObject(i).optString("path")))preview(files.getJSONObject(i));}
    }
    private void preview(JSONObject f){String name=f.optString("path");startActivity(new Intent(this,name.toLowerCase(Locale.ROOT).endsWith(".pdf")?PdfActivity.class:AttachmentActivity.class).putExtra("route",route).putExtra("file",name));}
    private void save(JSONObject f){selectedPath=f.optString("path");String mime=selectedPath.toLowerCase(Locale.ROOT).endsWith(".pdf")?"application/pdf":"application/octet-stream";startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,new File(selectedPath).getName()),81);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==81&&result==RESULT_OK&&data!=null&&selectedPath!=null){Uri uri=data.getData();String file=selectedPath;work(()->{JSONObject fresh=new Api(new Credentials(this)).call(route,"GET",null);JSONArray files=fresh.getJSONArray("files");for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);if(file.equals(f.getString("path"))){try(OutputStream out=getContentResolver().openOutputStream(uri,"w")){if(out==null)throw new IOException("无法写入所选位置");out.write(Base64.decode(f.getString("body"),Base64.DEFAULT));}return true;}}throw new IOException("附件已不可用");},r->notice("附件已保存"));}}
    @Override protected void onSaveInstanceState(Bundle state){state.putString("selectedPath",selectedPath);super.onSaveInstanceState(state);}
}
