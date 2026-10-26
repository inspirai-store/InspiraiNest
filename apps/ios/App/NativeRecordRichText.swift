import SwiftUI
import UIKit

private extension NSAttributedString.Key {
  static let recordBlock = Self("Lingnest.Record.Block")
  static let recordMarks = Self("Lingnest.Record.Marks")
  static let recordPrefix = Self("Lingnest.Record.Prefix")
}
struct RecordRichAncestor: Codable, Equatable {
  var id: String
  var type: String
  var attrs: [String: NativeRecordJSON]?
}
struct RecordRichBlock: Codable, Equatable {
  var type: String
  var attrs: [String: NativeRecordJSON]?
  var ancestors: [RecordRichAncestor]
  var ordinal = 1
  var list: String? { ancestors.last(where: { ["bulletList", "orderedList"].contains($0.type) })?.type }
  var heading: Int {
    if type == "heading", case .number(let level) = attrs?["level"] { return Int(level) }
    return 0
  }
  static let paragraph = Self(type: "paragraph", ancestors: [])
}
enum RecordRichAction: String, CaseIterable {
  case paragraph, heading1, heading2, bold, italic, bullet, ordered, quote, link, clear
}

@MainActor enum NativeRecordRichCodec {
  private static func data<T: Encodable>(_ value: T) -> Data { (try? JSONEncoder().encode(value)) ?? Data() }
  static func block(_ text: NSAttributedString, at position: Int) -> RecordRichBlock {
    guard text.length > 0, let value = text.attribute(.recordBlock, at: min(max(position, 0), text.length - 1), effectiveRange: nil) as? Data,
      let block = try? JSONDecoder().decode(RecordRichBlock.self, from: value) else { return .paragraph }
    return block
  }
  static func marks(_ attributes: [NSAttributedString.Key: Any]) -> [NativeRecordMark] {
    if let raw = attributes[.recordMarks] as? Data, let result = try? JSONDecoder().decode([NativeRecordMark].self, from: raw) { return result }
    var result: [NativeRecordMark] = []
    if let font = attributes[.font] as? UIFont {
      if font.fontDescriptor.symbolicTraits.contains(.traitBold) { result.append(.init(type: "bold")) }
      if font.fontDescriptor.symbolicTraits.contains(.traitItalic) { result.append(.init(type: "italic")) }
    }
    if let value = attributes[.link] {
      let href = (value as? URL)?.absoluteString ?? (value as? String) ?? ""
      if NativeRecordDocument.safeLink(href) != nil { result.append(.init(type: "link", attrs: ["href": .string(href)])) }
    }
    if (attributes[.underlineStyle] as? Int ?? 0) != 0 { result.append(.init(type: "underline")) }
    if (attributes[.strikethroughStyle] as? Int ?? 0) != 0 { result.append(.init(type: "strike")) }
    return result
  }
  static func render(_ document: NativeRecordDocument, width: CGFloat, tablet: Bool, dark: Bool, scale: CGFloat,
    attachmentImage: ((String, CGSize) -> UIImage?)? = nil, captions: [String: String] = [:]) -> NSAttributedString {
    var leaves: [(NativeRecordNode, RecordRichBlock)] = []
    func visit(_ node: NativeRecordNode, _ ancestors: [RecordRichAncestor], _ path: String, _ ordinal: Int = 1) {
      if ["paragraph", "heading", "attachment"].contains(node.type) {
        leaves.append((node, .init(type: node.type, attrs: node.attrs, ancestors: ancestors, ordinal: ordinal)))
      } else {
        let next = node.type == "doc" ? ancestors : ancestors + [.init(id: path, type: node.type, attrs: node.attrs)]
        for (index, child) in (node.content ?? []).enumerated() {
          let start: Int
          if case .number(let value) = node.attrs?["start"] { start = Int(value) } else { start = 1 }
          visit(child, next, path + ".\(index)", node.type == "orderedList" ? start + index : ordinal)
        }
      }
    }
    visit(document.doc, [], "doc")
    if leaves.isEmpty { leaves = [(.paragraph(""), .paragraph)] }
    let result = NSMutableAttributedString(string: "")
    for (index, pair) in leaves.enumerated() {
      let (node, block) = pair
      let next = index + 1 < leaves.count ? leaves[index + 1].1 : nil
      let style = NSMutableParagraphStyle()
      let size: CGFloat = block.heading == 1 ? 26 : block.heading == 2 ? 20 : 17
      let height: CGFloat = block.heading == 1 ? 37 : block.heading == 2 ? 29 : block.list == nil ? 28 : 25
      style.minimumLineHeight = height * scale; style.maximumLineHeight = height * scale
      if block.heading == 1 { style.paragraphSpacing = 15 * scale }
      else if block.heading == 2 { style.paragraphSpacing = (tablet ? 10 : 8) * scale }
      else if block.list != nil { style.paragraphSpacing = (next?.type == "attachment" ? (tablet ? 28 : 11) : (tablet ? 9 : 5)) * scale }
      else { style.paragraphSpacing = (next?.heading == 2 ? 46 : 14) * scale }
      if block.list != nil {
        let depth = max(1, block.ancestors.filter { ["bulletList", "orderedList"].contains($0.type) }.count)
        style.firstLineHeadIndent = CGFloat(depth - 1) * 18 * scale
        style.headIndent = CGFloat(depth) * 18 * scale
        style.tabStops = [.init(textAlignment: .left, location: style.headIndent)]
      } else if block.ancestors.contains(where: { $0.type == "blockquote" }) {
        style.firstLineHeadIndent = 16 * scale; style.headIndent = 16 * scale
      }
      let base: [NSAttributedString.Key: Any] = [.recordBlock: data(block), .paragraphStyle: style]
      func attributes(_ marks: [NativeRecordMark], fontSize: CGFloat = 0) -> [NSAttributedString.Key: Any] {
        var attrs = base
        var font = UIFont.systemFont(ofSize: (fontSize == 0 ? size : fontSize) * scale,
          weight: block.heading > 0 || marks.contains(where: { $0.type == "bold" }) ? .semibold : .regular)
        if marks.contains(where: { $0.type == "code" }) { font = .monospacedSystemFont(ofSize: size * scale, weight: .regular) }
        if marks.contains(where: { $0.type == "italic" }), let descriptor = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.traitItalic)) { font = UIFont(descriptor: descriptor, size: font.pointSize) }
        attrs[.font] = font; attrs[.foregroundColor] = UIColor(dark ? Color(hex: 0xF4F2EC) : Color(hex: 0x1C1C1E))
        attrs[.recordMarks] = data(marks)
        attrs[.baselineOffset] = -size * scale * 0.14
        if marks.contains(where: { $0.type == "underline" }) { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        if marks.contains(where: { $0.type == "strike" }) { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        if let link = marks.first(where: { $0.type == "link" }), case .string(let href) = link.attrs?["href"], let url = NativeRecordDocument.safeLink(href) { attrs[.link] = url }
        return attrs
      }
      if let list = block.list {
        var prefix = attributes([], fontSize: list == "bulletList" ? 20 : 17)
        if list == "bulletList" {
          prefix[.baselineOffset]=1*scale
          style.firstLineHeadIndent -= 3*scale
        }
        prefix[.recordPrefix] = true
        prefix[.foregroundColor] = UIColor(dark ? Color(hex: 0xABA9A2) : Color(hex: 0x6C6C70))
        result.append(.init(string: list == "bulletList" ? "•\t" : "\(block.ordinal).\t", attributes: prefix))
      }
      if node.type == "attachment" {
        let id = node.attachmentID ?? ""
        let h: CGFloat = tablet ? 196 : 86
        let attachment = NSTextAttachment()
        let image=attachmentImage?(id,.init(width:width,height:h))
        attachment.image = image ?? attachmentPlaceholder(width: width, height: 68, dark: dark)
        attachment.bounds = .init(x: 0, y: -3, width: width, height: image == nil ? 68 : h)
        let item = NSMutableAttributedString(attachment: attachment)
        let flexible = NSMutableParagraphStyle(); flexible.lineSpacing = 8; flexible.paragraphSpacing = 14
        var a = attributes([]); a[.paragraphStyle] = flexible; a[.baselineOffset] = 0
        item.addAttributes(a, range: NSRange(location: 0, length: item.length)); result.append(item)
        if let caption = captions[id] {
          var captionAttributes = a
          captionAttributes[.font] = UIFont.systemFont(ofSize: 12 * scale)
          captionAttributes[.baselineOffset] = -5.5*scale
          captionAttributes[.foregroundColor] = UIColor(dark ? Color(hex: 0xABA9A2) : Color(hex: 0x6C6C70))
          result.append(.init(string: "\u{2028}" + caption, attributes: captionAttributes))
        }
      } else {
        func inline(_ item: NativeRecordNode) {
          if item.type == "hardBreak" { result.append(.init(string: "\u{2028}", attributes: attributes(item.marks ?? []))) }
          else if let text = item.text { result.append(.init(string: text, attributes: attributes(item.marks ?? []))) }
          else { (item.content ?? []).forEach(inline) }
        }
        (node.content ?? []).forEach(inline)
      }
      if index < leaves.count - 1 { result.append(.init(string: "\n", attributes: attributes([]))) }
    }
    return result
  }
  private static func attachmentPlaceholder(width: CGFloat, height: CGFloat, dark: Bool) -> UIImage {
    UIGraphicsImageRenderer(size: .init(width: width, height: height)).image { _ in
      UIColor(dark ? Color(hex: 0x232321) : .white).setFill()
      UIBezierPath(roundedRect: .init(x: 0, y: 0, width: width, height: height), cornerRadius: 12).fill()
      UIImage(systemName: "doc")?.withTintColor(UIColor(Color(hex: 0xD97706)), renderingMode: .alwaysOriginal).draw(in: .init(x: 16, y: 21, width: 23, height: 26))
    }
  }
  static func document(_ text: NSAttributedString, emptyBlock: RecordRichBlock = .paragraph) -> NativeRecordDocument {
    final class Branch {
      var node: NativeRecordNode; var children: [Branch] = []
      init(_ node: NativeRecordNode) { self.node = node }
      func value() -> NativeRecordNode { var result = node; if !children.isEmpty { result.content = children.map { $0.value() } }; return result }
    }
    let root = Branch(.init(type: "doc", content: [])); var stack: [(String, Branch)] = []
    let raw = text.string as NSString
    var offset = 0
    repeat {
      let newline = raw.range(of: "\n", range: .init(location: offset, length: raw.length - offset))
      let range = NSRange(location: offset, length: newline.location == NSNotFound ? raw.length - offset : newline.location - offset + 1)
      let meta = raw.length == 0 ? emptyBlock : block(text, at: offset)
      var common = 0
      while common < stack.count, common < meta.ancestors.count, stack[common].0 == meta.ancestors[common].id { common += 1 }
      stack = Array(stack.prefix(common))
      for a in meta.ancestors.dropFirst(common) {
        let branch = Branch(.init(type: a.type, attrs: a.attrs, content: []))
        (stack.last?.1 ?? root).children.append(branch); stack.append((a.id, branch))
      }
      var node = NativeRecordNode(type: meta.type, attrs: meta.attrs, content: [])
      if meta.type != "attachment" {
        var end = NSMaxRange(range)
        if end > range.location, raw.substring(with: .init(location: end - 1, length: 1)) == "\n" { end -= 1 }
        let contentRange = NSRange(location: range.location, length: max(0, end - range.location))
        if contentRange.length > 0 {
          text.enumerateAttributes(in: contentRange) { attrs, run, _ in
            guard attrs[.recordPrefix] as? Bool != true else { return }
            let m = marks(attrs)
            let parts = raw.substring(with: run).components(separatedBy: "\u{2028}")
            for (i, part) in parts.enumerated() {
              if i > 0 { node.content?.append(.init(type: "hardBreak")) }
              guard !part.isEmpty else { continue }
              if let last = node.content?.last, last.type == "text", (last.marks ?? []) == m {
                node.content![node.content!.count - 1].text = (last.text ?? "") + part
              } else { node.content?.append(.init(type: "text", text: part, marks: m.isEmpty ? nil : m)) }
            }
          }
        }
      } else { node.content = nil }
      (stack.last?.1 ?? root).children.append(Branch(node))
      offset = NSMaxRange(range)
      if range.length == 0 { break }
    } while offset < raw.length
    if raw.length > 0, raw.substring(from: raw.length - 1) == "\n" { root.children.append(Branch(.paragraph(""))) }
    return .init(doc: root.value())
  }
  static func setBlock(_ block: RecordRichBlock, on text: NSMutableAttributedString, range: NSRange) {
    text.addAttribute(.recordBlock, value: data(block), range: range)
  }
  static func setMarks(_ marks: [NativeRecordMark], on text: NSMutableAttributedString, range: NSRange) {
    text.addAttribute(.recordMarks, value: data(marks), range: range)
  }
  static func semanticOffset(_ text:NSAttributedString,at native:Int) -> Int {
    var result=0
    text.enumerateAttributes(in:.init(location:0,length:min(max(0,native),text.length))) { attrs,range,_ in
      if attrs[.recordPrefix] as? Bool != true { result += range.length }
    }
    return result
  }
  static func nativeOffset(_ text:NSAttributedString,at semantic:Int) -> Int {
    var remaining=max(0,semantic),result=0
    text.enumerateAttributes(in:.init(location:0,length:text.length)) { attrs,range,stop in
      if attrs[.recordPrefix] as? Bool == true { result=NSMaxRange(range);return }
      if remaining <= range.length { result=range.location+remaining;stop.pointee=true }
      else { remaining -= range.length;result=NSMaxRange(range) }
    }
    return result
  }
  static func edgeBlock(_ document: NativeRecordDocument, last: Bool) -> RecordRichBlock {
    var node = document.doc, path = "doc", ancestors: [RecordRichAncestor] = [], ordinal = 1
    while !["paragraph","heading","attachment"].contains(node.type), let children = node.content, !children.isEmpty {
      if node.type != "doc" { ancestors.append(.init(id:path,type:node.type,attrs:node.attrs)) }
      let index = last ? children.count - 1 : 0
      if node.type == "orderedList" { if case .number(let start) = node.attrs?["start"] { ordinal=Int(start)+index } else { ordinal=index+1 } }
      node=children[index];path += ".\(index)"
    }
    return .init(type:node.type == "doc" ? "paragraph" : node.type,attrs:node.attrs,ancestors:ancestors,ordinal:ordinal)
  }
  static func typingAttributes(_ block: RecordRichBlock, marks: [NativeRecordMark] = [], width: CGFloat, tablet: Bool, dark: Bool, scale: CGFloat) -> [NSAttributedString.Key:Any] {
    var node=NativeRecordNode(type:block.type == "attachment" ? "paragraph" : block.type,attrs:block.attrs,content:[.init(type:"text",text:" ",marks:marks)])
    for a in block.ancestors.reversed() { node = .init(type:a.type,attrs:a.attrs,content:[node]) }
    let rendered=render(.init(doc:.init(type:"doc",content:[node])),width:width,tablet:tablet,dark:dark,scale:scale)
    var attrs=rendered.attributes(at:max(0,rendered.length-1),effectiveRange:nil)
    attrs[.recordBlock]=data(block);attrs.removeValue(forKey:.recordPrefix)
    return attrs
  }
}

