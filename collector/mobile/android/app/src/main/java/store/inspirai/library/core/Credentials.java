package store.inspirai.library.core;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import store.inspirai.library.BuildConfig;

/** App-private, non-backed-up credentials. All instances share one atomic-file lock. */
public final class Credentials {
    public static final String DEFAULT_SERVER = BuildConfig.DEFAULT_SERVER;
    private static final Object LOCK = new Object();
    private final AtomicFile file;
    private final String alias;

    public Credentials(Context context) {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "library-credentials.json"));
        alias = context.getPackageName() + ".library.credentials.v1";
    }

    public boolean isPaired() {
        synchronized (LOCK) {
            try { return snapshot() != null; }
            catch (Exception ignored) { return false; }
        }
    }

    /** Returns the default origin before pairing, suitable for binding pre-pair submissions. */
    public String server() {
        synchronized (LOCK) {
            try { return normalizeServer(read().optString("server", DEFAULT_SERVER)); }
            catch (Exception ignored) { return DEFAULT_SERVER; }
        }
    }

    public String token() throws Exception {
        Snapshot value = snapshot();
        if (value == null) throw new Exception("设备尚未配对。");
        return value.token;
    }

    public String deviceId() {
        synchronized (LOCK) {
            try { return read().optString("deviceId", ""); }
            catch (Exception ignored) { return ""; }
        }
    }

    public void save(String server, String token, String deviceId) throws Exception {
        String origin = normalizeServer(server);
        validateToken(token);
        if (deviceId == null || deviceId.isEmpty() || deviceId.length() > 200) {
            throw new Exception("设备编号无效。");
        }
        synchronized (LOCK) {
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key(true));
                cipher.updateAAD(aad(origin, deviceId));
                byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
                JSONObject record = new JSONObject().put("version", 1).put("server", origin)
                        .put("deviceId", deviceId)
                        .put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                        .put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP));
                write(record);
            } catch (Exception ignored) {
                throw new Exception("无法安全保存设备凭据。");
            }
        }
    }

    public void clear() throws Exception {
        synchronized (LOCK) {
            // Commit an empty record first: a failed write must not destroy the old key.
            write(new JSONObject());
            try {
                KeyStore store = keyStore();
                if (store.containsAlias(alias)) store.deleteEntry(alias);
            } catch (Exception ignored) {
                throw new Exception("设备凭据已清除，但旧加密密钥未能移除。");
            }
        }
    }

    /** Canonical origin; validation never reflects untrusted input in an exception. */
    public static String normalizeServer(String server) throws Exception {
        try {
            if (server == null || server.isEmpty()) throw new IllegalArgumentException();
            URI uri = new URI(server);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            String path = uri.getRawPath();
            int port = uri.getPort();
            if (uri.isOpaque() || host.isEmpty() || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (path != null && !path.isEmpty() && !path.equals("/"))
                    || port < -1 || port == 0 || port > 65535
                    || (uri.getRawAuthority() != null && uri.getRawAuthority().endsWith(":"))) {
                throw new IllegalArgumentException();
            }
            boolean debugLoopback = BuildConfig.DEBUG && scheme.equals("http")
                    && (host.equals("127.0.0.1") || host.equals("10.0.2.2") || host.equals("localhost"));
            if (!scheme.equals("https") && !debugLoopback) throw new IllegalArgumentException();
            if ((scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80)) port = -1;
            return new URI(scheme, null, host, port, null, null, null).toASCIIString();
        } catch (Exception ignored) {
            throw new Exception("请输入 HTTPS 服务器地址，不含账号密码、路径、查询参数或片段。");
        }
    }

    /** Snapshot server and token together so concurrent re-pairing cannot cross origins. */
    public Snapshot snapshot() throws Exception {
        synchronized (LOCK) {
            try {
                JSONObject record = read();
                if (record.length() == 0) return null;
                if (record.getInt("version") != 1) throw new IllegalArgumentException();
                String origin = normalizeServer(record.getString("server"));
                String device = record.getString("deviceId");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                byte[] iv = Base64.decode(record.getString("iv"), Base64.NO_WRAP);
                if (iv.length != 12) throw new IllegalArgumentException();
                cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
                cipher.updateAAD(aad(origin, device));
                String token = new String(cipher.doFinal(Base64.decode(record.getString("ciphertext"),
                        Base64.NO_WRAP)), StandardCharsets.UTF_8);
                validateToken(token);
                return new Snapshot(origin, token, device, record.getString("iv"));
            } catch (Exception ignored) {
                throw new Exception("设备凭据不可用，请重新配对。");
            }
        }
    }

    /** Hold only around short local state changes, never around network I/O. */
    boolean ifCurrent(Snapshot expected, LocalChange change) throws Exception {
        synchronized (LOCK) {
            if (!expected.samePairing(snapshot())) return false;
            change.run();
            return true;
        }
    }

    interface LocalChange { void run() throws Exception; }

    private JSONObject read() throws Exception {
        // AtomicFile.openRead also recovers an interrupted write on older Android releases.
        try { return new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8)); }
        catch (java.io.FileNotFoundException e) {
            if (!file.getBaseFile().exists()) return new JSONObject();
            throw e;
        }
    }

    private void write(JSONObject record) throws Exception {
        FileOutputStream stream = null;
        try {
            stream = file.startWrite();
            stream.write(record.toString().getBytes(StandardCharsets.UTF_8));
            stream.getFD().sync();
            file.finishWrite(stream);
        } catch (Exception ignored) {
            if (stream != null) file.failWrite(stream);
            throw new Exception("无法保存设备凭据。");
        }
    }

    private KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }

    private SecretKey key(boolean create) throws Exception {
        KeyStore store = keyStore();
        if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
        if (!create) throw new Exception("加密密钥不可用。");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build());
        return generator.generateKey();
    }

    private static byte[] aad(String server, String deviceId) throws Exception {
        return new JSONObject().put("version", 1).put("server", server).put("deviceId", deviceId)
                .toString().getBytes(StandardCharsets.UTF_8);
    }

    private static void validateToken(String token) throws Exception {
        if (token == null || token.isEmpty() || token.length() > 4096) throw new Exception("设备令牌无效。");
        for (int i = 0; i < token.length(); i++) {
            if (token.charAt(i) <= 32 || token.charAt(i) >= 127) throw new Exception("设备令牌无效。");
        }
    }

    /** Immutable atomic read. snapshot() returns null before pairing and after clear(). Never log token. */
    public static final class Snapshot {
        public final String server;
        public final String token;
        public final String deviceId;
        /** Non-secret marker that changes on every save, including re-pairing to the same origin. */
        public final String generation;

        private Snapshot(String server, String token, String deviceId, String generation) {
            this.server = server;
            this.token = token;
            this.deviceId = deviceId;
            this.generation = generation;
        }

        boolean samePairing(Snapshot other) {
            return other != null && generation.equals(other.generation) && server.equals(other.server)
                    && deviceId.equals(other.deviceId) && token.equals(other.token);
        }
    }
}
