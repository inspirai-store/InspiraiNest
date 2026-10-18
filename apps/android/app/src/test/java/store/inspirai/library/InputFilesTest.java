package store.inspirai.library;
import android.content.*;
import android.net.Uri;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import store.inspirai.library.core.*;
import java.util.*;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=35)
public class InputFilesTest {
 @Test public void mixedShareReadsEveryTextAndDeduplicatesUris(){Uri a=Uri.parse("content://files/a"),b=Uri.parse("content://files/b");Intent intent=new Intent(Intent.ACTION_SEND_MULTIPLE).putExtra(Intent.EXTRA_TEXT,"正文");intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM,new ArrayList<>(Arrays.asList(a,b)));ClipData clip=ClipData.newPlainText("mixed","补充内容");clip.addItem(new ClipData.Item(a));clip.addItem(new ClipData.Item(Uri.parse("https://example.test/material")));intent.setClipData(clip);assertEquals("正文\n补充内容\nhttps://example.test/material",ShareActivity.sharedText(intent));assertEquals(Arrays.asList(a,b),ShareActivity.sharedUris(intent));assertFalse(ShareActivity.sharedText(intent).contains("content://"));}
 @Test public void singleStreamAndClipOnlyFilesWork(){Uri uri=Uri.parse("content://files/one");Intent single=new Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM,uri);assertEquals(Collections.singletonList(uri),ShareActivity.sharedUris(single));single.setClipData(ClipData.newRawUri("file",uri));assertEquals(1,ShareActivity.sharedUris(single).size());assertEquals("",ShareActivity.sharedText(single));}
 private JSONObject row(String name,long bytes)throws Exception{return new JSONObject().put("id",UUID.randomUUID().toString()).put("name",name).put("sha256","a".repeat(64)).put("bytes",bytes).put("mime",InputFiles.mime(name,null)).put("state","ready").put("selected",true);}
 @Test public void deselectedFailedFilesNeverEnterAgentInput()throws Exception{JSONObject failed=row("wrong.txt",10).put("state","error").put("selected",false);JSONArray selected=InputFiles.selected(new JSONArray().put(row("one.txt",20)).put(failed));assertEquals(1,selected.length());assertEquals("one.txt",selected.getJSONObject(0).getString("name"));failed.put("selected",true);try{InputFiles.selected(new JSONArray().put(failed));fail();}catch(java.io.IOException expected){assertTrue(expected.getMessage().contains("wrong.txt"));}}
 @Test public void limitsCountSameNameAsDistinctFiles()throws Exception{JSONArray rows=new JSONArray();for(int i=0;i<4;i++)rows.put(row("same.txt",InputFiles.FILE_LIMIT));assertEquals(4,InputFiles.selected(rows).length());rows.put(row("same.txt",1));try{InputFiles.selected(rows);fail();}catch(java.io.IOException expected){assertTrue(expected.getMessage().contains("128"));}JSONArray many=new JSONArray();for(int i=0;i<21;i++)many.put(row("same.txt",1));try{InputFiles.selected(many);fail();}catch(java.io.IOException expected){assertTrue(expected.getMessage().contains("20"));}}
 @Test public void supportedTypesAndUnsupportedVideoAreExplicit(){assertEquals("application/vnd.openxmlformats-officedocument.wordprocessingml.document",InputFiles.mime("中文.DOCX","application/octet-stream"));assertEquals("audio/webm",InputFiles.mime("voice.webm","audio/webm"));assertEquals("audio/wav",InputFiles.mime("录音.wav","audio/x-wav"));for(String name:new String[]{"old.doc","sheet.xlsx","slides.pptx","bundle.zip","movie.mp4"})assertNull(name,InputFiles.mime(name,"application/octet-stream"));assertNull(InputFiles.mime("movie.webm","video/webm"));}
 @Test public void originalNamesCannotEscapePrivateStorage()throws Exception{InputFiles inputs=new InputFiles(RuntimeEnvironment.getApplication());String id=UUID.randomUUID().toString();try{inputs.file(id,"../outside");fail();}catch(java.io.IOException expected){}JSONObject progress=new JSONObject().put("uploaded",new JSONObject().put("sha",true)).put("bytes",32);inputs.progress(id,progress);assertEquals(32,new InputFiles(RuntimeEnvironment.getApplication()).progress(id).getInt("bytes"));inputs.discard(id);}
}
