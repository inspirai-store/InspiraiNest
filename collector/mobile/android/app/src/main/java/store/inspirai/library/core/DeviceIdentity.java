package store.inspirai.library.core;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONObject;
import java.util.UUID;

public final class DeviceIdentity {
    private DeviceIdentity() {}

    public static JSONObject payload(Context context) throws Exception {
        SharedPreferences preferences = context.getSharedPreferences("device-identity", Context.MODE_PRIVATE);
        String installationId = preferences.getString("installation-id", null);
        if (installationId == null) {
            installationId = UUID.randomUUID().toString();
            if (!preferences.edit().putString("installation-id", installationId).commit()) throw new Exception("无法保存本机设备标识。");
        }
        return new JSONObject().put("installationId", installationId).put("platform", "android")
                .put("system", (Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE).trim());
    }
}
