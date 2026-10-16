package store.inspirai.library;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;
import android.webkit.WebView;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;
@RunWith(RobolectricTestRunner.class) @Config(sdk=35)
public class CaptureEntryTest {
 @Test public void launcherOpensRecordingBeforePairing(){var controller=Robolectric.buildActivity(MainActivity.class).create();MainActivity activity=controller.get();assertEquals(CaptureActivity.class.getName(),shadowOf(activity).getNextStartedActivity().getComponent().getClassName());assertTrue(activity.isFinishing());controller.destroy();}
 @Test public void recordingSurfaceUsesBundledSecureOriginAndDurableWebStorage(){var controller=Robolectric.buildActivity(CaptureActivity.class).create();WebView web=ReflectionHelpers.getField(controller.get(),"web");assertTrue(web.getSettings().getDomStorageEnabled());assertFalse(web.getSettings().getAllowFileAccess());assertEquals("https://capture.local/index.html",shadowOf(web).getLastLoadedUrl());controller.destroy();}
 @Test public void writingBridgeAllowsOwnerRoutesButRejectsWorkerExecution() throws Exception {var method=CaptureActivity.class.getDeclaredMethod("allowed",String.class,String.class);method.setAccessible(true);String id="11111111-1111-4111-8111-111111111111";assertEquals(true,method.invoke(null,"/api/writing/sessions/"+id+"/history","GET"));assertEquals(true,method.invoke(null,"/api/writing/sessions/"+id+"/answers","POST"));assertEquals(true,method.invoke(null,"/api/writing/sessions/"+id+"/turns","POST"));assertEquals(false,method.invoke(null,"/api/writing/tasks/"+id+"/result","POST"));assertEquals(false,method.invoke(null,"/api/writing/sessions/"+id+"/files/../secret","GET"));}
 @Test public void jsonOriginalIsReadAsBytesRatherThanAnApiReply() throws Exception {var method=CaptureActivity.class.getDeclaredMethod("binaryRead",String.class,String.class);method.setAccessible(true);String id="11111111-1111-4111-8111-111111111111";assertEquals(true,method.invoke(null,"/api/writing/sessions/"+id+"/files/"+id,"GET"));assertEquals(false,method.invoke(null,"/api/writing/sessions/"+id+"/drafts/"+id,"GET"));assertEquals(false,method.invoke(null,"/api/writing/sessions/"+id+"/files/"+id,"POST"));}
}
