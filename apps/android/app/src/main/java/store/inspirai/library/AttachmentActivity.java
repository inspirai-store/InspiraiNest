package store.inspirai.library;
import android.os.Bundle;
import android.graphics.*;
import android.util.Base64;
import android.widget.*;
import org.json.*;
import java.nio.charset.StandardCharsets;
import store.inspirai.library.core.*;
public class AttachmentActivity extends Screen {
 @Override public void onCreate(Bundle state){super.onCreate(state);String name=getIntent().getStringExtra("file"),route=getIntent().getStringExtra("route");page("附件预览",name);if(name==null||route==null||!route.matches("/api/(archives/[a-f0-9]{64}|tasks/[^/]+/draft)")){notice("附件地址无效");return;}notice("正在读取附件…");work(()->{JSONArray files=new Api(new Credentials(this)).call(route,"GET",null).getJSONArray("files");for(int i=0;i<files.length();i++)if(name.equals(files.getJSONObject(i).optString("path")))return files.getJSONObject(i);throw new Exception("附件不存在或已不可访问");},f->{byte[] bytes=Base64.decode(f.getString("body"),Base64.DEFAULT);if(name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(png|jpe?g|webp|gif|avif)$")){BitmapFactory.Options size=new BitmapFactory.Options();size.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,size);BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=Math.max(1,Math.max(size.outWidth,size.outHeight)/1800);Bitmap bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);ImageView image=new ImageView(this);image.setImageBitmap(bitmap);image.setContentDescription(name);image.setAdjustViewBounds(true);body.addView(image,new LinearLayout.LayoutParams(-1,-2));}else{TextView text=label(new String(bytes,StandardCharsets.UTF_8),18,false);text.setTextIsSelectable(true);text.setLineSpacing(0,1.5f);body.addView(text);}notice("");});}
}
