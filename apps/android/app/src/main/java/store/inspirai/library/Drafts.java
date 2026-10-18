package store.inspirai.library;

import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Every unfinished composition is recoverable, including shares received before pairing. */
public final class Drafts {
    private final File folder;
    public Drafts(Context c) { folder=new File(c.getNoBackupFilesDir(),"compositions"); }
    private AtomicFile file(String id) { if(!id.matches("[a-fA-F0-9-]{36}"))throw new IllegalArgumentException("无效的草稿编号"); return new AtomicFile(new File(folder,id+".json")); }
    public synchronized void save(JSONObject draft) throws Exception { if(!folder.isDirectory()&&!folder.mkdirs())throw new IOException("无法保存草稿，请检查设备空间"); AtomicFile f=file(draft.getString("id")); FileOutputStream out=f.startWrite(); try {out.write(draft.toString().getBytes(StandardCharsets.UTF_8)); f.finishWrite(out);}catch(Exception e){f.failWrite(out);throw e;} }
    public JSONObject read(String id) throws Exception {return new JSONObject(new String(file(id).readFully(),StandardCharsets.UTF_8));}
    public JSONArray list() throws Exception {JSONArray rows=new JSONArray(); File[] files=folder.listFiles((d,n)->n.endsWith(".json")); if(files!=null)for(File f:files) rows.put(read(f.getName().replace(".json",""))); return rows;}
    public void remove(String id) {file(id).delete();}
}
