package store.inspirai.library.nativeui.data

import org.json.JSONObject
import java.text.Normalizer
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

object LibrarySelection {
    fun sorted(entries: List<JSONObject>,order: String): List<JSONObject> {
        fun time(item: JSONObject)=runCatching{OffsetDateTime.parse(item.optString("collected_at")).toInstant()}.getOrElse { runCatching { Instant.parse(item.optString("collected_at")) }.getOrDefault(Instant.MIN) }
        return when(order) {
            "title"->entries.sortedWith(compareBy<JSONObject>{Normalizer.normalize(it.optString("title"),Normalizer.Form.NFKC).lowercase(Locale.ROOT)}.thenBy{it.optString("id")})
            "collected_asc"->entries.sortedWith(compareBy<JSONObject>{time(it)}.thenBy{it.optString("id")})
            else->entries.sortedWith(compareByDescending<JSONObject>{time(it)}.thenBy{it.optString("id")})
        }
    }
    fun typeLabel(type: String)=when(type.removeSuffix("s")){"article"->"文章";"video"->"视频";"webpage"->"网页";"document"->"文档";"repository","repositorie"->"代码库";"audio"->"音频";"image"->"图片";"note"->"笔记";"other"->"其他";else->type}
}