@MainActor
final class NativeRecordRichController: NSObject, ObservableObject, UITextViewDelegate {
  weak var textView: UITextView?
  @Published var selection = NSRange(location: 0, length: 0)
  @Published var currentBlock = RecordRichBlock.paragraph
  @Published var currentMarks: [NativeRecordMark] = []
  var width: CGFloat = 353; var tablet = false; var dark = false; var scale: CGFloat = 1
  var lastDocument = NativeRecordDocument.plain("")
  var changed: ((NativeRecordDocument) -> Void)?
  var compositionChanged: ((Bool) -> Void)?
  var removeAttachment: ((String) -> Void)?
  var previewAttachment: ((String) -> Void)?
  var image: ((String, CGSize) -> UIImage?)?
  var captions: [String:String] = [:]
  private(set) var loaded = false
  var editable = true
  private var updating = false
  private var typingOverride: (Int,[NativeRecordMark])?
  func load(_ document: NativeRecordDocument, preserveSelection: Bool = true) {
    guard let view = textView else { return }
    let old = selection
    updating = true
    view.attributedText = NativeRecordRichCodec.render(document, width: width, tablet: tablet, dark: dark, scale: scale, attachmentImage: image, captions:captions)
    lastDocument = document
    view.selectedRange = .init(location: min(old.location, view.attributedText.length), length: min(old.length, max(0, view.attributedText.length - old.location)))
    if view.attributedText.length == 0 {
      let block = NativeRecordRichCodec.edgeBlock(document,last:true)
      view.typingAttributes = NativeRecordRichCodec.typingAttributes(block,width:width,tablet:tablet,dark:dark,scale:scale)
    }
    loaded = true; updating = false
    DispatchQueue.main.async { [weak self,weak view] in if let self,let view { self.textViewDidChangeSelection(view) } }
  }
  func textViewDidChange(_ textView: UITextView) {
    guard !updating else { return }
    compositionChanged?(textView.markedTextRange != nil)
    guard textView.markedTextRange == nil else { return }
    let value = NativeRecordRichCodec.document(textView.attributedText, emptyBlock: currentBlock)
    lastDocument = value; changed?(value); textViewDidChangeSelection(textView)
  }
  func textViewDidChangeSelection(_ textView: UITextView) {
    guard !updating, textView.markedTextRange == nil else { return }
    if selection != textView.selectedRange { selection = textView.selectedRange }
    let block = selection.location == textView.attributedText.length && (textView.attributedText.length == 0 || textView.text.hasSuffix("\n"))
      ? NativeRecordRichCodec.edgeBlock(lastDocument,last:true) : NativeRecordRichCodec.block(textView.attributedText,at:selection.location)
    if currentBlock != block { currentBlock = block }
    if textView.attributedText.length > 0 {
      let position=min(max(0,selection.location-(selection.length == 0 ? 1 : 0)),textView.attributedText.length-1)
      var marks = NativeRecordRichCodec.marks(textView.attributedText.attributes(at: position, effectiveRange: nil))
      if let pending=typingOverride,pending.0 == selection.location,selection.length == 0 { marks=pending.1 }
      else { typingOverride=nil }
      if currentMarks != marks { currentMarks = marks }
    }
    if selection.length == 0 {
      textView.typingAttributes=NativeRecordRichCodec.typingAttributes(currentBlock,marks:currentMarks,width:width,tablet:tablet,dark:dark,scale:scale)
    }
  }
  func blur() { if let textView { textView.unmarkText();textViewDidChange(textView);textView.resignFirstResponder() } }
  func insertAttachments(_ ids:[String],followingText:String?=nil) {
    guard let view=textView,!ids.isEmpty else { return }
    let source=view.attributedText ?? NSAttributedString(string:"")
    let start=min(selection.location,source.length),end=min(NSMaxRange(selection),source.length)
    let before=source.attributedSubstring(from:.init(location:0,length:start))
    let after=source.attributedSubstring(from:.init(location:end,length:source.length-end))
    let leading=before.length == 0 ? [] : NativeRecordRichCodec.document(before).doc.content ?? []
    let trailing=after.length == 0 ? [NativeRecordNode.paragraph("")] : NativeRecordRichCodec.document(after).doc.content ?? []
    let nodes=ids.map { NativeRecordNode(type:"attachment",attrs:["attachmentId":.string($0)]) }
    let notes=followingText?.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty == false ? [NativeRecordNode.paragraph(followingText!)] : []
    let document=NativeRecordDocument(doc:.init(type:"doc",content:leading+nodes+notes+trailing))
    let rendered=NativeRecordRichCodec.render(document,width:width,tablet:tablet,dark:dark,scale:scale,attachmentImage:image,captions:captions)
    replace(rendered,selection:.init(location:rendered.length,length:0))
  }
  func focus() { guard editable else { return }; textView?.becomeFirstResponder() }
  func undo() { textView?.undoManager?.undo(); if let textView { textViewDidChange(textView) } }
  func redo() { textView?.undoManager?.redo(); if let textView { textViewDidChange(textView) } }
  private func replace(_ value: NSAttributedString, selection next: NSRange, registerUndo: Bool = true) {
    guard let view = textView else { return }
    let prior = view.attributedText.copy() as! NSAttributedString, priorSelection = view.selectedRange
    if registerUndo { view.undoManager?.registerUndo(withTarget: self) { target in target.replace(prior, selection: priorSelection) } }
    updating = true; view.textStorage.setAttributedString(value); view.selectedRange = next; updating = false
    textViewDidChange(view)
  }
  func perform(_ action: RecordRichAction) {
    guard editable, let view = textView else { return }
    let text = NSMutableAttributedString(attributedString: view.attributedText)
    let semanticStart=NativeRecordRichCodec.semanticOffset(text,at:selection.location)
    let semanticEnd=NativeRecordRichCodec.semanticOffset(text,at:NSMaxRange(selection))
    if [RecordRichAction.bold, .italic].contains(action) {
      var marks = selection.length == 0 ? NativeRecordRichCodec.marks(view.typingAttributes) : currentMarks
      if marks.contains(where: { $0.type == action.rawValue }) { marks.removeAll { $0.type == action.rawValue } } else { marks.append(.init(type: action.rawValue)) }
      if selection.length == 0 {
        view.typingAttributes = NativeRecordRichCodec.typingAttributes(currentBlock,marks:marks,width:width,tablet:tablet,dark:dark,scale:scale)
        currentMarks = marks;typingOverride=(selection.location,marks);return
      }
      var runs:[(NSRange,[NativeRecordMark])]=[]
      text.enumerateAttributes(in:selection) { attrs,range,_ in
        guard attrs[.recordPrefix] as? Bool != true else { return }
        runs.append((range,NativeRecordRichCodec.marks(attrs)))
      }
      let removing = !runs.isEmpty && runs.allSatisfy { $0.1.contains { $0.type == action.rawValue } }
      for (range,existing) in runs {
        var updated=existing.filter { $0.type != action.rawValue }
        if !removing { updated.append(.init(type:action.rawValue)) }
        NativeRecordRichCodec.setMarks(updated,on:text,range:range)
      }
    } else {
      let raw = text.string as NSString
      let range = raw.length == 0 ? NSRange(location: 0, length: 0) : raw.paragraphRange(for: selection)
      var position = range.location
      let containerID = UUID().uuidString
      repeat {
        let paragraph = raw.length == 0 ? .init(location: 0, length: 0) : raw.paragraphRange(for: .init(location: min(position, raw.length - 1), length: 0))
        var block = NativeRecordRichCodec.block(text, at: position)
        switch action {
        case .paragraph, .heading1, .heading2:
          block.type = action == .paragraph ? "paragraph" : "heading"
          block.attrs = action == .paragraph ? nil : ["level": .number(action == .heading1 ? 1 : 2)]
        case .bullet, .ordered:
          let type = action == .bullet ? "bulletList" : "orderedList"
          let removing = currentBlock.list == type
          block.ancestors.removeAll { ["bulletList", "orderedList", "listItem"].contains($0.type) }
          block.type="paragraph";block.attrs=nil
          if !removing { block.ancestors += [.init(id: containerID, type: type, attrs: nil), .init(id: UUID().uuidString, type: "listItem", attrs: nil)] }
        case .quote:
          if currentBlock.ancestors.contains(where: { $0.type == "blockquote" }) { block.ancestors.removeAll { $0.type == "blockquote" } }
          else { block.ancestors.append(.init(id: containerID, type: "blockquote", attrs: nil)) }
        case .clear:
          if block.type != "attachment" { block = .paragraph; NativeRecordRichCodec.setMarks([], on: text, range: paragraph) }
        default: break
        }
        if paragraph.length > 0 { NativeRecordRichCodec.setBlock(block, on: text, range: paragraph) }
        else { currentBlock = block }
        position = NSMaxRange(paragraph)
        if paragraph.length == 0 { break }
      } while position < NSMaxRange(range)
    }
    let document = NativeRecordRichCodec.document(text, emptyBlock: currentBlock)
    let rendered = NativeRecordRichCodec.render(document, width: width, tablet: tablet, dark: dark, scale: scale, attachmentImage: image,captions:captions)
    if rendered.length == 0 { currentBlock=NativeRecordRichCodec.edgeBlock(document,last:true) }
    let start=NativeRecordRichCodec.nativeOffset(rendered,at:semanticStart),end=NativeRecordRichCodec.nativeOffset(rendered,at:semanticEnd)
    replace(rendered, selection: .init(location:start,length:max(0,end-start)))
  }
  var selectedText: String { guard let view = textView, NSMaxRange(selection) <= view.attributedText.length else { return "" }; return (view.attributedText.string as NSString).substring(with: selection) }
  var selectedURL: String {
    guard let mark = currentMarks.first(where: { $0.type == "link" }), case .string(let href) = mark.attrs?["href"] else { return "" }; return href
  }
  var linkRange: NSRange? {
    guard let view=textView,view.attributedText.length>0 else { return nil }
    var range=NSRange(location:0,length:0)
    let index=min(max(0,selection.location-(selection.length == 0 ? 1 : 0)),view.attributedText.length-1)
    guard view.attributedText.attribute(.link,at:index,effectiveRange:&range) != nil else { return nil }
    return range
  }
  var linkDisplayText: String {
    guard let view=textView,let range=linkRange else { return selectedText }
    return (view.attributedText.string as NSString).substring(with:range)
  }
  func link(text label: String, href: String?) throws {
    guard editable, let view = textView else { return }
    if let href, NativeRecordDocument.safeLink(href) == nil { throw NativeRecordLocalError.invalidLink }
    let text = NSMutableAttributedString(attributedString: view.attributedText)
    var marks = currentMarks.filter { $0.type != "link" }
    if let href { marks.append(.init(type: "link", attrs: ["href": .string(href)])) }
    var range = selection
    if range.length == 0, let existing=linkRange { range=existing }
    if !label.isEmpty, label != selectedText {
      var attrs = view.typingAttributes
      if view.attributedText.length > 0 { attrs = view.attributedText.attributes(at: min(range.location, view.attributedText.length - 1), effectiveRange: nil) }
      text.replaceCharacters(in: range, with: NSAttributedString(string: label, attributes: attrs)); range.length = (label as NSString).length
    }
    NativeRecordRichCodec.setMarks(marks, on: text, range: range)
    let rendered = NativeRecordRichCodec.render(NativeRecordRichCodec.document(text), width: width, tablet: tablet, dark: dark, scale: scale, attachmentImage: image,captions:captions)
    replace(rendered, selection: .init(location: min(NSMaxRange(range), rendered.length), length: 0))
  }
  func textView(_ textView:UITextView,shouldInteractWith attachment:NSTextAttachment,in characterRange:NSRange,interaction:UITextItemInteraction)->Bool {
    let block=NativeRecordRichCodec.block(textView.attributedText,at:characterRange.location)
    if case .string(let id)=block.attrs?["attachmentId"] {blur();previewAttachment?(id)}
    return false
  }
  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    guard editable else { return false }
    if text.isEmpty,range.length == 1,range.location < textView.attributedText.length,
      textView.attributedText.attribute(.recordPrefix,at:range.location,effectiveRange:nil) as? Bool == true {
      textViewDidChangeSelection(textView)
      if let list=currentBlock.list { perform(list == "orderedList" ? .ordered : .bullet);return false }
    }
    if textView.attributedText.length > 0 {
      let block = NativeRecordRichCodec.block(textView.attributedText, at: range.location)
      if block.type == "attachment", case .string(let id) = block.attrs?["attachmentId"] {
        if range.length > 0 { removeAttachment?(id) }
        else {
          let result=NSMutableAttributedString(attributedString:textView.attributedText)
          let paragraph=(result.string as NSString).paragraphRange(for:range)
          let position=range.location == paragraph.location ? paragraph.location : NSMaxRange(paragraph)
          let before=position == paragraph.location
          let attrs=NativeRecordRichCodec.typingAttributes(.paragraph,width:width,tablet:tablet,dark:dark,scale:scale)
          let value=before ? text+"\n" : "\n"+text
          result.insert(.init(string:value,attributes:attrs),at:position)
          replace(result,selection:.init(location:position+(before ? (text as NSString).length : (value as NSString).length),length:0))
        }
        return false
      }
    }
    guard text == "\n", textView.markedTextRange == nil else { return true }
    let semantic=NativeRecordRichCodec.semanticOffset(textView.attributedText,at:range.location)+1
    let result = NSMutableAttributedString(attributedString: textView.attributedText)
    var block = NativeRecordRichCodec.block(result, at: range.location)
    if block.heading > 0 { block.type = "paragraph"; block.attrs = nil }
    if let index = block.ancestors.lastIndex(where: { $0.type == "listItem" }) { block.ancestors[index].id = UUID().uuidString }
    let paragraph = (result.string as NSString).paragraphRange(for: range)
    let visible = result.attributedSubstring(from: paragraph).string.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "•0123456789.")))
    if visible.isEmpty,let list=block.list {
      textViewDidChangeSelection(textView);perform(list == "orderedList" ? .ordered : .bullet);return false
    }
    if visible.isEmpty { block = .paragraph }
    var attrs = textView.typingAttributes
    if result.length > 0 { attrs = result.attributes(at: min(range.location, result.length - 1), effectiveRange: nil) }
    attrs.removeValue(forKey: .recordPrefix)
    result.replaceCharacters(in: range, with: NSAttributedString(string: "\n", attributes: attrs))
    let marker = NSMutableAttributedString(string: " ", attributes: attrs)
    NativeRecordRichCodec.setBlock(block, on: marker, range: .init(location: 0, length: 1))
    result.insert(marker, at: range.location + 1)
    var document = NativeRecordRichCodec.document(result)
    // The temporary space carries paragraph metadata through a trailing newline.
    func trimLast(_ node: inout NativeRecordNode) {
      guard var children = node.content, !children.isEmpty else { return }
      if children[children.count - 1].type == "text", children[children.count - 1].text == " " { children.removeLast() }
      else { trimLast(&children[children.count - 1]) }
      node.content = children
    }
    trimLast(&document.doc)
    let rendered = NativeRecordRichCodec.render(document, width: width, tablet: tablet, dark: dark, scale: scale, attachmentImage: image,captions:captions)
    replace(rendered, selection: .init(location:NativeRecordRichCodec.nativeOffset(rendered,at:semantic),length:0))
    textView.typingAttributes=NativeRecordRichCodec.typingAttributes(block,width:width,tablet:tablet,dark:dark,scale:scale)
    return false
  }
}

