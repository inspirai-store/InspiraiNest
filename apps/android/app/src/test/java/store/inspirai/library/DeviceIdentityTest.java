package store.inspirai.library;

import android.content.Context;
import android.provider.Settings;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import store.inspirai.library.core.DeviceIdentity;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class DeviceIdentityTest {
    private Context context;
    private JSONObject policy;
    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        context.getSharedPreferences("device-identity", Context.MODE_PRIVATE).edit().clear().commit();
        policy = new JSONObject().put("version", 2).put("namespace", "11111111-1111-4111-8111-111111111111");
    }
    private void systemId(String value) {
        Settings.Secure.putString(context.getContentResolver(), Settings.Secure.ANDROID_ID, value);
    }
    @Test public void stableScopedIdRetainsInstallationAndNeverUploadsRawValue() throws Exception {
        systemId("0123456789abcdef");
        JSONObject first = DeviceIdentity.payload(context, policy, false);
        JSONObject second = DeviceIdentity.payload(context, policy, false);
        assertEquals(first.getString("installationId"), second.getString("installationId"));
        assertEquals(first.getJSONObject("identity").toString(), second.getJSONObject("identity").toString());
        assertEquals("android-id", first.getJSONObject("identity").getString("source"));
        assertFalse(first.toString().contains("0123456789abcdef"));
        String oldDigest = first.getJSONObject("identity").getString("digest");
        policy.put("namespace", "22222222-2222-4222-8222-222222222222");
        assertNotEquals(oldDigest, DeviceIdentity.payload(context, policy, false).getJSONObject("identity").getString("digest"));
    }
    @Test public void unavailableIdKeepsCacheAndChangedIdRequiresConfirmation() throws Exception {
        systemId("0123456789abcdef");
        String original = DeviceIdentity.payload(context, policy, false).getJSONObject("identity").toString();
        systemId(null);
        assertEquals(original, DeviceIdentity.payload(context, policy, false).getJSONObject("identity").toString());
        systemId("fedcba9876543210");
        try { DeviceIdentity.payload(context, policy, false); fail("changed identity accepted"); }
        catch (Exception expected) { assertTrue(expected.getMessage().contains("重新配对")); }
        assertNotEquals(original, DeviceIdentity.payload(context, policy, true).getJSONObject("identity").toString());
    }
    @Test public void invalidIdUsesPersistentFallbackUntilExplicitPairing() throws Exception {
        systemId("9774d56d682e549c");
        String original = DeviceIdentity.payload(context, policy, false).getJSONObject("identity").toString();
        assertEquals("local", new JSONObject(original).getString("source"));
        systemId("0123456789abcdef");
        assertEquals(original, DeviceIdentity.payload(context, policy, false).getJSONObject("identity").toString());
        assertEquals("android-id", DeviceIdentity.payload(context, policy, true).getJSONObject("identity").getString("source"));
    }
}
