import XCTest

@testable import PersonalLibrary

@MainActor
final class NativeOutboxTests: XCTestCase {
  private final class Harness {
    var items: [OutboxItem] = []
    var credential: DeviceCredential? = .init(
      origin: "https://library.inspirai.store", deviceID: "owner", name: "审核", token: "fixture")
    var listFails = false
    var keychainFails = false
    var error: Error?
    var ignoreBinding = false
    var sends: [String] = []
    var binds: [String] = []
    var copied = ""
    var delay = false
    var dependencies: NativeOutboxDependencies {
      .init(
        list: {
          if self.listFails { throw CollectorError.message("读取失败") }
          return self.items
        },
        credential: {
          if self.keychainFails { throw CollectorError.message("凭据不可用") }
          return self.credential
        },
        bind: { id, origin in
          self.binds.append(origin)
          if !self.ignoreBinding {
            self.items = self.items.map { $0.id == id ? self.updated($0, origin: origin) : $0 }
          }
        },
        send: { id, _ in
          self.sends.append(id)
          if self.delay { try await Task.sleep(nanoseconds: 80_000_000) }
          if let error = self.error { throw error }
          self.items = self.items.map {
            $0.id == id ? self.updated($0, state: "submitted", taskID: "confirmed-task") : $0
          }
        }, copy: { self.copied = $0 })
    }
    func updated(
      _ item: OutboxItem, origin: String? = nil, state: String? = nil, taskID: String? = nil
    ) -> OutboxItem {
      .init(
        id: item.id, share: item.share, origin: origin ?? item.origin, state: state ?? item.state,
        attempts: item.attempts, taskID: taskID ?? item.taskID, message: item.message,
        leaseUntil: item.leaseUntil)
    }
    func record(
      origin: String? = "https://library.inspirai.store", state: String = "queued",
      leased: Bool = false
    ) -> OutboxItem {
      let raw = "  原始标题\n原始正文 https://example.com?q=1#source\n"
      let parts = [
        SharedPart(item: 0, attachment: 0, kind: "text", representation: "text/plain", value: raw),
        SharedPart(item: 0, attachment: 1, kind: "text", representation: "text/plain", value: raw),
      ]
      let submission = Submission(
        id: UUID(), parts: parts, requirements: "完整要求", autoArchive: false, tags: ["阅读"],
        deviceId: "offline-worker", agent: "codex")
      let share = SavedShare(
        submission: submission, originalParts: parts, additionalRequirements: "完整要求",
        createdAt: ISO8601DateFormatter().date(from: "2026-10-09T14:30:00+08:00")!)
      return .init(
        id: submission.submissionId, share: share, origin: origin, state: state, attempts: 3,
        taskID: nil, message: nil, leaseUntil: leased ? Date().timeIntervalSince1970 + 120 : nil)
    }
  }
  func testUnboundRequiresConfirmationAndPreservesEntireSubmission() async throws {
    let h = Harness()
    h.items = [h.record(origin: nil)]
    let original = h.items[0]
    let m = NativeOutboxModel(dependencies: h.dependencies)
    m.reload()
    await m.retry(original.id)
    XCTAssertTrue(h.sends.isEmpty)
    m.requestBinding(original.id)
    XCTAssertNotNil(m.binding)
    XCTAssertTrue(h.binds.isEmpty)
    await m.confirmBinding()
    XCTAssertEqual(h.binds, ["https://library.inspirai.store"])
    XCTAssertEqual(h.sends, [original.id])
    XCTAssertEqual(m.items[0].share, original.share)
    XCTAssertEqual(m.items[0].state, "submitted")
  }
  func testChangedServerOrDeviceInvalidatesBindingBeforeMutation() async {
    for changeServer in [true, false] {
      let h = Harness()
      h.items = [h.record(origin: nil)]
      let m = NativeOutboxModel(dependencies: h.dependencies)
      m.reload()
      m.requestBinding(h.items[0].id)
      h.credential = .init(
        origin: changeServer ? "https://other.example" : "https://library.inspirai.store",
        deviceID: "other-owner", name: "审核", token: "fixture")
      await m.confirmBinding()
      XCTAssertTrue(h.binds.isEmpty)
      XCTAssertTrue(h.sends.isEmpty)
      XCTAssertNil(h.items[0].origin)
    }
  }
  func testBindingMustBeDurablyConfirmedBeforeSend() async {
    let h = Harness()
    h.items = [h.record(origin: nil)]
    h.ignoreBinding = true
    let m = NativeOutboxModel(dependencies: h.dependencies)
    m.reload()
    m.requestBinding(h.items[0].id)
    await m.confirmBinding()
    XCTAssertTrue(h.sends.isEmpty)
    XCTAssertNotNil(m.notice)
    XCTAssertNil(m.items[0].origin)
  }
  func testMismatchLeaseSubmittedOfflineAndUnpairedCannotSend() async {
    let h = Harness()
    h.items = [
      h.record(origin: "https://archive.example.com"), h.record(leased: true),
      h.record(state: "submitted"),
    ]
    let m = NativeOutboxModel(dependencies: h.dependencies)
    m.reload()
    for i in h.items {
      XCTAssertFalse(m.canSend(i))
      await m.retry(i.id)
    }
    XCTAssertTrue(h.sends.isEmpty)
    h.items = [h.record()]
    m.reload()
    m.setOffline(true)
    await m.retry(h.items[0].id)
    m.setOffline(false)
    h.credential = nil
    m.reload()
    await m.retry(h.items[0].id)
    XCTAssertTrue(h.sends.isEmpty)
  }
  func testSubmittedTaskCanOnlyOpenForCurrentAuthorizedServer() {
    let h = Harness()
    h.items = [
      h.updated(h.record(state: "submitted"), taskID: "current-task"),
      h.updated(h.record(origin: "https://other.example", state: "submitted"), taskID: "other-task"),
    ]
    let m = NativeOutboxModel(dependencies: h.dependencies)
    m.reload()
    XCTAssertTrue(m.canOpenTask(h.items[0]))
    XCTAssertFalse(m.canOpenTask(h.items[1]))
    m.invalidateSession(expired: true)
    XCTAssertFalse(m.canOpenTask(h.items[0]))
    h.credential = nil
    m.invalidateSession(expired: false)
    XCTAssertFalse(m.canOpenTask(h.items[0]))
  }
  func testRetriesReuseIDAndFailureNeverDiscardsOriginal() async {
    let h = Harness()
    h.items = [h.record()]
    let original = h.items[0]
    h.error = URLError(.timedOut)
    let m = NativeOutboxModel(dependencies: h.dependencies)
    m.reload()
    await m.retry(original.id)
    XCTAssertTrue(m.offline)
    XCTAssertEqual(m.items[0].share, original.share)
    XCTAssertEqual(m.items[0].state, "queued")
    m.refresh()
    h.error = nil
    await m.retry(original.id)
    XCTAssertEqual(h.sends, [original.id, original.id])
    XCTAssertEqual(m.items[0].share, original.share)
    XCTAssertEqual(m.items[0].state, "submitted")
  }
  func testBatchOnlyCurrentQueuedAndStopsOnUnconfirmedResult() async {
    let h = Harness()
    let queued = h.record()
    h.items = [
      queued, h.record(origin: nil), h.record(origin: "https://other.example"),
      h.record(state: "blocked"), h.record(leased: true), h.record(),
    ]
    h.error = CollectorError.message("尚未确认")
    let m = NativeOutboxModel(dependencies: h.dependencies)
    m.reload()
    await m.retryQueued()
    XCTAssertEqual(h.sends, [queued.id])
    XCTAssertEqual(m.items.count, 6)
  }
  func testReloadErrorsRetainRecordsAndCopyIsVerbatim() {
    let h = Harness()
    h.items = [h.record()]
    let m = NativeOutboxModel(dependencies: h.dependencies)
    m.reload()
    let original = m.items[0]
    h.listFails = true
    m.reload()
    XCTAssertEqual(m.items[0].share, original.share)
    h.listFails = false
    h.keychainFails = true
    m.reload()
    XCTAssertFalse(m.paired)
    XCTAssertEqual(m.items[0].share, original.share)
    m.copyOriginal(original)
    XCTAssertEqual(h.copied, original.share.originalParts[0].value)
    XCTAssertEqual(original.nativeDate, "2026-10-09  14:30")
  }
  func testConcurrentRetryAndExpiredAuthorizationPreserveContent() async {
    let h = Harness()
    h.items = [h.record()]
    h.delay = true
    let m = NativeOutboxModel(dependencies: h.dependencies)
    m.reload()
    let id = h.items[0].id
    async let a: Void = m.retry(id)
    async let b: Void = m.retry(id)
    _ = await (a, b)
    XCTAssertEqual(h.sends, [id])
    h.items = [h.record()]
    h.delay = false
    h.error = CollectorError.http(401)
    m.reload()
    await m.retry(h.items[0].id)
    XCTAssertTrue(m.expired)
    XCTAssertFalse(m.canSend(m.items[0]))
    XCTAssertEqual(m.items[0].share.originalParts.count, 2)
  }
}
