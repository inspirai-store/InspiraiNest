package store.inspirai.library.core;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.Iterator;
import java.util.UUID;

/** Durable submissions. Only remove() deletes a row; retry never edits its identity or payload. */
public final class Outbox {
    private static final Object DB_LOCK = new Object();
    private final Context context;

    public Outbox(Context context) {
        Context app = context.getApplicationContext();
        this.context = app == null ? context : app;
    }

    /** A null/empty server binds to the currently configured origin, including the pre-pair default. */
    public String enqueue(JSONObject payload, String server) throws Exception {
        if (payload == null) throw new Exception("请提供提交内容。");
        JSONObject copy = new JSONObject(payload.toString());
        String id;
        if (copy.has("submissionId")) {
            Object supplied = copy.get("submissionId");
            if (!(supplied instanceof String)) throw new Exception("提交编号无效。");
            id = (String) supplied;
            if (id.isEmpty() || id.length() > 100 || !id.equals(id.trim())
                    || Character.isWhitespace(id.charAt(0)) || Character.isSpaceChar(id.charAt(0))
                    || Character.isWhitespace(id.charAt(id.length() - 1))
                    || Character.isSpaceChar(id.charAt(id.length() - 1))) {
                throw new Exception("提交编号无效。");
            }
        } else {
            id = UUID.randomUUID().toString();
            copy.put("submissionId", id);
        }
        String origin = Credentials.normalizeServer(server == null || server.isEmpty()
                ? new Credentials(context).server() : server);
        synchronized (DB_LOCK) {
            try (Database helper = new Database(context)) {
                SQLiteDatabase db = helper.getWritableDatabase();
                db.beginTransaction();
                try {
                    JSONObject existing = find(db, id);
                    if (existing != null) {
                        if (!origin.equals(existing.getString("server"))
                                || !sameJson(copy, existing.getJSONObject("payload"))) {
                            throw new Exception("此提交编号已绑定其他内容或服务器，不能覆盖。");
                        }
                    } else {
                        ContentValues values = new ContentValues();
                        values.put("id", id);
                        values.put("payload", copy.toString());
                        values.put("server", origin);
                        values.put("state", "pending");
                        db.insertOrThrow("outbox", null, values);
                    }
                    db.setTransactionSuccessful();
                } finally { db.endTransaction(); }
            }
        }
        return id;
    }

    public JSONArray list() {
        synchronized (DB_LOCK) {
            try (Database helper = new Database(context);
                 Cursor cursor = helper.getReadableDatabase().query("outbox", null, null, null, null, null, "seq ASC")) {
                JSONArray result = new JSONArray();
                while (cursor.moveToNext()) result.put(record(cursor));
                return result;
            } catch (Exception ignored) {
                throw new IllegalStateException("无法读取待提交列表，已保留原始数据。");
            }
        }
    }

    /** Sent rows stay sent. UI should schedule QueueJob after retrying or enqueueing. */
    public void retry(String id) {
        synchronized (DB_LOCK) {
            try (Database helper = new Database(context)) {
                ContentValues values = new ContentValues();
                values.put("state", "pending");
                values.putNull("error");
                helper.getWritableDatabase().update("outbox", values, "id=? AND state!='sent'", new String[]{id});
            }
        }
    }

    /** Local removal only; a request already received by the server cannot be recalled here. */
    public void remove(String id) {
        synchronized (DB_LOCK) {
            try (Database helper = new Database(context)) {
                helper.getWritableDatabase().delete("outbox", "id=?", new String[]{id});
            }
        }
    }

    /**
     * Serializes foreground and JobService delivery in this app process. No in-flight durable state:
     * process death or lost acknowledgements leave the same ID pending. Runs off the main thread.
     * True means transient pending work remains. Unpaired/blocked records need user action instead.
     */
    public static synchronized boolean flush(Context context) {
        Api.requireBackground();
        Outbox queue = new Outbox(context);
        Credentials credentials = new Credentials(context);
        Api api = new Api(credentials);
        try {
            JSONArray initial = queue.list();
            for (int i = 0; i < initial.length(); i++) {
                if (Thread.currentThread().isInterrupted()) return queue.hasPending();
                JSONObject row = queue.pending(initial.getJSONObject(i).getString("id"));
                if (row == null) continue;
                Credentials.Snapshot pairing;
                try { pairing = credentials.snapshot(); }
                catch (Exception ignored) {
                    queue.pendingError("设备凭据不可用，请重新配对后重试。");
                    return false;
                }
                if (pairing == null) {
                    queue.pendingError("请先配对设备，再提交资料。");
                    return false;
                }
                if (!row.getString("server").equals(pairing.server)) {
                    if (!credentials.ifCurrent(pairing, () -> queue.update(row, "blocked",
                            "此条目属于另一台服务器，请恢复原服务器配对后重试。", null))) return true;
                    continue;
                }
                if (Thread.currentThread().isInterrupted()) return queue.hasPending();
                try {
                    JSONObject response = api.callBound(row.getString("server"), "/api/tasks", "POST",
                            row.getJSONObject("payload"));
                    Object task = response.opt("id");
                    if (!(task instanceof String) || ((String) task).isEmpty() || ((String) task).length() > 200
                            || !row.getString("id").equals(response.optString("submissionId", ""))) {
                        queue.update(row, "pending", "服务器确认信息不完整，请使用原提交编号重试。", null);
                        return true;
                    }
                    queue.update(row, "sent", null, (String) task);
                } catch (Api.Failure failure) {
                    if (failure.status == 401) {
                        if (!credentials.ifCurrent(pairing,
                                () -> queue.blockOrigin(row.getString("server"), failure.getMessage()))) return true;
                    } else if (failure.status == 0 || failure.status == 429 || failure.status >= 500) {
                        queue.update(row, "pending", failure.getMessage(), null);
                        return true;
                    } else {
                        if (!credentials.ifCurrent(pairing,
                                () -> queue.update(row, "blocked", failure.getMessage(), null))) return true;
                    }
                } catch (Exception ignored) {
                    queue.update(row, "pending", "提交中断，可使用原提交编号安全重试。", null);
                    return true;
                }
            }
            // Include items enqueued while this run was delivering its initial snapshot.
            return queue.hasPending();
        } catch (Exception ignored) {
            // Storage failures never trigger deletes or claim success; a later run can recover.
            return true;
        }
    }

