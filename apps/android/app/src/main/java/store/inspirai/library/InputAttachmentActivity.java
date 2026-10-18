package store.inspirai.library;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.media.MediaPlayer;
import android.graphics.*;
import android.widget.*;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.nio.charset.*;
import store.inspirai.library.core.*;

/** Originals use native authenticated binary transport; tokens never enter WebView. */
public class InputAttachmentActivity extends Screen {
 private File local;private JSONObject meta;private MediaPlayer player;private boolean prepared;
 @Override public void onCreate(Bundle state){super.onCreate(state);page("原始附件",null);try{meta=new JSONObject(getIntent().getStringExtra("meta"));String route=getIntent().getStringExtra("route");body.addView(label(meta.getString("name"),22,true));body.addView(label(meta.getString("mime")+" · "+meta.getLong("bytes")+" 字节",13,false));notice("正在下载并校验原件…");Credentials c=new Credentials(this);Credentials.Snapshot paired=c.snapshot();String name=new File(meta.getString("name")).getName().replaceAll("[^\\p{L}\\p{N}._-]","_");File target=new File(getCacheDir(),"input-files/"+meta.getString("sha256")+"-"+name);work(()->new Api(c).downloadInput(paired,route,meta,target),file->{local=file;notice("");button(body,"保存原件",this::save);button(body,"用其他应用打开",this::external);preview();});}catch(Exception e){fail(e);}}
 private void preview()throws Exception {
  String mime=meta.getString("mime");
  if(mime.startsWith("audio/")){player=new MediaPlayer();player.setDataSource(local.getAbsolutePath());Button play=button(body,"准备音频…",()->{if(!prepared)return;if(player.isPlaying()){player.pause();}else player.start();});play.setEnabled(false);player.setOnPreparedListener(p->{prepared=true;play.setText("播放 / 暂停");play.setEnabled(true);});player.setOnErrorListener((p,w,e)->{notice("此设备无法播放该音频，可保存或用其他应用打开。");return true;});player.prepareAsync();}
  else if(mime.startsWith("image/")){work(()->{BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(local.getPath(),bounds);BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=Math.max(1,Math.max(bounds.outWidth,bounds.outHeight)/1800);return BitmapFactory.decodeFile(local.getPath(),options);},bitmap->{if(bitmap==null){notice("无法预览此图片，可保存原件。");return;}ImageView image=new ImageView(this);image.setAdjustViewBounds(true);image.setImageBitmap(bitmap);image.setContentDescription(meta.optString("name"));body.addView(image,new LinearLayout.LayoutParams(-1,-2));});}
  else if(mime.equals("application/pdf")){button(body,"阅读 PDF",()->startActivity(new Intent(this,PdfActivity.class).putExtra("route",getIntent().getStringExtra("route")).putExtra("inputMeta",meta.toString()).putExtra("file",meta.optString("name"))));}
  else if(mime.startsWith("text/")){work(()->{byte[] bytes=InputFiles.preview(local,256*1024);if(bytes.length>=2&&bytes[0]==(byte)255&&bytes[1]==(byte)254)return new String(bytes,2,bytes.length-2,StandardCharsets.UTF_16LE);if(bytes.length>=2&&bytes[0]==(byte)254&&bytes[1]==(byte)255)return new String(bytes,2,bytes.length-2,StandardCharsets.UTF_16BE);try{return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();}catch(CharacterCodingException e){return new String(bytes,Charset.forName("GB18030"));}},text->{TextView v=label(text,18,false);v.setTextIsSelectable(true);v.setLineSpacing(0,1.5f);body.addView(v);if(local.length()>256*1024)notice("此处预览前 256 KiB，保存原件可查看全文。");});}
  else body.addView(label("DOCX 原件可保存，或用 WPS 等文档应用打开。解析后的正文位于资料阅读页。",16,false));
 }
 private void save(){startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(meta.optString("mime","application/octet-stream")).putExtra(Intent.EXTRA_TITLE,new File(meta.optString("name")).getName()),95);}
 private void external(){try{Uri uri=FileProvider.getUriForFile(this,getPackageName()+".inputs",local);Intent view=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,meta.optString("mime")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);view.setClipData(ClipData.newRawUri("原始附件",uri));startActivity(view);}catch(ActivityNotFoundException e){notice("没有可打开此文件的应用，请先保存原件。");}}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==95&&result==RESULT_OK&&data!=null&&local!=null){work(()->{try(InputStream in=new FileInputStream(local);OutputStream out=getContentResolver().openOutputStream(data.getData(),"w")){if(out==null)throw new IOException("无法保存文件");byte[] bytes=new byte[65536];int count;while((count=in.read(bytes))!=-1)out.write(bytes,0,count);}return true;},v->notice("原件已保存"));}}
 @Override protected void onPause(){if(player!=null&&prepared&&player.isPlaying())player.pause();super.onPause();}
 @Override protected void onDestroy(){if(player!=null){player.release();player=null;}super.onDestroy();}
}
