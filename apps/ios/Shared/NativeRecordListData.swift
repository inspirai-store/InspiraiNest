import CryptoKit
import Foundation
import SQLite3

// The records collection is independent of share submissions and the outbox.
// These are read models. Editing and version submission are intentionally separate stages.
struct NativeRecordAttachment: Codable, Hashable, Identifiable, Sendable {
  let id: String
  let name: String
  let mime: String
  let bytes: Int
  let sha256: String
  var thumbnailSha256: String?
}
struct NativeRecordTaskSummary: Codable, Hashable, Identifiable, Sendable {
  let id: String
  let state: String
  var recordVersion: Int?
  var createdAt: String?
  var title: String? = nil
}
indirect enum NativeRecordJSON: Codable, Hashable, Sendable {
  case object([String: Self])
  case array([Self])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode([Self].self) {
      self = .array(v)
    } else {
      self = .object(try c.decode([String: Self].self))
    }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .string(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .object(let v): try c.encode(v)
    }
  }
}
enum NativeRecordSync: String, Codable, Hashable, Sendable {
  case pending, syncing, synced, failed, conflict
  var title: String {
    switch self {
    case .pending: return "待同步"
    case .syncing: return "同步中"
    case .synced: return "已同步"
    case .failed: return "同步失败"
    case .conflict: return "版本冲突"
    }
  }
}
struct NativeRecord: Codable, Hashable, Identifiable, Sendable {
  let id: String
  var text: String
  var attachments: [NativeRecordAttachment]
  var version: Int
  var createdAt: String
  var updatedAt: String?
  var document: NativeRecordJSON?
  var tasks: [NativeRecordTaskSummary]
  var sync: NativeRecordSync
  var summary: String?
  init(
    id: String, text: String, attachments: [NativeRecordAttachment] = [], version: Int = 1,
    createdAt: String, updatedAt: String? = nil, document: NativeRecordJSON? = nil,
    tasks: [NativeRecordTaskSummary] = [], sync: NativeRecordSync = .synced, summary: String? = nil
  ) {
    self.id = id
    self.text = text
    self.attachments = attachments
    self.version = version
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.document = document
    self.tasks = tasks
    self.sync = sync
    self.summary = summary
  }
  enum CodingKeys: String, CodingKey {
    case id, text, attachments, version, createdAt, updatedAt, document, tasks, sync, summary
  }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    text = try c.decode(String.self, forKey: .text)
    attachments = try c.decodeIfPresent([NativeRecordAttachment].self, forKey: .attachments) ?? []
    version = try c.decode(Int.self, forKey: .version)
    createdAt = try c.decode(String.self, forKey: .createdAt)
    updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
    document = try c.decodeIfPresent(NativeRecordJSON.self, forKey: .document)
    tasks = try c.decodeIfPresent([NativeRecordTaskSummary].self, forKey: .tasks) ?? []
    sync = try c.decodeIfPresent(NativeRecordSync.self, forKey: .sync) ?? .synced
    summary = try c.decodeIfPresent(String.self, forKey: .summary)
  }
  var lines: [String] {
    text.components(separatedBy: .newlines).filter {
      !$0.trimmingCharacters(in: .whitespaces).isEmpty
    }
  }
  var title: String { lines.first ?? attachments.first?.name ?? "无标题记录" }
  var excerpt: String { summary ?? lines.dropFirst().joined(separator: " ") }
  var symbol: String {
    if attachments.contains(where: { $0.mime.hasPrefix("audio/") }) { return "waveform" }
    if title.contains("路线") { return "map" }
    if title.contains("阅读") { return "doc.text" }
    return "note.text"
  }
  var processingTitle: String {
    let states = Set(tasks.map(\.state))
    // Outstanding results of an earlier source version must remain discoverable.
    // The desktop protocol uses completed only after the archive is confirmed.
    if states.contains("awaiting_review") { return "待确认" }
    if !states.isDisjoint(with: ["queued", "assigned", "running", "uploading"]) { return "加工中" }
    if states.contains("completed") { return "已归档" }
    if states.contains("waiting_action") { return "待电脑操作" }
    if states.contains("failed") { return "加工失败" }
    if states.contains("cancelled") { return "已取消" }
    return states.isEmpty ? "未加工" : "状态待更新"
  }
}
struct NativeRecordDraftIndex: Codable, Hashable {
  let id: String
  let title: String
  let modifiedAt: String
}
struct NativeRecordListSnapshot: Codable, Equatable {
  var records: [NativeRecord] = []
  var draft: NativeRecordDraftIndex?
}
protocol NativeRecordListService: Sendable {
  func listRecords() async throws -> [NativeRecord]
}
protocol NativeRecordListStorage: Sendable {
  func load(scope: String) async throws -> NativeRecordListSnapshot
  func save(_ value: NativeRecordListSnapshot, scope: String) async throws
}

