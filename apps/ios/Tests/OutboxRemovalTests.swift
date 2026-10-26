import SQLite3
import XCTest
@testable import PersonalLibrary

final class OutboxRemovalStorageTests: XCTestCase {
  private var directory: URL!
  private var box: Outbox!
  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    box = try Outbox(directory: directory)
  }
  override func tearDownWithError() throws { try? FileManager.default.removeItem(at: directory) }
  private func share() -> SavedShare {
    let parts = [SharedPart(item: 0, attachment: nil, kind: "text", representation: nil,
      value: "  完整原文\n\nhttps://example.com?a=1#章节  ")]
    return SavedShare(submission: Submission(id: UUID(), parts: parts, requirements: "保留空格"),
      originalParts: parts, additionalRequirements: "保留空格", createdAt: Date())
  }
  func testRemovalOfEveryStatePreservesOtherRecordsDraftsAndCache() throws {
    let origin = "https://one.example"
    let unaffected = share()
    try box.insert(unaffected, origin: origin)
    let draft = try box.saveComposition(LocalComposition(requirements: "未提交草稿"))
    let worker = Device(id: UUID().uuidString, name: "电脑", role: "worker", revokedAt: nil,
      online: true, agents: ["codex"])
    try box.cacheDevices([worker], origin: origin)
    for state in ["unbound", "queued", "sending", "submitted", "blocked"] {
      let record = share(), id = record.submission.submissionId
      try box.insert(record, origin: state == "unbound" ? nil : origin)
      if ["sending", "submitted", "blocked"].contains(state) {
        let lease = try XCTUnwrap(box.claim(id: id, origin: origin))
        if state != "sending" { try box.finish(id: id, lease: lease,
          taskID: state == "submitted" ? "server-task" : nil, blocked: state == "blocked") }
      }
      try box.remove(id: id)
      XCTAssertEqual(try box.list().map(\.share), [unaffected])
      XCTAssertEqual(try box.compositions(), [draft])
      XCTAssertEqual(try box.cachedDevices(origin: origin).map(\.id), [worker.id])
      XCTAssertThrowsError(try box.insert(record, origin: origin))
    }
    XCTAssertEqual(try Outbox(directory: directory).list().map(\.share), [unaffected])
  }
  func testLateAcknowledgementAndExpiredSenderCannotResurrectRemovedRecord() throws {
    let other = try Outbox(directory: directory), record = share(), origin = "https://one.example"
    let id = record.submission.submissionId
    try box.insert(record, origin: origin)
    let lease = try XCTUnwrap(other.claim(id: id, origin: origin))
    try box.remove(id: id)
    XCTAssertFalse(try other.finish(id: id, lease: lease, taskID: "accepted-server-task"))
    XCTAssertFalse(try other.finish(id: id, lease: lease, blocked: true, message: "timeout"))
    XCTAssertNil(try other.claim(id: id, origin: origin, now: Date().addingTimeInterval(100)))
    XCTAssertTrue(try other.list().isEmpty)
    XCTAssertThrowsError(try other.insert(record, origin: origin))
  }
  func testLegacyRowWithoutTombstoneAlsoRetiresOriginalUUID() throws {
    let record = share(), id = record.submission.submissionId
    try box.insert(record, origin: nil)
    var db: OpaquePointer?
    XCTAssertEqual(sqlite3_open(directory.appendingPathComponent("outbox.sqlite").path, &db), SQLITE_OK)
    defer { sqlite3_close(db) }
    XCTAssertEqual(sqlite3_exec(db, "DELETE FROM composition_tombstones", nil, nil, nil), SQLITE_OK)
    try box.remove(id: id)
    try box.remove(id: id)
    XCTAssertThrowsError(try box.insert(record, origin: nil))
    XCTAssertThrowsError(try box.saveComposition(LocalComposition(id: UUID(uuidString: id)!)))
    XCTAssertTrue(try box.list().isEmpty)
  }
  func testInvalidIdentifierCannotDeleteAnyRecord() throws {
    let record = share()
    try box.insert(record, origin: nil)
    XCTAssertThrowsError(try box.remove(id: "' OR 1=1 --"))
    XCTAssertEqual(try box.list().map(\.share), [record])
  }
}

