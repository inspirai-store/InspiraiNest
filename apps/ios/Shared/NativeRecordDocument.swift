import Foundation

struct NativeRecordMark: Codable, Equatable, Hashable {
  var type: String
  var attrs: [String: NativeRecordJSON]? = nil
}
struct NativeRecordNode: Codable, Equatable, Hashable {
  var type: String
  var attrs: [String: NativeRecordJSON]? = nil
  var text: String? = nil
  var marks: [NativeRecordMark]? = nil
  var content: [NativeRecordNode]? = nil

  static func paragraph(_ text: String, type: String = "paragraph", level: Int? = nil) -> Self {
    .init(type: type, attrs: level.map { ["level": .number(Double($0))] },
      content: text.isEmpty ? [] : [.init(type: "text", text: text)])
  }
  var attachmentID: String? {
    guard type == "attachment", case .string(let id) = attrs?["attachmentId"] else { return nil }
    return id
  }
  // Mirrors the desktop plainText projection; links keep their destination.
  var plainText: String {
    if type == "attachment" { return "" }
    if type == "hardBreak" { return "\n" }
    if let text {
      if let mark = marks?.first(where: { $0.type == "link" }),
        case .string(let href) = mark.attrs?["href"], href != text {
        return text + " <" + href + ">"
      }
      return text
    }
    let separator = ["doc", "bulletList", "orderedList", "blockquote"].contains(type) ? "\n" : ""
    return (content ?? []).map(\.plainText).joined(separator: separator)
  }
  var referencedAttachments: Set<String> {
    var ids = Set((content ?? []).flatMap { $0.referencedAttachments })
    if let attachmentID { ids.insert(attachmentID) }
    return ids
  }
  func removingAttachment(_ id: String) -> Self {
    var copy = self
    copy.content = content?.filter { $0.attachmentID != id }.map { $0.removingAttachment(id) }
    return copy
  }
}
struct NativeRecordDocument: Codable, Equatable, Hashable {
  var version = 1
  var doc: NativeRecordNode
  static func plain(_ text: String, attachments: [NativeRecordAttachment] = []) -> Self {
    var content = text.components(separatedBy: "\n").map { NativeRecordNode.paragraph($0) }
    content += attachments.map { .init(type: "attachment", attrs: ["attachmentId": .string($0.id)]) }
    return .init(doc: .init(type: "doc", content: content))
  }
  init(version: Int = 1, doc: NativeRecordNode) { self.version = version; self.doc = doc }
  init(record: NativeRecord) throws {
    if let raw = record.document {
      self = try JSONDecoder().decode(Self.self, from: JSONEncoder().encode(raw))
      try validateStructure(attachments: record.attachments)
    } else { self = .plain(record.text, attachments: record.attachments) }
  }
  var plainText: String { doc.plainText }
  var hasContent: Bool { !plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !doc.referencedAttachments.isEmpty }
  func json() throws -> NativeRecordJSON {
    try JSONDecoder().decode(NativeRecordJSON.self, from: JSONEncoder().encode(self))
  }
  static func safeLink(_ input: String) -> URL? {
    guard let url = URL(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
      ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
      url.host?.isEmpty == false, url.user == nil, url.password == nil else { return nil }
    return url
  }
  func validateStructure(attachments: [NativeRecordAttachment]) throws {
    guard version == 1, doc.type == "doc" else { throw NativeRecordLocalError.invalidDocument }
    let kinds: Set<String> = ["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "blockquote", "hardBreak", "attachment"]
    let marks: Set<String> = ["bold", "italic", "strike", "code", "link", "underline"]
    let ids = Set(attachments.map(\.id)); var count = 0
    func visit(_ node: NativeRecordNode, _ depth: Int) throws {
      count += 1
      guard kinds.contains(node.type), depth < 32, count <= 10_000,
        (node.text?.utf16.count ?? 0) <= 50_000, (node.marks?.count ?? 0) <= 8 else { throw NativeRecordLocalError.invalidDocument }
      if node.type == "heading" {
        guard let level = node.attrs?["level"], [.number(1), .number(2)].contains(level) else { throw NativeRecordLocalError.invalidDocument }
      }
      if node.type == "attachment", !ids.contains(node.attachmentID ?? "") { throw NativeRecordLocalError.invalidDocument }
      for mark in node.marks ?? [] {
        guard marks.contains(mark.type) else { throw NativeRecordLocalError.invalidDocument }
        if mark.type == "link" {
          guard case .string(let href) = mark.attrs?["href"], Self.safeLink(href) != nil else { throw NativeRecordLocalError.invalidLink }
        }
      }
      for child in node.content ?? [] { try visit(child, depth + 1) }
    }
    try visit(doc, 0)
  }
  func validateForSave(attachments: [NativeRecordAttachment]) throws {
    guard plainText.utf16.count <= 50_000 else { throw NativeRecordLocalError.limit("正文 \(plainText.utf16.count) / 50,000") }
    try validateStructure(attachments: attachments)
    guard hasContent || !attachments.isEmpty else { throw NativeRecordLocalError.empty }
    let encoder = JSONEncoder(); encoder.outputFormatting = [.withoutEscapingSlashes]
    let serialized = String(decoding: try encoder.encode(self), as: UTF8.self)
    guard serialized.utf16.count <= 300_000 else { throw NativeRecordLocalError.limit("富文本内容超出容量限制") }
    guard attachments.count <= 20 else { throw NativeRecordLocalError.limit("附件 \(attachments.count) / 20 · 超出数量限制") }
    guard Set(attachments.map(\.id)).count == attachments.count else { throw NativeRecordLocalError.invalidDocument }
    var total: Int64 = 0
    for a in attachments {
      guard a.bytes >= 0, a.bytes <= 32 * 1024 * 1024 else { throw NativeRecordLocalError.limit(a.name + " · 超出 32 MiB") }
      total += Int64(a.bytes)
    }
    guard total <= 128 * 1024 * 1024 else { throw NativeRecordLocalError.limit("附件合计超出 128 MiB") }
  }
}

enum NativeRecordLocalError: LocalizedError, Equatable {
  case unavailable, diskFull, stale, retired, invalidDocument, invalidLink, empty
  case limit(String)
  var errorDescription: String? {
    switch self {
    case .unavailable: return "本机保存失败"
    case .diskFull: return "本机空间不足 · 保存未完成"
    case .stale: return "记录已在其他窗口修改 · 草稿已保留"
    case .retired: return "这份草稿已保存或放弃"
    case .invalidDocument: return "记录格式无法保存 · 原文已保留"
    case .invalidLink: return "请输入 http 或 https 链接"
    case .empty: return "记录内容为空"
    case .limit(let text): return text
    }
  }
}
