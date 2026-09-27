package store.inspirai.library.core;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URI;
import java.security.MessageDigest;
import java.util.*;

/** Public release requests never carry pairing credentials. */
public final class AppUpdate {
    private static final long MAX_APK = 150L * 1024 * 1024;
    public interface Progress { void changed(int percent); }
    public static final class Release {
        public final String version, sha256, url;
        public final long code, size;
        public Release(JSONObject json, String server) throws Exception {
            String origin = Credentials.normalizeServer(server);
            version=json.getString("version"); code=json.getLong("versionCode");
            sha256=json.getString("sha256").toLowerCase(Locale.ROOT); size=json.getLong("size");
            String relative=json.getString("url");
            if(!version.matches("\\d+\\.\\d+\\.\\d+") || code<=0 || size<=0 || size>MAX_APK
                || !sha256.matches("[a-f0-9]{64}") || !relative.equals("/downloads/personal-library-"+version+"-release.apk"))
                throw new IOException("更新信息无效，请稍后重试。");
            url=origin+relative;
        }
        public boolean newerThan(long installed) { return code>installed; }
    }
    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URI(url).toURL().openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000); c.setInstanceFollowRedirects(false);
        c.setUseCaches(false); c.setRequestProperty("Cache-Control","no-cache");
        if(c.getResponseCode()!=200){c.disconnect();throw new IOException("暂时无法获取更新，请检查网络后重试。");}
        return c;
    }
    public static Release check(String server) throws Exception {
        Api.requireBackground();
        String origin = Credentials.normalizeServer(server);
        HttpURLConnection c=open(origin+"/client-release.json");
        try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>65536)throw new IOException("更新信息过大。");out.write(b,0,n);}
            JSONObject android=new JSONObject(out.toString("UTF-8")).optJSONObject("android");
            if(android==null)throw new IOException("暂未发布安卓更新，请稍后重试。");
            return new Release(android, origin);
        }finally{c.disconnect();}
    }
    public static File file(Context context,Release release) {
        return new File(new File(context.getCacheDir(),"updates"),release.sha256+".apk");
    }
    public static File download(Context context,Release release,Progress progress)throws Exception {
        Api.requireBackground();
        File target=file(context,release);
        if(target.exists()){try{verify(context,release,target);progress.changed(100);return target;}catch(Exception ignored){target.delete();}}
        if(!target.getParentFile().isDirectory()&&!target.getParentFile().mkdirs())throw new IOException("无法保存更新，请检查手机剩余空间。");
        File partial=new File(target.getPath()+".part");
        HttpURLConnection c=open(release.url);
        try{
            long declared=c.getContentLengthLong();if(declared>=0&&declared!=release.size)throw new IOException("安装包大小不符，请重新检查更新。");
            try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(partial)){
                byte[] b=new byte[32768];int n,last=-1;long total=0;
                while((n=in.read(b))!=-1){
                    if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("下载已取消。");
                    total+=n;if(total>release.size)throw new IOException("安装包大小不符。");out.write(b,0,n);
                    int percent=(int)(total*100/release.size);if(percent!=last){last=percent;progress.changed(percent);}
                }
            }
            verify(context,release,partial);
            if(!partial.renameTo(target))throw new IOException("无法保存安装包，请重试。");
            return target;
        }finally{c.disconnect();partial.delete();}
    }
    public static void verifyBytes(Release release,File file)throws Exception {
        if(file.length()!=release.size)throw new IOException("安装包下载不完整，请重试。");
        MessageDigest hash=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(file)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)hash.update(b,0,n);}
        StringBuilder hex=new StringBuilder();for(byte b:hash.digest())hex.append(String.format(Locale.ROOT,"%02x",b&255));
        if(!hex.toString().equals(release.sha256))throw new IOException("安装包校验失败，请重新下载。");
    }
    @SuppressWarnings("deprecation")
    public static void verify(Context context,Release release,File file)throws Exception {
        verifyBytes(release,file);
        PackageManager pm=context.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo incoming=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags),installed=pm.getPackageInfo(context.getPackageName(),flags);
        if(incoming==null||!context.getPackageName().equals(incoming.packageName)||version(incoming)!=release.code||version(incoming)<=version(installed))
            throw new IOException("安装包与当前应用或更新版本不符。");
        if(!signatures(incoming).equals(signatures(installed))||signatures(installed).isEmpty())throw new IOException("安装包签名不符，无法安装。");
    }
    @SuppressWarnings("deprecation") private static long version(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}
    @SuppressWarnings("deprecation") private static Set<String> signatures(PackageInfo p){
        Signature[] values=Build.VERSION.SDK_INT>=28?(p.signingInfo==null?null:p.signingInfo.getApkContentsSigners()):p.signatures;
        Set<String> set=new HashSet<>();if(values!=null)for(Signature s:values)set.add(s.toCharsString());return set;
    }
}
