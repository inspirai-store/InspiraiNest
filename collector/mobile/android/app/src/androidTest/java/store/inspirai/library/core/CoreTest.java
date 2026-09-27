package store.inspirai.library.core;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.Assert;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import store.inspirai.library.BuildConfig;

/** On-device tests. Each test has its own no-backup directory and Keystore alias. */
public final class CoreTest extends Assert {
    private static final String TOKEN = "synthetic-core-test-token";
    private Context context;
    private File directory;
    private Credentials credentials;

    @Before public void setUp() throws Exception {
        
        Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String suffix = UUID.randomUUID().toString();
        directory = new File(target.getNoBackupFilesDir(), "core-test-" + suffix);
        assertTrue(directory.mkdirs());
        context = new ContextWrapper(target) {
            @Override public File getNoBackupFilesDir() { return directory; }
            @Override public Context getApplicationContext() { return this; }
            @Override public String getPackageName() { return target.getPackageName() + ".coretest." + suffix; }
        };
        credentials = new Credentials(context);
    }

    @After public void tearDown() throws Exception {
        try {
            credentials.clear();
        } finally { deleteTestFiles(directory); }
    }

    @Test public void testRawPayloadStableIdAndReopen() throws Exception {
        String raw = "  分享标题\r\nhttps://example.org/a?x=1&y=2\n\t要求：原样保留 😀\u0000  ";
        JSONObject input = new JSONObject().put("content", raw).put("scenario", "  场景\n ")
                .put("tags", new JSONArray().put(" 原标签 ")).put("autoArchive", false);
        Outbox first = new Outbox(context);
        String id = first.enqueue(input, null);
        assertFalse(input.has("submissionId"));
        input.put("content", "caller mutation");
        JSONObject row = new Outbox(context).list().getJSONObject(0);
        assertEquals(id, row.getString("id"));
        assertEquals(id, row.getJSONObject("payload").getString("submissionId"));
        assertEquals(raw, row.getJSONObject("payload").getString("content"));
        assertEquals("  场景\n ", row.getJSONObject("payload").getString("scenario"));
        assertEquals(" 原标签 ", row.getJSONObject("payload").getJSONArray("tags").getString(0));
        assertFalse(row.getJSONObject("payload").getBoolean("autoArchive"));
        assertEquals(Credentials.DEFAULT_SERVER, row.getString("server"));
        assertEquals(id, first.enqueue(row.getJSONObject("payload"), row.getString("server")));
        assertEquals(1, first.list().length());
        row.getJSONObject("payload").put("content", "returned-object mutation");
        assertEquals(raw, first.list().getJSONObject(0).getJSONObject("payload").getString("content"));
        assertFalse(Outbox.flush(context)); // Not paired: retained pending, no automatic retry spin.
        assertEquals("pending", first.list().getJSONObject(0).getString("state"));
        assertFalse(first.list().getJSONObject(0).isNull("error"));
    }

    @Test public void testImmutablePayloadAndServerBinding() throws Exception {
        Outbox queue = new Outbox(context);
        JSONObject input = new JSONObject().put("submissionId", "stable-ui-id").put("content", "  same\n");
        assertEquals("stable-ui-id", queue.enqueue(input, "https://EXAMPLE.org:443/"));
        assertEquals("stable-ui-id", queue.enqueue(new JSONObject().put("content", "  same\n")
                .put("submissionId", "stable-ui-id"), "https://example.org"));
        expectFailure(() -> queue.enqueue(new JSONObject(input.toString()).put("content", "different"), "https://example.org"));
        expectFailure(() -> queue.enqueue(input, "https://other.example.org"));
        JSONObject row = queue.list().getJSONObject(0);
        assertEquals("https://example.org", row.getString("server"));
        assertEquals("  same\n", row.getJSONObject("payload").getString("content"));
        assertEquals(1, queue.list().length());
        queue.remove("stable-ui-id");
        assertEquals(0, queue.list().length());
    }

