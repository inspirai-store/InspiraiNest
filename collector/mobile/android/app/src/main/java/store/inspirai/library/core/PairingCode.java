package store.inspirai.library.core;

import org.json.JSONObject;
import java.time.Instant;

/** The scanned text is data, never a URL to open or a script to execute. */
public final class PairingCode {
    public final String server, key;
    private PairingCode(String server,String key){this.server=server;this.key=key;}
    public static PairingCode parse(String raw) throws Exception {
        try {
            if(raw==null||raw.length()>4096)throw new IllegalArgumentException();
            JSONObject value=new JSONObject(raw);
            if(!"personal-library-pairing".equals(value.optString("protocol"))||value.optInt("version")!=1)throw new IllegalArgumentException();
            if(!"owner".equals(value.optString("role")))throw new Exception("请在网页生成新的设备配对二维码。");
            String server=Credentials.normalizeServer(value.getString("server"));
            if(!server.startsWith("https://"))throw new IllegalArgumentException();
            String key=value.getString("key");
            if(!key.matches("[A-Za-z0-9_-]{32,200}"))throw new IllegalArgumentException();
            if(!Instant.parse(value.getString("expiresAt")).isAfter(Instant.now()))throw new Exception("配对二维码已过期，请在网页重新生成。");
            return new PairingCode(server,key);
        } catch(org.json.JSONException|RuntimeException e) { throw new Exception("这不是有效的资料库配对二维码。"); }
    }
}
