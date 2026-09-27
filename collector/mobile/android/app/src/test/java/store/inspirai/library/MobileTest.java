package store.inspirai.library;

import android.content.*;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.android.controller.ActivityController;
import store.inspirai.library.core.*;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=35)
public class MobileTest {
    @Test public void preservesUnicodeWhitespaceMultipleLinksAndShareTitle() {
        String raw="  标题\nhttps://example.com/a?x=1  https://example.com/b\n场景：用于剧本 🐈\n ";
        Intent intent=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT,"原始标题").putExtra(Intent.EXTRA_TEXT,raw);
        assertEquals("原始标题\n"+raw,ShareActivity.sharedText(intent));
    }
    @Test public void clipDataOnlyTextRemainsWhole() {
        Intent intent=new Intent(Intent.ACTION_SEND);intent.setClipData(ClipData.newPlainText("label","正文 https://example.com\n不要截断"));
        assertEquals("正文 https://example.com\n不要截断",ShareActivity.sharedText(intent));
    }
    @Test public void draftsSurviveNewStoreAndKeepDistinctShares()throws Exception{
        Context c=RuntimeEnvironment.getApplication();Drafts d=new Drafts(c);String first=UUID.randomUUID().toString(),second=UUID.randomUUID().toString();
        d.save(new JSONObject().put("id",first).put("content","  空白\nhttps://example.com/1\n"));d.save(new JSONObject().put("id",second).put("content","另一个分享"));
        assertEquals("  空白\nhttps://example.com/1\n",new Drafts(c).read(first).getString("content"));assertEquals("另一个分享",new Drafts(c).read(second).getString("content"));
        d.remove(first);d.remove(second);
    }
    @Test public void intentRecreationKeepsOneDurableDraft()throws Exception{
        Context c=RuntimeEnvironment.getApplication();int before=new Drafts(c).list().length();
        Intent share=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,"原始正文\nhttps://example.com");
        ActivityController<ShareActivity> first=Robolectric.buildActivity(ShareActivity.class,share).setup();Bundle state=new Bundle();first.saveInstanceState(state).pause().stop().destroy();
        ActivityController<ShareActivity> second=Robolectric.buildActivity(ShareActivity.class,share).create(state).start().resume();
        assertEquals(before+1,new Drafts(c).list().length());assertEquals("原始正文\nhttps://example.com",new Drafts(c).read(state.getString("draftId")).getString("content"));
        second.pause().stop().destroy();new Drafts(c).remove(state.getString("draftId"));
    }
    @Test public void immutableOutboxSurvivesReopenAndRetriesSameId()throws Exception{
        Context c=RuntimeEnvironment.getApplication();Outbox q=new Outbox(c);String id=UUID.randomUUID().toString();JSONObject payload=new JSONObject().put("submissionId",id).put("content"," 原文\nhttps://example.com\n").put("autoArchive",false).put("tags",new JSONArray().put("原标签"));
        assertEquals(id,q.enqueue(payload,"https://library.example"));assertEquals(id,q.enqueue(payload,"https://library.example"));
        new Outbox(c).retry(id);JSONObject found=null;JSONArray rows=new Outbox(c).list();for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).getString("id")))found=rows.getJSONObject(i);
        assertNotNull(found);assertEquals(payload.toString(),found.getJSONObject("payload").toString());assertEquals("pending",found.getString("state"));
        try{q.enqueue(new JSONObject(payload.toString()).put("content","changed"),"https://library.example");fail("identity reuse should fail");}catch(Exception expected){}
        try{q.enqueue(payload,"https://another.example");fail("origin reuse should fail");}catch(Exception expected){}
        q.remove(id);
    }
    @Test public void authenticatedFilesRejectForeignOriginAndNonLibraryPaths(){
        assertTrue(PrivateFiles.allowed("https://library.example","https://library.example/library/files/report.pdf"));
        for(String url:new String[]{"https://evil.example/library/data","https://library.example:444/library/data","http://library.example/library/data","https://u@library.example/library/data","https://library.example/api/state","file:///library/data"})assertFalse(url,PrivateFiles.allowed("https://library.example",url));
    }
    @Test public void serverValidationRejectsCredentialsPathsAndPublicCleartext()throws Exception{
        assertEquals("https://library.example",Credentials.normalizeServer("https://library.example/"));
        for(String url:new String[]{"https://user:password@library.example","https://library.example/other","https://library.example?token=bad","https://library.example/#secret","http://library.example"}){try{Credentials.normalizeServer(url);fail(url);}catch(Exception expected){}}
    }

    @Test public void sharedOriginalIsSelectableButCannotBeEdited() throws Exception {
        String raw = "  原文\r\nhttps://example.com/a?x=1&y=2\n\t🐈  ";
        ActivityController<ShareActivity> controller = Robolectric.buildActivity(
                ShareActivity.class, shareIntent(raw)).setup();
        String id = savedDraftId(controller);
        try {
            TextView original = requireText(controller.get().body, raw);
            assertFalse("Shared text must not use an editable widget", original instanceof EditText);
            assertTrue("Copying the original should remain possible", original.isTextSelectable());
            assertNull("Selection must not leave an editing key listener", original.getKeyListener());
            assertFalse("The original must not expose an IME editor", original.onCheckIsTextEditor());
            Bundle edit = new Bundle();
            edit.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "changed");
            assertFalse("Accessibility input must not modify the original",
                    original.performAccessibilityAction(AccessibilityNodeInfo.ACTION_SET_TEXT, edit));
            assertEquals(raw, original.getText().toString());
            assertEquals(raw, new Drafts(controller.get()).read(id).getString("original"));
        } finally {
            closeShare(controller);
            new Drafts(RuntimeEnvironment.getApplication()).remove(id);
        }
    }

    @Test
    @Config(shadows = SubmissionCredentials.class,
            instrumentedPackages = {"store.inspirai.library.core"})
    public void submissionUsesExactOriginalEvenWhenDisplayTextChanges() throws Exception {
        String raw = "  原始正文\r\nhttps://example.com/a?x=1&y=2\n"
                + "https://example.com/b\t🐈\u0000  ";
        String original = "  分享主题  \n分享标题\n" + raw;
        String addition = "  保留换行\r\n用于剧本 🐈  ";
        Intent intent = shareIntent(raw).putExtra(Intent.EXTRA_SUBJECT, "  分享主题  ")
                .putExtra(Intent.EXTRA_TITLE, "分享标题");
        SubmissionCredentials.allowSubmission = false;
        ActivityController<ShareActivity> controller = Robolectric.buildActivity(
                ShareActivity.class, intent).setup();
        String id = savedDraftId(controller);
        Context context = RuntimeEnvironment.getApplication();
        try {
            // Exercise the immutable data source independently of the widget's edit prevention.
            requireText(controller.get().body, original).setText("changed presentation text");
            EditText extra = findInput(controller.get().body, "补充要求或使用场景（可选）");
            assertNotNull(extra);
            extra.setText(addition);
            assertEquals(original, new Drafts(context).read(id).getString("original"));

            SubmissionCredentials.allowSubmission = true;
            assertTrue("The test credential gate must be installed", new Credentials(context).isPaired());
            TextView submit = requireText(controller.get().root, "提交采集任务");
            assertTrue(submit instanceof Button);
            assertTrue(submit.performClick());

            JSONObject queued = queueRecord(context, id);
            assertNotNull("Submission must reach the real durable outbox", queued);
            assertEquals(id, queued.getJSONObject("payload").getString("submissionId"));
            assertEquals(original + "\n\n补充要求：\n" + addition,
                    queued.getJSONObject("payload").getString("content"));
            assertFalse("A queued composition must not remain editable as a draft", hasDraft(context, id));
            assertFalse("A second tap must not enqueue another task", submit.isEnabled());
            assertEquals(id, savedDraftId(controller));
        } finally {
            closeShare(controller);
            SubmissionCredentials.allowSubmission = false;
            new Drafts(context).remove(id);
            new Outbox(context).remove(id);
        }
    }

    @Test public void recreationAfterDraftDeletionRestoresDurableSubmission() throws Exception {
        assertQueuedRestoration(false);
    }

    @Test public void recreationPrefersQueueOverDraftLeftByInterruptedSubmission() throws Exception {
        assertQueuedRestoration(true);
    }

    private void assertQueuedRestoration(boolean keepDraft) throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        Intent intent = shareIntent("  原始分享\r\nhttps://example.com\n🐈  ");
        ActivityController<ShareActivity> first = Robolectric.buildActivity(
                ShareActivity.class, intent).setup();
        Bundle state = new Bundle();
        first.saveInstanceState(state);
        String id = state.getString("draftId");
        assertNotNull(id);
        closeShare(first);
        ActivityController<ShareActivity> restored = null;
        try {
            // Model both sides of the crash window between SQLite commit and draft deletion.
            String queuedText = "  原始分享\r\nhttps://example.com\n🐈  \n\n补充要求：\n只做摘要";
            JSONObject payload = new JSONObject().put("submissionId", id).put("content", queuedText)
                    .put("autoArchive", false).put("tags", new JSONArray().put("原标签"));
            new Outbox(context).enqueue(payload, "https://library.example");
            if (!keepDraft) new Drafts(context).remove(id);
            int draftCount = new Drafts(context).list().length();
            int queueCount = new Outbox(context).list().length();

            restored = Robolectric.buildActivity(ShareActivity.class, intent)
                    .create(state).start().resume();
            assertEquals(queuedText, requireText(restored.get().body, queuedText).getText().toString());
            requireText(restored.get().body, "查看待提交与任务进度");
            requireText(restored.get().body, "重试提交");
            assertNull("Restoration must not create a second composer",
                    findText(restored.get().body, "提交采集任务"));
            assertFalse("Queued content must have no editable controls", containsEditor(restored.get().body));
            assertEquals(id, savedDraftId(restored));
            closeShare(restored);
            restored = null;

            assertEquals("No draft may be recreated on pause", draftCount, new Drafts(context).list().length());
            assertEquals("No duplicate submission may be created", queueCount, new Outbox(context).list().length());
            JSONObject reopened = queueRecord(context, id);
            assertNotNull(reopened);
            assertEquals("pending", reopened.getString("state"));
            assertEquals("https://library.example", reopened.getString("server"));
            assertEquals(payload.toString(), reopened.getJSONObject("payload").toString());
        } finally {
            if (restored != null) closeShare(restored);
            new Drafts(context).remove(id);
            new Outbox(context).remove(id);
        }
    }

    private static Intent shareIntent(String raw) {
        return new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, raw);
    }

    private static String savedDraftId(ActivityController<ShareActivity> controller) {
        Bundle state = new Bundle();
        controller.saveInstanceState(state);
        String id = state.getString("draftId");
        assertNotNull("Activity must save the durable composition ID", id);
        return id;
    }

    private static void closeShare(ActivityController<ShareActivity> controller) throws Exception {
        ShareActivity activity = controller.get();
        controller.pause().stop().destroy();
        assertTrue("Background work must finish before removing test rows",
                activity.io.awaitTermination(5, TimeUnit.SECONDS));
    }

    private static JSONObject queueRecord(Context context, String id) throws Exception {
        JSONArray rows = new Outbox(context).list();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (id.equals(row.getString("id"))) return row;
        }
        return null;
    }

    private static boolean hasDraft(Context context, String id) throws Exception {
        JSONArray rows = new Drafts(context).list();
        for (int i = 0; i < rows.length(); i++) {
            if (id.equals(rows.getJSONObject(i).getString("id"))) return true;
        }
        return false;
    }

    private static TextView requireText(View root, String text) {
        TextView found = findText(root, text);
        assertNotNull("Missing visible text: " + text, found);
        return found;
    }

    private static TextView findText(View root, String text) {
        if (root instanceof TextView && text.contentEquals(((TextView) root).getText())) {
            return (TextView) root;
        }
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                TextView found = findText(group.getChildAt(i), text);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static EditText findInput(View root, String hint) {
        if (root instanceof EditText && hint.equals(String.valueOf(((EditText) root).getHint()))) {
            return (EditText) root;
        }
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                EditText found = findInput(group.getChildAt(i), hint);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static boolean containsEditor(View root) {
        if (root instanceof EditText) return true;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                if (containsEditor(group.getChildAt(i))) return true;
            }
        }
        return false;
    }

    /** Only the submit gate is faked; draft persistence, SQLite and activity lifecycle stay real. */
    @Implements(value = Credentials.class, isInAndroidSdk = false)
    public static class SubmissionCredentials {
        static boolean allowSubmission;

        @Implementation protected boolean isPaired() { return allowSubmission; }
        @Implementation protected String server() { return "https://library.example"; }
        // No credentials are available to background delivery, so no HTTP request can be made.
        @Implementation protected Credentials.Snapshot snapshot() { return null; }
    }
}
