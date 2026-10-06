package store.inspirai.library.core;

import android.os.Looper;
import android.os.SystemClock;
import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** Synchronous API: callers must use a background thread. No redirects or error-body reflection. */
public final class Api {
    private static final int MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_BUNDLE_BYTES = 60 * 1024 * 1024;
    private final Credentials credentials;

    public Api(Credentials credentials) { this.credentials = credentials; }

    public JSONObject call(String path, String method, JSONObject body) throws Exception {
        return authenticated(null, path, method, body).body;
    }

    /** The UI must verify response.device.role == "owner" before saving these credentials. */
    public static JSONObject pair(String server, String key, String name) throws Exception {
        requireBackground();
        return request(Credentials.normalizeServer(server), null, "/api/pair", "POST",
                new JSONObject().put("key", key).put("name", name).put("clientType", "android")).body;
    }
    public static JSONObject pair(Context context, String server, String key, String name) throws Exception {
        return pair(context, server, key, name, null, null);
    }
    public static JSONObject pair(Context context, String server, String key, String name, String otp, String recoveryCode) throws Exception {
        requireBackground();
        JSONObject payload = devicePayload(context, server, true).put("key", key).put("name", name);
        if (otp != null) payload.put("otp", otp);
        if (recoveryCode != null) payload.put("recoveryCode", recoveryCode);
        return request(Credentials.normalizeServer(server), null, "/api/pair", "POST", payload).body;
    }
    public static JSONObject devicePayload(Context context, String server, boolean allowChange) throws Exception {
        JSONObject policy;
        try { policy = request(Credentials.normalizeServer(server), null, "/api/device-policy", "GET", null).body; }
        catch (Failure failure) { if (failure.status != 404) throw failure; policy = null; }
        return DeviceIdentity.payload(context, policy, allowChange);
    }

    /** Returns the server's complete Set-Cookie value, preserving its scope and security flags. */
    public String libraryCookie() throws Exception {
        Reply reply = authenticated(null, "/api/library-session", "POST", new JSONObject());
        if (reply.cookie == null) throw new Failure(0, "服务器没有返回资料库会话 Cookie。");
        java.util.Set<String> attributes = new java.util.HashSet<>();
        String[] pieces = reply.cookie.split(";");
        for (int i=1;i<pieces.length;i++) attributes.add(pieces[i].trim().toLowerCase(java.util.Locale.ROOT));
        if(!attributes.contains("httponly") || !attributes.contains("secure") || !attributes.contains("path=/library/")
            || !attributes.contains("samesite=strict") || attributes.stream().anyMatch(a->a.startsWith("domain=")))
            throw new Failure(0, "资料库会话的安全属性无效。");
        return reply.cookie;
    }

    JSONObject callBound(String expectedServer, String path, String method, JSONObject body) throws Exception {
        return authenticated(expectedServer, path, method, body).body;
    }
    public JSONObject skillEnvironment(String expectedServer,String deviceId,int offset,String snapshotId) throws Exception {
        if(deviceId==null || !deviceId.matches("[a-fA-F0-9-]{36}") || offset<0 || snapshotId!=null&&!snapshotId.matches("[a-f0-9]{64}"))throw new Failure(400,"清单请求无效。");
        return callBound(expectedServer,"/api/skills/devices/"+deviceId+"/environment?offset="+offset+(snapshotId==null?"":"&snapshotId="+snapshotId),"GET",null);
    }

    private Reply authenticated(String expectedServer, String path, String method, JSONObject body) throws Exception {
        requireBackground();
        Credentials.Snapshot snapshot;
        try { snapshot = credentials.snapshot(); }
        catch (Exception ignored) { throw new Failure(401, "设备凭据不可用，请重新配对。"); }
        if (snapshot == null) throw new Failure(401, "请先配对设备，再提交资料。");
        if (expectedServer != null && !snapshot.server.equals(expectedServer)) {
            throw new Failure(409, "此条目属于另一台服务器，请恢复原服务器配对后重试。");
        }
        Reply reply;
        try {
            reply = request(snapshot.server, snapshot.token, path, method, body);
        } catch (Failure failure) {
            // A response to an old pairing must not block submissions under a new pairing.
            if (!stillPaired(snapshot)) throw new Failure(0, "配对状态已改变，请重新尝试。");
            throw failure;
        }
        if ("/api/library-session".equals(path) && !stillPaired(snapshot)) {
            throw new Failure(0, "配对状态已改变，请重新打开资料库。");
        }
        return reply;
    }

    private boolean stillPaired(Credentials.Snapshot snapshot) {
        try { return snapshot.samePairing(credentials.snapshot()); }
        catch (Exception ignored) { return false; }
    }

