import CryptoKit
import Foundation

struct ReadFile: Codable, Hashable, Identifiable, Sendable {
  let path: String
  let role: String?
  let bytes: Int
  let sha256: String
  var id: String { path }
  var name: String { (path as NSString).lastPathComponent }
  var suffix: String { (path as NSString).pathExtension.lowercased() }
  var isText: Bool {
    [
      "md", "markdown", "txt", "srt", "vtt", "json", "csv", "log", "swift", "py", "js", "html",
      "css", "yaml", "yml",
    ].contains(suffix)
  }
  var sizeLabel: String {
    if bytes >= 1_000_000 { return String(format: "%.1f MB", Double(bytes) / 1_000_000) }
    if bytes >= 1000 { return "\(Int((Double(bytes) / 1000).rounded())) KB" }
    return "\(bytes) B"
  }
  func validate() throws {
    guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"),
      !path.split(separator: "/", omittingEmptySubsequences: false).contains(where: {
        $0 == ".." || $0 == "." || $0.isEmpty
      }),
      bytes >= 0, bytes <= 16 * 1024 * 1024, Self.validDigest(sha256)
    else { throw ReaderFailure.integrity }
  }
  static func validDigest(_ value: String) -> Bool {
    value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
  }
  func verify(_ data: Data, header: String? = nil) throws {
    try validate()
    guard data.count == bytes, Self.digest(data) == sha256, header == nil || header == sha256 else {
      throw ReaderFailure.integrity
    }
  }
  static func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}

struct ReadDetail: Decodable, Sendable {
  let id: String
  let archiveID: String
  let title: String
  let summary: String?
  let type: String?
  let status: String?
  let sourceURL: String?
  let author: String?
  let publishedAt: String?
  let collectedAt: String?
  let verificationStatus: String?
  let coverageNote: String?
  let tags: [String]?
  let related: [String]?
  let files: [ReadFile]
  let omitted: [String]?
  enum CodingKeys: String, CodingKey {
    case id, title, summary, type, status, author, tags, related, files, omitted
    case archiveID = "archive_id"
    case sourceURL = "source_url"
    case publishedAt = "published_at"
    case collectedAt = "collected_at"
    case verificationStatus = "verification_status"
    case coverageNote = "coverage_note"
  }
  var entry: ReadEntry {
    .init(
      id: id, title: title, summary: summary, type: type, status: status, collectedAt: collectedAt,
      tags: tags, matches: nil)
  }
  var safeSource: URL? {
    guard let text = sourceURL, let url = URL(string: text),
      ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil, url.user == nil,
      url.password == nil
    else { return nil }
    return url
  }
  func validate(expectedID: String) throws {
    guard id == expectedID, ReadFile.validDigest(archiveID),
      Set(files.map(\.path)).count == files.count
    else { throw ReaderFailure.integrity }
    for file in files { try file.validate() }
  }
  var readableFiles: [ReadFile] { files.filter(\.isText) }
  func files(in category: ReaderCategory) -> [ReadFile] {
    files.filter { file in
      guard file.isText else { return false }
      switch category {
      case .report:
        return file.role == "summary" || file.role == "analysis"
          || ["summary.md", "analysis.md"].contains(file.path)
      case .source:
        return ["source", "original", "source_excerpt", "source_snapshot"].contains(file.role ?? "")
          || file.path.hasPrefix("source/")
      case .transcript:
        return ["transcript", "transcript_raw"].contains(file.role ?? "")
          || ["srt", "vtt"].contains(file.suffix)
          || file.path.hasPrefix("transcript/")
      case .scenario: return file.role == "scenario" || file.path.hasPrefix("scenarios/")
      case .attachments: return false
      }
    }
  }
  var categories: [ReaderCategory] {
    ReaderCategory.allCases.filter { $0 == .attachments || !files(in: $0).isEmpty }
  }
  var info: [(String, String)] {
    var values = [("资料", title)]
    if let url = safeSource { values.append(("来源", (url.host ?? "") + url.path)) }
    if let author, !author.isEmpty { values.append(("作者", author)) }
    if let publishedAt {
      let date = Self.day(publishedAt)
      if !date.isEmpty { values.append(("发表日期", date)) }
    }
    if !entry.dateLabel.isEmpty { values.append(("采集日期", entry.dateLabel)) }
    if let type, !type.isEmpty { values.append(("类型", LibraryTypes.label(type))) }
    if let status, !status.isEmpty { values.append(("完整度", entry.statusLabel)) }
    if let verificationStatus, !verificationStatus.isEmpty {
      values.append(
        (
          "核验程度",
          ["source_only": "仅总结来源", "cross_checked": "已交叉核验", "legacy_not_reverified": "历史资料未复核"][
            verificationStatus] ?? verificationStatus
        ))
    }
    if let coverageNote, !coverageNote.isEmpty { values.append(("覆盖情况", coverageNote)) }
    if let tags, !tags.isEmpty { values.append(("标签", tags.joined(separator: "、"))) }
    return values
  }
  static func day(_ value: String) -> String {
    ReadEntry(
      id: "", title: "", summary: nil, type: nil, status: nil, collectedAt: value, tags: nil,
      matches: nil
    ).dateLabel
  }
}

enum ReaderCategory: String, CaseIterable, Sendable {
  case report = "报告"
  case source = "原文"
  case transcript = "转录"
  case scenario = "场景"
  case attachments = "附件"
}
enum ReaderFailure: Error, Equatable {
  case integrity, changed, invalidText, unsupported
}
protocol LibraryReadingService: Sendable {
  func readDetail(id: String) async throws -> ReadDetail
  func readFile(entry: ReadDetail, file: ReadFile) async throws -> Data
  func readArchiveData(digest: String) async throws -> Data
}
