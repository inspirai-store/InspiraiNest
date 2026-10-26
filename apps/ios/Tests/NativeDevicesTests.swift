import XCTest
@testable import PersonalLibrary

private actor DevicesStub: NativeDevicesService {
  var me: Device
  var devices: [Device]
  var revocations: [String] = []
  var stateError: Error?
  var revokeError: Error?
  var delay: UInt64 = 0
  var replaceOnRead: [Device]?
  var failAfterRevoke = false
  init(_ devices: [Device], me: Device) { self.devices = devices; self.me = me }
  func setup(stateError: Error? = nil, revokeError: Error? = nil, delay: UInt64 = 0,
    replace: [Device]? = nil, failAfterRevoke: Bool = false) {
    self.stateError = stateError; self.revokeError = revokeError; self.delay = delay
    replaceOnRead = replace; self.failAfterRevoke = failAfterRevoke
  }
  func state() async throws -> ServerState {
    let captured = devices
    if delay > 0 { try await Task.sleep(nanoseconds: delay) }
    if let stateError { throw stateError }
    let resolved = replaceOnRead ?? captured
    devices = resolved; replaceOnRead = nil
    return ServerState(me: me, devices: resolved.filter { $0.revokedAt == nil }, tasks: [], archives: [])
  }
  func revoke(_ id: String) async throws {
    revocations.append(id)
    if delay > 0 { try await Task.sleep(nanoseconds: delay) }
    if let revokeError { throw revokeError }
    devices = devices.map { $0.id == id ? Device(id: $0.id, name: $0.name, role: $0.role,
      revokedAt: "2026-10-11T10:00:00Z", online: false, agents: nil) : $0 }
    if failAfterRevoke { stateError = CollectorError.http(503) }
  }
}

