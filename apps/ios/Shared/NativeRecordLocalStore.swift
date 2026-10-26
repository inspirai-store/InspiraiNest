import Foundation
import SQLite3

struct NativeRecordLocalEntry: Codable, Equatable, Identifiable {
  var id:String {scope+":"+record.id}
  var record: NativeRecord
  var scope: String
  var localRevision: Int
  var baseVersion: Int
  var requestID: String
}
struct NativeRecordEditDraft: Codable, Equatable, Identifiable {
  var id: String
  var recordID: String
  var scope: String
  var revision: Int
  var baseLocalRevision: Int
  var baseVersion: Int
  var original: NativeRecord?
  var document: NativeRecordDocument
  var attachments: [NativeRecordAttachment]
  var createdAt: String
  var modifiedAt: String
  var isNew: Bool { original == nil }
  var title: String {
    document.plainText.components(separatedBy: .newlines).first { !$0.isEmpty } ?? "未命名记录"
  }
}
struct NativeRecordLocalSnapshot: Equatable {
  var records: [NativeRecordLocalEntry] = []
  var drafts: [NativeRecordEditDraft] = []
}
protocol NativeRecordLocalStorage: Sendable {
  func snapshot(scope: String) async throws -> NativeRecordLocalSnapshot
  func begin(record: NativeRecord?, scope: String) async throws -> NativeRecordEditDraft
  func persist(_ draft: NativeRecordEditDraft) async throws -> Int
  func commit(id: String, revision: Int) async throws -> NativeRecordLocalEntry
  func discard(id: String, revision: Int) async throws
}

