package store.inspirai.library.core;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;
import org.json.JSONObject;
import java.util.UUID;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import store.inspirai.library.BuildConfig;

public final class DeviceIdentity {
    private DeviceIdentity() {}

    public static JSONObject payload(Context context) throws Exception {
        SharedPreferences preferences = context.getSharedPreferences("device-identity", Context.MODE_PRIVATE);
        String installationId = preferences.getString("installation-id", null);
        if (installationId == null) {
            installationId = UUID.randomUUID().toString();
            if (!preferences.edit().putString("installation-id", installationId).commit()) throw new Exception("无法保存本机设备标识。");
        }
        return new JSONObject().put("installationId", installationId).put("platform", "android").put("clientType", "android")
                .put("system", (Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE).trim())
                .put("deviceInfo", new JSONObject().put("os", new JSONObject().put("family", "Android").put("version", Build.VERSION.RELEASE))
                    .put("client", new JSONObject().put("type", "android").put("name", "InspiraiNest").put("version", BuildConfig.VERSION_NAME))
                    .put("model", (Build.MANUFACTURER + " " + Build.MODEL).trim()));
    }

    public static JSONObject payload(Context context, JSONObject policy, boolean allowChange) throws Exception {
        JSONObject result = payload(context);
        if (policy == null) return result;
        String namespace = policy.optString("namespace");
        if (policy.optInt("version") != 2 || !namespace.matches("[0-9a-fA-F-]{36}")) throw new Exception("设备身份策略无效。");
        SharedPreferences preferences = context.getSharedPreferences("device-identity", Context.MODE_PRIVATE);
        String stored = preferences.getString("identity-" + namespace, null);
        JSONObject previous = stored == null ? null : new JSONObject(stored);
        String androidId = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        if (androidId != null) androidId = androidId.toLowerCase(Locale.ROOT);
        boolean valid = androidId != null && androidId.matches("[0-9a-f]{16}")
                && !androidId.equals("0000000000000000") && !androidId.equals("9774d56d682e549c");
        JSONObject identity = previous;
        if (previous == null || valid && (!"local".equals(previous.optString("source")) || allowChange)) {
            String source = valid ? "android-id" : "local";
            String value = valid ? androidId : result.getString("installationId").toLowerCase(Locale.ROOT);
            String digest = digest(namespace, source, value);
            if (previous != null && !previous.getString("digest").equals(digest) && !allowChange)
                throw new Exception("系统设备标识已变化，请确认并重新配对。");
            identity = new JSONObject().put("version", 2).put("namespace", namespace).put("source", source).put("digest", digest);
        }
        if (!preferences.edit().putString("identity-" + namespace, identity.toString()).commit()) throw new Exception("无法保存本机设备标识。");
        return result.put("identity", identity);
    }

    public static String digest(String namespace, String source, String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest((namespace + "\n" + source + "\n" + value).getBytes(StandardCharsets.UTF_8));
        StringBuilder output = new StringBuilder();
        for (byte b : bytes) output.append(String.format(Locale.ROOT, "%02x", b & 255));
        return output.toString();
    }
}
