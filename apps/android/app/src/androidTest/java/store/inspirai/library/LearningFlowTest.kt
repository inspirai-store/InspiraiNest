package store.inspirai.library

import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.json.JSONArray
import org.junit.*
import org.junit.Assert.*
import store.inspirai.library.core.Credentials
import store.inspirai.library.nativeui.*
import store.inspirai.library.nativeui.data.*
import java.io.File

class LearningFlowTest {
 @get:Rule val compose=createEmptyComposeRule()
 private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
 private val context get()=instrumentation.targetContext
 private lateinit var database:NativeDatabase
 private lateinit var goal:JSONObject
 private var activity:NativeActivity?=null
 @Before fun prepare()=runBlocking{
  Credentials(context).save("https://learning.example.test","fixture-learning-token","fixture-learning")
  database=Room.inMemoryDatabaseBuilder(context,NativeDatabase::class.java).build();database.dao().journal(MigrationLog("records-v1","complete"))
  goal=JSONObject(instrumentation.context.assets.open("learning-goal.json").bufferedReader().readText())
  val plugins=JSONObject(instrumentation.context.assets.open("plugins.json").bufferedReader().readText());plugins.getJSONArray("plugins").objects().forEach{if(it.optString("id")=="learning")it.put("enabled",true)};plugins.getJSONObject("enabled").put("learning",true)
  val repository=AndroidNestRepository(context,database){path,method,body->when{
   path=="/api/plugins"->plugins
   path=="/api/learning"->JSONObject().put("goals",JSONArray().put(goal)).put("candidates",JSONArray())
   path=="/api/learning/sources"->JSONObject().put("items",JSONArray())
   path.endsWith("/progress")&&method=="POST"->{assertEquals(goal.getInt("revision"),body!!.getInt("revision"));val node=goal.getJSONArray("nodes").objects().first{it.getString("id")==body.getString("nodeId")};if(body.has("notes"))node.put("notes",body.getString("notes"));if(body.has("mastery"))node.put("mastery",body.getString("mastery"));goal.put("revision",goal.getInt("revision")+1);JSONObject(goal.toString())}
   path.startsWith("/api/learning/goals/")->JSONObject(goal.toString())
   path.endsWith("capabilities")->JSONObject().put("recordSyncProtocol",0)
   else->JSONObject().put("records",JSONArray()).put("deleted",JSONArray()).put("tasks",JSONArray()).put("devices",JSONArray())
  }}
  NestDependencies.overrideFactory={repository}
 }
 @After fun close(){activity?.let{instrumentation.runOnMainSync{it.finish()};instrumentation.waitForIdleSync()};NestDependencies.overrideFactory=null;database.close()}
 @Test fun nativeLearningNavigationNotesAndExplicitMastery(){
  activity=instrumentation.startActivitySync(Intent(context,NativeActivity::class.java).putExtra("tab","records").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
  compose.waitUntil(15000){compose.onAllNodesWithContentDescription("更多").fetchSemanticsNodes().isNotEmpty()}
  compose.onAllNodesWithContentDescription("更多").onFirst().performClick();compose.onNodeWithText("新知").performClick()
  compose.waitUntil(15000){compose.onAllNodesWithText("AI 基础软件架构师").fetchSemanticsNodes().isNotEmpty()};compose.onNodeWithText("AI 基础软件架构师").performClick()
  compose.waitUntil(15000){compose.onAllNodesWithText("KV Cache · 待学").fetchSemanticsNodes().isNotEmpty()}
  compose.onNodeWithText("KV Cache · 待学").performScrollTo().performClick()
  compose.onNodeWithText("已掌握").performScrollTo().performClick()
  compose.waitUntil(10000){goal.getJSONArray("nodes").objects().first{it.getString("id")=="kv-cache"}.optString("mastery")=="mastered"}
  compose.onNode(hasSetTextAction() and hasText("我的理解")).performScrollTo().performTextInput("逻辑容量与物理分配需要区分")
  compose.onNodeWithText("保存笔记").performScrollTo().performClick()
  compose.waitUntil(10000){goal.getJSONArray("nodes").objects().first{it.getString("id")=="kv-cache"}.optString("notes")=="逻辑容量与物理分配需要区分"}
  val folder=File(context.getExternalFilesDir(null),"learning-qa").apply{mkdirs()};instrumentation.uiAutomation.takeScreenshot().let{bitmap->File(folder,"learning-notes.png").outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()}
  android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("screencap -p /sdcard/Download/learning-notes.png")).use{it.readBytes()}
  assertEquals(3,goal.getInt("revision"))
 }
}