/// Versioned local writes. Draft retirement and record promotion share a transaction.
/// No method in this store sends a record to a server or changes an outbox row.
actor NativeRecordLocalStore: NativeRecordLocalStorage {
  static let unbound = "unpaired-local"
  private let path: String
  private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  private let now: @Sendable () -> Date
  init(directory: URL, now: @escaping @Sendable () -> Date = { Date() }) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    path = directory.appendingPathComponent("record-local.sqlite").path
    self.now = now
  }
  static func live() throws -> NativeRecordLocalStore {
    try .init(directory: SharedConfiguration.container().appendingPathComponent("Records", isDirectory: true))
  }
  private func date() -> String { ISO8601DateFormatter().string(from: now()) }
  private func failure(_ db: OpaquePointer) -> NativeRecordLocalError {
    sqlite3_errcode(db) == SQLITE_FULL ? .diskFull : .unavailable
  }
  private func connection<T>(_ work: (OpaquePointer) throws -> T) throws -> T {
    var pointer: OpaquePointer?
    guard sqlite3_open_v2(path, &pointer, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
      let db = pointer else { if let pointer { sqlite3_close(pointer) }; throw NativeRecordLocalError.unavailable }
    defer { sqlite3_close(db) }
    sqlite3_busy_timeout(db, 3000)
    let schema = """
      PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS record_drafts(id TEXT PRIMARY KEY, scope TEXT NOT NULL, record_id TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL, body BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS local_records(scope TEXT NOT NULL, id TEXT NOT NULL, body BLOB NOT NULL, PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS record_sync(id TEXT PRIMARY KEY, scope TEXT NOT NULL, record_id TEXT NOT NULL, state TEXT NOT NULL, body BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS record_spaces(scope TEXT PRIMARY KEY, origin TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS record_watermarks(scope TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS record_remote(scope TEXT NOT NULL,id TEXT NOT NULL,body BLOB NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS record_process_forms(scope TEXT,id TEXT,body BLOB NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS record_process_ops(id TEXT PRIMARY KEY,scope TEXT,record_id TEXT,body BLOB NOT NULL);
      """
    guard sqlite3_exec(db, schema, nil, nil, nil) == SQLITE_OK else { throw failure(db) }
    return try work(db)
  }
  @discardableResult private func query(_ db: OpaquePointer, _ sql: String, _ values: [String] = [], body: Data? = nil) throws -> [[Data]] {
    var raw: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &raw, nil) == SQLITE_OK, let stmt = raw else { throw failure(db) }
    defer { sqlite3_finalize(stmt) }
    for (index, value) in values.enumerated() {
      guard sqlite3_bind_text(stmt, Int32(index + 1), value, -1, transient) == SQLITE_OK else { throw failure(db) }
    }
    if let body {
      let result = body.withUnsafeBytes { sqlite3_bind_blob(stmt, Int32(values.count + 1), $0.baseAddress, Int32($0.count), transient) }
      guard result == SQLITE_OK else { throw failure(db) }
    }
    var rows: [[Data]] = []
    while true {
      let result = sqlite3_step(stmt)
      if result == SQLITE_DONE { return rows }
      guard result == SQLITE_ROW else { throw failure(db) }
      rows.append((0..<sqlite3_column_count(stmt)).map { column in
        if let bytes = sqlite3_column_blob(stmt, column) { return Data(bytes: bytes, count: Int(sqlite3_column_bytes(stmt, column))) }
        return Data()
      })
    }
  }
  private func transaction<T>(_ db: OpaquePointer, _ work: () throws -> T) throws -> T {
    try query(db, "BEGIN IMMEDIATE")
    do { let result = try work(); try query(db, "COMMIT"); return result }
    catch { _ = try? query(db, "ROLLBACK"); throw error }
  }
  private func decode<T: Decodable>(_ data: Data, _ type: T.Type) throws -> T { try JSONDecoder().decode(type, from: data) }
  private func entry(_ db: OpaquePointer, id: String, scope: String) throws -> NativeRecordLocalEntry? {
    guard let row = try query(db, "SELECT body FROM local_records WHERE scope=? AND id=?", [scope, id]).first else { return nil }
    return try decode(row[0], NativeRecordLocalEntry.self)
  }
  func importLegacy(_ value:NativeRecordLocalEntry,origin:String?,fingerprint:String) throws {
    try connection {db in try transaction(db) {
      try query(db,"CREATE TABLE IF NOT EXISTS legacy_imports(id TEXT PRIMARY KEY)")
      guard try query(db,"SELECT id FROM legacy_imports WHERE id=?",[fingerprint]).isEmpty else{return}
      if try entry(db,id:value.record.id,scope:value.scope) == nil {try writeEntry(db,value)}
      if let origin {try query(db,"INSERT INTO record_spaces(scope,origin) VALUES (?,?) ON CONFLICT(scope) DO NOTHING",[value.scope,origin])}
      try query(db,"INSERT INTO legacy_imports(id) VALUES (?)",[fingerprint])
    }}
  }
  func snapshot(scope: String) throws -> NativeRecordLocalSnapshot {
    try connection { db in
      let entries = try query(db, "SELECT body FROM local_records WHERE scope=? OR scope=?", [scope, Self.unbound])
        .map { try decode($0[0], NativeRecordLocalEntry.self) }
      let drafts = try query(db, "SELECT body FROM record_drafts WHERE (scope=? OR scope=?) AND state='draft'", [scope, Self.unbound])
        .map { try decode($0[0], NativeRecordEditDraft.self) }.sorted { $0.modifiedAt > $1.modifiedAt }
      return .init(records: entries, drafts: drafts)
    }
  }
  func begin(record: NativeRecord?, scope: String) throws -> NativeRecordEditDraft {
    try connection { db in try transaction(db) {
      let local = try record.flatMap { try entry(db, id: $0.id, scope: scope) ?? entry(db, id: $0.id, scope: Self.unbound) }
      let owner = local?.scope ?? scope
      let existing = try query(db, "SELECT body FROM record_drafts WHERE scope=? AND state='draft'", [owner])
        .map { try decode($0[0], NativeRecordEditDraft.self) }
        .first { record == nil ? $0.isNew : $0.recordID == record?.id }
      if let existing { return existing }
      let source = local?.record ?? record
      let timestamp = date()
      let draft = NativeRecordEditDraft(id: UUID().uuidString.lowercased(), recordID: source?.id ?? UUID().uuidString.lowercased(),
        scope: owner, revision: 0, baseLocalRevision: local?.localRevision ?? 0, baseVersion: local?.baseVersion ?? source?.version ?? 0,
        original: source, document: try source.map { try NativeRecordDocument(record: $0) } ?? .plain(""),
        attachments: source?.attachments ?? [], createdAt: source?.createdAt ?? timestamp, modifiedAt: timestamp)
      try query(db, "INSERT INTO record_drafts(id,scope,record_id,state,revision,body) VALUES (?,?,?,'draft',0,?)", [draft.id, owner, draft.recordID], body: JSONEncoder().encode(draft))
      return draft
    } }
  }
  func persist(_ input: NativeRecordEditDraft) throws -> Int {
    try connection { db in
      var draft = input; draft.revision += 1
      try query(db, "UPDATE record_drafts SET body=?5, revision=revision+1 WHERE id=?1 AND revision=?2 AND scope=?3 AND record_id=?4 AND state='draft'",
        [input.id, String(input.revision), input.scope, input.recordID], body: JSONEncoder().encode(draft))
      guard sqlite3_changes(db) == 1 else { throw NativeRecordLocalError.stale }
      return draft.revision
    }
  }
  func commit(id: String, revision: Int) throws -> NativeRecordLocalEntry {
    try connection { db in try transaction(db) {
      guard let row = try query(db, "SELECT state,revision,body,scope,record_id FROM record_drafts WHERE id=?", [id]).first else { throw NativeRecordLocalError.retired }
      let state = String(decoding: row[0], as: UTF8.self), owner = String(decoding: row[3], as: UTF8.self), recordID = String(decoding: row[4], as: UTF8.self)
      if state == "saved", let existing = try entry(db, id: recordID, scope: owner) { return existing }
      guard state == "draft" else { throw NativeRecordLocalError.retired }
      guard Int(String(decoding: row[1], as: UTF8.self)) == revision else { throw NativeRecordLocalError.stale }
      let draft = try decode(row[2], NativeRecordEditDraft.self)
      try draft.document.validateForSave(attachments: draft.attachments)
      let current = try entry(db, id: recordID, scope: owner)
      let remoteAdvanced=current?.record.sync == .synced && current?.localRevision != draft.baseLocalRevision && (current?.baseVersion ?? 0)>draft.baseVersion
      guard (current?.localRevision ?? 0) == draft.baseLocalRevision || remoteAdvanced else { throw NativeRecordLocalError.stale }
      var record = draft.original ?? NativeRecord(id: recordID, text: "", createdAt: draft.createdAt)
      record.text = draft.document.plainText; record.document = try draft.document.json(); record.attachments = draft.attachments
      record.summary = nil; record.sync = .pending; record.updatedAt = date()
      if let current { record.version = remoteAdvanced ? draft.baseVersion : current.record.version }
      let value = NativeRecordLocalEntry(record: record, scope: owner, localRevision: (current?.localRevision ?? draft.baseLocalRevision) + 1,
        baseVersion: remoteAdvanced ? draft.baseVersion : current?.baseVersion ?? draft.baseVersion, requestID: UUID().uuidString.lowercased())
      try query(db, "INSERT INTO local_records(scope,id,body) VALUES (?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body", [owner, recordID], body: JSONEncoder().encode(value))
      try query(db, "UPDATE record_drafts SET state='saved', revision=revision+1, body=X'' WHERE id=? AND revision=? AND state='draft'", [id, String(revision)])
      guard sqlite3_changes(db) == 1 else { throw NativeRecordLocalError.stale }
      return value
    } }
  }
  func discard(id: String, revision: Int) throws {
    try connection { db in
      try query(db, "UPDATE record_drafts SET state='discarded', revision=revision+1, body=X'' WHERE id=? AND revision=? AND state='draft'", [id, String(revision)])
      guard sqlite3_changes(db) == 1 else { throw NativeRecordLocalError.stale }
    }
  }

  private func writeEntry(_ db:OpaquePointer,_ value:NativeRecordLocalEntry) throws {
    try query(db,"INSERT INTO local_records(scope,id,body) VALUES (?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",[value.scope,value.record.id],body:JSONEncoder().encode(value))
  }
  private func operations(_ db:OpaquePointer,scope:String) throws -> [NativeRecordSyncOperation] {
    try query(db,"SELECT body FROM record_sync WHERE scope=? AND state!='synced' ORDER BY rowid",[scope]).map {try decode($0[0],NativeRecordSyncOperation.self)}
  }
  private func writeOperation(_ db:OpaquePointer,_ value:NativeRecordSyncOperation) throws {
    try query(db,"INSERT INTO record_sync(id,scope,record_id,state,body) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,body=excluded.body",[value.id,value.scope,value.recordID,value.state.rawValue],body:JSONEncoder().encode(value))
  }
  func syncOperations(scope:String) throws -> [NativeRecordSyncOperation] {try connection {try operations($0,scope:scope)}}
  func nextSync(scope:String,origin:String) throws -> NativeRecordSyncOperation? {
    guard scope != Self.unbound else {return nil}
    return try connection {db in try transaction(db) {
      let active=try operations(db,scope:scope)
      if let value=active.first(where:{$0.state == .pending || $0.state == .syncing}) {return value}
      let blocked=Set(active.map(\.recordID))
      let records=try query(db,"SELECT body FROM local_records WHERE scope=? ORDER BY rowid",[scope]).map {try decode($0[0],NativeRecordLocalEntry.self)}
      guard let entry=records.first(where:{$0.record.sync == .pending && !blocked.contains($0.record.id)}) else {return nil}
      try NativeRecordDocument(record:entry.record).validateForSave(attachments:entry.record.attachments)
      guard UUID(uuidString:entry.record.id) != nil,entry.record.attachments.allSatisfy({UUID(uuidString:$0.id) != nil}) else {throw CollectorError.message("记录或附件编号无效 · 本机内容已保留")}
      // Older servers accept thumbnails only for image/video originals.
      let attachments=entry.record.attachments.map {a in var a=a;if !a.mime.hasPrefix("image/") && !a.mime.hasPrefix("video/"){a.thumbnailSha256=nil};return a}
      let payload=NativeRecordSaveRequest(requestId:entry.requestID,baseVersion:entry.baseVersion,text:entry.record.text,document:entry.record.document,attachments:attachments,createdAt:entry.record.createdAt)
      let op=NativeRecordSyncOperation(id:entry.requestID,scope:scope,recordID:entry.record.id,localRevision:entry.localRevision,payload:payload,body:try payload.data(),state:.pending,origin:origin,createdAt:date())
      try writeOperation(db,op);return op
    }}
  }
  func updateSync(_ operation:NativeRecordSyncOperation) throws {
    try connection {db in try transaction(db) {
      guard let old=try operations(db,scope:operation.scope).first(where:{$0.id==operation.id}) else {return}
      guard old.body==operation.body,old.localRevision==operation.localRevision else {throw NativeRecordLocalError.stale}
      try writeOperation(db,operation)
      if var local=try entry(db,id:operation.recordID,scope:operation.scope) {
        local.record.sync=operation.state;try writeEntry(db,local)
      }
    }}
  }
  func finishSync(_ operation:NativeRecordSyncOperation,record:NativeRecord) throws {
    guard record.id==operation.recordID,record.version==operation.payload.baseVersion+1,
      record.text==operation.payload.text,record.document==operation.payload.document,
      record.attachments.count==operation.payload.attachments.count,
      zip(record.attachments,operation.payload.attachments).allSatisfy({$0.id==$1.id && $0.sha256==$1.sha256 && $0.bytes==$1.bytes && $0.mime==$1.mime && $0.name==$1.name && $0.thumbnailSha256==$1.thumbnailSha256}) else {throw NativeRecordSyncFailure.integrity}
    try connection {db in try transaction(db) {
      guard let active=try operations(db,scope:operation.scope).first(where:{$0.id==operation.id}) else {return}
      guard active.body==operation.body else {throw NativeRecordLocalError.stale}
      var done=active;done.state = .synced;done.error=nil;done.errorCode=nil;try writeOperation(db,done)
      guard var local=try entry(db,id:operation.recordID,scope:operation.scope) else {throw NativeRecordLocalError.stale}
      local.baseVersion=record.version
      if local.localRevision==operation.localRevision {
        let tasks=local.record.tasks
        let observed=try query(db,"SELECT body FROM record_remote WHERE scope=? AND id=?",[operation.scope,operation.recordID]).first.map {try decode($0[0],NativeRecord.self)}
        if let observed,observed.version>record.version {local.record=observed;local.baseVersion=observed.version;local.localRevision += 1}
        else {local.record=record;local.record.tasks=observed?.version==record.version ? observed!.tasks : tasks}
        local.record.sync = .synced
      } else {local.record.version=record.version;local.record.sync = .pending}
      try writeEntry(db,local)
    }}
  }
  func mergeRemote(_ records:[NativeRecord],scope:String) throws {
    guard scope != Self.unbound else {return}
    try connection {db in try transaction(db) {
      let blocked=Set(try operations(db,scope:scope).map(\.recordID))
      for var record in records {
        let cached=try query(db,"SELECT body FROM record_remote WHERE scope=? AND id=?",[scope,record.id]).first.map {try decode($0[0],NativeRecord.self)}
        if cached == nil || cached!.version<=record.version {try query(db,"INSERT INTO record_remote(scope,id,body) VALUES (?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",[scope,record.id],body:JSONEncoder().encode(record))}
        guard !blocked.contains(record.id) else {continue}
        let old=try entry(db,id:record.id,scope:scope)
        guard old == nil || old?.record.sync == .synced else {continue}
        if let old,old.baseVersion > record.version {continue}
        record.sync = .synced
        if old?.record==record {continue}
        try writeEntry(db,.init(record:record,scope:scope,localRevision:(old?.localRevision ?? 0)+((old?.record.text != record.text || old?.record.document != record.document || old?.record.attachments != record.attachments || old?.record.version != record.version) ? 1 : 0),baseVersion:record.version,requestID:UUID().uuidString.lowercased()))
      }
    }}
  }
  func retrySync(scope:String,id:String?=nil,onlyNetwork:Bool=false) throws {
    try connection {db in try transaction(db) {
      for var op in try operations(db,scope:scope) where op.state == .failed && (id == nil || op.recordID==id) && (!onlyNetwork || op.errorCode == "network") {
        op.state = .pending;op.error=nil;op.errorCode=nil;try writeOperation(db,op)
        if var value=try entry(db,id:op.recordID,scope:scope){value.record.sync = .pending;try writeEntry(db,value)}
      }
    }}
  }
  func resolveConflict(scope:String,operationID:String,localRevision:Int,remote:NativeRecord) throws {
    try connection {db in try transaction(db) {
      guard var op=try operations(db,scope:scope).first(where:{$0.id==operationID}),op.state == .conflict,
        op.remote?.version==remote.version,var value=try entry(db,id:op.recordID,scope:scope),value.localRevision==localRevision else {throw NativeRecordSyncFailure.changed}
      // Preserve both the old frozen request and the remote comparison in history.
      op.state = .synced;op.errorCode="superseded";try writeOperation(db,op)
      value.baseVersion=remote.version;value.record.version=remote.version;value.record.sync = .pending
      value.requestID=UUID().uuidString.lowercased();try writeEntry(db,value)
    }}
  }
  func bindLocalRecord(id:String,revision:Int,to scope:String) throws {
    guard scope != Self.unbound else {throw NativeRecordSyncFailure.unavailable}
    try connection {db in try transaction(db) {
      guard var value=try entry(db,id:id,scope:Self.unbound),value.localRevision==revision,
        try entry(db,id:id,scope:scope)==nil else {throw NativeRecordLocalError.stale}
      let drafts=try query(db,"SELECT body FROM record_drafts WHERE scope=? AND record_id=? AND state='draft'",[Self.unbound,id])
      guard drafts.isEmpty else {throw CollectorError.message("请先保存或放弃该记录的编辑草稿")}
      value.scope=scope;value.record.sync = .pending;value.requestID=UUID().uuidString.lowercased()
      if let row=try query(db,"SELECT body FROM record_process_forms WHERE scope=? AND id=?",[Self.unbound,id]).first {
        guard try query(db,"SELECT body FROM record_process_forms WHERE scope=? AND id=?",[scope,id]).isEmpty else {throw CollectorError.message("当前连接已有该记录的加工要求，请先处理")}
        var form=try decode(row[0],NativeRecordProcessDraft.self);form.scope=scope;form.revision+=1
        try query(db,"INSERT INTO record_process_forms(scope,id,body) VALUES (?,?,?)",[scope,id],body:JSONEncoder().encode(form))
        try query(db,"DELETE FROM record_process_forms WHERE scope=? AND id=?",[Self.unbound,id])
      }
      try writeEntry(db,value);try query(db,"DELETE FROM local_records WHERE scope=? AND id=?",[Self.unbound,id])
    }}
  }

  func registerSpace(scope:String,origin:String) throws {
    guard scope != Self.unbound else{return}
    try connection {db in try query(db,"INSERT INTO record_spaces(scope,origin) VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET origin=excluded.origin",[scope,origin])}
  }
  func otherSpaces(current:String) throws -> [NativeRecordSpaceSummary] {
    try connection {db in
      let rows=try query(db,"SELECT DISTINCT l.scope,coalesce(s.origin,'') FROM (SELECT scope FROM local_records UNION SELECT scope FROM record_process_forms UNION SELECT scope FROM record_process_ops) l LEFT JOIN record_spaces s ON s.scope=l.scope WHERE l.scope!=? AND l.scope!=?",[current,Self.unbound])
      return try rows.compactMap {row in
        let scope=String(decoding:row[0],as:UTF8.self),origin=String(decoding:row[1],as:UTF8.self)
        let records=try query(db,"SELECT body FROM local_records WHERE scope=?",[scope]).map {try decode($0[0],NativeRecordLocalEntry.self)}
        let forms=try query(db,"SELECT body FROM record_process_forms WHERE scope=?",[scope]).map {try decode($0[0],NativeRecordProcessDraft.self)}
        let ops=try query(db,"SELECT body FROM record_process_ops WHERE scope=?",[scope]).map {try decode($0[0],NativeRecordProcessOperation.self)}
        let pending=Set(records.filter {$0.record.sync != .synced}.map {$0.record.id}+forms.map(\.recordID)+ops.filter {$0.accepted==nil&&$0.rejected != true}.map(\.recordID)).count
        return pending == 0 ? nil : NativeRecordSpaceSummary(id:scope,origin:origin,count:pending)
      }
    }
  }

  func watermark(scope:String) throws -> String? {
    try connection {db in try query(db,"SELECT value FROM record_watermarks WHERE scope=?",[scope]).first.map {String(decoding:$0[0],as:UTF8.self)}}
  }
  func setWatermark(_ value:String,scope:String) throws {
    try connection {db in try query(db,"INSERT INTO record_watermarks(scope,value) VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET value=excluded.value",[scope,value])}
  }

  func adoptSpace(from oldScope:String,to scope:String) throws {
    try connection {db in try transaction(db) {
      let origins=try query(db,"SELECT origin FROM record_spaces WHERE scope=? OR scope=?",[oldScope,scope]).map {String(decoding:$0[0],as:UTF8.self)}
      guard oldScope != scope,oldScope != Self.unbound,origins.count==2,origins[0]==origins[1],!origins[0].isEmpty else {throw NativeRecordSyncFailure.changed}
      let oldEntries=try query(db,"SELECT body FROM local_records WHERE scope=?",[oldScope]).map {try decode($0[0],NativeRecordLocalEntry.self)}
      let oldDrafts=try query(db,"SELECT body FROM record_drafts WHERE scope=? AND state='draft'",[oldScope]).map {try decode($0[0],NativeRecordEditDraft.self)}
      let currentDrafts=try query(db,"SELECT body FROM record_drafts WHERE scope=? AND state='draft'",[scope]).map {try decode($0[0],NativeRecordEditDraft.self)}
      guard !oldDrafts.contains(where:{draft in currentDrafts.contains {$0.recordID==draft.recordID}}) else {throw CollectorError.message("当前连接已有该记录的编辑草稿，请先处理")}
      var revisions:[String:Int]=[:],deltas:[String:Int]=[:]
      for var value in oldEntries {
        let current=try entry(db,id:value.record.id,scope:scope)
        guard current == nil || current?.record.sync == .synced else {throw CollectorError.message("当前连接已有该记录的本机修改，请先处理")}
        let oldRevision=value.localRevision
        if value.record.sync == .synced,let current {value=current}
        else {value.localRevision=max(value.localRevision,current?.localRevision ?? 0)+1}
        value.scope=scope;revisions[value.record.id]=value.localRevision;deltas[value.record.id]=value.localRevision-oldRevision
        try writeEntry(db,value)
      }
      for var draft in oldDrafts {
        draft.scope=scope
        if let revision=revisions[draft.recordID] {draft.baseLocalRevision=revision}
        try query(db,"UPDATE record_drafts SET scope=?1,body=?3 WHERE id=?2 AND state='draft'",[scope,draft.id],body:JSONEncoder().encode(draft))
      }
      for var operation in try operations(db,scope:oldScope) {
        operation.scope=scope;operation.localRevision += deltas[operation.recordID] ?? 0
        try query(db,"UPDATE record_sync SET scope=?1,body=?3 WHERE id=?2",[scope,operation.id],body:JSONEncoder().encode(operation))
      }
      for var form in try query(db,"SELECT body FROM record_process_forms WHERE scope=?",[oldScope]).map({try decode($0[0],NativeRecordProcessDraft.self)}) {
        form.scope=scope
        if let row=try query(db,"SELECT body FROM record_process_forms WHERE scope=? AND id=?",[scope,form.recordID]).first {
          let other=try decode(row[0],NativeRecordProcessDraft.self)
          guard form.preset==other.preset,form.instructions==other.instructions,form.deviceID==other.deviceID,form.agent==other.agent else {throw CollectorError.message("当前连接已有该记录的加工要求，请先处理")}
          form.revision=max(form.revision,other.revision)
        }
        form.revision+=1
        try query(db,"INSERT INTO record_process_forms(scope,id,body) VALUES (?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",[scope,form.recordID],body:JSONEncoder().encode(form))
      }
      let currentOps=try query(db,"SELECT body FROM record_process_ops WHERE scope=?",[scope]).map {try decode($0[0],NativeRecordProcessOperation.self)}
      for var op in try query(db,"SELECT body FROM record_process_ops WHERE scope=?",[oldScope]).map({try decode($0[0],NativeRecordProcessOperation.self)}) {
        guard op.accepted != nil || op.rejected==true || !currentOps.contains(where:{$0.recordID==op.recordID&&$0.accepted==nil&&$0.rejected != true}) else {throw CollectorError.message("当前连接已有该记录尚未确认的加工请求")}
        op.scope=scope;try query(db,"UPDATE record_process_ops SET scope=?1,body=?3 WHERE id=?2",[scope,op.id],body:JSONEncoder().encode(op))
      }
      try query(db,"DELETE FROM record_process_forms WHERE scope=?",[oldScope])
      try query(db,"DELETE FROM local_records WHERE scope=?",[oldScope])
    }}
  }
  func processDraft(scope:String,id:String) throws -> NativeRecordProcessDraft? {
    try connection {db in
      try query(db,"CREATE TABLE IF NOT EXISTS record_process_forms(scope TEXT, id TEXT, body BLOB NOT NULL, PRIMARY KEY(scope,id))")
      return try query(db,"SELECT body FROM record_process_forms WHERE scope=? AND id=?",[scope,id]).first.map {try decode($0[0],NativeRecordProcessDraft.self)}
    }
  }
  func saveProcessDraft(_ form:NativeRecordProcessDraft) throws {
    try connection {db in try transaction(db) {
      try query(db,"CREATE TABLE IF NOT EXISTS record_process_forms(scope TEXT, id TEXT, body BLOB NOT NULL, PRIMARY KEY(scope,id))")
      if let row=try query(db,"SELECT body FROM record_process_forms WHERE scope=? AND id=?",[form.scope,form.recordID]).first,try decode(row[0],NativeRecordProcessDraft.self).revision>=form.revision {return}
      try query(db,"INSERT INTO record_process_forms(scope,id,body) VALUES (?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",[form.scope,form.recordID],body:JSONEncoder().encode(form))
    }}
  }
  func processOperation(scope:String,id:String) throws -> NativeRecordProcessOperation? {
    try connection {db in
      try query(db,"CREATE TABLE IF NOT EXISTS record_process_ops(id TEXT PRIMARY KEY,scope TEXT,record_id TEXT,body BLOB NOT NULL)")
      return try query(db,"SELECT body FROM record_process_ops WHERE scope=? AND record_id=? ORDER BY rowid DESC",[scope,id]).map {try decode($0[0],NativeRecordProcessOperation.self)}.first {$0.accepted==nil&&$0.rejected != true}
    }
  }
  func saveProcessOperation(_ op:NativeRecordProcessOperation) throws {
    try op.request.validate();guard op.body == (try op.request.data()) else {throw NativeRecordSyncFailure.integrity}
    try connection {db in try transaction(db) {
      try query(db,"CREATE TABLE IF NOT EXISTS record_process_ops(id TEXT PRIMARY KEY,scope TEXT,record_id TEXT,body BLOB NOT NULL)")
      if let row=try query(db,"SELECT body FROM record_process_ops WHERE id=?",[op.id]).first {
        let old=try decode(row[0],NativeRecordProcessOperation.self)
        guard old.scope==op.scope,old.recordID==op.recordID,old.body==op.body else {throw NativeRecordSyncFailure.changed}
        if old.accepted != nil || old.rejected==true {return}
      }
      try query(db,"INSERT INTO record_process_ops(id,scope,record_id,body) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",[op.id,op.scope,op.recordID],body:JSONEncoder().encode(op))
    }}
  }

}
