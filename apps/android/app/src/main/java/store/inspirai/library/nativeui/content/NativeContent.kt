package store.inspirai.library.nativeui.content

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.commonmark.parser.Parser
import org.commonmark.node.*
import org.commonmark.ext.gfm.tables.*
import org.json.JSONObject

data class HeadingItem(val index: Int,val title: String)
data class MarkdownContent(val blocks: List<Node>,val headings: List<HeadingItem>) {
    companion object {
        fun parse(text: String): MarkdownContent {
            val root=Parser.builder().extensions(listOf(TablesExtension.create())).build().parse(text)
            val blocks=root.children();return MarkdownContent(blocks,blocks.mapIndexedNotNull { i,n -> if(n is Heading)HeadingItem(i,n.plain()) else null })
        }
    }
}
fun Node.children(): List<Node> { val result=mutableListOf<Node>();var child=firstChild;while(child!=null){result+=child;child=child.next};return result }
private fun htmlText(html: String)=android.text.Html.fromHtml(html,android.text.Html.FROM_HTML_MODE_COMPACT).toString()
private fun Node.plain(): String = when(this) { is Text->literal;is Code->literal;is HtmlBlock->htmlText(literal);is HtmlInline->htmlText(literal);else->children().joinToString("") { it.plain() } }
val LocalMarkdownImage=staticCompositionLocalOf<(@Composable (String,String)->Unit)?> { null }
private fun Node.images(): List<Image> = children().flatMap { if(it is Image)listOf(it) else it.images() }
private fun Node.annotated(): AnnotatedString = buildAnnotatedString {
    fun add(node: Node) {
        when(node) {
            is Text -> append(node.literal)
            is SoftLineBreak, is HardLineBreak -> append('\n')
            is Code -> withStyle(SpanStyle(fontFamily=FontFamily.Monospace)) { append(node.literal) }
            is HtmlInline -> append(htmlText(node.literal))
            is HtmlBlock -> append(htmlText(node.literal))
            is StrongEmphasis -> withStyle(SpanStyle(fontWeight=FontWeight.Bold)) { node.children().forEach(::add) }
            is Emphasis -> withStyle(SpanStyle(fontStyle=FontStyle.Italic)) { node.children().forEach(::add) }
            is Link -> { pushStringAnnotation("url",node.destination);withStyle(SpanStyle(textDecoration=TextDecoration.Underline)) { node.children().forEach(::add) };pop() }
            is Image -> append("[图片：${node.plain()}]")
            else -> node.children().forEach(::add)
        }
    };add(this@annotated)
}
@Composable fun MarkdownBlock(node: Node, onImage: (String)->Unit={}) {
    val colors=MaterialTheme.colorScheme
    when(node) {
        is Heading -> Text(node.annotated(), style=if(node.level==1)MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleMedium,modifier=Modifier.padding(top=16.dp,bottom=8.dp))
        is FencedCodeBlock -> CodeBlock(node.literal)
        is IndentedCodeBlock -> CodeBlock(node.literal)
        is BlockQuote -> Row(Modifier.fillMaxWidth().background(colors.surfaceVariant).padding(16.dp)) {
            Column { node.children().forEach { MarkdownBlock(it,onImage) } }
        }
        is BulletList, is OrderedList -> Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
            node.children().forEachIndexed { index,item -> Row {
                Text(if(node is OrderedList) "${node.markerStartNumber+index}. " else "• ",style=MaterialTheme.typography.bodyLarge)
                Column(Modifier.weight(1f)) { item.children().forEach { MarkdownBlock(it,onImage) } }
            } }
        }
        is TableBlock -> {
            val rows=node.children().flatMap { it.children() };val columns=rows.maxOfOrNull { it.children().size }?:1
            Column(Modifier.horizontalScroll(rememberScrollState()).border(1.dp,colors.outlineVariant)) {
                rows.forEach { row -> Row {
                    row.children().forEach { cell -> Box(Modifier.width(if(columns<3)280.dp else 200.dp).border(0.5.dp,colors.outlineVariant).padding(12.dp)) {
                        Text(cell.annotated(),style=MaterialTheme.typography.bodyMedium)
                    } }
                } }
            }
        }
        is ThematicBreak -> HorizontalDivider(Modifier.padding(vertical=12.dp))
        else -> {
            val links=LocalUriHandler.current;val annotated=node.annotated()
            @Suppress("DEPRECATION")
            ClickableText(annotated,style=MaterialTheme.typography.bodyLarge.copy(color=colors.onSurface),modifier=Modifier.fillMaxWidth().padding(bottom=12.dp)) { offset ->
                annotated.getStringAnnotations("url",offset,offset).firstOrNull()?.item?.let {
                    if(it.startsWith("https://")||it.startsWith("http://"))runCatching { links.openUri(it) }
                }
            }
            node.images().forEach { image ->
                val renderer=LocalMarkdownImage.current
                if(renderer!=null)renderer(image.destination,image.plain()) else TextButton(onClick={onImage(image.destination)}) { Text("查看图片") }
            }
        }
    }
}
@Composable private fun CodeBlock(text: String) {
    Surface(shape=MaterialTheme.shapes.small,color=MaterialTheme.colorScheme.surfaceVariant) {
        SelectionContainer { Text(text.trimEnd(),fontFamily=FontFamily.Monospace,fontSize=14.sp,lineHeight=22.sp,
            modifier=Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(16.dp)) }
    }
}

@Composable fun RecordDocument(value: JSONObject, fallback: String) {
    val ink=MaterialTheme.colorScheme.onSurface.toArgbCompat()
    val link=MaterialTheme.colorScheme.secondary.toArgbCompat()
    val doc=value.optJSONObject("document")
    if(doc==null) { SelectionContainer { Text(fallback,style=MaterialTheme.typography.bodyLarge) };return }
    if(!RecordCodec.supported(doc)) { Text("此记录包含当前版本不支持的格式，原文已保留。");SelectionContainer { Text(fallback) };return }
    SelectionContainer { androidx.compose.ui.viewinterop.AndroidView(factory={context ->
        android.widget.TextView(context).apply { textSize=18f;setLineSpacing(0f,1.65f);setTextIsSelectable(true);movementMethod=android.text.method.LinkMovementMethod.getInstance() }
    },update={ view -> view.text=RecordCodec.decode(doc);view.setTextColor(ink);view.setLinkTextColor(link) },modifier=Modifier.fillMaxWidth()) }
}
fun androidx.compose.ui.graphics.Color.toArgbCompat(): Int = android.graphics.Color.argb((alpha*255).toInt(),(red*255).toInt(),(green*255).toInt(),(blue*255).toInt())
