package store.inspirai.library.nativeui.content

import android.text.*
import android.text.Annotation
import android.text.style.*
import android.graphics.Typeface
import org.json.*

/** Version 1 document codec. Unknown nodes are never silently flattened by the editor. */
object RecordCodec {
    private val nodes=setOf("doc","paragraph","text","heading","bulletList","orderedList","listItem","blockquote","hardBreak","attachment")
    private val marks=setOf("bold","italic","strike","code","link","underline")
    fun supported(document: JSONObject): Boolean {
        if(document.optInt("version")!=1)return false
        fun check(node: JSONObject): Boolean {
            if(node.optString("type") !in nodes)return false
            val styles=node.optJSONArray("marks")
            if(styles!=null)for(i in 0 until styles.length())if(styles.optJSONObject(i)?.optString("type") !in marks)return false
            val children=node.optJSONArray("content") ?: return true
            return (0 until children.length()).all { children.optJSONObject(it)?.let(::check)==true }
        }
        return document.optJSONObject("doc")?.let(::check)==true
    }
    fun decode(document: JSONObject): SpannableStringBuilder {
        val out=SpannableStringBuilder()
        fun visit(node: JSONObject, block: String="paragraph",ancestors: List<JSONObject> = emptyList(),path: String="root") {
            val type=node.optString("type");val start=out.length
            when(type) {
                "text" -> {
                    out.append(node.optString("text"));val styles=node.optJSONArray("marks") ?: JSONArray()
                    for(i in 0 until styles.length()) { val style=styles.getJSONObject(i);val span: Any?=when(style.optString("type")) {
                        "bold"->StyleSpan(Typeface.BOLD);"italic"->StyleSpan(Typeface.ITALIC);"underline"->UnderlineSpan();"strike"->StrikethroughSpan();"code"->TypefaceSpan("monospace")
                        "link"->URLSpan(style.optJSONObject("attrs")?.optString("href")?:"");else->null
                    };if(span!=null && out.length>start)out.setSpan(span,start,out.length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
                }
                "hardBreak"->{out.append('\n');out.setSpan(Annotation("hardBreak","1"),start,out.length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)}
                "attachment"->{out.append('\uFFFC');out.setSpan(Annotation("attachment",node.toString()),start,out.length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)}
                else -> {
                    val children=node.optJSONArray("content") ?: JSONArray()
                    val childBlock=when(type){"bulletList","orderedList","blockquote"->type;else->block}
                    val chain=if(type in setOf("bulletList","orderedList","listItem","blockquote"))ancestors+JSONObject(node.toString()).apply { remove("content");put("identity",path) } else ancestors
                    for(i in 0 until children.length())visit(children.getJSONObject(i),childBlock,chain,"$path.$i")
                    if(type in setOf("paragraph","heading")) {
                        if(out.length==start)out.append('\u200B')
                        out.setSpan(Annotation("block",if(type=="heading")"heading${node.optJSONObject("attrs")?.optInt("level",1)}" else block),start,out.length,Spanned.SPAN_INCLUSIVE_INCLUSIVE)
                        out.setSpan(Annotation("structure",JSONObject().put("node",JSONObject(node.toString()).apply{remove("content")}).put("ancestors",JSONArray(ancestors)).toString()),start,out.length,Spanned.SPAN_INCLUSIVE_INCLUSIVE)
                        if(type=="heading")out.setSpan(HeadingAppearance(),start,out.length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        if(ancestors.any { it.optString("type") in setOf("orderedList","bulletList") })out.setSpan(BulletSpan(12),start,out.length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        if(ancestors.any { it.optString("type")=="blockquote" })out.setSpan(QuoteSpan(),start,out.length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        out.append('\n')
                    }
                }
            }
        }
        document.optJSONObject("doc")?.let { visit(it) }
        if(out.endsWith("\n"))out.delete(out.length-1,out.length)
        out.setSpan(Annotation("sourceDocument",document.toString()),0,out.length,Spanned.SPAN_INCLUSIVE_INCLUSIVE)
        return out
    }
    private class HeadingAppearance: MetricAffectingSpan() {
        override fun updateDrawState(paint: android.text.TextPaint) { paint.typeface=Typeface.create(paint.typeface,Typeface.BOLD);paint.textSize*=1.15f }
        override fun updateMeasureState(paint: android.text.TextPaint)=updateDrawState(paint)
    }
    fun setBlock(text: Spannable,start: Int,end: Int,block: String) {
        text.getSpans(start,end,Any::class.java).filter { it is Annotation&&it.key in setOf("block","structure") || it is HeadingAppearance || it is BulletSpan || it is QuoteSpan }.forEach { text.removeSpan(it) }
        text.setSpan(Annotation("block",block),start,end,Spanned.SPAN_INCLUSIVE_INCLUSIVE)
        when(block) {
            "heading1","heading2"->text.setSpan(HeadingAppearance(),start,end,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            "bulletList","orderedList"->text.setSpan(BulletSpan(12),start,end,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            "blockquote"->text.setSpan(QuoteSpan(),start,end,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }
    private fun signature(text: Spanned): String = buildString {
        append(text.toString())
        text.getSpans(0,text.length,Any::class.java).mapNotNull { span->
            val value=when(span) {
                is Annotation->if(span.key in setOf("attachment","block","structure","hardBreak"))"${span.key}:${span.value}" else null
                is StyleSpan->"style:${span.style}";is URLSpan->"url:${span.url}";is UnderlineSpan->"underline";is StrikethroughSpan->"strike";is TypefaceSpan->"font:${span.family}";else->null
            }
            value?.let { "${text.getSpanStart(span)}:${text.getSpanEnd(span)}:$it" }
        }.sorted().forEach { append('|').append(it) }
    }
    fun encode(text: Spanned): JSONObject {
        text.getSpans(0,text.length,Annotation::class.java).firstOrNull { it.key=="sourceDocument" }?.let { source ->
            val original=JSONObject(source.value)
            if(signature(text)==signature(decode(original)))return original
        }
        val blocks=JSONArray();var start=0
        val containers=mutableMapOf<String,JSONObject>()
        while(start<=text.length) {
            var end=start
            while(end<text.length) { if(text[end]=='\n'&&text.getSpans(end,end+1,Annotation::class.java).none { it.key=="hardBreak"&&text.getSpanStart(it)==end })break;end++ }
            val content=JSONArray();var position=start
            while(position<end) {
                val attachment=text.getSpans(position,position+1,Annotation::class.java).firstOrNull { it.key=="attachment" }
                if(attachment!=null && text[position]=='\uFFFC') { content.put(JSONObject(attachment.value));position++;continue }
                if(text[position]=='\n') { content.put(JSONObject().put("type","hardBreak"));position++;continue }
                var next=text.nextSpanTransition(position,end,CharacterStyle::class.java)
                val lineAt=text.toString().indexOf('\n',position);if(lineAt in (position+1) until next)next=lineAt
                val objectAt=text.toString().indexOf('\uFFFC',position);if(objectAt in (position+1) until next)next=objectAt
                if(next<=position)next=position+1
                val literal=text.subSequence(position,next).toString().replace("\u200B","")
                if(literal.isNotEmpty()) {
                    val styles=JSONArray()
                    for(span in text.getSpans(position,next,CharacterStyle::class.java)) {
                        when(span) {
                            is StyleSpan->{if(span.style and Typeface.BOLD!=0)styles.put(JSONObject().put("type","bold"));if(span.style and Typeface.ITALIC!=0)styles.put(JSONObject().put("type","italic"))}
                            is UnderlineSpan->styles.put(JSONObject().put("type","underline"))
                            is StrikethroughSpan->styles.put(JSONObject().put("type","strike"))
                            is TypefaceSpan->styles.put(JSONObject().put("type","code"))
                            is URLSpan->styles.put(JSONObject().put("type","link").put("attrs",JSONObject().put("href",span.url)))
                        }
                    }
                    content.put(JSONObject().put("type","text").put("text",literal).apply { if(styles.length()>0)put("marks",styles) })
                }
                position=next
            }
            val annotations=text.getSpans(start,end.coerceAtLeast(start),Annotation::class.java).filter { text.getSpanStart(it)<=start && text.getSpanEnd(it)>=end }
            val block=annotations.lastOrNull { it.key=="block" }?.value?:"paragraph"
            val structure=annotations.firstOrNull { it.key=="structure" }?.let { JSONObject(it.value) }
            val paragraph=structure?.optJSONObject("node")?.let { JSONObject(it.toString()) }?:JSONObject()
            paragraph.put("type",if(block.startsWith("heading"))"heading" else "paragraph").put("content",content)
            if(block.startsWith("heading"))paragraph.put("attrs",JSONObject().put("level",block.last().digitToIntOrNull()?.coerceIn(1,2)?:1))
            val ancestors=structure?.optJSONArray("ancestors")?:JSONArray()
            if(ancestors.length()>0) {
                var parent=blocks
                for(i in 0 until ancestors.length()) {
                    val ancestor=ancestors.getJSONObject(i);val identity=ancestor.getString("identity")
                    val container=containers.getOrPut(identity) { JSONObject(ancestor.toString()).apply { remove("identity");put("content",JSONArray());parent.put(this) } }
                    parent=container.getJSONArray("content")
                }
                parent.put(paragraph)
            } else blocks.put(when(block) {
                "bulletList","orderedList"->JSONObject().put("type",block).put("content",JSONArray().put(JSONObject().put("type","listItem").put("content",JSONArray().put(paragraph))))
                "blockquote"->JSONObject().put("type",block).put("content",JSONArray().put(paragraph))
                else->paragraph
            })
            if(end==text.length)break;start=end+1
        }
        return JSONObject().put("version",1).put("doc",JSONObject().put("type","doc").put("content",blocks))
    }
}
