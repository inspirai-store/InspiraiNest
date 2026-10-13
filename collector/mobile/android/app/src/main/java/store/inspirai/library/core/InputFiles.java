package store.inspirai.library.core;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Private, hash-checked copies. Paths are derived from IDs, never from shared filenames. */
public final class InputFiles {
    public static final long FILE_LIMIT=32L*1024*1024, TOTAL_LIMIT=128L*1024*1024;
    private final Context context;
    public InputFiles(Context c){context=c.getApplicationContext();}
    private File folder(String submission)throws IOException{if(submission==null||!submission.matches("[a-fA-F0-9-]{36}"))throw new IOException("附件提交编号无效");File f=new File(context.getNoBackupFilesDir(),"share-input/"+submission);if(!f.isDirectory()&&!f.mkdirs())throw new IOException("无法保存附件，请检查设备空间");return f;}
    public File file(String submission,String id)throws IOException{if(id==null||!id.matches("[a-fA-F0-9-]{36}"))throw new IOException("附件编号无效");return new File(folder(submission),id+".bin");}
    public JSONObject read(String submission,String id)throws Exception{return new JSONObject(new String(new AtomicFile(new File(file(submission,id).getParentFile(),id+".json")).readFully(),StandardCharsets.UTF_8));}
    private void write(String submission,JSONObject item)throws Exception{AtomicFile a=new AtomicFile(new File(file(submission,item.getString("id")).getParentFile(),item.getString("id")+".json"));FileOutputStream out=a.startWrite();try{out.write(item.toString().getBytes(StandardCharsets.UTF_8));a.finishWrite(out);}catch(Exception e){a.failWrite(out);throw e;}}
    public JSONObject copy(String submission,JSONObject pending,Uri uri)throws Exception{
        JSONObject item=new JSONObject(pending.toString());File target=file(submission,item.getString("id")),temp=new File(target.getPath()+".tmp");
        try {
            String name="附件",mime=context.getContentResolver().getType(uri);long reported=-1;
            try(Cursor c=context.getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)){if(c!=null&&c.moveToFirst()){int n=c.getColumnIndex(OpenableColumns.DISPLAY_NAME),s=c.getColumnIndex(OpenableColumns.SIZE);if(n>=0&&!c.isNull(n))name=c.getString(n);if(s>=0&&!c.isNull(s))reported=c.getLong(s);}}
            name=name.replaceAll("[\\p{Cntrl}]", " ");if(name.length()>200)name=name.substring(0,200);if(name.trim().isEmpty())name="附件";
            mime=mime(name,mime);item.put("name",name).put("mime",mime==null?"":mime).put("bytes",reported);
            if(mime==null){item.put("selected",false);throw new IOException("暂不支持此文件类型");}
            if(reported>FILE_LIMIT)throw new IOException("单个文件超过 32 MiB");
            MessageDigest digest=MessageDigest.getInstance("SHA-256");long size=0;
            try(InputStream in=context.getContentResolver().openInputStream(uri);FileOutputStream out=new FileOutputStream(temp)){if(in==null)throw new IOException("无法读取所选文件");byte[] buffer=new byte[65536];int count;while((count=in.read(buffer))!=-1){if(Thread.currentThread().isInterrupted())throw new IOException("读取已中断，请重新添加此文件");size+=count;if(size>FILE_LIMIT)throw new IOException("单个文件超过 32 MiB");out.write(buffer,0,count);digest.update(buffer,0,count);}out.getFD().sync();}
            if(size==0)throw new IOException("文件为空");if(reported>=0&&reported!=size)throw new IOException("读取期间文件大小改变，请重新添加");
            if(!temp.renameTo(target))throw new IOException("无法保存附件副本，请检查设备空间");
            String sha=hex(digest.digest());if(!sha.equals(sha256(target)))throw new IOException("附件副本校验失败，请重新添加");
            item.put("bytes",size).put("sha256",sha).put("state","ready").remove("error");
        }catch(Exception failure){temp.delete();item.put("state","error").put("error",failure instanceof SecurityException?"读取权限已失效，请重新添加":failure instanceof IOException?failure.getMessage():"无法读取文件，请检查权限和剩余空间");}
        write(submission,item);return item;
    }
    public static String mime(String name,String reported){
        if(reported!=null&&reported.startsWith("video/"))return null;
        String extension=name.contains(".")?name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT):"";
        String[] ext={"txt","md","markdown","pdf","docx","jpg","jpeg","png","webp","gif","mp3","m4a","aac","wav","ogg","flac","webm"};
        String[] types={"text/plain","text/markdown","text/markdown","application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","image/jpeg","image/jpeg","image/png","image/webp","image/gif","audio/mpeg","audio/mp4","audio/aac","audio/wav","audio/ogg","audio/flac","audio/webm"};
        for(int i=0;i<ext.length;i++)if(extension.equals(ext[i]))return types[i];
        if(reported!=null)for(String type:types)if(type.equals(reported))return type;
        return null;
    }
    public static String category(JSONObject f){String mime=f.optString("mime");return mime.startsWith("image/")?"图片":mime.startsWith("audio/")?"音频":"文档";}
    public static String title(JSONObject task){String text=task.optString("content",task.optString("url",""));if(!text.trim().isEmpty()&&!"null".equals(text))return text;JSONArray files=task.optJSONArray("inputAttachments");if(files==null)files=task.optJSONArray("attachments");return files!=null&&files.length()>0?"附件采集 · "+files.optJSONObject(0).optString("name","文件")+(files.length()>1?" 等 "+files.length()+" 个文件":""):"采集任务";}
    public static String progressText(JSONObject p){return p.optString("name").isEmpty()?"":String.format(Locale.ROOT,"上传 %d / %d · %s · %.1f / %.1f MiB",p.optInt("index"),p.optInt("count"),p.optString("name"),p.optLong("bytes")/1048576.0,p.optLong("total")/1048576.0);}
    public static JSONArray selected(JSONArray rows)throws Exception{
        JSONArray result=new JSONArray();long total=0;
        for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(!row.optBoolean("selected",true))continue;if(!"ready".equals(row.optString("state")))throw new IOException("附件尚未读取成功："+row.optString("name")+"。可取消勾选后继续。");long size=row.getLong("bytes");if(size<=0||size>FILE_LIMIT)throw new IOException("单个文件最多 32 MiB");total+=size;result.put(new JSONObject().put("id",row.getString("id")).put("name",row.getString("name")).put("sha256",row.getString("sha256")));}
        if(result.length()>20)throw new IOException("一次最多选择 20 个文件");if(total>TOTAL_LIMIT)throw new IOException("选中附件合计超过 128 MiB");return result;
    }
    public JSONObject progress(String submission){try{return new JSONObject(new String(new AtomicFile(new File(folder(submission),"upload.json")).readFully(),StandardCharsets.UTF_8));}catch(Exception ignored){return new JSONObject();}}
    public synchronized void progress(String submission,JSONObject value)throws Exception{AtomicFile a=new AtomicFile(new File(folder(submission),"upload.json"));FileOutputStream out=a.startWrite();try{out.write(value.toString().getBytes(StandardCharsets.UTF_8));a.finishWrite(out);}catch(Exception e){a.failWrite(out);throw e;}}
    public void discard(String submission){try{File f=folder(submission);File[] all=f.listFiles();if(all!=null)for(File item:all)if(item.isFile())item.delete();f.delete();}catch(Exception ignored){}}
    public static String sha256(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[65536];int count;while((count=in.read(buffer))!=-1)digest.update(buffer,0,count);}return hex(digest.digest());}
    public static byte[] preview(File file,int limit)throws IOException{try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int count;while(out.size()<limit&&(count=in.read(buffer,0,Math.min(buffer.length,limit-out.size())))!=-1)out.write(buffer,0,count);return out.toByteArray();}}
    private static String hex(byte[] bytes){StringBuilder result=new StringBuilder();for(byte b:bytes)result.append(String.format(Locale.ROOT,"%02x",b&255));return result.toString();}
}
