import Foundation
import SQLite3

/// Separate connection per operation, SQLite WAL + FULL sync + BEGIN IMMEDIATE.
/// Rows, not one shared JSON array. SQLite coordinates both processes and threads.
/// Network calls never hold a database transaction. A crash leaves a finite lease.
final class Outbox: @unchecked Sendable {
    private let path: String
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        path = directory.appendingPathComponent("outbox.sqlite").path
        try connection { db in
            try execute(db, "PRAGMA journal_mode=WAL")
            try execute(db, "CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, body BLOB NOT NULL, origin TEXT, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, task_id TEXT, message TEXT, lease_id TEXT, lease_until REAL)")
            try execute(db, "CREATE TABLE IF NOT EXISTS dispatch_cache (origin TEXT PRIMARY KEY, body BLOB NOT NULL)")
            try execute(db, "PRAGMA user_version=1")
        }
    }
    static func shared() throws -> Outbox { try Outbox(directory: SharedConfiguration.container().appendingPathComponent("Outbox", isDirectory: true)) }
    func cacheDevices(_ devices: [Device], origin: String) throws {
        let body = try JSONEncoder().encode(devices)
        try connection { db in
            try statement(db, "INSERT INTO dispatch_cache (origin,body) VALUES (?,?) ON CONFLICT(origin) DO UPDATE SET body=excluded.body") { s in
                try bind(s, 1, origin)
                let result = body.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32($0.count), transient) }
                guard result == SQLITE_OK else { throw storageError }; try done(s)
            }
        }
    }
    func cachedDevices(origin: String) throws -> [Device] {
        try connection { db in
            try statement(db, "SELECT body FROM dispatch_cache WHERE origin=?") { s in
                try bind(s, 1, origin)
                let status = sqlite3_step(s)
                if status == SQLITE_DONE { return [] }
                guard status == SQLITE_ROW, let bytes = sqlite3_column_blob(s, 0) else { throw storageError }
                return try JSONDecoder().decode([Device].self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(s, 0))))
            }
        }
    }
    private func connection<T>(_ work: (OpaquePointer) throws -> T) throws -> T {
        var handle: OpaquePointer?
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let db = handle else {
            if let handle { sqlite3_close(handle) }; throw storageError
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 3000)
        try execute(db, "PRAGMA synchronous=FULL")
        return try work(db)
    }
    private var storageError: CollectorError { .message("共享发件箱读写失败。未确认保存，请重试；不会自动丢弃原文。") }
    private func execute(_ db: OpaquePointer, _ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw storageError }
    }
    private func statement<T>(_ db: OpaquePointer, _ sql: String, _ work: (OpaquePointer) throws -> T) throws -> T {
        var raw: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &raw, nil) == SQLITE_OK, let stmt = raw else { throw storageError }
        defer { sqlite3_finalize(stmt) }; return try work(stmt)
    }
    private func bind(_ stmt: OpaquePointer, _ index: Int32, _ value: String?) throws {
        let result: Int32
        if let value { result = sqlite3_bind_text(stmt, index, value, -1, transient) }
        else { result = sqlite3_bind_null(stmt, index) }
        guard result == SQLITE_OK else { throw storageError }
    }
    private func done(_ stmt: OpaquePointer) throws { guard sqlite3_step(stmt) == SQLITE_DONE else { throw storageError } }
    private func transaction<T>(_ db: OpaquePointer, _ work: () throws -> T) throws -> T {
        try execute(db, "BEGIN IMMEDIATE")
        do { let result = try work(); try execute(db, "COMMIT"); return result }
        catch { try? execute(db, "ROLLBACK"); throw error }
    }
    func insert(_ share: SavedShare, origin: String?) throws {
        let body = try JSONEncoder().encode(share)
        try connection { db in
            try transaction(db) {
                try statement(db, "INSERT INTO outbox (id,body,origin) VALUES (?,?,?)") { s in
                    try bind(s, 1, share.submission.submissionId)
                    let result = body.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32($0.count), transient) }
                    guard result == SQLITE_OK else { throw storageError }
                    try bind(s, 3, origin); try done(s)
                }
            }
        }
    }
    func list() throws -> [OutboxItem] {
        try connection { db in
            try statement(db, "SELECT id,body,origin,state,attempts,task_id,message,lease_until FROM outbox ORDER BY rowid DESC") { s in
                var items: [OutboxItem] = []
                while true {
                    let status = sqlite3_step(s)
                    if status == SQLITE_DONE { break }; guard status == SQLITE_ROW else { throw storageError }
                    func text(_ i: Int32) -> String? { sqlite3_column_text(s, i).map { String(cString: $0) } }
                    guard let bytes = sqlite3_column_blob(s, 1), let id = text(0), let state = text(3) else { throw storageError }
                    let share = try JSONDecoder().decode(SavedShare.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(s, 1))))
                    guard share.submission.submissionId == id else { throw storageError }
                    items.append(OutboxItem(id: id, share: share, origin: text(2), state: state,
                        attempts: Int(sqlite3_column_int(s, 4)), taskID: text(5), message: text(6),
                        leaseUntil: sqlite3_column_type(s, 7) == SQLITE_NULL ? nil : sqlite3_column_double(s, 7)))
                }
                return items
            }
        }
    }
    /// Only never-bound records may be bound. Existing items cannot migrate to an
    /// unrelated server after ambiguous acceptance and accidentally double-submit.
    func bindUnassigned(id: String, origin: String) throws {
        _ = try ServerOrigin(origin)
        try connection { db in
            try statement(db, "UPDATE outbox SET origin=? WHERE id=? AND origin IS NULL AND lease_id IS NULL") { s in
                try bind(s, 1, origin); try bind(s, 2, id); try done(s)
            }
        }
    }
    func claim(id: String, origin: String, now: Date = Date()) throws -> String? {
        try connection { db in
            try transaction(db) {
                let lease = UUID().uuidString
                return try statement(db, "UPDATE outbox SET lease_id=?,lease_until=?,attempts=attempts+1,message=NULL WHERE id=? AND origin=? AND state!='submitted' AND (lease_until IS NULL OR lease_until<=?)") { s in
                    try bind(s, 1, lease); sqlite3_bind_double(s, 2, now.timeIntervalSince1970 + 90)
                    try bind(s, 3, id); try bind(s, 4, origin); sqlite3_bind_double(s, 5, now.timeIntervalSince1970)
                    try done(s); return sqlite3_changes(db) == 1 ? lease : nil
                }
            }
        }
    }
    @discardableResult
    func finish(id: String, lease: String, taskID: String? = nil, blocked: Bool = false, message: String? = nil) throws -> Bool {
        try connection { db in
            try statement(db, "UPDATE outbox SET state=?,task_id=?,message=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?") { s in
                try bind(s, 1, taskID != nil ? "submitted" : blocked ? "blocked" : "queued")
                try bind(s, 2, taskID); try bind(s, 3, message); try bind(s, 4, id); try bind(s, 5, lease)
                try done(s); return sqlite3_changes(db) == 1
            }
        }
    }
}
