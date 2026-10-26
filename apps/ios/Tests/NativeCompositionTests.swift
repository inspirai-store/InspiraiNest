import XCTest
@testable import PersonalLibrary

@MainActor
final class NativeCompositionTests: XCTestCase {
  private var directory: URL!
  private var box: Outbox!
  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    box = try Outbox(directory: directory)
  }
  override func tearDownWithError() throws { try? FileManager.default.removeItem(at: directory) }
  private func draft(_ text: String = "  原文\n\nhttps://example.com?q=1&q=2#章节  ") -> LocalComposition {
    LocalComposition(parts: [SharedPart(item: 0, attachment: nil, kind: "text", representation: nil, value: text)])
  }
  private func record(_ draft: LocalComposition) -> SavedShare {
    SavedShare(submission: Submission(id: UUID(uuidString: draft.id)!, parts: draft.parts,
      requirements: draft.requirements, autoArchive: draft.autoArchive,
      tags: Submission.tags(from: draft.tags), deviceId: draft.deviceID.isEmpty ? nil : draft.deviceID,
      agent: draft.agent.isEmpty ? nil : draft.agent), originalParts: draft.parts,
      additionalRequirements: draft.requirements, createdAt: draft.createdAt)
  }
  private func dependencies(credential: DeviceCredential? = nil, cancelled: @escaping () -> Void = {}) -> ShareDependencies {
    ShareDependencies(capture: { ShareCaptureResult(parts: self.draft().parts, omittedAttachments: 0) },
      credential: { credential }, cachedDevices: { _ in [] }, refreshDevices: { _ in [] },
      persist: { try self.box.insert($0, origin: $1) }, send: { _, _ in throw URLError(.timedOut) },
      complete: {}, cancel: cancelled, openMainApp: { _ in true },
      saveComposition: { try self.box.saveComposition($0) })
  }
  func testDraftReopensWithEveryFieldAndVerbatimUnicode() throws {
    var original = draft()
    original.requirements = "  要求\n第二段😀"
    original.tags = "原生，阅读"
    original.autoArchive = false
    original.deviceID = UUID().uuidString.lowercased()
    original.agent = "codex"
    original.origin = "https://one.example"
    let stored = try box.saveComposition(original)
    let reopened = try Outbox(directory: directory).compositions()
    XCTAssertEqual(reopened, [stored])
    XCTAssertEqual(stored.original, original.original)
    XCTAssertTrue(try box.list().isEmpty)
  }
  func testStaleWindowCannotOverwriteNewerDraft() throws {
    let first = try box.saveComposition(draft())
    var second = first
    second.requirements = "新要求"
    let current = try Outbox(directory: directory).saveComposition(second)
    XCTAssertThrowsError(try box.saveComposition(first))
    XCTAssertEqual(try box.compositions(), [current])
  }
  func testDeletionRequiresCurrentRevisionAndPreventsResurrection() throws {
    let first = try box.saveComposition(draft())
    let next = try box.saveComposition(first)
    XCTAssertThrowsError(try box.deleteComposition(id: first.id, revision: first.revision))
    try box.deleteComposition(id: next.id, revision: next.revision)
    XCTAssertTrue(try box.compositions().isEmpty)
    XCTAssertThrowsError(try box.saveComposition(next))
    XCTAssertThrowsError(try box.insert(record(next), origin: nil))
    XCTAssertTrue(try box.list().isEmpty)
  }
  func testPromotionIsAtomicAndQueuedPayloadCannotBecomeEditableAgain() throws {
    let stored = try box.saveComposition(draft())
    let frozen = record(stored)
    try box.insert(frozen, origin: nil)
    let reopened = try Outbox(directory: directory)
    XCTAssertTrue(try reopened.compositions().isEmpty)
    XCTAssertEqual(try reopened.list().first?.share, frozen)
    XCTAssertThrowsError(try reopened.saveComposition(stored))
    XCTAssertThrowsError(try reopened.insert(frozen, origin: nil))
    XCTAssertEqual(try reopened.list().count, 1)
  }
  func testStalePromotionRollsBackWithoutLosingCurrentDraft() throws {
    let first = try box.saveComposition(draft())
    var changed = first
    changed.parts = draft("新内容").parts
    let latest = try box.saveComposition(changed)
    XCTAssertThrowsError(try box.insert(record(first), origin: nil))
    XCTAssertEqual(try box.compositions(), [latest])
    XCTAssertTrue(try box.list().isEmpty)
  }
  func testManualEditsAutosaveWithoutPairingAndReturnRestoresFields() throws {
    var cancelled = false
    let model = ShareModel(dependencies: dependencies(cancelled: { cancelled = true }), composition: LocalComposition())
    model.editableOriginal = draft().original
    model.requirements = "保留\n空格  与换行"
    model.tags = "原生,阅读"
    model.autoArchive = false
    model.agent = "codebuddy"
    model.deviceID = "离线电脑"
    model.cancel()
    XCTAssertTrue(cancelled)
    let saved = try XCTUnwrap(box.compositions().first)
    let restored = ShareModel(dependencies: dependencies(), composition: saved)
    XCTAssertEqual(restored.editableOriginal, model.editableOriginal)
    XCTAssertEqual(restored.requirements, model.requirements)
    XCTAssertEqual(restored.deviceID, "离线电脑")
    XCTAssertEqual(restored.agent, "codebuddy")
    XCTAssertFalse(restored.autoArchive)
    XCTAssertFalse(restored.loading)
  }
  func testEmptyCompositionDoesNotCreateEmptyDraftOnReturn() throws {
    let model = ShareModel(dependencies: dependencies(), composition: LocalComposition())
    model.cancel()
    XCTAssertTrue(try box.compositions().isEmpty)
  }
  func testDispatchOptionsSaveBeforeEnteringOriginal() throws {
    let model = ShareModel(dependencies: dependencies(), composition: LocalComposition())
    model.autoArchive = false
    model.agent = "codex"
    model.deviceID = UUID().uuidString.lowercased()
    model.cancel()
    let saved = try XCTUnwrap(box.compositions().first)
    XCTAssertTrue(saved.original.isEmpty)
    let restored = ShareModel(dependencies: dependencies(), composition: saved)
    XCTAssertEqual(restored.deviceID, model.deviceID)
    XCTAssertEqual(restored.agent, "codex")
    XCTAssertFalse(restored.autoArchive)
    XCTAssertTrue(try box.list().isEmpty)
  }
  func testOverLimitSubmissionStaysEditableAndUntruncated() async throws {
    let model = ShareModel(dependencies: dependencies(), composition: LocalComposition())
    model.editableOriginal = String(repeating: "😀", count: 5001)
    await model.save()
    XCTAssertFalse(model.saved)
    XCTAssertTrue(try box.list().isEmpty)
    XCTAssertEqual(try box.compositions().first?.original.utf16.count, 10002)
  }
  func testExplicitUnpairedSubmitUsesDraftIDAndRetiresComposition() async throws {
    let original = draft()
    let model = ShareModel(dependencies: dependencies(), composition: original)
    await model.save()
    XCTAssertTrue(model.saved)
    XCTAssertFalse(model.submitted)
    XCTAssertTrue(try box.compositions().isEmpty)
    let queued = try XCTUnwrap(box.list().first)
    XCTAssertEqual(queued.id, original.id)
    XCTAssertNil(queued.origin)
    XCTAssertEqual(queued.share.originalParts, original.parts)
  }
  func testTimeoutAfterPromotionKeepsOneImmutableRecordWithOriginalID() async throws {
    let credential = DeviceCredential(origin: "https://one.example", deviceID: UUID().uuidString,
      name: "fixture", token: "fixture")
    let original = draft()
    let model = ShareModel(dependencies: dependencies(credential: credential), composition: original)
    await model.loadDevices()
    await model.save()
    await model.save()
    XCTAssertTrue(model.saved)
    XCTAssertFalse(model.submitted)
    XCTAssertEqual(try box.list().map(\.id), [original.id])
    XCTAssertTrue(try box.compositions().isEmpty)
  }
  func testSharedOriginalAlsoAutosavesBeforeUserConfirms() async throws {
    let model = ShareModel(dependencies: dependencies())
    await model.capture()
    model.requirements = "追加要求"
    model.cancel()
    let saved = try XCTUnwrap(box.compositions().first)
    XCTAssertFalse(saved.manual)
    XCTAssertEqual(saved.original, draft().original)
    XCTAssertEqual(saved.requirements, "追加要求")
    XCTAssertTrue(try box.list().isEmpty)
  }
  func testCredentialChangeBeforeDeviceRefreshCannotRebindDraft() async throws {
    var current: DeviceCredential? = DeviceCredential(origin: "https://one.example",
      deviceID: UUID().uuidString, name: "fixture", token: "fixture")
    var sends = 0
    var deps = dependencies()
    deps.credential = { current }
    deps.send = { _, _ in sends += 1; return true }
    let model = ShareModel(dependencies: deps, composition: LocalComposition())
    model.editableOriginal = "原文"
    XCTAssertEqual(try box.compositions().first?.origin, "https://one.example")
    current = DeviceCredential(origin: "https://two.example", deviceID: UUID().uuidString,
      name: "fixture", token: "fixture")
    model.requirements = "追加要求"
    await model.loadDevices()
    XCTAssertEqual(model.dispatchFailure, "草稿属于另一台服务器")
    await model.save()
    XCTAssertTrue(model.saved)
    XCTAssertEqual(try box.list().first?.origin, "https://one.example")
    XCTAssertEqual(sends, 0)
  }
  func testSharedDraftRetainsOmittedAttachmentBusinessCopy() async throws {
    var deps = dependencies()
    deps.capture = { ShareCaptureResult(parts: self.draft().parts, omittedAttachments: 2) }
    let model = ShareModel(dependencies: deps)
    await model.capture()
    model.cancel()
    let saved = try XCTUnwrap(box.compositions().first)
    XCTAssertEqual(saved.omittedAttachments, 2)
    let restored = ShareModel(dependencies: dependencies(), composition: saved)
    XCTAssertEqual(restored.omittedAttachments, 2)
    XCTAssertEqual(restored.captureNotice, model.captureNotice)
  }
  func testPairingDisappearingStillPreservesDraftOrigin() async throws {
    var current: DeviceCredential? = DeviceCredential(origin: "https://one.example",
      deviceID: UUID().uuidString, name: "fixture", token: "fixture")
    var deps = dependencies()
    deps.credential = { current }
    let model = ShareModel(dependencies: deps, composition: LocalComposition())
    model.editableOriginal = "原文"
    current = nil
    model.tags = "阅读"
    await model.save()
    XCTAssertTrue(model.saved)
    XCTAssertFalse(model.submitted)
    XCTAssertEqual(try box.list().first?.origin, "https://one.example")
  }
  func testFailedAutosavePreventsReturnAndPromotionUntilRecovery() async throws {
    var writesFail = true
    var cancelled = false
    var deps = dependencies(cancelled: { cancelled = true })
    deps.saveComposition = { draft in
      if writesFail { throw CollectorError.message("草稿保存失败") }
      return try self.box.saveComposition(draft)
    }
    let model = ShareModel(dependencies: deps, composition: draft())
    model.requirements = "新要求"
    model.cancel()
    await model.save()
    XCTAssertFalse(cancelled)
    XCTAssertFalse(model.saved)
    writesFail = false
    model.cancel()
    XCTAssertTrue(cancelled)
    XCTAssertEqual(try box.compositions().first?.requirements, "新要求")
  }
}