@MainActor
final class NativeOutboxRemovalTests: XCTestCase {
  @MainActor private final class Harness {
    var records: [OutboxItem]
    var remoteTaskState = "processing"
    var removed: [String] = []
    var sends = 0
    var binds = 0
    var removeFails = false
    var ignoreRemove = false
    var credentialFails = false
    var continuation: CheckedContinuation<Void, Error>?
    init() { records = NativeOutboxFixture(page: "P18").items }
    var dependencies: NativeOutboxDependencies {
      .init(list: { self.records }, credential: {
        if self.credentialFails { throw CollectorError.message("Keychain 不可用") }
        return DeviceCredential(origin: "https://library.inspirai.store", deviceID: "fixture",
          name: "fixture", token: "fixture")
      }, bind: { _, _ in self.binds += 1 }, send: { _, _ in
        self.sends += 1
        try await withCheckedThrowingContinuation { self.continuation = $0 }
      }, copy: { _ in }, remove: { id in
        if self.removeFails { throw CollectorError.message("存储不可用") }
        self.removed.append(id)
        if !self.ignoreRemove { self.records.removeAll { $0.id == id } }
      })
    }
  }
  func testRequestAndCancelNeverDeleteOrSend() {
    let h = Harness(), model = NativeOutboxModel(dependencies: h.dependencies)
    model.reload(); model.menu = true
    let id = h.records[0].id
    model.requestRemoval(id)
    XCTAssertEqual(model.removal?.id, id)
    XCTAssertFalse(model.menu)
    XCTAssertTrue(h.removed.isEmpty)
    model.cancelRemoval(); model.confirmRemoval()
    XCTAssertNil(model.removal)
    XCTAssertEqual(h.records.count, 4)
    XCTAssertEqual(h.sends, 0); XCTAssertEqual(h.binds, 0)
  }
  func testSubmittedRemovalIsLocalAndReturnsFromRemovedDetail() {
    let h = Harness(), model = NativeOutboxModel(dependencies: h.dependencies)
    model.reload()
    let submitted = h.records[2], retained = h.records[0]
    model.selectedID = submitted.id; model.path = [submitted.id]
    model.requestRemoval(submitted.id); model.confirmRemoval()
    XCTAssertEqual(h.removed, [submitted.id])
    XCTAssertNil(model.item(submitted.id))
    XCTAssertEqual(model.selectedID, retained.id)
    XCTAssertTrue(model.path.isEmpty)
    XCTAssertEqual(model.item(retained.id)?.share, retained.share)
    XCTAssertEqual(h.remoteTaskState, "processing")
    XCTAssertEqual(h.sends, 0); XCTAssertEqual(h.binds, 0)
  }
  func testRemovingDifferentRecordPreservesSelectionAndNavigation() {
    let h = Harness(), model = NativeOutboxModel(dependencies: h.dependencies)
    model.reload()
    let selected = h.records[0].id, other = h.records[2].id
    model.selectedID = selected; model.path = [selected]
    model.requestRemoval(other); model.confirmRemoval()
    XCTAssertEqual(model.selectedID, selected)
    XCTAssertEqual(model.path, [selected])
  }
  func testOfflineExpiredAndLockedKeychainDoNotPreventLocalRemoval() {
    let h = Harness(), model = NativeOutboxModel(dependencies: h.dependencies)
    model.reload(); model.setOffline(true)
    h.credentialFails = true; model.invalidateSession(expired: true)
    let id = h.records[0].id
    model.requestRemoval(id); model.confirmRemoval()
    XCTAssertNil(model.item(id))
    XCTAssertNil(model.notice)
    XCTAssertEqual(h.sends, 0); XCTAssertEqual(h.binds, 0)
  }
  func testFailedOrUnconfirmedRemovalKeepsDetailAndOriginalContent() {
    for ignore in [false, true] {
      let h = Harness(), model = NativeOutboxModel(dependencies: h.dependencies)
      model.reload()
      let record = h.records[0]
      h.removeFails = !ignore; h.ignoreRemove = ignore
      model.path = [record.id]; model.selectedID = record.id
      model.requestRemoval(record.id); model.confirmRemoval()
      XCTAssertEqual(model.item(record.id)?.share, record.share)
      XCTAssertEqual(model.path, [record.id])
      XCTAssertNotNil(model.notice)
      XCTAssertEqual(h.remoteTaskState, "processing")
    }
  }
  func testRemovalDoesNotCancelAlreadyStartedSend() async {
    let h = Harness(), model = NativeOutboxModel(dependencies: h.dependencies)
    model.reload()
    let id = h.records[0].id
    let job = Task { await model.retry(id) }
    for _ in 0..<100 where h.continuation == nil { await Task.yield() }
    XCTAssertNotNil(h.continuation)
    model.requestRemoval(id); model.confirmRemoval()
    XCTAssertNil(model.item(id))
    XCTAssertFalse(job.isCancelled)
    h.continuation?.resume(); h.continuation = nil
    await job.value
    XCTAssertNil(model.item(id))
    XCTAssertEqual(h.sends, 1)
    XCTAssertEqual(h.remoteTaskState, "processing")
  }
}
