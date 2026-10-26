import Foundation
import Markdown
import SwiftUI

struct NativeMarkdownDocument {
  struct Heading: Identifiable, Equatable {
    let id: String
    let title: String
    let level: Int
    let line: Int
  }
  struct Block: Identifiable {
    enum Kind {
      case heading(Int)
      case paragraph
      case code(String?)
      case quote
      case list(String)
      case table([[String]])
      case rule, literal
    }
    let id: String
    let kind: Kind
    let text: String
    let inline: AttributedString?
    let children: [Block]
    let images: [(String, String)]
  }
  let blocks: [Block]
  let headings: [Heading]
  let original: String
  init(_ source: String) {
    original = source
    let document = Document(parsing: source)
    var outline: [Heading] = []
    var index = 0
    func plain(_ node: Markup) -> String {
      if let text = node as? Markdown.Text { return text.string }
      if let code = node as? InlineCode { return code.code }
      if let html = node as? InlineHTML { return html.rawHTML }
      if node is SoftBreak || node is LineBreak { return "\n" }
      return node.children.map(plain).joined()
    }
    func attributed(_ node: Markup) -> AttributedString {
      var value: AttributedString
      if node.childCount == 0 {
        value = AttributedString(plain(node))
      } else {
        value = node.children.reduce(into: AttributedString()) { $0 += attributed($1) }
      }
      let intent: InlinePresentationIntent =
        node is Strong
        ? .stronglyEmphasized
        : node is Emphasis
          ? .emphasized : node is Strikethrough ? .strikethrough : node is InlineCode ? .code : []
      if !intent.isEmpty {
        for (range, previous) in value.runs.map({ ($0.range, $0.inlinePresentationIntent ?? []) }) {
          value[range].inlinePresentationIntent = previous.union(intent)
        }
      }
      if let link = node as? Markdown.Link, let text = link.destination,
        let url = URL(string: text), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
        url.host != nil, url.user == nil, url.password == nil
      {
        value.link = url
      }
      if let link = node as? Markdown.Link, let target = link.destination,
        URL(string: target)?.scheme == nil, !target.hasPrefix("/")
      {
        var local = URLComponents()
        local.scheme = "lingnest-file"
        local.host = "attachment"
        local.queryItems = [.init(name: "source", value: target)]
        value.link = local.url
      }
      return value
    }
    func images(_ node: Markup) -> [(String, String)] {
      if let image = node as? Markdown.Image { return [(image.source ?? "", plain(image))] }
      return node.children.flatMap(images)
    }
    func make(_ node: Markup) -> Block {
      index += 1
      let id = "block-\(index)-line-\(node.range?.lowerBound.line ?? 0)"
      var kind: Block.Kind = .paragraph
      var text = plain(node)
      var children: [Block] = []
      if let h = node as? Markdown.Heading {
        kind = .heading(h.level)
        outline.append(
          .init(id: id, title: text, level: h.level, line: h.range?.lowerBound.line ?? 0))
      } else if let code = node as? CodeBlock {
        kind = .code(code.language)
        text = code.code
      } else if let html = node as? HTMLBlock {
        kind = .literal
        text = html.rawHTML
      } else if node is BlockQuote {
        kind = .quote
        children = node.children.map(make)
      } else if let list = node as? OrderedList {
        kind = .list("")
        children = list.children.enumerated().map { n, item in
          Block(
            id: id + "-\(n)", kind: .list("\(Int(list.startIndex) + n)."), text: "", inline: nil,
            children: item.children.map(make), images: [])
        }
      } else if node is UnorderedList {
        kind = .list("")
        children = node.children.enumerated().map { n, item in
          let checkbox = (item as? ListItem)?.checkbox
          return Block(
            id: id + "-\(n)", kind: .list(checkbox.map { $0 == .checked ? "☑" : "☐" } ?? "•"),
            text: "", inline: nil, children: item.children.map(make), images: [])
        }
      } else if let table = node as? Markdown.Table {
        kind = .table([table.head.cells.map(plain)] + table.body.rows.map { $0.cells.map(plain) })
      } else if node is ThematicBreak {
        kind = .rule
      } else if !(node is Paragraph) {
        children = node.children.map(make)
      }
      let decorated = node.children.contains {
        $0 is Strong || $0 is Emphasis || $0 is Markdown.Link || $0 is InlineCode
          || $0 is Strikethrough
      }
      return Block(
        id: id, kind: kind, text: text, inline: decorated ? attributed(node) : nil,
        children: children, images: images(node))
    }
    blocks = document.children.map(make)
    headings = outline
  }
}

struct NativeSubtitleCue: Identifiable, Equatable {
  let id: Int
  let timestamp: String
  let text: String
  static func parse(_ source: String) -> [Self] {
    source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n").enumerated()
      .compactMap { index, part in
        let lines = part.components(separatedBy: "\n")
        guard let timeIndex = lines.firstIndex(where: { $0.contains(" --> ") }),
          timeIndex + 1 < lines.count
        else { return nil }
        return .init(
          id: index, timestamp: lines[timeIndex].replacingOccurrences(of: " --> ", with: " → "),
          text: lines.dropFirst(timeIndex + 1).joined(separator: "\n"))
      }
  }
}
