package store.inspirai.library;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
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
}
