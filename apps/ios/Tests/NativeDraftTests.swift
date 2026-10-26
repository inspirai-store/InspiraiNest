import XCTest

@testable import PersonalLibrary

private actor DraftServiceStub: NativeDraftService {
  let id = "00000000-0000-0000-0000-000000000003"
  var packet = NativeDraftFixture.makePacket()
  var version: String { ReadFile.digest(packet) }
  var stateValue = "awaiting_review"
  var error: Error?
  var corrupt = false
  var delay: UInt64 = 0
  var stateReads = 0
  var changeAfterRead = false
  var owner = true
  var submissions: [(String, String)] = []
  func setup(
    error: Error? = nil, corrupt: Bool = false, delay: UInt64 = 0,
    changeAfterRead: Bool = false, owner: Bool = true
  ) {
    self.error = error
    self.corrupt = corrupt
    self.delay = delay
    self.changeAfterRead = changeAfterRead
    self.owner = owner
  }
  func change() { packet = NativeDraftFixture.makePacket(version: 1) }
  func terminal(_ state: String) { stateValue = state }
  func removeTranscript() throws {
    var json = try JSONSerialization.jsonObject(with: packet) as! [String: Any]
    json["files"] = (json["files"] as! [[String: Any]]).filter {
      $0["role"] as? String != "transcript"
    }
    packet = try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
  }
  func state() async throws -> ServerState {
    stateReads += 1
    let task = LibraryTask(
      id: id, submissionId: "stable-source-id", content: "原文完整保留",
      url: nil, state: stateValue, events: [], deviceId: "original-worker",
      archiveId: stateValue == "completed" ? version : nil, draftId: version,
      createdAt: "2026-10-09T14:30:00+08:00")
    if delay > 0 { try await Task.sleep(nanoseconds: delay) }
    if let error { throw error }
    return ServerState(
      me: Device(
        id: "owner", name: "Test", role: owner ? "owner" : "worker",
        revokedAt: nil, online: nil, agents: nil), devices: [], tasks: [task], archives: [])
  }
  func draft(_ id: String, expectedDigest: String) async throws -> DraftBundle {
    let captured = packet
    guard expectedDigest == ReadFile.digest(captured) else { throw CollectorError.http(409) }
    if changeAfterRead { change() }
    var data = captured
    if corrupt {
      var json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
      var files = json["files"] as! [[String: Any]]
      files[0]["sha256"] = String(repeating: "0", count: 64)
      json["files"] = files
      data = try JSONSerialization.data(withJSONObject: json)
    }
    return try JSONDecoder().decode(DraftBundle.self, from: data)
  }
  func approveDraft(_ id: String, expectedDigest: String) async throws {
    submissions.append((id, expectedDigest))
    guard version == expectedDigest else { throw CollectorError.http(409) }
    stateValue = "completed"
  }
  func calls() -> Int { submissions.count }
}

