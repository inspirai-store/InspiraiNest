package store.inspirai.library;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.RuntimeEnvironment;
import org.json.JSONObject;
import store.inspirai.library.core.AppUpdate;
import java.io.*;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=35)
public class AppUpdateTest {
    private JSONObject release()throws Exception{return new JSONObject().put("version","1.2.0").put("versionCode",5).put("size",3).put("sha256","ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad").put("url","/downloads/personal-library-1.2.0-release.apk");}
    @Test public void comparesBuildNumbersAndKeepsDownloadOnConfiguredServer()throws Exception{
        AppUpdate.Release r=new AppUpdate.Release(release(), "https://self-host.example");assertTrue(r.newerThan(4));assertFalse(r.newerThan(5));assertFalse(r.newerThan(6));assertEquals("https://self-host.example"+"/downloads/personal-library-1.2.0-release.apk",r.url);
    }
    @Test public void rejectsUnsafeUpdateOrigins()throws Exception{
        for(String server:new String[]{"http://untrusted.example","https://user:password@self-host.example","https://self-host.example/path","https://self-host.example?token=x"}){
            try{new AppUpdate.Release(release(),server);fail("Accepted unsafe origin");}catch(Exception expected){}
        }
        assertEquals("https://second.example/downloads/personal-library-1.2.0-release.apk",new AppUpdate.Release(release(),"https://second.example/").url);
    }
    @Test public void rejectsMalformedVersionsMissingCodesAndUntrustedUrls()throws Exception{
        for(JSONObject j:new JSONObject[]{release().put("url","https://example.com/update.apk"),release().put("url","//example.com/update.apk"),release().put("url","/downloads/../update.apk"),release().put("versionCode",0),release().put("versionCode",JSONObject.NULL),release().put("sha256","bad"),release().put("size",200000000)}){
            try{new AppUpdate.Release(j, "https://self-host.example");fail("Accepted invalid release");}catch(Exception expected){}
        }
    }
    @Test public void rejectsTruncatedOrCorruptDownloadAndNonApkPayload()throws Exception{
        File file=File.createTempFile("update-test-",".apk");try{
            AppUpdate.Release r=new AppUpdate.Release(release(), "https://self-host.example");
            try(FileOutputStream out=new FileOutputStream(file)){out.write("abc".getBytes());}AppUpdate.verifyBytes(r,file);
            try{AppUpdate.verify(RuntimeEnvironment.getApplication(),r,file);fail("Accepted non-APK");}catch(Exception expected){}
            for(String content:new String[]{"ab","abd"}){try(FileOutputStream out=new FileOutputStream(file)){out.write(content.getBytes());}try{AppUpdate.verifyBytes(r,file);fail("Accepted corrupt bytes");}catch(IOException expected){}}
        }finally{file.delete();}
    }
}
