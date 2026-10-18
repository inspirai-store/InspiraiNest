package store.inspirai.library;

import store.inspirai.library.core.Credentials;
import java.net.*;
import java.io.*;

/** Only fetch a private library path from the exact paired origin. No redirect/token forwarding. */
final class PrivateFiles {
    static boolean allowed(String server,String address) {
        try {URI base=new URI(server),url=new URI(address);return base.getScheme().equals(url.getScheme())&&base.getHost().equals(url.getHost())&&port(base)==port(url)&&url.getUserInfo()==null&&url.getPath().startsWith("/library/");}catch(Exception e){return false;}
    }
    private static int port(URI u){return u.getPort()==-1?("https".equals(u.getScheme())?443:80):u.getPort();}
    static byte[] read(Credentials c,String address)throws Exception{
        Credentials.Snapshot pairing=c.snapshot();
        if(pairing==null||!allowed(pairing.server,address))throw new IOException("只能读取当前资料库的私有文件");
        HttpURLConnection conn=(HttpURLConnection)new URL(address).openConnection();
        conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(15000);conn.setReadTimeout(30000);conn.setUseCaches(false);
        conn.setRequestProperty("Authorization","Bearer "+pairing.token);
        try{int code=conn.getResponseCode();if(code!=200)throw new IOException(code==401?"设备授权已失效，请重新配对":"文件请求失败（HTTP "+code+"）");
            try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buf=new byte[8192];int n;long deadline=android.os.SystemClock.elapsedRealtime()+120000;while((n=in.read(buf))!=-1){if(out.size()+n>60*1024*1024||android.os.SystemClock.elapsedRealtime()>deadline)throw new IOException("文件过大或传输超时，请重试");out.write(buf,0,n);}return out.toByteArray();}
        }finally{conn.disconnect();}
    }
}
