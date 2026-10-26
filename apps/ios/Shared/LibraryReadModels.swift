import Foundation

struct ReadMatch: Codable, Hashable, Sendable {
  let file: String
  let startLine: Int
  let endLine: Int
  let snippet: String
  enum CodingKeys: String, CodingKey {
    case file, snippet
    case startLine = "start_line"
    case endLine = "end_line"
  }
  var location: String { "\(file):\(startLine)" + (endLine > startLine ? "–\(endLine)" : "") }
}
struct ReadEntry: Codable, Hashable, Identifiable, Sendable {
  let id: String
  let title: String
  let summary: String?
  let type: String?
  let status: String?
  let collectedAt: String?
  let tags: [String]?
  let matches: [ReadMatch]?
  enum CodingKeys: String, CodingKey {
    case id, title, summary, type, status, tags, matches
    case collectedAt = "collected_at"
  }
  var typeLabel: String { LibraryTypes.label(type ?? "") }
  var statusLabel: String {
    switch status {
    case "archived": return "已归档"
    case "partial": return "待补齐"
    case "pending": return "待处理"
    default: return status ?? ""
    }
  }
  var collectedDate: Date? {
    guard let value = collectedAt else { return nil }
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = parser.date(from: value) ?? ISO8601DateFormatter().date(from: value) {
      return date
    }
    guard value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else {
      return nil
    }
    let day = DateFormatter()
    day.locale = Locale(identifier: "en_US_POSIX")
    day.timeZone = TimeZone(secondsFromGMT: 8 * 3600)
    day.dateFormat = "yyyy-MM-dd"
    day.isLenient = false
    guard let date = day.date(from: value), day.string(from: date) == value else { return nil }
    return date
  }
  var dateLabel: String {
    guard let date = collectedDate else { return "" }
    let output = DateFormatter()
    output.locale = Locale(identifier: "en_US_POSIX")
    output.timeZone = TimeZone(secondsFromGMT: 8 * 3600)
    output.dateFormat = "yyyy-MM-dd"
    return output.string(from: date)
  }
}
enum LibraryTypes {
  static let values = [
    "video", "article", "webpage", "document", "repository", "audio", "image", "note", "other",
  ]
  static let labels = ["视频", "文章", "网页", "文档", "代码仓库", "音频", "图片", "笔记", "其他"]
  static func label(_ value: String) -> String {
    values.firstIndex(of: value).map { labels[$0] } ?? value
  }
}
struct ReadIndex: Codable, Sendable {
  let complete: Bool
  let pending: Int
  let failed: Int
}
struct ReadPage: Codable, Sendable {
  let items: [ReadEntry]
  let total: Int
  let limit: Int
  let offset: Int
  let index: ReadIndex
}
struct ReadFacet: Codable, Hashable, Sendable {
  let value: String
  let count: Int
}
struct ReadCategories: Codable, Sendable {
  let total: Int
  let types: [ReadFacet]
  let tags: [ReadFacet]
  let statuses: [ReadFacet]
  let index: ReadIndex
  static let empty = Self(
    total: 0, types: [], tags: [], statuses: [], index: .init(complete: true, pending: 0, failed: 0)
  )
  static func from(_ entries: [ReadEntry]) -> Self {
    func facets(_ values: [String]) -> [ReadFacet] {
      Dictionary(grouping: values, by: { $0 }).map {
        ReadFacet(value: $0.key, count: $0.value.count)
      }.sorted { $0.value < $1.value }
    }
    return .init(
      total: entries.count, types: facets(entries.compactMap(\.type)),
      tags: facets(entries.flatMap { Set($0.tags ?? []) }),
      statuses: facets(entries.compactMap(\.status)),
      index: .init(complete: true, pending: 0, failed: 0))
  }
}
enum LibrarySort: String, CaseIterable, Sendable {
  case recent = "collected_desc"
  case earliest = "collected_asc"
  case title
  var label: String {
    switch self {
    case .recent: return "最近收集"
    case .earliest: return "最早收集"
    case .title: return "标题"
    }
  }
}
struct ReadQuery: Equatable, Sendable {
  var text = ""
  var type: String?
  var tag: String?
  var status: String?
  var sort: LibrarySort? = nil
  var ids: [String]?
  var offset = 0
  var limit = 40
  var path: String {
    var parts = URLComponents()
    parts.path =
      "/api/read/v1/"
      + (text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "entries" : "search")
    var items = [
      URLQueryItem(name: "limit", value: String(limit)),
      URLQueryItem(name: "offset", value: String(offset)),
    ]
    for (key, value) in [
      ("q", text.isEmpty ? nil : text), ("type", type), ("tag", tag), ("status", status),
      ("sort", sort?.rawValue),
    ] {
      if let value { items.append(URLQueryItem(name: key, value: value)) }
    }
    if let ids, let data = try? JSONEncoder().encode(ids.sorted()),
      let json = String(data: data, encoding: .utf8)
    {
      items.append(URLQueryItem(name: "ids", value: json))
    }
    parts.queryItems = items
    return parts.string ?? parts.path
  }
}
protocol LibraryReadService: Sendable {
  func readEntries(_ query: ReadQuery) async throws -> ReadPage
  func readCategories() async throws -> ReadCategories
}

/// Map compatibility-normalized hits back onto the original graphemes.
/// Snippets and location numbers remain untouched.
enum LibrarySearchHighlight {
  static func ranges(in text: String, query: String) -> [Range<String.Index>] {
    var normalized = ""
    var mapping: [(Range<Int>, Range<String.Index>)] = []
    for index in text.indices {
      let end = text.index(after: index)
      let value = String(text[index..<end]).precomposedStringWithCompatibilityMapping.lowercased()
      let start = normalized.utf16.count
      normalized += value
      mapping.append((start..<normalized.utf16.count, index..<end))
    }
    var result: [Range<String.Index>] = []
    let ns = normalized as NSString
    for term in query.precomposedStringWithCompatibilityMapping.lowercased().split(
      whereSeparator: \.isWhitespace)
    {
      var position = 0
      while position < ns.length {
        let range = ns.range(
          of: String(term), range: NSRange(location: position, length: ns.length - position))
        if range.location == NSNotFound { break }
        let hits = mapping.filter { $0.0.overlaps(range.location..<NSMaxRange(range)) }
        if let first = hits.first, let last = hits.last {
          result.append(first.1.lowerBound..<last.1.upperBound)
        }
        position = NSMaxRange(range)
      }
    }
    return result
  }
}