@MainActor final class NativeDevicesTests: XCTestCase {
  private func device(_ i: Int, role: String = "worker", revoked: Bool = false, online: Bool? = true) -> Device {
    Device(id: NativeDevicesFixture.id(i), name: i == 0 ? "当前设备" : "电脑\(i)", role: role,
      revokedAt: revoked ? "2026-10-10" : nil, online: online, agents: ["Codex", "CodeBuddy"])
  }
  private func make(_ others: [Device]) -> (NativeDevicesModel, DevicesStub) {
    let me = device(0, role: "owner")
    let s = DevicesStub([me] + others, me: me)
    return (NativeDevicesModel(service: s, origin: "https://fixture.invalid:8443"), s)
  }
  func testCurrentDeviceIsSeparateAndDuplicatesDoNotCreateFakeRows() async {
    let d = device(1); let (m, _) = make([d, d, device(2)])
    await m.reload()
    XCTAssertEqual(m.me?.nativeDeviceRole, "管理端")
    XCTAssertEqual(m.others.map(\.id), [d.id, device(2).id])
    XCTAssertEqual(m.host, "fixture.invalid:8443")
  }
  func testBusinessLabelsDoNotInventOnlineOrAgents() {
    XCTAssertEqual(device(1, online: nil).nativeDeviceStatus, "状态未知")
    XCTAssertEqual(device(1, role: "owner", online: false).nativeDeviceStatus, "已授权")
    XCTAssertEqual(device(1, revoked: true).nativeDeviceStatus, "已撤销")
    XCTAssertTrue(device(1, revoked: true).nativeAgents.isEmpty)
    XCTAssertTrue(device(1, role: "owner").nativeAgents.isEmpty)
    let d = Device(id: device(1).id, name: "", role: "other", revokedAt: nil, online: nil, agents: nil)
    XCTAssertEqual(d.nativeDeviceName, "未命名设备"); XCTAssertEqual(d.nativeDeviceRole, "设备")
  }
  func testRevokeRequiresExplicitConfirmAndCancelDoesNotCallAPI() async {
    let d = device(1); let (m, s) = make([d]); await m.reload()
    await m.confirm()
    m.requestRevoke(d.id); m.confirmation = nil; await m.confirm()
    let calls = await s.revocations; XCTAssertTrue(calls.isEmpty)
    m.requestRevoke(d.id); await m.confirm()
    let performed = await s.revocations; XCTAssertEqual(performed, [d.id])
    XCTAssertTrue(m.others.isEmpty); XCTAssertFalse(m.canRevoke(d.id))
  }
  func testCurrentUnknownAndRevokedDevicesCannotBeRevoked() async {
    let d = device(1, revoked: true); let (m, s) = make([d]); await m.reload()
    for id in [device(0).id, d.id, device(8).id] { m.requestRevoke(id); await m.confirm() }
    let calls = await s.revocations; XCTAssertTrue(calls.isEmpty)
  }
  func testRevalidateIfDeviceAlreadyRevokedBeforeConfirmation() async {
    let d = device(1); let (m, s) = make([d]); await m.reload(); m.requestRevoke(d.id)
    await s.setup(replace: [device(0, role: "owner"), device(1, revoked: true)])
    await m.confirm()
    let calls = await s.revocations; XCTAssertTrue(calls.isEmpty)
    XCTAssertEqual(m.notice, "设备状态已变化")
  }
  func testExpiredAuthorizationClearsDeviceDetailsAndRoutes() async {
    let d = device(1); let (m, s) = make([d]); await m.reload(); m.open(d.id, tablet: false)
    m.requestRevoke(d.id); await s.setup(revokeError: CollectorError.http(401)); await m.confirm()
    XCTAssertEqual(m.phase, .expired); XCTAssertNil(m.me); XCTAssertTrue(m.others.isEmpty)
    XCTAssertTrue(m.path.isEmpty); XCTAssertNil(m.confirmation); XCTAssertTrue(m.origin.isEmpty)
  }
  func testRevocationFailureKeepsActualDeviceWithoutSuccess() async {
    let d = device(1); let (m, s) = make([d]); await m.reload()
    await s.setup(revokeError: CollectorError.http(503)); m.requestRevoke(d.id); await m.confirm()
    XCTAssertNil(m.others[0].revokedAt); XCTAssertEqual(m.notice, "撤销未确认完成")
    XCTAssertTrue(m.canRevoke(d.id))
  }
  func testAcknowledgedRevokeStaysDisabledWhenFollowupReadFails() async {
    let d = device(1); let (m, s) = make([d]); await m.reload()
    await s.setup(failAfterRevoke: true); m.requestRevoke(d.id); await m.confirm()
    XCTAssertNotNil(m.others[0].revokedAt); XCTAssertFalse(m.canRevoke(d.id))
  }
  func testOfflineClearsRemoteConfirmationAndDoesNotRevoke() async {
    let d = device(1); let (m, s) = make([d]); await m.reload(); m.requestRevoke(d.id)
    m.setOffline(true); await m.confirm(); m.requestRevoke(d.id); await m.confirm()
    let calls = await s.revocations; XCTAssertTrue(calls.isEmpty)
    XCTAssertEqual(m.others[0].name, d.name); XCTAssertEqual(m.phase, .offline)
  }
  func testRemovingLocalLoginDoesNotRevokeAndWorksOffline() async {
    let me = device(0, role: "owner"); let s = DevicesStub([me], me: me)
    var calls = 0
    let m = NativeDevicesModel(service: s, forget: { calls += 1 })
    await m.reload(); m.requestForget(tablet: false); m.confirmation = nil; await m.confirm()
    XCTAssertEqual(calls, 0)
    m.setOffline(true); m.requestForget(tablet: false); await m.confirm()
    let remote = await s.revocations; XCTAssertTrue(remote.isEmpty)
    XCTAssertEqual(calls, 1); XCTAssertEqual(m.phase, .unpaired)
  }
  func testRealKeychainRemovalKeepsPersistentOutboxAndSubmissionID() throws {
    // This test must run under the dedicated unit bundle/group, never production identity.
    XCTAssertTrue(try SharedConfiguration.value("CollectorAppGroup").hasSuffix("devices.unit"))
    XCTAssertTrue(try SharedConfiguration.value("CollectorKeychainGroup").hasSuffix("devices.unit"))
    let credentials = CredentialStore()
    try credentials.clear(); defer { try? credentials.clear() }
    let parts = [SharedPart(item: 0, attachment: nil, kind: "text", representation: "public.plain-text", value: "  原文\nhttps://example.com?part=1#source\n")]
    let share = SavedShare(submission: Submission(id: UUID(), parts: parts, requirements: "核对来源"),
      originalParts: parts, additionalRequirements: "核对来源", createdAt: Date(timeIntervalSince1970: 123))
    let box = try Outbox.shared(); try box.insert(share, origin: "https://fixture.invalid")
    try credentials.save(DeviceCredential(origin: "https://fixture.invalid", deviceID: device(0).id,
      name: "测试设备", token: "unit-only-placeholder"))
    let app = AppModel(); XCTAssertTrue(app.paired); let before = app.sessionID
    try app.forget().get()
    XCTAssertFalse(app.paired); XCTAssertNil(try credentials.load()); XCTAssertNotEqual(app.sessionID, before)
    XCTAssertNil(app.snapshot)
    let item = try XCTUnwrap(Outbox.shared().list().first { $0.id == share.submission.submissionId })
    XCTAssertEqual(item.share, share); XCTAssertEqual(item.origin, "https://fixture.invalid")
    XCTAssertEqual(item.id, share.submission.submissionId)
  }
  func testLocalCredentialRemovalFailureDoesNotPretendLoggedOut() async {
    let me = device(0, role: "owner"); let s = DevicesStub([me], me: me)
    let m = NativeDevicesModel(service: s, forget: { throw CollectorError.message("Locked") })
    await m.reload(); m.requestForget(tablet: true); await m.confirm()
    XCTAssertNotNil(m.me); XCTAssertEqual(m.notice, "移除登录未完成")
  }
  func testLocalEnrollmentCanBeRemovedOfflineBeforeRemoteListLoads() async {
    let me = device(0, role: "owner"); let s = DevicesStub([me], me: me); var forgotten = false
    let m = NativeDevicesModel()
    m.configure(service: s, origin: "https://fixture.invalid", localDevice: me, forget: { forgotten = true })
    m.setOffline(true)
    XCTAssertNotNil(m.me); XCTAssertFalse(m.hasLoaded)
    m.requestForget(tablet: false); await m.confirm()
    XCTAssertTrue(forgotten); XCTAssertEqual(m.phase, .unpaired)
    let remote = await s.revocations; XCTAssertTrue(remote.isEmpty)
  }
  func testSessionChangeRejectsOldReadAndConfirmationCompletion() async throws {
    let d = device(1); let (m, s) = make([d]); await m.reload(); await s.setup(delay: 100_000_000)
    let pending = Task { await m.reload() }
    try await Task.sleep(nanoseconds: 20_000_000); m.configure(service: nil, expired: true)
    await pending.value; XCTAssertNil(m.me); XCTAssertTrue(m.others.isEmpty)
    XCTAssertEqual(m.phase, .expired)
  }
  func testDuplicateConfirmationDoesNotSubmitTwice() async throws {
    let d = device(1); let (m, s) = make([d]); await m.reload(); await s.setup(delay: 80_000_000)
    m.requestRevoke(d.id); let pending = Task { await m.confirm() }
    try await Task.sleep(nanoseconds: 20_000_000); m.confirmation = .revoke(d.id); await m.confirm()
    await pending.value; let calls = await s.revocations; XCTAssertEqual(calls, [d.id])
  }
  func testInvalidCurrentAuthorizationCannotExposeDeviceList() async {
    for me in [device(0, role: "worker"), device(0, role: "owner", revoked: true)] {
      let m = NativeDevicesModel(service: DevicesStub([device(1)], me: me)); await m.reload()
      XCTAssertEqual(m.phase, .expired); XCTAssertNil(m.me); XCTAssertTrue(m.others.isEmpty)
    }
  }
}