    @Test public void testOriginValidation() throws Exception {
        assertEquals("https://example.org", Credentials.normalizeServer("https://EXAMPLE.org:443/"));
        assertEquals("https://example.org:8443", Credentials.normalizeServer("https://example.org:8443"));
        for (String origin : new String[]{"https://u:p@example.org", "https://example.org/a", "https://example.org?",
                "https://example.org/#", "https://example.org/%2f", "https://example.org:", "https://example.org:0",
                "https://example.org:65536", "http://example.org", "http://127.0.0.2", "http://localhost.evil.test",
                "http://127.1", "http://[::1]", "file:///tmp", "//example.org", " https://example.org", "https://example.org\\@evil.org"}) {
            expectFailure(() -> Credentials.normalizeServer(origin));
        }
        for (String host : new String[]{"127.0.0.1", "10.0.2.2", "localhost"}) {
            String origin = "http://" + host + ":4317";
            if (BuildConfig.DEBUG) assertEquals(origin, Credentials.normalizeServer(origin));
            else expectFailure(() -> Credentials.normalizeServer(origin));
        }
    }

    @Test public void testKeystoreCiphertextReopenClearAndMetadataBinding() throws Exception {
        credentials.save("https://example.org/", TOKEN, "test-device");
        Credentials reopened = new Credentials(context);
        assertTrue(reopened.isPaired());
        assertEquals(TOKEN, reopened.token());
        assertEquals("https://example.org", reopened.server());
        assertEquals("test-device", reopened.deviceId());
        File recordFile = new File(directory, "library-credentials.json");
        String record = new String(Files.readAllBytes(recordFile.toPath()), StandardCharsets.UTF_8);
        assertFalse(record.contains(TOKEN));
        JSONObject tampered = new JSONObject(record).put("server", "https://other.example.org");
        Files.write(recordFile.toPath(), tampered.toString().getBytes(StandardCharsets.UTF_8));
        assertFalse(new Credentials(context).isPaired());
        expectFailure(() -> new Credentials(context).token());
        Files.write(recordFile.toPath(), record.getBytes(StandardCharsets.UTF_8));
        assertEquals(TOKEN, reopened.token());
        expectFailure(() -> credentials.save("https://example.org/", "bad\r\ntoken", "test-device"));
        assertEquals(TOKEN, reopened.token());
        credentials.clear();
        assertFalse(reopened.isPaired());
        assertEquals("", reopened.deviceId());
        expectFailure(reopened::token);
    }

    @Test public void testServerIsolationBlocksWithoutSending() throws Exception {
        Outbox queue = new Outbox(context);
        String id = queue.enqueue(new JSONObject().put("content", "private to server A"), "https://a.example.org");
        credentials.save("https://b.example.org", TOKEN, "test-device");
        assertFalse(Outbox.flush(context));
        JSONObject row = queue.list().getJSONObject(0);
        assertEquals("blocked", row.getString("state"));
        assertEquals(id, row.getString("id"));
        queue.retry(id);
        assertEquals("pending", queue.list().getJSONObject(0).getString("state"));
        assertTrue(queue.list().getJSONObject(0).isNull("error"));
        assertFalse(Outbox.flush(context));
        assertEquals("https://a.example.org", queue.list().getJSONObject(0).getString("server"));
    }

