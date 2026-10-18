package store.inspirai.library;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.json.JSONObject;
import store.inspirai.library.core.PairingCode;
import java.time.Instant;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=35)
public class PairingCodeTest {
    private JSONObject code()throws Exception{return new JSONObject().put("protocol","personal-library-pairing").put("version",1).put("server","https://library.example").put("role","owner").put("key","a".repeat(43)).put("expiresAt",Instant.now().plusSeconds(900).toString());}
    @Test public void scansOriginAndOneTimeKeyTogether()throws Exception{PairingCode v=PairingCode.parse(code().toString());assertEquals("https://library.example",v.server);assertEquals("a".repeat(43),v.key);}
    @Test public void rejectsUnrelatedCodesAndExpiredOrWorkerAuthority()throws Exception{
        for(String raw:new String[]{"https://example.com",code().put("role","worker").toString(),code().put("expiresAt","bad-time").toString(),code().put("expiresAt",Instant.now().minusSeconds(1).toString()).toString(),code().put("version",2).toString()}){try{PairingCode.parse(raw);fail("Accepted invalid code");}catch(Exception expected){assertFalse(expected.getMessage().contains("a".repeat(43)));}}
    }
    @Test public void rejectsHttpCredentialsPathsAndMalformedKeys()throws Exception{
        for(String server:new String[]{"http://library.example","https://user:pass@library.example","https://library.example/path","https://library.example?secret=bad"}){try{PairingCode.parse(code().put("server",server).toString());fail("Accepted invalid origin");}catch(Exception expected){}}
        try{PairingCode.parse(code().put("key","short").toString());fail();}catch(Exception expected){}
    }
}
