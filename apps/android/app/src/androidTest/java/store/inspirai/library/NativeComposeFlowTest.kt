package store.inspirai.library

import android.content.*
import android.os.SystemClock
import android.view.*
import android.widget.EditText
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.core.content.FileProvider
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.*
import org.junit.*
import org.junit.Assert.*
import store.inspirai.library.core.Credentials
import store.inspirai.library.nativeui.*
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.content.RecordCodec
import java.io.File
import java.util.UUID

/** UI fixtures remain inside androidTest; these tests exercise the real Compose/runtime boundary. */
class NativeComposeFlowTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private lateinit var repository: Fixture
    private lateinit var activity: NativeActivity
    @Before fun prepare()=runBlocking {
        Appearance.set(context,"light")
        Credentials(context).save("https://overlay.example.test","fixture-only-token","fixture-android")
        repository=Fixture(Room.inMemoryDatabaseBuilder(context,NativeDatabase::class.java).build(),Credentials(context))
        repository.seed()
        NestDependencies.overrideFactory={repository}
    }
    @After fun close(){if(::activity.isInitialized){instrumentation.runOnMainSync { activity.finish() };instrumentation.waitForIdleSync()};NestDependencies.overrideFactory=null;repository.database.close()}
    private fun launch(intent: Intent=Intent(context,NativeActivity::class.java)) {
        activity=instrumentation.startActivitySync(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
    }
    @Test fun nativeTabsReaderReturnAndBothThemesRender() {
        launch()
        compose.waitUntil(15000) { compose.onAllNodesWithText("真实字体测量与原生阅读").fetchSemanticsNodes().isNotEmpty() }
        for(theme in listOf("light","dark")) {
            compose.onNode(hasText("我的") and hasClickAction()).performClick()
            compose.onNodeWithText("外观").performScrollTo().performClick()
            compose.onNodeWithText(if(theme=="light")"日间" else "夜间").performClick()
            compose.onNodeWithContentDescription("返回").performClick()
            for(tab in listOf("资料库","记录","任务","我的")) {
                compose.onNode(hasText(tab) and hasClickAction()).performClick();capture("$theme-${mapOf("资料库" to "library","记录" to "records","任务" to "tasks","我的" to "account")[tab]}")
            }
            if(theme=="light") {
                compose.onNode(hasText("资料库") and hasClickAction()).performClick()
                compose.waitUntil(15000){compose.onAllNodesWithText("真实字体测量与原生阅读").fetchSemanticsNodes().isNotEmpty()}
                compose.onNodeWithText("真实字体测量与原生阅读").performClick()
                compose.waitUntil(15000){compose.onAllNodesWithText("正文标题").fetchSemanticsNodes().isNotEmpty()};capture("light-reader")
                compose.onNodeWithContentDescription("返回").performClick()
            }
        }
        compose.onNode(hasText("资料库") and hasClickAction()).performClick();compose.onNodeWithText("搜索资料").performTextInput("真实")
        compose.onNodeWithText("真实字体测量与原生阅读").performClick()
        compose.waitUntil(5000){var visible=false;instrumentation.runOnMainSync{visible=activity.window.decorView.rootWindowInsets?.isVisible(WindowInsets.Type.ime())==true};!visible}
        compose.waitUntil(15000){compose.onAllNodesWithText("正文标题").fetchSemanticsNodes().isNotEmpty()};capture("dark-reader")
        compose.onAllNodes(hasScrollAction()).onLast().performScrollToIndex(42)
        compose.onNodeWithText("val value = 1").assertIsDisplayed();compose.onNodeWithText("方式").assertIsDisplayed();capture("dark-reader-code-table")
        compose.onNodeWithContentDescription("返回").performClick();compose.onNodeWithText("真实",useUnmergedTree=true).assertExists()
    }
    @Test fun sharedTextAndFileBecomeAnIndependentDurableRecord()=runBlocking {
        val file=File(context.cacheDir,"input-files/原始中文.txt").apply{parentFile!!.mkdirs();writeText("完整附件原文\n第二段保持不变。")}
        val uri=FileProvider.getUriForFile(context,"${context.packageName}.inputs",file)
        val raw="  完整分享原文\nhttps://example.com/a?x=1\n不能截断  "
        launch(Intent(context,NativeShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,raw).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        compose.waitUntil(20000){compose.onAllNodesWithText("原始中文.txt").fetchSemanticsNodes().isNotEmpty()}
        compose.onAllNodesWithText("存为记录").onFirst().performClick()
        compose.waitUntil(15000){compose.onAllNodesWithText("存为记录").onLast().fetchSemanticsNode().config.contains(androidx.compose.ui.semantics.SemanticsProperties.Disabled).not()}
        capture("light-share-record");compose.onAllNodesWithText("存为记录").onLast().performClick()
        compose.waitUntil(20000){compose.onAllNodesWithText("记录已保存").fetchSemanticsNodes().isNotEmpty()}
        val saved=repository.dao.records().single { JSONObject(it.json).optString("text")==raw };val document=JSONObject(saved.json)
        assertEquals(raw,document.getString("text"));assertEquals(1,document.getJSONArray("attachments").length())
        val local=JSONObject(repository.dao.files(saved.id,repository.credentials.server()).single().json)
        assertTrue(local.getString("localPath").contains("record-media/"));assertEquals(file.readText(),File(local.getString("localPath")).readText())
        assertEquals(document.getJSONArray("attachments").getJSONObject(0).getString("id"),local.getString("id"))
    }
    private fun externalShare(text: String)=Intent(context,NativeShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,text)
    private fun awaitShare(text: String) {
        compose.waitUntil(20000){compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("保存分享").assertIsDisplayed()
    }
    @Test fun continuousSharesReadNewContentAndKeepPreviousDraft() {
        val first="first-${UUID.randomUUID()}";val second="second-${UUID.randomUUID()}"
        launch(externalShare(first));awaitShare(first)
        instrumentation.runOnMainSync { instrumentation.callActivityOnNewIntent(activity,externalShare(second)) }
        awaitShare(second);compose.onAllNodesWithText(first).assertCountEquals(0)
        val drafts=Drafts(context).list()
        val originals=(0 until drafts.length()).map { drafts.getJSONObject(it).optString("original") }
        assertTrue(originals.contains(first));assertTrue(originals.contains(second))
    }
    @Test fun shareAfterReturningClosesOldActivityAndOpensNewShare() {
        val first="first-${UUID.randomUUID()}";val second="second-${UUID.randomUUID()}"
        launch(externalShare(first));awaitShare(first);val previous=activity
        compose.onNodeWithContentDescription("返回").performClick();instrumentation.waitForIdleSync()
        assertTrue(previous.isFinishing || previous.isDestroyed)
        launch(externalShare(second));awaitShare(second);compose.onAllNodesWithText(first).assertCountEquals(0)
    }
    @Test fun nativeEditorKeepsChineseTextAndFormattingInVersionOneDocument()=runBlocking {
        launch(Intent(context,NativeActivity::class.java).putExtra("tab","records"))
        compose.waitUntil(15000){compose.onAllNodesWithContentDescription("新建记录").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithContentDescription("新建记录").performClick()
        var input: EditText?=null
        compose.waitUntil(15000){instrumentation.runOnMainSync{input=findEditor(activity.window.decorView)};input!=null}
        val text="中文记录与富文本\n保存后保持原始段落。"
        instrumentation.runOnMainSync{input!!.requestFocus();input!!.setText(text);input!!.setSelection(0,4);(activity.getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).showSoftInput(input,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)}
        compose.waitUntil(10000){var shown=false;instrumentation.runOnMainSync{shown=activity.window.decorView.rootWindowInsets?.isVisible(WindowInsets.Type.ime())==true};shown}
        SystemClock.sleep(800)
        compose.onNodeWithText("粗体").assertIsDisplayed().performClick();capture("light-record-editor")
        compose.onNodeWithText("保存",useUnmergedTree=true).assertIsDisplayed().performClick()
        compose.waitUntil(15000){compose.onAllNodesWithContentDescription("新建记录").fetchSemanticsNodes().isNotEmpty()}
        val row=repository.dao.records().single { JSONObject(it.json).optString("text")==text }
        val doc=JSONObject(row.json).getJSONObject("document")
        assertEquals(1,doc.getInt("version"));val decoded=RecordCodec.decode(doc)
        assertEquals(text,decoded.toString());assertTrue(decoded.getSpans(0,4,android.text.style.StyleSpan::class.java).any{it.style==android.graphics.Typeface.BOLD})
    }
    @Test fun reportLinksToItsSourceAndTheSourceLinksBackToTheReport() {
        launch(Intent(context,NativeActivity::class.java).putExtra("tab","tasks"))
        compose.waitUntil(15000){compose.onAllNodesWithText("处理结果 1").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("处理结果 1").performClick();compose.onNodeWithText("项目插件实测报告").performClick()
        awaitReport();capture("light-trial-report")
        compose.onNodeWithText("查看原资料").performClick();compose.onNodeWithText("返回原记录 · 版本 3").performClick()
        compose.waitUntil(15000){compose.onAllNodesWithText("记录原文与加工结果分开保存。",substring=true).fetchSemanticsNodes().isNotEmpty()}
        repeat(3){compose.onNodeWithContentDescription("返回").performClick()}
        compose.onNode(hasText("资料库") and hasClickAction()).performClick()
        compose.waitUntil(15000){compose.onAllNodesWithText("真实字体测量与原生阅读").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("真实字体测量与原生阅读").performClick()
        compose.onNodeWithContentDescription("更多").performClick();compose.onNodeWithText("归档信息").performClick()
        compose.waitUntil(15000){compose.onAllNodesWithText("项目插件实测报告").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("项目插件实测报告").performClick()
        awaitReport()
    }
    @Test fun archivedOriginalAttachmentOpensFromTheNativeReader() {
        launch();compose.waitUntil(15000){compose.onAllNodesWithText("真实字体测量与原生阅读").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("真实字体测量与原生阅读").performClick();compose.onNodeWithContentDescription("更多").performClick()
        compose.onNodeWithText("文件与附件").performClick();compose.onNodeWithText("archive-original.txt").performClick()
        compose.waitUntil(15000){compose.onAllNodesWithText("原始归档附件正文").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("保存").assertIsDisplayed();compose.onNodeWithContentDescription("返回").performClick()
    }
    @Test fun largeLibraryRestoresItsPositionAfterReading() {
        repository.additionalEntries=(1..1000).map { index->JSONObject().put("id","large-library-$index").put("title","长列表资料 $index").put("status","archived").put("type","article").put("collected_at",java.time.Instant.parse("2026-10-16T09:00:00Z").minusSeconds(index.toLong()).toString()) }
        val started=SystemClock.uptimeMillis()
        launch();compose.waitUntil(15000){compose.onAllNodesWithText("真实字体测量与原生阅读").fetchSemanticsNodes().isNotEmpty()}
        compose.onAllNodes(hasScrollAction()).onLast().performScrollToIndex(700)
        compose.onNodeWithText("长列表资料 700").assertIsDisplayed().performClick()
        compose.waitUntil(15000){compose.onAllNodesWithText("正文标题").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithContentDescription("返回").performClick()
        compose.onNodeWithText("长列表资料 700").assertIsDisplayed();capture("light-large-library")
        File(context.getExternalFilesDir(null),"native-qa/large-library.json").writeText(JSONObject().put("entries",1001).put("scrolledToIndex",700).put("returnedPositionPreserved",true).put("elapsedMillis",SystemClock.uptimeMillis()-started).put("frameTimingMeasured",false).toString(2))
    }
    private fun awaitReport(){try{compose.waitUntil(15000){compose.onAllNodesWithText("原生报告关联验收").fetchSemanticsNodes().isNotEmpty()}}catch(error:Throwable){capture("failed-report");File(context.getExternalFilesDir(null),"native-qa/failed-report.txt").writeText(compose.onRoot(useUnmergedTree=true).printToString());throw error}}
    private fun findEditor(view: View): EditText? {
        if(view is EditText)return view
        if(view is ViewGroup)for(i in 0 until view.childCount)findEditor(view.getChildAt(i))?.let{return it}
        return null
    }
    private fun capture(name: String) {
        compose.waitForIdle();instrumentation.waitForIdleSync()
        val frames=java.util.concurrent.CountDownLatch(1)
        instrumentation.runOnMainSync{activity.window.decorView.postOnAnimation{activity.window.decorView.postOnAnimation{frames.countDown()}}}
        check(frames.await(5,java.util.concurrent.TimeUnit.SECONDS));SystemClock.sleep(350)
        val folder=File(context.getExternalFilesDir(null),"native-qa").apply{mkdirs()}
        instrumentation.uiAutomation.takeScreenshot().let { bitmap->File(folder,"$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) };bitmap.recycle() }
    }
    private class Fixture(val database: NativeDatabase,override val credentials: Credentials): NestRepository {
        override val dao=database.dao();override val records=dao.observeRecords()
        var additionalEntries: List<JSONObject> = emptyList()
        private val recordId="f537a7a6-5b45-48a9-a1be-1068b7d65881"
        private val parentId="33ebc3ee-8267-4bb0-81a6-352f8a128ab2"
        private val trialId="48aedbeb-dbf1-420a-a177-f0226a0611ad"
        private val archiveId="1".repeat(64)
        private val original="原始归档附件正文".toByteArray(Charsets.UTF_8)
        private val digest=java.security.MessageDigest.getInstance("SHA-256").digest(original).joinToString(""){"%02x".format(it)}
        private val attachment=JSONObject().put("id","d7095da9-bb82-40cb-adc8-769a6d7f234d").put("name","archive-original.txt").put("mime","text/plain").put("bytes",original.size).put("sha256",digest)
        private val trial=JSONObject().put("id",trialId).put("title","项目插件实测报告").put("state","completed").put("report",JSONObject().put("digest","2".repeat(64))).put("trial",JSONObject().put("parentTaskId",parentId).put("sourceArchiveId",archiveId))
        private val parent=JSONObject().put("id",parentId).put("title","分享的原始资料").put("state","completed").put("recordId",recordId).put("recordVersion",3)
        private val item=JSONObject().put("id","native-reader-fixture").put("title","真实字体测量与原生阅读").put("summary","中文长标题、代码和表格的组件验收资料").put("status","archived").put("type","article").put("archive_id",archiveId).put("inputAttachments",JSONArray().put(attachment)).put("collected_at","2026-10-17T10:00:00+08:00")
        suspend fun seed(){val value=JSONObject().put("id",recordId).put("server",credentials.server()).put("text","记录原文与加工结果分开保存。").put("createdAt","2026-10-17T08:00:00Z").put("remoteVersion",3).put("sync","synced");dao.put(LocalRecord(credentials.server(),recordId,value.toString(),System.currentTimeMillis()))}
        override suspend fun request(path: String,method: String,body: JSONObject?)=when {
            path.startsWith("/api/read/v1/entry")->item
            path=="/api/processing-center"->JSONObject().put("items",JSONArray().put(JSONObject().put("id","trial:$trialId").put("section","results").put("title","项目插件实测报告").put("taskIds",JSONArray().put(trialId)))).put("counts",JSONObject().put("results",1))
            path=="/api/state"->JSONObject().put("tasks",JSONArray().put(parent).put(trial)).put("devices",JSONArray())
            path=="/api/tasks/$trialId/trial-report"->JSONObject().put("markdown","# 原生报告关联验收\n\n安装、加载与调用证据通过现有报告协议展示。\n\n此处为独立测试夹具。")
            else->JSONObject().put("tasks",JSONArray()).put("devices",JSONArray())
        }
        override suspend fun library(query: String)=(listOf(item)+additionalEntries).filter { query.isBlank()||it.optString("title").contains(query) }
        override suspend fun content(id: String,file: String?)="# 正文标题\n\n"+"原生长文阅读，日夜模式保留滚动位置。\n\n".repeat(40)+"```kotlin\nval value = 1\n```\n\n| 方式 | 内容 |\n|---|---|\n| 原生 | 正文 |"
        override suspend fun saveRecord(value: JSONObject,draft: Boolean){val json=value.copyJson().put("sync",if(draft)"draft" else "pending");dao.put(LocalRecord(credentials.server(),json.getString("id"),json.toString(),System.currentTimeMillis(),draft))}
        override suspend fun syncRecords(){}
        override suspend fun resolveConflict(server: String,id: String,useLocal: Boolean){}
        override suspend fun processRecord(server: String,id: String,preset: String,instructions: String,deviceId: String?,agent: String?){}
        override suspend fun download(route: String,meta: JSONObject): File {
            check(route=="/api/archives/$archiveId/input-files/$digest");check(meta.getString("sha256")==digest)
            return File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,"native-files/$digest").apply{parentFile!!.mkdirs();writeBytes(original)}
        }
    }
}
