import XCTest

@testable import PersonalLibrary

private actor TaskServiceStub: NativeTaskService {
  var tasks: [LibraryTask]
  var changes: [String] = []
  var failure: Error?
  var nextState: String?
  var delay: UInt64 = 0
  var reads = 0
  init(_ tasks: [LibraryTask]) { self.tasks = tasks }
  func setup(failure: Error? = nil, nextState: String? = nil, delay: UInt64 = 0) {
    self.failure = failure
    self.nextState = nextState
    self.delay = delay
  }
  func state() async throws -> ServerState {
    reads += 1
    let captured = tasks
    if delay > 0 { try await Task.sleep(nanoseconds: delay) }
    if let failure { throw failure }
    if let nextState { tasks = tasks.map { copy($0, state: nextState) } }
    return ServerState(
      me: Device(
        id: "owner", name: "Test", role: "owner", revokedAt: nil, online: nil, agents: nil),
      devices: [], tasks: nextState == nil ? captured : tasks, archives: [])
  }
  func taskAction(_ id: String, action: String) async throws {
    changes.append(id + "/" + action)
    tasks = tasks.map {
      $0.id == id ? copy($0, state: action == "cancel" ? "cancelled" : "assigned") : $0
    }
  }
  private func copy(_ t: LibraryTask, state: String) -> LibraryTask {
    .init(
      id: t.id, submissionId: t.submissionId, content: t.content, url: t.url, state: state,
      events: t.events, deviceId: t.deviceId, archiveId: t.archiveId, draftId: t.draftId,
      createdAt: t.createdAt)
  }
}
@MainActor
final class NativeTaskTests: XCTestCase {
  private func item(_ state: String = "running", index: Int = 1) -> LibraryTask {
    .init(
      id: String(format: "00000000-0000-0000-0000-%012d", index), submissionId: "stable-submission",
      content: "真实标题\n完整原文 https://example.com?a=1#source", url: nil, state: state,
      events: [.init(at: "2026-10-09T06:30:00Z", state: "queued", message: "原始事件")],
      deviceId: "original-computer", archiveId: nil, draftId: nil, createdAt: "2026-10-09T06:30:00Z"
    )
  }
  func testFiltersKeepServerOrderAndOriginalBusinessContent() async {
    let input = [
      item(), item("waiting_action", index: 2), item("awaiting_review", index: 3),
      item("failed", index: 4), item("completed", index: 5), item("cancelled", index: 6),
    ]
    let m = NativeTaskModel(service: TaskServiceStub(input))
    await m.reload()
    m.filter = 0
    XCTAssertEqual(m.visibleTasks.map(\.state), ["running", "waiting_action"])
    m.filter = 1
    XCTAssertEqual(m.visibleTasks.map(\.state), ["awaiting_review"])
    m.filter = 2
    XCTAssertEqual(m.visibleTasks.map(\.id), input.map(\.id))
    XCTAssertEqual(m.tasks[0].content, input[0].content)
    XCTAssertEqual(m.tasks[0].events?.first?.message, "原始事件")
    XCTAssertEqual(m.tasks[0].nativeTaskTitle, "真实标题")
  }
  func testCancelRequiresConfirmationAndCancelDialogHasNoMutation() async {
    let t = item()
    let s = TaskServiceStub([t])
    let m = NativeTaskModel(service: s)
    await m.reload()
    await m.confirmCancellation()
    let changes1 = await s.changes
    XCTAssertTrue(changes1.isEmpty)
    m.requestCancellation(t.id)
    XCTAssertEqual(m.cancellationID, t.id)
    m.cancellationID = nil
    await m.confirmCancellation()
    let changes2 = await s.changes
    XCTAssertTrue(changes2.isEmpty)
    m.requestCancellation(t.id)
    await m.confirmCancellation()
    let changes3 = await s.changes
    XCTAssertEqual(changes3, [t.id + "/cancel"])
    XCTAssertEqual(m.tasks[0].state, "cancelled")
    XCTAssertEqual(m.tasks[0].content, t.content)
    XCTAssertEqual(m.tasks[0].submissionId, t.submissionId)
  }
  func testRetryReusesTaskAndOriginalComputerWithoutResubmitting() async {
    let t = item("failed")
    let s = TaskServiceStub([t])
    let m = NativeTaskModel(service: s)
    await m.reload()
    await m.retry(t.id)
    let changes4 = await s.changes
    XCTAssertEqual(changes4, [t.id + "/retry"])
    XCTAssertEqual(m.tasks[0].id, t.id)
    XCTAssertEqual(m.tasks[0].submissionId, t.submissionId)
    XCTAssertEqual(m.tasks[0].deviceId, t.deviceId)
    XCTAssertEqual(m.tasks[0].events?.first?.message, "原始事件")
  }
  func testChangedTerminalStateBlocksCancelAndRetryBeforePost() async {
    for state in ["running", "failed"] {
      let t = item(state)
      let s = TaskServiceStub([t])
      let m = NativeTaskModel(service: s)
      await m.reload()
      m.requestCancellation(t.id)
      await s.setup(nextState: "completed")
      if state == "failed" { await m.retry(t.id) } else { await m.confirmCancellation() }
      let changes5 = await s.changes
      XCTAssertTrue(changes5.isEmpty)
      XCTAssertEqual(m.tasks[0].state, "completed")
    }
  }
  func testSessionChangeDropsInflightPrivateTaskResponse() async {
    let s = TaskServiceStub([item()])
    await s.setup(delay: 80_000_000)
    let m = NativeTaskModel(service: s)
    let read = Task { await m.reload() }
    await Task.yield()
    m.configure(service: nil)
    await read.value
    XCTAssertTrue(m.tasks.isEmpty)
    XCTAssertEqual(m.phase, .unpaired)
    XCTAssertTrue(m.path.isEmpty)
    XCTAssertFalse(m.busy)
  }
  func testAuthorizationFailureClosesDetailsAndCancelsPendingAction() async {
    for code in [401, 403] {
      let t = item()
      let s = TaskServiceStub([t])
      let m = NativeTaskModel(service: s)
      await m.reload()
      m.open(t.id, tablet: false)
      m.requestCancellation(t.id)
      await s.setup(failure: CollectorError.http(code))
      await m.reload()
      XCTAssertEqual(m.phase, .expired)
      XCTAssertTrue(m.tasks.isEmpty)
      XCTAssertTrue(m.path.isEmpty)
      XCTAssertNil(m.cancellationID)
      await m.confirmCancellation()
      let changes6 = await s.changes
      XCTAssertTrue(changes6.isEmpty)
    }
  }
  func testNetworkFailureKeepsCachedTasksAndRecoversOnExplicitRefresh() async {
    let t = item()
    let s = TaskServiceStub([t])
    let m = NativeTaskModel(service: s)
    await m.reload()
    await s.setup(failure: URLError(.notConnectedToInternet))
    await m.reload()
    XCTAssertEqual(m.phase, .offline)
    XCTAssertEqual(m.tasks[0].content, t.content)
    await m.retry(t.id)
    let changes7 = await s.changes
    XCTAssertTrue(changes7.isEmpty)
    await s.setup()
    await m.reload()
    XCTAssertEqual(m.phase, .content)
    XCTAssertNil(m.notice)
  }
  func testNoActionOnMissingOrIneligibleTasksAndNoServiceWhenUnpaired() async {
    let s = TaskServiceStub([item("completed")])
    let m = NativeTaskModel(service: s)
    await m.reload()
    await m.retry(m.tasks[0].id)
    m.requestCancellation(m.tasks[0].id)
    await m.retry(UUID().uuidString)
    XCTAssertNil(m.cancellationID)
    let changes8 = await s.changes
    XCTAssertTrue(changes8.isEmpty)
    m.configure(service: nil)
    await m.reload()
    XCTAssertEqual(m.phase, .unpaired)
  }
  func testDatesUseBeijingTimeAndRetainUnknownSourceTimestamp() {
    XCTAssertEqual(NativeTaskDate.display("2026-10-09T06:30:00.123Z", timeOnly: true), "14:30")
    XCTAssertEqual(NativeTaskDate.display("2026-10-09T18:00:00Z"), "2026-10-10")
    XCTAssertEqual(NativeTaskDate.display("unknown"), "unknown")
  }
  func testConnectivityPreservesCachedEventsAndBlocksPostsUntilReconnected() async {
    let t = item("failed")
    let s = TaskServiceStub([t])
    let m = NativeTaskModel(service: s)
    await m.reload()
    m.requestCancellation(t.id)
    m.setOffline(true)
    XCTAssertNil(m.cancellationID)
    XCTAssertEqual(m.phase, .offline)
    XCTAssertEqual(m.tasks[0].events?.first?.message, "原始事件")
    await m.retry(t.id)
    await m.reload()
    let changes = await s.changes
    XCTAssertTrue(changes.isEmpty)
    m.setOffline(false)
    await m.retry(t.id)
    let resumed = await s.changes
    XCTAssertEqual(resumed, [t.id + "/retry"])
    m.configure(service: nil, expired: true)
    m.setOffline(false)
    XCTAssertEqual(m.phase, .expired)
    XCTAssertTrue(m.tasks.isEmpty)
  }
}