    static void requireBackground() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw new IllegalStateException("网络请求必须在后台线程执行。");
        }
    }

    private static Reply request(String server, String token, String path, String method, JSONObject body) throws Exception {
        requireBackground();
        HttpURLConnection connection = null;
        try {
            checkInterrupted();
            URI relative = path == null ? null : new URI(path);
            if (relative == null || !path.startsWith("/") || path.startsWith("//") || path.contains("\\")
                    || relative.isAbsolute() || relative.getRawAuthority() != null || relative.getRawFragment() != null) {
                throw new Failure(400, "接口路径无效。");
            }
            if (!("GET".equals(method) || "POST".equals(method) || "PUT".equals(method)
                    || "PATCH".equals(method) || "DELETE".equals(method))) {
                throw new Failure(400, "接口请求方法无效。");
            }
            if ("GET".equals(method) && body != null) throw new Failure(400, "GET 请求不能包含请求体。");
            URL url = new URL(server + path);
            String actualOrigin = Credentials.normalizeServer(new URI(url.getProtocol(), null,
                    url.getHost(), url.getPort(), null, null, null).toString());
            if (!server.equals(actualOrigin)) throw new Failure(400, "接口与已配对服务器不同源。");
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setUseCaches(false);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                // Streaming disables automatic request replay, including authentication/redirect replay.
                connection.setFixedLengthStreamingMode(bytes.length);
                checkInterrupted();
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                if ("/api/pair".equals(relative.getRawPath()) && token == null) {
                    String code = "";
                    try {
                        ByteArrayOutputStream errors = new ByteArrayOutputStream();
                        try (InputStream input = connection.getErrorStream()) {
                            if (input != null) {
                                byte[] chunk = new byte[512]; int count;
                                while (errors.size() <= 4096 && (count = input.read(chunk, 0, Math.min(chunk.length, 4097 - errors.size()))) >= 0) {
                                    checkInterrupted(); errors.write(chunk, 0, count);
                                }
                            }
                        }
                        byte[] errorBytes = errors.toByteArray();
                        if (errorBytes.length <= 4096) code = new JSONObject(new String(errorBytes, java.nio.charset.StandardCharsets.UTF_8)).optString("code");
                    } catch (Exception ignored) {}
                    throw loginFailure(status, code);
                }
                throw new Failure(status, statusMessage(status));
            }
            String cookie = sessionCookie(connection);
            String route = relative.getRawPath();
            int maxBytes = "GET".equals(method) && (route.matches("/api/archives/[a-f0-9]{64}")
                    || route.matches("/api/tasks/[^/]+/draft")) ? MAX_BUNDLE_BYTES : MAX_RESPONSE_BYTES;
            if (connection.getContentLengthLong() > maxBytes) throw new Failure(0, "服务器响应超过此接口允许的大小。");
            long deadline = SystemClock.elapsedRealtime() + 45000;
            ResponseBuffer bytes = new ResponseBuffer();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    checkInterrupted();
                    if (SystemClock.elapsedRealtime() > deadline) throw new Failure(0, "服务器响应超时，请稍后重试。");
                    if (bytes.size() + count > maxBytes) throw new Failure(0, "服务器响应超过此接口允许的大小。");
                    bytes.write(buffer, 0, count);
                }
            }
            try {
                JSONObject result = bytes.size() == 0 ? new JSONObject()
                        : new JSONObject(bytes.utf8());
                return new Reply(result, cookie);
            } catch (Exception ignored) {
                throw new Failure(0, "服务器响应不完整或无效，请使用原提交编号重试。");
            }
        } catch (Failure e) {
            throw e;
        } catch (java.net.URISyntaxException ignored) {
            throw new Failure(400, "接口路径无效。");
        } catch (Exception ignored) {
            // Never attach a cause: network exceptions can contain URLs or response fragments.
            throw new Failure(0, "无法连接服务器，请检查网络后重试。");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static void checkInterrupted() throws Failure {
        if (Thread.currentThread().isInterrupted()) throw new Failure(0, "提交已暂停，可安全重试。");
    }

    private static String sessionCookie(HttpURLConnection connection) throws Failure {
        String result = null;
        for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
            if (header.getKey() == null || !header.getKey().equalsIgnoreCase("Set-Cookie")) continue;
            for (String value : header.getValue()) {
                if (value == null || !value.startsWith("library_session=")) continue;
                if (value.length() > 8192 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0 || result != null) {
                    throw new Failure(0, "资料库会话响应无效。");
                }
                result = value;
            }
        }
        return result;
    }

    private static String statusMessage(int status) {
        if (status == 401) return "设备授权已失效或被撤销，请重新配对后重试。资料已保留。";
        if (status == 403) return "此操作需要管理员权限。资料已保留。";
        if (status == 409) return "提交编号与已有任务冲突。资料已保留。";
        if (status == 413) return "提交内容过大。资料已保留。";
        if (status == 429) return "请求过于频繁，请稍后重试。";
        if (status >= 500) return "服务器暂时不可用，请稍后重试。";
        if (status >= 300 && status < 400) return "服务器要求跳转，已拒绝跳转。资料已保留。";
        return "服务器拒绝了请求（HTTP " + status + "）。资料已保留。";
    }

    public static final class Failure extends Exception {
        public final int status;
        public final String code;
        private Failure(int status, String message) { this(status, message, ""); }
        private Failure(int status, String message, String code) { super(message); this.status = status; this.code = code; }
    }
    public static Failure loginFailure(int status, String code) {
        String message;
        switch (code) {
            case "mfa_required": message = "请输入认证器动态码或恢复码。"; break;
            case "mfa_invalid": message = "动态码或恢复码无效，请重试。"; break;
            case "credential_invalid": message = "登录密码或配对码不正确。"; break;
            default:
                code = "";
                message = status == 401 ? "登录密码或配对码不正确。" : status == 429 ? "验证过于频繁，请稍后重试。"
                        : status == 409 ? "设备身份冲突，请检查已有授权。" : status == 410 ? "此资料库已停止提供服务。" : "无法登录此资料库，请检查地址和服务状态。";
        }
        return new Failure(status, message, code);
    }

    /** Avoid copying a complete archive byte array again before JSON decoding. */
    private static final class ResponseBuffer extends ByteArrayOutputStream {
        String utf8() { return new String(buf, 0, count, StandardCharsets.UTF_8); }
    }

    private static final class Reply {
        final JSONObject body;
        final String cookie;
        Reply(JSONObject body, String cookie) { this.body = body; this.cookie = cookie; }
    }
}
