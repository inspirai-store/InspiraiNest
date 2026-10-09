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
}