final class NativeRecordTextView:UITextView {
  override func caretRect(for position:UITextPosition) -> CGRect {
    var rect=super.caretRect(for:position)
    let font=(typingAttributes[.font] as? UIFont) ?? UIFont.systemFont(ofSize:17)
    let baseline=(typingAttributes[.baselineOffset] as? CGFloat) ?? 0
    rect.origin.y += -baseline + font.pointSize * 3 / 17
    rect.size.height=font.pointSize*1.25
    rect.size.width=1.25*min(1.5,max(1,font.pointSize/17))
    return rect
  }
  override func canPerformAction(_ action:Selector,withSender sender:Any?) -> Bool {
    if action == #selector(paste(_:)),UIPasteboard.general.hasImages { return false }
    return super.canPerformAction(action,withSender:sender)
  }
}
struct NativeRecordRichInput: UIViewRepresentable {
  @ObservedObject var controller: NativeRecordRichController
  let document: NativeRecordDocument
  let width: CGFloat
  let tablet: Bool
  let dark: Bool
  let scale: CGFloat
  let editable: Bool
  func makeUIView(context: Context) -> UITextView {
    let view = NativeRecordTextView(usingTextLayoutManager: false)
    view.backgroundColor = .clear; view.textContainerInset = .zero; view.textContainer.lineFragmentPadding = 0
    view.contentInsetAdjustmentBehavior = .never; view.keyboardDismissMode = .interactive
    view.autocorrectionType = .no; view.spellCheckingType = .no; view.allowsEditingTextAttributes = true
    view.tintColor = UIColor(Color(hex: dark ? 0xF2A33A : 0xD97706))
    view.linkTextAttributes=[.foregroundColor:view.tintColor as Any,.underlineStyle:NSUnderlineStyle.single.rawValue]
    view.accessibilityIdentifier = "record.editor.body"; view.accessibilityLabel = "记录正文"
    view.delegate = controller; controller.textView = view
    updateUIView(view, context: context)
    return view
  }
  func updateUIView(_ view: UITextView, context: Context) {
    let changedGeometry = controller.width != width || controller.dark != dark || controller.scale != scale
    controller.width = width; controller.tablet = tablet; controller.dark = dark; controller.scale = scale; controller.editable = editable
    view.isEditable = editable
    if changedGeometry || controller.lastDocument != document || !controller.loaded { controller.load(document) }
  }
}
