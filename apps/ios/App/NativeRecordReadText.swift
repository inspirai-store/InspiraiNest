import SwiftUI
import UIKit
import CoreText

struct NativeRecordReadText:View {
  let node:NativeRecordNode
  var size:CGFloat=17
  var heading=false
  var lineHeight:CGFloat=28
  var width:CGFloat=353
  @ScaledMetric private var scale:CGFloat=1
  @Environment(\.colorScheme) private var scheme
  static func attributed(_ node:NativeRecordNode,size:CGFloat,heading:Bool,dark:Bool)->NSAttributedString {
    let result=NSMutableAttributedString(string:"")
    func append(_ node:NativeRecordNode) {
      if node.type == "hardBreak" {result.append(NSAttributedString(string:"\n"));return}
      if node.type == "attachment" {return}
      if let text=node.text {
        let marks=node.marks ?? []
        var font=marks.contains(where:{$0.type == "code"}) ? UIFont.monospacedSystemFont(ofSize:size,weight:.regular) : UIFont.systemFont(ofSize:size,weight:heading || marks.contains(where:{$0.type == "bold"}) ? .semibold : .regular)
        if marks.contains(where:{$0.type == "italic"}),let descriptor=font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.traitItalic)) {font=UIFont(descriptor:descriptor,size:size)}
        var attributes:[NSAttributedString.Key:Any]=[.font:font,.foregroundColor:UIColor(Color(hex:dark ? 0xF4F2EC : 0x1C1C1E))]
        if marks.contains(where:{$0.type == "strike"}) {attributes[.strikethroughStyle]=NSUnderlineStyle.single.rawValue}
        if marks.contains(where:{$0.type == "underline"}) {attributes[.underlineStyle]=NSUnderlineStyle.single.rawValue}
        if let link=marks.first(where:{$0.type == "link"}),case .string(let href)=link.attrs?["href"],let url=NativeRecordDocument.safeLink(href) {attributes[.link]=url;attributes[.foregroundColor]=UIColor(Color(hex:dark ? 0xF2A33A : 0xD97706))}
        result.append(NSAttributedString(string:text,attributes:attributes));return
      }
      for (index,child) in (node.content ?? []).enumerated() {
        if index > 0,["doc","blockquote","listItem"].contains(node.type) {result.append(NSAttributedString(string:"\n"))}
        append(child)
      }
    }
    append(node);return result
  }
  static func lines(_ value:NSAttributedString,width:CGFloat)->[NSAttributedString] {
    guard value.length > 0 else{return [NSAttributedString(string:"")]}
    let typesetter=CTTypesetterCreateWithAttributedString(value as CFAttributedString)
    var result:[NSAttributedString]=[],offset=0
    while offset < value.length {
      let suggested=CTTypesetterSuggestLineBreak(typesetter,offset,Double(max(1,width)))
      let count=suggested > 0 ? suggested : (value.string as NSString).rangeOfComposedCharacterSequence(at:offset).length
      let length=min(count,value.length-offset)
      var range=NSRange(location:offset,length:length)
      let source=value.string as NSString
      if range.length > 0,source.character(at:NSMaxRange(range)-1) == 10 {range.length -= 1}
      result.append(value.attributedSubstring(from:range));offset += length
    }
    return result
  }
  var body:some View {
    let value=Self.attributed(node,size:size*scale,heading:heading,dark:scheme == .dark)
    let lines=Self.lines(value,width:width)
    VStack(alignment:.leading,spacing:0) {
      ForEach(lines.indices,id:\.self) {index in
        let text=(try? AttributedString(lines[index],including:\.uiKit)) ?? AttributedString(lines[index].string)
        RecordTextLayout(size:size*scale,lineHeight:lineHeight*scale,weight:heading ? .semibold : .regular) {
          Text(text).lineLimit(1).fixedSize(horizontal:true,vertical:true).textSelection(.enabled)
        }.offset(y:(heading ? 0.5 : 1.5)*scale)
      }
    }.frame(width:width,alignment:.leading).accessibilityElement(children:.combine)
  }
}

struct NativeRecordTextFileContent:View {
  let text:String
  @ScaledMetric private var scale:CGFloat=1
  var body:some View {
    RecordTextLayout(size:16*scale,lineHeight:26*scale,weight:.regular) {
      Text(verbatim:text).font(.system(size:16*scale)).lineSpacing(max(0,42*scale-UIFont.systemFont(ofSize:16*scale).lineHeight)).fixedSize(horizontal:false,vertical:true)
    }
  }
}