    private JSONObject pending(String id) throws Exception {
        synchronized (DB_LOCK) {
            try (Database helper = new Database(context)) {
                JSONObject row = find(helper.getReadableDatabase(), id);
                return row != null && row.getString("state").equals("pending") ? row : null;
            }
        }
    }

    private boolean hasPending() {
        synchronized (DB_LOCK) {
            try (Database helper = new Database(context);
                 Cursor cursor = helper.getReadableDatabase().rawQuery("SELECT 1 FROM outbox WHERE state='pending' LIMIT 1", null)) {
                return cursor.moveToFirst();
            }
        }
    }

    private void pendingError(String error) {
        synchronized (DB_LOCK) {
            try (Database helper = new Database(context)) {
                ContentValues values = new ContentValues();
                values.put("error", error);
                helper.getWritableDatabase().update("outbox", values, "state='pending'", null);
            }
        }
    }

    private void blockOrigin(String origin, String error) {
        synchronized (DB_LOCK) {
            try (Database helper = new Database(context)) {
                ContentValues values = new ContentValues();
                values.put("state", "blocked");
                values.put("error", error);
                helper.getWritableDatabase().update("outbox", values, "server=? AND state='pending'", new String[]{origin});
            }
        }
    }

    private void update(JSONObject row, String state, String error, String taskId) throws Exception {
        synchronized (DB_LOCK) {
            try (Database helper = new Database(context)) {
                ContentValues values = new ContentValues();
                values.put("state", state);
                if (error == null) values.putNull("error"); else values.put("error", error);
                if (taskId == null) values.putNull("taskId"); else values.put("taskId", taskId);
                // A remove during delivery must not resurrect a row or acknowledge a replacement.
                helper.getWritableDatabase().update("outbox", values,
                        "id=? AND server=? AND payload=? AND state='pending'",
                        new String[]{row.getString("id"), row.getString("server"), row.getJSONObject("payload").toString()});
            }
        }
    }

    private static JSONObject find(SQLiteDatabase db, String id) throws Exception {
        try (Cursor cursor = db.query("outbox", null, "id=?", new String[]{id}, null, null, null)) {
            return cursor.moveToFirst() ? record(cursor) : null;
        }
    }

    private static JSONObject record(Cursor cursor) throws Exception {
        JSONObject row = new JSONObject();
        for (String field : new String[]{"id", "server", "state", "error", "taskId"}) {
            int column = cursor.getColumnIndexOrThrow(field);
            row.put(field, cursor.isNull(column) ? JSONObject.NULL : cursor.getString(column));
        }
        return row.put("payload", new JSONObject(cursor.getString(cursor.getColumnIndexOrThrow("payload"))));
    }

    private static boolean sameJson(Object a, Object b) throws Exception {
        if (a instanceof JSONObject && b instanceof JSONObject) {
            JSONObject left = (JSONObject) a, right = (JSONObject) b;
            if (left.length() != right.length()) return false;
            Iterator<String> keys = left.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (!right.has(key) || !sameJson(left.get(key), right.get(key))) return false;
            }
            return true;
        }
        if (a instanceof JSONArray && b instanceof JSONArray) {
            JSONArray left = (JSONArray) a, right = (JSONArray) b;
            if (left.length() != right.length()) return false;
            for (int i = 0; i < left.length(); i++) if (!sameJson(left.get(i), right.get(i))) return false;
            return true;
        }
        return a == b || (a != null && a.equals(b));
    }

    private static final class Database extends SQLiteOpenHelper {
        Database(Context context) {
            super(context, new File(context.getNoBackupFilesDir(), "library-outbox.sqlite").getAbsolutePath(), null, 1);
        }

        @Override public void onConfigure(SQLiteDatabase db) {
            super.onConfigure(db);
            db.execSQL("PRAGMA synchronous=FULL");
        }

        @Override public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, "
                    + "payload TEXT NOT NULL, server TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending' "
                    + "CHECK(state IN ('pending','blocked','sent')), error TEXT, taskId TEXT)");
            db.execSQL("CREATE TRIGGER immutable_outbox BEFORE UPDATE OF id,payload,server ON outbox "
                    + "BEGIN SELECT RAISE(ABORT,'Outbox identity is immutable'); END");
        }

        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            // Future migrations must preserve rows; never use a destructive fallback.
            throw new IllegalStateException("待提交数据库需要迁移，已保留原始数据。");
        }
    }
}
