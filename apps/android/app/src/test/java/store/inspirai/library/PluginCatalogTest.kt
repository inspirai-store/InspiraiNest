package store.inspirai.library
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
@org.junit.runner.RunWith(org.robolectric.RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk=[35])
class PluginCatalogTest {
 @Test fun sharedPluginContractKeepsCoreIndependentAndWritingOptional() {
  val input=javaClass.getResourceAsStream("/plugins.json")?:error("missing plugin fixture")
  val value=JSONObject(input.bufferedReader().use { it.readText() })
  assertEquals(1,value.getInt("protocol"));assertTrue(value.getJSONObject("enabled").getBoolean("ai-assistant"));assertFalse(value.getJSONObject("enabled").getBoolean("writing"))
  val rows=value.getJSONArray("plugins");val writing=(0 until rows.length()).map { rows.getJSONObject(it) }.first { it.getString("id")=="writing" }
  assertEquals("ai-assistant",writing.getJSONArray("dependencies").getString(0));assertTrue(writing.getJSONArray("platforms").toString().contains("android"))
 }
}