    @Test public void testMainThreadNetworkRejected() {
        AtomicInteger rejected = new AtomicInteger();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            Checked[] actions = new Checked[]{() -> Api.pair("https://example.org", "key", "name"),
                    () -> new Api(credentials).call("/api/state", "GET", null),
                    () -> new Api(credentials).libraryCookie(), () -> Outbox.flush(context)};
            for (Checked action : actions) {
                try { action.run(); }
                catch (IllegalStateException expected) { rejected.incrementAndGet(); }
                catch (Exception ignored) { /* Fails the count assertion below. */ }
            }
        });
        assertEquals(4, rejected.get());
    }

    @Test public void testApiCannotEscapeConfiguredOrigin() throws Exception {
        credentials.save("https://example.org", TOKEN, "test-device");
        for (String path : new String[]{"https://other.example.org/api/state", "//other.example.org/api/state",
                "/\\other.example.org/api/state", "/api/state#fragment", "/api/\r\nstate"}) {
            try {
                new Api(credentials).call(path, "GET", null);
                fail("Unsafe API path was accepted.");
            } catch (Api.Failure expected) { assertEquals(400, expected.status); }
        }
    }

    @Test public void testOfflineRetentionAcrossReopen() throws Exception {
        if (!BuildConfig.DEBUG) return;
        String origin;
        try (ServerSocket unavailable = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            origin = "http://127.0.0.1:" + unavailable.getLocalPort();
        }
        credentials.save(origin, TOKEN, "test-device");
        String id = new Outbox(context).enqueue(new JSONObject().put("content", " offline\n "), origin);
        assertTrue(Outbox.flush(context));
        JSONObject row = new Outbox(context).list().getJSONObject(0);
        assertEquals(id, row.getString("id"));
        assertEquals("pending", row.getString("state"));
        assertEquals(" offline\n ", row.getJSONObject("payload").getString("content"));
        assertFalse(row.isNull("error"));
    }

    @Test public void testTransientRetryKeepsIdAndSentRecord() throws Exception {
        if (!BuildConfig.DEBUG) return;
        AtomicInteger attempt = new AtomicInteger();
        try (Fixture server = new Fixture(request -> attempt.incrementAndGet() == 1
                ? reply(429, "{\"error\":\"untrusted " + TOKEN + "\"}") : taskReply(request, 201))) {
            credentials.save(server.origin(), TOKEN, "test-device");
            Outbox queue = new Outbox(context);
            String raw = "  exact\r\n中文 😀  ";
            String id = queue.enqueue(new JSONObject().put("content", raw), server.origin());
            assertTrue(Outbox.flush(context));
            assertEquals("pending", queue.list().getJSONObject(0).getString("state"));
            assertFalse(queue.list().getJSONObject(0).getString("error").contains(TOKEN));
            assertFalse(Outbox.flush(context));
            JSONObject row = new Outbox(context).list().getJSONObject(0);
            assertEquals("sent", row.getString("state"));
            assertEquals("fixture-task", row.getString("taskId"));
            assertTrue(row.isNull("error"));
            queue.retry(id);
            assertFalse(Outbox.flush(context));
            assertEquals(2, server.requests.size());
            for (Request request : server.requests) {
                assertEquals(id, request.body.getString("submissionId"));
                assertEquals(raw, request.body.getString("content"));
                assertEquals("Bearer " + TOKEN, request.authorization);
                assertEquals("POST /api/tasks HTTP/1.1", request.line);
            }
        }
    }

    @Test public void testLostAcknowledgementReplaysSameId() throws Exception {
        if (!BuildConfig.DEBUG) return;
        AtomicReference<String> accepted = new AtomicReference<>();
        try (Fixture server = new Fixture(request -> {
            String id = request.body.getString("submissionId");
            if (accepted.compareAndSet(null, id)) return null; // Commit then drop the response.
            if (!accepted.get().equals(id)) return reply(409, "{}");
            return taskReply(request, 200);
        })) {
            credentials.save(server.origin(), TOKEN, "test-device");
            Outbox queue = new Outbox(context);
            String id = queue.enqueue(new JSONObject().put("content", "ack loss"), server.origin());
            assertTrue(Outbox.flush(context));
            assertEquals("pending", new Outbox(context).list().getJSONObject(0).getString("state"));
            assertFalse(Outbox.flush(context));
            assertEquals(id, accepted.get());
            assertEquals(2, server.requests.size());
            assertEquals("sent", queue.list().getJSONObject(0).getString("state"));
        }
    }

    @Test public void testUnauthorizedBlocksAllRowsUntilExplicitRetry() throws Exception {
        if (!BuildConfig.DEBUG) return;
        try (Fixture server = new Fixture(request -> reply(401, "{\"error\":\"" + TOKEN + "\"}"))) {
            credentials.save(server.origin(), TOKEN, "test-device");
            Outbox queue = new Outbox(context);
            String id = queue.enqueue(new JSONObject().put("content", "one"), server.origin());
            queue.enqueue(new JSONObject().put("content", "two"), server.origin());
            assertFalse(Outbox.flush(context));
            assertEquals(1, server.requests.size());
            assertEquals(2, queue.list().length());
            for (int i = 0; i < 2; i++) {
                JSONObject row = queue.list().getJSONObject(i);
                assertEquals("blocked", row.getString("state"));
                assertTrue(row.getString("error").length() < 256);
                assertFalse(row.getString("error").contains(TOKEN));
            }
            assertFalse(Outbox.flush(context));
            assertEquals(1, server.requests.size());
            queue.retry(id);
            assertEquals("pending", queue.list().getJSONObject(0).getString("state"));
            assertTrue(queue.list().getJSONObject(0).isNull("error"));
        }
    }

    @Test public void testServerFailureIsTransientAndClientFailureBlocked() throws Exception {
        if (!BuildConfig.DEBUG) return;
        AtomicInteger attempt = new AtomicInteger();
        try (Fixture server = new Fixture(request -> reply(attempt.incrementAndGet() == 1 ? 503 : 400, "{}"))) {
            credentials.save(server.origin(), TOKEN, "test-device");
            Outbox queue = new Outbox(context);
            String id = queue.enqueue(new JSONObject().put("content", "retained"), server.origin());
            assertTrue(Outbox.flush(context));
            assertFalse(Outbox.flush(context));
            assertEquals(id, queue.list().getJSONObject(0).getString("id"));
            assertEquals("blocked", queue.list().getJSONObject(0).getString("state"));
            assertFalse(Outbox.flush(context));
            assertEquals(2, server.requests.size());
        }
    }

    @Test public void testPairUnauthenticatedAndActualCookieReturned() throws Exception {
        if (!BuildConfig.DEBUG) return;
        String cookie = "library_session=fixture-session; Path=/library/; HttpOnly; Secure; SameSite=Strict";
        try (Fixture server = new Fixture(request -> request.line.contains("/api/pair ")
                ? reply(201, "{\"device\":{\"id\":\"fixture\",\"role\":\"owner\"},\"token\":\"fixture-token\"}")
                : reply(200, "{\"ok\":true}", "Set-Cookie: " + cookie + "\r\n"))) {
            JSONObject paired = Api.pair(server.origin(), "fixture-key", "fixture-name");
            assertEquals("owner", paired.getJSONObject("device").getString("role"));
            assertNull(server.requests.get(0).authorization);
            assertEquals("fixture-key", server.requests.get(0).body.getString("key"));
            credentials.save(server.origin(), paired.getString("token"), "fixture");
            assertEquals(cookie, new Api(credentials).libraryCookie());
            assertEquals("POST /api/library-session HTTP/1.1", server.requests.get(1).line);
            assertEquals("Bearer fixture-token", server.requests.get(1).authorization);
        }
    }

    @Test public void testRedirectNeverFollowed() throws Exception {
        if (!BuildConfig.DEBUG) return;
        try (Fixture destination = new Fixture(request -> taskReply(request, 201));
             Fixture redirect = new Fixture(request -> reply(307, "{}", "Location: " + destination.origin() + "/api/tasks\r\n"))) {
            credentials.save(redirect.origin(), TOKEN, "test-device");
            Outbox queue = new Outbox(context);
            queue.enqueue(new JSONObject().put("content", "private payload"), redirect.origin());
            assertFalse(Outbox.flush(context));
            assertEquals("blocked", queue.list().getJSONObject(0).getString("state"));
            assertEquals(1, redirect.requests.size());
            assertEquals(0, destination.requests.size());
        }
    }

    @Test public void testInterruptedFlushDoesNotStartNextItem() throws Exception {
        Outbox queue = new Outbox(context);
        queue.enqueue(new JSONObject().put("content", "keep queued"), null);
        Thread.currentThread().interrupt();
        try { assertTrue(Outbox.flush(context)); }
        finally { Thread.interrupted(); }
        assertEquals("pending", queue.list().getJSONObject(0).getString("state"));
        assertTrue(queue.list().getJSONObject(0).isNull("error"));
    }

    @Test public void testRePairDuringUnauthorizedResponseDoesNotBlockNewPairing() throws Exception {
        if (!BuildConfig.DEBUG) return;
        try (Fixture server = new Fixture(request -> {
            if (request.authorization.equals("Bearer " + TOKEN)) {
                credentials.save(credentials.server(), "replacement-token", "replacement-device");
                return reply(401, "{}");
            }
            return taskReply(request, 201);
        })) {
            credentials.save(server.origin(), TOKEN, "original-device");
            Credentials.Snapshot original = credentials.snapshot();
            Outbox queue = new Outbox(context);
            String id = queue.enqueue(new JSONObject().put("content", "pairing race"), server.origin());
            assertTrue(Outbox.flush(context));
            assertEquals("pending", queue.list().getJSONObject(0).getString("state"));
            assertEquals("original-device", original.deviceId);
            assertEquals(TOKEN, original.token);
            assertEquals("replacement-device", credentials.snapshot().deviceId);
            assertFalse(original.generation.equals(credentials.snapshot().generation));
            assertFalse(Outbox.flush(context));
            assertEquals("sent", queue.list().getJSONObject(0).getString("state"));
            assertEquals(id, server.requests.get(1).body.getString("submissionId"));
            assertEquals("Bearer replacement-token", server.requests.get(1).authorization);
        }
    }

    @Test public void testCookieFromObsoletePairingIsRejected() throws Exception {
        if (!BuildConfig.DEBUG) return;
        try (Fixture server = new Fixture(request -> {
            credentials.save(credentials.server(), "replacement-token", "replacement-device");
            return reply(200, "{\"ok\":true}", "Set-Cookie: library_session=obsolete; Path=/library/; Secure; HttpOnly\r\n");
        })) {
            credentials.save(server.origin(), TOKEN, "original-device");
            try { new Api(credentials).libraryCookie(); fail("Obsolete cookie was returned."); }
            catch (Api.Failure expected) { assertEquals(0, expected.status); }
            assertEquals("replacement-token", credentials.snapshot().token);
        }
    }

    @Test public void testConcurrentFlushIsSerialized() throws Exception {
        if (!BuildConfig.DEBUG) return;
        CountDownLatch received = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        AtomicInteger finished = new AtomicInteger();
        Thread first = null, second = null;
        try (Fixture server = new Fixture(request -> {
            received.countDown();
            if (!release.await(5, TimeUnit.SECONDS)) throw new Exception("Fixture release timed out.");
            return taskReply(request, 201);
        })) {
            credentials.save(server.origin(), TOKEN, "test-device");
            new Outbox(context).enqueue(new JSONObject().put("content", "deliver once"), server.origin());
            Runnable flush = () -> {
                try { assertFalse(Outbox.flush(context)); finished.incrementAndGet(); }
                catch (Throwable error) { failure.set(error); }
            };
            first = new Thread(flush, "core-flush-one");
            second = new Thread(flush, "core-flush-two");
            first.start();
            assertTrue(received.await(5, TimeUnit.SECONDS));
            second.start();
            release.countDown();
            first.join(10000);
            second.join(10000);
            if (failure.get() != null) throw new AssertionError("Concurrent flush failed.", failure.get());
            assertEquals(2, finished.get());
            assertEquals(1, server.requests.size());
            assertEquals("sent", new Outbox(context).list().getJSONObject(0).getString("state"));
        } finally {
            release.countDown();
            if (first != null && first.isAlive()) { first.interrupt(); first.join(10000); }
            if (second != null && second.isAlive()) { second.interrupt(); second.join(10000); }
        }
    }

    @Test public void testRemoveDuringDeliveryDoesNotResurrectRow() throws Exception {
        if (!BuildConfig.DEBUG) return;
        Outbox queue = new Outbox(context);
        try (Fixture server = new Fixture(request -> {
            queue.remove(request.body.getString("submissionId"));
            return taskReply(request, 201);
        })) {
            credentials.save(server.origin(), TOKEN, "test-device");
            queue.enqueue(new JSONObject().put("content", "explicit removal"), server.origin());
            assertFalse(Outbox.flush(context));
            assertEquals(0, queue.list().length());
        }
    }

    @Test public void testLargeBundleBoundIsRouteSpecific() throws Exception {
        if (!BuildConfig.DEBUG) return;
        try (Fixture server = new Fixture(request -> {
            if (request.line.contains("/api/tasks/oversize/draft ")) {
                // Reject from Content-Length before allocating/reading the oversized response.
                return ("HTTP/1.1 200 OK\r\nContent-Length: " + (60 * 1024 * 1024 + 1)
                        + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
            }
            if (request.line.contains("/api/state ")) {
                return ("HTTP/1.1 200 OK\r\nContent-Length: " + (8 * 1024 * 1024 + 1)
                        + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
            }
            char[] padding = new char[8 * 1024 * 1024];
            java.util.Arrays.fill(padding, 'x');
            return reply(200, "{\"padding\":\"" + new String(padding) + "\"}");
        })) {
            credentials.save(server.origin(), TOKEN, "test-device");
            Api api = new Api(credentials);
            assertEquals(8 * 1024 * 1024, api.call("/api/tasks/fixture/draft", "GET", null).getString("padding").length());
            assertEquals(8 * 1024 * 1024, api.call("/api/archives/"
                    + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "GET", null)
                    .getString("padding").length());
            expectFailure(() -> api.call("/api/tasks/oversize/draft", "GET", null));
            expectFailure(() -> api.call("/api/state", "GET", null));
        }
    }

    private interface Checked { void run() throws Exception; }
    private void expectFailure(Checked action) throws Exception {
        try { action.run(); }
        catch (Exception expected) { return; }
        fail("Expected validation failure.");
    }

    private void deleteTestFiles(File file) throws Exception {
        String root = directory.getCanonicalPath();
        String target = file.getCanonicalPath();
        if (!target.equals(root) && !target.startsWith(root + File.separator)) throw new Exception("Outside test directory.");
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTestFiles(child);
        assertTrue(file.delete());
    }

    private interface Responder { byte[] respond(Request request) throws Exception; }

    private static byte[] taskReply(Request request, int status) throws Exception {
        return reply(status, new JSONObject().put("id", "fixture-task")
                .put("submissionId", request.body.getString("submissionId")).toString());
    }

    private static byte[] reply(int status, String body) { return reply(status, body, ""); }
    private static byte[] reply(int status, String body, String headers) {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + " Fixture\r\nContent-Type: application/json\r\n"
                + "Content-Length: " + bytes.length + "\r\nConnection: close\r\n" + headers + "\r\n";
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        result.write(head.getBytes(StandardCharsets.US_ASCII), 0, head.length());
        result.write(bytes, 0, bytes.length);
        return result.toByteArray();
    }

    private static final class Request {
        final String line;
        final String authorization;
        final JSONObject body;
        Request(String line, String authorization, JSONObject body) {
            this.line = line; this.authorization = authorization; this.body = body;
        }
    }

    /** Loopback only; tests never call a live service or reuse the app's actual pairing. */
    private static final class Fixture implements AutoCloseable {
        final ServerSocket server;
        final Thread thread;
        final List<Request> requests = Collections.synchronizedList(new ArrayList<>());
        volatile boolean closed;
        volatile Throwable failure;
        Fixture(Responder responder) throws Exception {
            server = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
            thread = new Thread(() -> {
                while (!closed) {
                    try (Socket socket = server.accept()) {
                        socket.setSoTimeout(5000);
                        InputStream input = socket.getInputStream();
                        String first = line(input), auth = null, header;
                        int length = 0;
                        while (!(header = line(input)).isEmpty()) {
                            int colon = header.indexOf(':');
                            if (colon < 0) throw new Exception("Invalid fixture request header.");
                            String name = header.substring(0, colon), value = header.substring(colon + 1).trim();
                            if (name.equalsIgnoreCase("Content-Length")) length = Integer.parseInt(value);
                            if (name.equalsIgnoreCase("Authorization")) auth = value;
                        }
                        if (length < 0 || length > 96 * 1024) throw new Exception("Invalid fixture request length.");
                        byte[] bytes = new byte[length];
                        for (int offset = 0; offset < length;) {
                            int count = input.read(bytes, offset, length - offset);
                            if (count < 0) throw new Exception("Truncated fixture request.");
                            offset += count;
                        }
                        Request request = new Request(first, auth, length == 0 ? new JSONObject()
                                : new JSONObject(new String(bytes, StandardCharsets.UTF_8)));
                        requests.add(request);
                        byte[] response = responder.respond(request);
                        if (response != null) {
                            OutputStream output = socket.getOutputStream();
                            output.write(response);
                            output.flush();
                        }
                    } catch (Throwable error) {
                        if (!closed) { failure = error; return; }
                    }
                }
            }, "core-test-http");
            thread.start();
        }
        String origin() { return "http://127.0.0.1:" + server.getLocalPort(); }
        @Override public void close() throws Exception {
            closed = true;
            server.close();
            thread.join(6000);
            if (thread.isAlive()) throw new Exception("Fixture thread did not stop.");
            if (failure != null) throw new AssertionError("Fixture failed.", failure);
        }
        private static String line(InputStream input) throws Exception {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            for (int value; (value = input.read()) != -1;) {
                if (value == '\n') return new String(bytes.toByteArray(), StandardCharsets.US_ASCII).replace("\r", "");
                if (bytes.size() > 8192) throw new Exception("Fixture header too large.");
                bytes.write(value);
            }
            throw new Exception("Incomplete fixture headers.");
        }
    }
}
