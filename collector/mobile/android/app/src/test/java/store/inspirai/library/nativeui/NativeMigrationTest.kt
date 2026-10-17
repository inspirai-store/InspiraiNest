package store.inspirai.library.nativeui

import android.util.Base64
import androidx.room.Room
import kotlinx.coroutines.runBlocking
import org.json.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.*
import org.robolectric.annotation.Config
import store.inspirai.library.core.InputFiles
import store.inspirai.library.nativeui.data.*
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class) @Config(sdk=[35])
class NativeMigrationTest {
    private val context get()=RuntimeEnvironment.getApplication()
    private lateinit var database: NativeDatabase
    @Before fun open(){database=Room.inMemoryDatabaseBuilder(context,NativeDatabase::class.java).build()}
    @After fun close(){database.close()}
    @Test fun interruptedBlobRestartsAndKeepsIdsVersionsAndFrozenRequests()=runBlocking {
        val id=UUID.randomUUID().toString();val fileId=UUID.randomUUID().toString();val bytes="中文原始文件\n不能替换为摘要".toByteArray()
        val hash=java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
        val row=JSONObject().put("id",id).put("server","https://old.example").put("remoteVersion",7).put("text","原文")
            .put("payload",JSONObject().put("requestId","same-put-request").put("baseVersion",7).put("text","未确认正文"))
            .put("pendingProcess",JSONObject().put("requestId","same-processing-request").put("baseVersion",7))
            .put("attachments",JSONArray().put(JSONObject().put("id",fileId).put("name","中文.txt").put("sha256",hash)))
        fun exporter()=MigrationImporter(context,database){"https://current.example"}
        val broken=exporter();broken.accept("begin",JSONObject().put("count",1));broken.accept("recordStart",row)
        val start=JSONObject().put("fileId",fileId).put("part","original").put("bytes",bytes.size).put("meta",row.getJSONArray("attachments").getJSONObject(0))
        broken.accept("fileStart",start);broken.accept("chunk",JSONObject().put("body",Base64.encodeToString(bytes.copyOfRange(0,4),Base64.NO_WRAP)));broken.abort()
        assertNull(database.dao().record("https://old.example",id));assertNull(database.dao().journal("records-v1"))
        val resumed=exporter();resumed.accept("begin",JSONObject().put("count",1));resumed.accept("recordStart",row);resumed.accept("fileStart",start)
        resumed.accept("chunk",JSONObject().put("body",Base64.encodeToString(bytes,Base64.NO_WRAP)));resumed.accept("fileEnd",JSONObject());resumed.accept("recordEnd",JSONObject())
        resumed.accept("complete",JSONObject().put("count",1).put("files",1).put("bytes",bytes.size))
        val saved=JSONObject(database.dao().record("https://old.example",id)!!.json)
        assertEquals(7,saved.getInt("remoteVersion"));assertEquals("same-put-request",saved.getJSONObject("payload").getString("requestId"));assertEquals("same-processing-request",saved.getJSONObject("pendingProcess").getString("requestId"))
        val retained=File(JSONObject(database.dao().files(id,"https://old.example").single().json).getString("localPath"))
        assertArrayEquals(bytes,retained.readBytes());assertEquals(hash,InputFiles.sha256(retained));assertEquals("complete",database.dao().journal("records-v1")!!.json)
        // A process restart after a committed record does not create a replacement.
        val again=exporter();again.accept("begin",JSONObject().put("count",1));again.accept("recordStart",row);again.accept("recordEnd",JSONObject());again.accept("complete",JSONObject().put("count",1))
        assertEquals(1,database.dao().records().size)
    }
    @Test fun missingDraftIdIsStableAndIncorrectHashCannotComplete()=runBlocking {
        val first=MigrationImporter(context,database){"https://old.example"};val draft=JSONObject().put("id","draft").put("text","草稿原文")
        first.accept("begin",JSONObject().put("count",1));first.accept("recordStart",draft);first.accept("recordEnd",JSONObject())
        val id=database.dao().records().single().id
        val retry=MigrationImporter(context,database){"https://old.example"};retry.accept("begin",JSONObject().put("count",1));retry.accept("recordStart",draft);retry.accept("recordEnd",JSONObject())
        assertEquals(id,database.dao().records().single().id)
        val fileId=UUID.randomUUID().toString();val bad=JSONObject().put("id",UUID.randomUUID().toString()).put("attachments",JSONArray().put(JSONObject().put("id",fileId)))
        val stream=MigrationImporter(context,database){"https://old.example"};stream.accept("begin",JSONObject().put("count",1));stream.accept("recordStart",bad)
        stream.accept("fileStart",JSONObject().put("fileId",fileId).put("part","original").put("bytes",1).put("meta",JSONObject().put("sha256","0".repeat(64))))
        stream.accept("chunk",JSONObject().put("body","YQ=="))
        assertTrue(runCatching { stream.accept("fileEnd",JSONObject()) }.isFailure);stream.abort()
        assertNull(database.dao().journal("records-v1"));assertNull(database.dao().record("https://old.example",bad.getString("id")))
    }
}
