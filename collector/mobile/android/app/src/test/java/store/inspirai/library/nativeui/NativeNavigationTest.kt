package store.inspirai.library.nativeui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.activity.compose.setContent
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.room.Room
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.runBlocking
import org.json.*
import org.junit.*
import org.junit.runner.RunWith
import org.robolectric.*
import org.robolectric.annotation.*
import store.inspirai.library.core.Credentials
import store.inspirai.library.nativeui.data.*
import store.inspirai.library.nativeui.design.NestTheme
import java.io.File

/** Android graphics in a JVM, not a substitute for emulator/device acceptance. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],qualifiers="w393dp-h852dp-mdpi",shadows=[ConnectedCredentials::class],instrumentedPackages=["store.inspirai.library.core"])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeNavigationTest {
    @get:Rule val compose=createEmptyComposeRule()
    private lateinit var db: NativeDatabase
    private lateinit var host: org.robolectric.android.controller.ActivityController<androidx.activity.ComponentActivity>
    private lateinit var root: android.view.View
    private fun show(mode: String="light") {
        val context=RuntimeEnvironment.getApplication();db=Room.inMemoryDatabaseBuilder(context,NativeDatabase::class.java).build()
        val repository=FixtureRepository(db)
        host=Robolectric.buildActivity(androidx.activity.ComponentActivity::class.java).setup().visible()
        host.get().setContent { root=androidx.compose.ui.platform.LocalView.current.rootView;NestTheme(mode) { NativeApp(repository,true,"",{}, {},mode,android.content.Intent(),{}) } }
        compose.waitUntil(10000) { compose.onAllNodesWithText("原生阅读与长篇中文资料").fetchSemanticsNodes().isNotEmpty() }
    }
    @After fun close() { if(::host.isInitialized)host.pause().stop().destroy();if(::db.isInitialized)db.close() }
    @Test fun fourTabsReaderAndReturnKeepSearch() {
        show()
        compose.onNodeWithText("搜索资料").performTextInput("原生")
        compose.onNodeWithText("原生阅读与长篇中文资料").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("正文示例").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("返回").performClick()
        compose.onNodeWithText("原生",useUnmergedTree=true).assertExists()
        compose.onAllNodesWithText("记录").onLast().performClick();compose.onNodeWithText("搜索记录").assertExists()
        compose.onAllNodesWithText("任务").onLast().performClick();compose.onNodeWithText("需要处理").assertExists()
        compose.onAllNodesWithText("我的").onLast().performClick();compose.onNodeWithText("发件箱").assertExists()
    }
    @Test fun dayLibraryRenders() { show();capture("day-library") }
    @Test fun nightLibraryRenders() { show("dark");capture("night-library") }
    private fun capture(name: String) {
        compose.waitForIdle();val file=File("build/reports/native-ui/$name.png");file.parentFile!!.mkdirs()
        compose.runOnIdle {
            val bitmap=android.graphics.Bitmap.createBitmap(root.width,root.height,android.graphics.Bitmap.Config.ARGB_8888)
            root.draw(android.graphics.Canvas(bitmap))
            file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) };bitmap.recycle()
        }
    }
    private class FixtureRepository(db: NativeDatabase): NestRepository {
        override val dao=db.dao();override val credentials=Credentials(RuntimeEnvironment.getApplication())
        override val records=MutableStateFlow<List<LocalRecord>>(emptyList())
        private val item=JSONObject().put("id","fixture-reading").put("title","原生阅读与长篇中文资料").put("summary","用于组件验收的本地夹具").put("status","archived").put("type","article").put("collected_at","2026-10-17T10:00:00+08:00")
        override suspend fun library(query: String)=listOf(item)
        override suspend fun content(id: String,file: String?)="# 正文示例\n\n"+"中文长文内容，保持舒适的行距与留白。\n\n".repeat(20)
        override suspend fun request(path: String,method: String,body: JSONObject?)=when {
            path.startsWith("/api/read/v1/entry")->item
            path=="/api/processing-center"->JSONObject().put("items",JSONArray()).put("counts",JSONObject())
            else->JSONObject().put("tasks",JSONArray()).put("devices",JSONArray())
        }
        override suspend fun saveRecord(value: JSONObject,draft: Boolean){}
        override suspend fun syncRecords(){}
        override suspend fun resolveConflict(server: String,id: String,useLocal: Boolean){}
        override suspend fun processRecord(server: String,id: String,preset: String,instructions: String,deviceId: String?,agent: String?){}
        override suspend fun download(route: String,meta: JSONObject)=error("No network in fixture")
    }
}
@Implements(value=Credentials::class,isInAndroidSdk=false)
class ConnectedCredentials {
    @Implementation fun isPaired()=true
    @Implementation fun server()="https://native-fixture.example"
}
