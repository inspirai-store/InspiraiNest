package store.inspirai.library.nativeui

import android.text.Spanned
import android.text.style.StyleSpan
import androidx.room.Room
import kotlinx.coroutines.runBlocking
import org.json.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.*
import org.robolectric.annotation.Config
import store.inspirai.library.nativeui.content.*
import store.inspirai.library.nativeui.data.*
import java.util.UUID

@RunWith(RobolectricTestRunner::class) @Config(sdk=[35])
class NativeDataTest {
    @Test fun richDocumentKeepsTextMarksAndAttachmentIdentity() {
        val document=JSONObject("""{"version":1,"doc":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"中文标题"}]},{"type":"paragraph","content":[{"type":"text","text":"粗体与链接","marks":[{"type":"bold"},{"type":"link","attrs":{"href":"https://example.com"}}]},{"type":"attachment","attrs":{"attachmentId":"original-file"}}]}]}}""")
        assertTrue(RecordCodec.supported(document));val span=RecordCodec.decode(document)
        assertTrue(span.toString().contains("中文标题\n粗体与链接"));assertTrue(span.getSpans(0,span.length,StyleSpan::class.java).isNotEmpty())
        val encoded=RecordCodec.encode(span).toString()
        assertTrue(encoded,encoded.contains("original-file"));assertTrue(encoded,encoded.replace("\\/","/").contains("https://example.com"));assertTrue(encoded,encoded.contains("\"level\":2"))
    }
    @Test fun futureDocumentCannotBeSilentlyFlattened() {
        assertFalse(RecordCodec.supported(JSONObject("""{"version":2,"doc":{"type":"doc","content":[]}}""")))
        assertFalse(RecordCodec.supported(JSONObject("""{"version":1,"doc":{"type":"doc","content":[{"type":"futureNode"}]}}""")))
    }
    @Test fun editingNestedListKeepsItsParentContainersAndHardBreaks() {
        val document=JSONObject("""{"version":1,"doc":{"type":"doc","content":[{"type":"blockquote","content":[{"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"第一行"},{"type":"hardBreak"},{"type":"text","text":"第二行"}]}]}]}]}]}}""")
        val text=RecordCodec.decode(document);assertEquals(document.toString(),RecordCodec.encode(text).toString())
        text.replace(0,1,"首");val encoded=RecordCodec.encode(text).getJSONObject("doc").getJSONArray("content").getJSONObject(0)
        assertEquals("blockquote",encoded.getString("type"));val list=encoded.getJSONArray("content").getJSONObject(0)
        assertEquals("orderedList",list.getString("type"));assertEquals(3,list.getJSONObject("attrs").getInt("start"))
        val leaf=list.getJSONArray("content").getJSONObject(0).getJSONArray("content").getJSONObject(0)
        assertTrue(leaf.getJSONArray("content").objects().any { it.optString("type")=="hardBreak" })
        assertTrue(leaf.toString().contains("首一行"))
    }
    @Test fun imageReferencesCannotEscapeTheRegisteredEntry() {
        val image=JSONObject().put("path","images/original.png");val files=listOf(image)
        assertEquals(image,documentImage(files,"summary.md","./images/original.png"))
        assertEquals(image,documentImage(files,"text/transcript.md","../images/original.png"))
        assertNull(documentImage(files,"summary.md","../../private.png"));assertNull(documentImage(files,null,"https://example.com/private.png"))
    }
    @Test fun fallbackOrderingUsesInstantsRatherThanTimezoneStrings() {
        val earlier=JSONObject().put("id","earlier").put("title","Ａ").put("collected_at","2026-10-17T09:00:00+08:00")
        val later=JSONObject().put("id","later").put("title","b").put("collected_at","2026-10-17T02:00:00Z")
        assertEquals("later",LibrarySelection.sorted(listOf(earlier,later),"collected_desc").first().getString("id"))
        assertEquals("earlier",LibrarySelection.sorted(listOf(later,earlier),"title").first().getString("id"))
    }
    @Test fun longMarkdownPreservesOutlineCodeAndTablesAsNativeNodes() {
        val parsed=MarkdownContent.parse("# 长篇中文\n\n"+"正文\n\n".repeat(2000)+"```java\nSystem.out.println(1);\n```\n\n| A | B |\n|---|---|\n| 中 | 文 |")
        assertEquals("长篇中文",parsed.headings.single().title)
        assertTrue(parsed.blocks.any { it is org.commonmark.ext.gfm.tables.TableBlock });assertTrue(parsed.blocks.any { it is org.commonmark.node.FencedCodeBlock })
    }
    @Test fun roomSeparatesServersAndPersistsFrozenPayloadJournalAndFiles() = runBlocking {
        val context=RuntimeEnvironment.getApplication();val db=Room.inMemoryDatabaseBuilder(context,NativeDatabase::class.java).build()
        try {
            val dao=db.dao();val id=UUID.randomUUID().toString();val payload="""{"requestId":"unchanged","baseVersion":7,"document":{"version":1}}"""
            dao.put(LocalRecord("https://a.example",id,JSONObject().put("payload",JSONObject(payload)).toString(),1))
            dao.put(LocalRecord("https://b.example",id,"{\"text\":\"different\"}",2))
            dao.journal(MigrationLog("legacy:a:$id","verified"));dao.file(RecordFile(id,"file", "{\"sha256\":\"original\"}","https://a.example"))
            assertEquals("unchanged",JSONObject(dao.record("https://a.example",id)!!.json).getJSONObject("payload").getString("requestId"))
            assertEquals("different",JSONObject(dao.record("https://b.example",id)!!.json).getString("text"))
            assertEquals("verified",dao.journal("legacy:a:$id")!!.json);assertEquals(1,dao.files(id,"https://a.example").size);assertEquals(0,dao.files(id,"https://b.example").size)
        }finally {db.close()}
    }
}
