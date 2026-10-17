package store.inspirai.library

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.*
import org.junit.*
import org.junit.Assert.*
import store.inspirai.library.core.Credentials
import store.inspirai.library.nativeui.*
import store.inspirai.library.nativeui.data.*
import java.io.File
import java.util.UUID

/** Real editor + Room + sync merge, using an isolated fixture service. */
class NativeRecordSyncFlowTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private lateinit var database: NativeDatabase
    private lateinit var repository: AndroidNestRepository
    private var activity: NativeActivity?=null
    private val id=UUID.randomUUID().toString()
    private var incoming=JSONObject()
    @Before fun prepare()=runBlocking {
        Credentials(context).save("https://record-sync.example.test","fixture-only-token","fixture-record-sync")
        database=Room.inMemoryDatabaseBuilder(context,NativeDatabase::class.java).build()
        database.dao().journal(MigrationLog("records-v1","complete"))
        val original=JSONObject().put("id",id).put("text","同步中的原始记录").put("attachments",JSONArray()).put("version",1).put("remoteVersion",1).put("sync","synced").put("createdAt","2026-10-17T01:00:00Z")
        incoming=JSONObject().put("records",JSONArray().put(original)).put("deleted",JSONArray())
        database.dao().put(LocalRecord("https://record-sync.example.test",id,original.toString(),1))
        repository=AndroidNestRepository(context,database){path,method,body->
            when {path.endsWith("capabilities")->JSONObject().put("recordSyncProtocol",0)
                path.startsWith("/api/records")->if(method=="PUT")body!!.copyJson().put("id",path.substringAfterLast('/')).put("version",body.getLong("baseVersion")+1) else incoming
                else->JSONObject().put("tasks",JSONArray()).put("devices",JSONArray())}
        }
        NestDependencies.overrideFactory={repository}
    }
    @After fun close(){activity?.let{instrumentation.runOnMainSync{it.finish()};instrumentation.waitForIdleSync()};NestDependencies.overrideFactory=null;database.close()}
    @Test fun deletionWhileTypingKeepsTextAndOnlyExplicitSaveCreatesAnotherRecord()=runBlocking {
        activity=instrumentation.startActivitySync(Intent(context,NativeActivity::class.java).putExtra("tab","records").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        compose.waitUntil(15000){compose.onAllNodesWithText("同步中的原始记录").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("同步中的原始记录").performClick();compose.onNodeWithContentDescription("编辑记录").performClick()
        var input: EditText?=null
        compose.waitUntil(15000){instrumentation.runOnMainSync{input=findEditor(activity!!.window.decorView)};input!=null}
        instrumentation.runOnMainSync{input!!.setText("正在输入且尚未上传的修改");input!!.setSelection(input!!.length())}
        compose.waitForIdle()
        incoming=JSONObject().put("records",JSONArray()).put("deleted",JSONArray().put(JSONObject().put("id",id).put("version",1).put("trashVersion",1).put("deletedAt","2026-10-17T02:00:00Z")))
        RecordSyncClient(database,repository).pull()
        compose.waitUntil(10000){compose.onAllNodesWithText("已在其他设备删除").fetchSemanticsNodes().isNotEmpty()}
        instrumentation.runOnMainSync{assertEquals("正在输入且尚未上传的修改",input!!.text.toString())}
        val before=JSONObject(database.dao().record(repository.credentials.server(),id)!!.json)
        assertTrue(before.getJSONArray("recoveryDrafts").length()>0);assertEquals(1,database.dao().records().size)
        val folder=File(context.getExternalFilesDir(null),"native-qa").apply{mkdirs()}
        instrumentation.uiAutomation.takeScreenshot().let{bitmap->File(folder,"record-sync-recovery.png").outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()}
        compose.onAllNodesWithText("另存记录").onFirst().performClick()
        compose.waitUntil(10000){compose.onAllNodesWithContentDescription("编辑记录").fetchSemanticsNodes().isNotEmpty()}
        val all=database.dao().records();assertEquals(2,all.size);assertFalse(JSONObject(all.single{it.id==id}.json).isNull("deletedAt"))
        assertEquals("正在输入且尚未上传的修改",JSONObject(all.single{it.id!=id}.json).getString("text"));Unit
    }
    private fun findEditor(view: View): EditText? {if(view is EditText)return view;if(view is ViewGroup)for(i in 0 until view.childCount)findEditor(view.getChildAt(i))?.let{return it};return null}
}
