package store.inspirai.library;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.Button;
import android.content.Context;
import org.json.JSONObject;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.Implementation;
import org.robolectric.util.ReflectionHelpers;
import org.robolectric.shadows.ShadowLooper;
import store.inspirai.library.core.Api;
import store.inspirai.library.core.Credentials;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=35)
public class ClientLoginTest {
    private EditText input(View view,String hint) {
        if(view instanceof EditText && hint.equals(String.valueOf(((EditText)view).getHint())))return (EditText)view;
        if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){EditText found=input(((ViewGroup)view).getChildAt(i),hint);if(found!=null)return found;}
        return null;
    }
    @Test public void firstLoginIsBlankAndBackgroundClearsPassword() {
        var controller=Robolectric.buildActivity(MainActivity.class).create().start().resume().visible();
        MainActivity activity=controller.get();View root=activity.getWindow().getDecorView();
        EditText server=input(root,"https://"),password=input(root,"登录密码");
        assertNotNull(server);assertEquals("",server.getText().toString());assertNotNull(password);
        password.setText("  fixture secret  ");assertFalse(password.isSaveEnabled());
        server.setText("https://review.example:8443/");assertEquals("",password.getText().toString());
        password.setText("another secret");controller.pause();assertEquals("",password.getText().toString());controller.stop().destroy();
    }
    @Test public void canonicalOriginAndTypedLoginFailures() throws Exception {
        assertEquals("https://review.example",Credentials.normalizeServer(" HTTPS://REVIEW.EXAMPLE:443/ "));
        assertEquals("https://review.example:8443",Credentials.normalizeServer("https://review.example:8443/"));
        for(String code:new String[]{"mfa_required","mfa_invalid","credential_invalid"})assertEquals(code,Api.loginFailure(401,code).code);
        Api.Failure unknown=Api.loginFailure(401,"untrusted-secret");assertEquals("",unknown.code);assertFalse(unknown.getMessage().contains("untrusted"));assertFalse(unknown.getMessage().contains("授权已失效"));
    }
    @Test @Config(shadows={FailingCredentials.class,LoginApi.class},instrumentedPackages={"store.inspirai.library.core"})
    public void credentialSaveFailureKeepsOriginalConnectionAndClearsPassword() throws Exception {
        FailingCredentials.attempts=0;LoginApi.password="";
        var controller=Robolectric.buildActivity(MainActivity.class).create().start().resume().visible();
        MainActivity activity=controller.get();ReflectionHelpers.callInstanceMethod(activity,"login");
        View root=activity.getWindow().getDecorView();
        input(root,"https://").setText("https://review.example");input(root,"登录密码").setText("  fixture password  ");
        Button login=ReflectionHelpers.getField(activity,"loginButton");login.performClick();
        for(int n=0;n<100&&FailingCredentials.attempts==0;n++){Thread.sleep(10);ShadowLooper.idleMainLooper();}
        ShadowLooper.idleMainLooper();assertEquals(1,FailingCredentials.attempts);
        assertEquals("  fixture password  ",LoginApi.password);
        assertEquals("https://personal.example",new Credentials(activity).server());
        assertEquals("",input(root,"登录密码").getText().toString());
        assertEquals("",ReflectionHelpers.getField(activity,"pendingPassword"));assertTrue(login.isEnabled());
        controller.pause().stop().destroy();
    }
    @Implements(value=Credentials.class,isInAndroidSdk=false)
    public static class FailingCredentials {
        static volatile int attempts;
        @Implementation protected boolean isPaired(){return true;}
        @Implementation protected String server(){return "https://personal.example";}
        @Implementation protected String deviceId(){return "personal-device";}
        @Implementation protected void save(String server,String token,String deviceId) throws Exception {attempts++;throw new java.io.IOException("Fixture storage unavailable");}
    }
    @Implements(value=Api.class,isInAndroidSdk=false)
    public static class LoginApi {
        static volatile String password="";
        @Implementation protected static JSONObject pair(Context context,String server,String key,String name,String otp,String recovery) throws Exception {
            password=key;return new JSONObject().put("token","fixture-review-token").put("device",new JSONObject().put("id","review-device").put("role","owner"));
        }
    }

}