@MainActor final class NativeDraftTests: XCTestCase {
  private let id = "00000000-0000-0000-0000-000000000003"
  private func assertCalls(_ service: DraftServiceStub, _ expected: Int) async {
    let count = await service.calls()
    XCTAssertEqual(count, expected)
  }
  func testVerifiedFilesCategoriesOmissionsAndRelativeLinks() async {
    let service = DraftServiceStub()
    let model = NativeDraftModel(service: service)
    await model.load(id)
    XCTAssertEqual(model.phase, .ready)
    XCTAssertTrue(model.canApprove)
    XCTAssertEqual(model.bundle?.omitted, ["recording.mp4"])
    XCTAssertEqual(model.coverage, "待补齐")
    for index in 0...3 {
      model.chooseCategory(index)
      XCTAssertNotNil(model.selectedData)
    }
    model.chooseCategory(1)
    XCTAssertEqual(model.localFile("../architecture.pdf")?.path, "architecture.pdf")
    XCTAssertNil(model.localFile("../../secret"))
    XCTAssertNil(model.localFile("https://example.com/image.png"))
    XCTAssertNil(model.localFile("/layout.png"))
    model.chooseCategory(4)
    XCTAssertEqual(model.files(in: 4).count, 6)
  }
  func testCorruptAttachmentStopsEntirePreviewAndApproval() async {
    let service = DraftServiceStub()
    await service.setup(corrupt: true)
    let model = NativeDraftModel(service: service)
    await model.load(id)
    XCTAssertEqual(model.phase, .integrity)
    XCTAssertNil(model.bundle)
    model.requestApproval()
    await model.approve()
    await assertCalls(service, 0)
  }
  func testVersionChangedWhileReadingKeepsReviewedContentButDisablesApproval() async {
    let service = DraftServiceStub()
    await service.setup(changeAfterRead: true)
    let model = NativeDraftModel(service: service)
    await model.load(id)
    XCTAssertEqual(model.phase, .changed)
    XCTAssertNotNil(model.bundle)
    XCTAssertFalse(model.canApprove)
    model.requestApproval()
    await model.approve()
    await assertCalls(service, 0)
    await service.setup()
    await model.reload()
    XCTAssertEqual(model.phase, .ready)
    XCTAssertTrue(String(data: model.selectedData!, encoding: .utf8)!.contains("补充核验"))
  }
  func testApprovalRequiresConfirmationAndExactReviewedVersion() async {
    let service = DraftServiceStub()
    let model = NativeDraftModel(service: service)
    await model.load(id)
    await model.approve()
    await assertCalls(service, 0)
    model.requestApproval()
    await model.approve()
    XCTAssertEqual(model.phase, .archived)
    await assertCalls(service, 1)
    model.requestApproval()
    await model.approve()
    await assertCalls(service, 1)
    XCTAssertEqual(model.task?.submissionId, "stable-source-id")
    XCTAssertEqual(model.task?.deviceId, "original-worker")
  }
  func testVersionChangesAfterDialogPreventPost() async {
    let service = DraftServiceStub()
    let model = NativeDraftModel(service: service)
    await model.load(id)
    model.requestApproval()
    await service.change()
    await model.approve()
    XCTAssertEqual(model.phase, .changed)
    await assertCalls(service, 0)
  }
  func testPollingClosesConfirmationWhenTaskWasCancelled() async {
    let service = DraftServiceStub()
    let model = NativeDraftModel(service: service)
    await model.load(id)
    model.requestApproval()
    await service.terminal("cancelled")
    await model.checkVersion()
    XCTAssertEqual(model.phase, .terminal)
    XCTAssertFalse(model.confirmation)
    XCTAssertFalse(model.canApprove)
  }
  func testSessionChangeDiscardsInFlightPrivateDraftAndCredentials() async throws {
    let service = DraftServiceStub()
    await service.setup(delay: 150_000_000)
    let model = NativeDraftModel(service: service)
    let read = Task { await model.load(id) }
    try await Task.sleep(nanoseconds: 30_000_000)
    model.configure(service: nil)
    await read.value
    XCTAssertEqual(model.phase, .unpaired)
    XCTAssertNil(model.bundle)
    XCTAssertNil(model.task)
    XCTAssertFalse(model.loading)
  }
  func testRevokedOrNonOwnerSessionClearsPreviouslyReadFiles() async {
    let service = DraftServiceStub()
    let model = NativeDraftModel(service: service)
    await model.load(id)
    await service.setup(error: CollectorError.http(401))
    await model.checkVersion()
    XCTAssertEqual(model.phase, .expired)
    XCTAssertNil(model.bundle)
    XCTAssertFalse(model.canApprove)
    await service.setup(owner: false)
    model.configure(service: service)
    await model.load(id)
    XCTAssertEqual(model.phase, .expired)
  }
  func testOfflineRetainsVerifiedContentAndRequiresRecheckAfterReconnect() async {
    let service = DraftServiceStub()
    let model = NativeDraftModel(service: service)
    await model.load(id)
    model.requestApproval()
    model.setOffline(true)
    XCTAssertEqual(model.phase, .offline)
    XCTAssertNotNil(model.bundle)
    XCTAssertFalse(model.confirmation)
    await model.approve()
    await assertCalls(service, 0)
    await service.change()
    model.setOffline(false)
    await model.checkVersion()
    XCTAssertFalse(model.canApprove)
  }
  func testTransportFailureCanRecoverWithFreshVerifiedRead() async {
    let service = DraftServiceStub()
    await service.setup(error: CollectorError.http(503))
    let model = NativeDraftModel(service: service)
    await model.load(id)
    XCTAssertEqual(model.phase, .failure)
    XCTAssertFalse(model.canApprove)
    await service.setup()
    await model.reload()
    XCTAssertEqual(model.phase, .ready)
  }
  func testOfflineDuringVersionRefreshStaysOffline() async throws {
    let service = DraftServiceStub()
    let model = NativeDraftModel(service: service)
    await model.load(id)
    await service.setup(delay: 150_000_000)
    let read = Task { await model.checkVersion() }
    try await Task.sleep(nanoseconds: 30_000_000)
    model.setOffline(true)
    await read.value
    XCTAssertEqual(model.phase, .offline)
    XCTAssertNotNil(model.bundle)
    XCTAssertFalse(model.canApprove)
  }
  func testLatestReadCanReplaceAnUnfinishedNavigationRead() async throws {
    let service = DraftServiceStub()
    await service.setup(delay: 150_000_000)
    let model = NativeDraftModel(service: service)
    let old = Task { await model.load(id) }
    try await Task.sleep(nanoseconds: 30_000_000)
    await service.change()
    let replacement = Task { await model.load(id) }
    await old.value
    await replacement.value
    XCTAssertEqual(model.phase, .ready)
    XCTAssertFalse(model.loading)
    XCTAssertTrue(model.canApprove)
    XCTAssertTrue(String(data: model.selectedData!, encoding: .utf8)!.contains("补充核验"))
  }
  func testMissingCategoryDoesNotInventAnAttachment() async throws {
    let service = DraftServiceStub()
    try await service.removeTranscript()
    let model = NativeDraftModel(service: service)
    await model.load(id)
    model.chooseCategory(2)
    XCTAssertNil(model.selected)
    XCTAssertNil(model.selectedData)
    XCTAssertTrue(model.files(in: 2).isEmpty)
    XCTAssertEqual(model.files.count, 5)
    XCTAssertTrue(model.canApprove)
  }
}