// Separate database and scope from the share outbox. No credential is stored here.
actor NativeRecordListStore: NativeRecordListStorage {
  private let path: String
  private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  init(directory: URL) throws {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    path = directory.appendingPathComponent("record-list.sqlite").path
  }
  static func live() throws -> NativeRecordListStore {
    try .init(
      directory: SharedConfiguration.container().appendingPathComponent(
        "Records", isDirectory: true))
  }
  static func scope(origin: String, deviceID: String) -> String {
    SHA256.hash(data: Data((origin + "\n" + deviceID).utf8)).map { String(format: "%02x", $0) }
      .joined()
  }
  private func connection<T>(_ work: (OpaquePointer) throws -> T) throws -> T {
    var pointer: OpaquePointer?
    guard
      sqlite3_open_v2(
        path, &pointer, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil)
        == SQLITE_OK, let db = pointer
    else {
      if let pointer { sqlite3_close(pointer) }
      throw failure
    }
    defer { sqlite3_close(db) }
    sqlite3_busy_timeout(db, 3000)
    guard
      sqlite3_exec(
        db,
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS list_cache(scope TEXT PRIMARY KEY, body BLOB NOT NULL)",
        nil, nil, nil) == SQLITE_OK
    else { throw failure }
    return try work(db)
  }
  private var failure: CollectorError { .message("记录缓存读写失败。") }
  func load(scope: String) throws -> NativeRecordListSnapshot {
    try connection { db in
      var raw: OpaquePointer?
      guard
        sqlite3_prepare_v2(db, "SELECT body FROM list_cache WHERE scope=?", -1, &raw, nil)
          == SQLITE_OK, let stmt = raw
      else { throw failure }
      defer { sqlite3_finalize(stmt) }
      guard sqlite3_bind_text(stmt, 1, scope, -1, transient) == SQLITE_OK else { throw failure }
      let result = sqlite3_step(stmt)
      if result == SQLITE_DONE { return .init() }
      guard result == SQLITE_ROW, let bytes = sqlite3_column_blob(stmt, 0) else { throw failure }
      return try JSONDecoder().decode(
        NativeRecordListSnapshot.self,
        from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(stmt, 0))))
    }
  }
  func save(_ value: NativeRecordListSnapshot, scope: String) throws {
    let bytes = try JSONEncoder().encode(value)
    try connection { db in
      var raw: OpaquePointer?
      guard
        sqlite3_prepare_v2(
          db,
          "INSERT INTO list_cache(scope,body) VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET body=excluded.body",
          -1, &raw, nil) == SQLITE_OK, let stmt = raw
      else { throw failure }
      defer { sqlite3_finalize(stmt) }
      guard sqlite3_bind_text(stmt, 1, scope, -1, transient) == SQLITE_OK else { throw failure }
      let bound = bytes.withUnsafeBytes {
        sqlite3_bind_blob(stmt, 2, $0.baseAddress, Int32($0.count), transient)
      }
      guard bound == SQLITE_OK, sqlite3_step(stmt) == SQLITE_DONE else { throw failure }
    }
  }
}
