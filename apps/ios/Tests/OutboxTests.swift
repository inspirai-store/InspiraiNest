import XCTest
@testable import PersonalLibrary

final class OutboxTests: XCTestCase {
    private var directory: URL!
    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: directory) }
    private func fixture() -> SavedShare {
        let parts = [SharedPart(item: 0, attachment: 0, kind: "text", representation: "public.plain-text", value: "  标题\n原文 https://example.com?q=1#fragment\n")]
        return SavedShare(submission: Submission(id: UUID(), parts: parts, requirements: "追加"), originalParts: parts, additionalRequirements: "追加", createdAt: Date(timeIntervalSince1970: 123))
    }
    func testDurableContentAndNoOverwrite() throws {
        let box = try Outbox(directory: directory); let share = fixture()
        try box.insert(share, origin: nil)
        let reopened = try Outbox(directory: directory)
        XCTAssertEqual(try reopened.list().first?.share, share)
        XCTAssertThrowsError(try reopened.insert(share, origin: nil))
        XCTAssertEqual(try box.list().count, 1)
        try box.bindUnassigned(id: share.submission.submissionId, origin: "https://first.example")
        try box.bindUnassigned(id: share.submission.submissionId, origin: "https://second.example")
        XCTAssertEqual(try box.list().first?.origin, "https://first.example")
    }
    func testIndependentConnectionsLeaseRecoveryAndStaleCompletion() throws {
        let first = try Outbox(directory: directory), second = try Outbox(directory: directory)
        let share = fixture(), id = share.submission.submissionId, origin = "https://example.com"
        try first.insert(share, origin: origin)
        let time = Date(timeIntervalSince1970: 1_000)
        let old = try XCTUnwrap(first.claim(id: id, origin: origin, now: time))
        XCTAssertNil(try second.claim(id: id, origin: origin, now: time.addingTimeInterval(89)))
        let current = try XCTUnwrap(second.claim(id: id, origin: origin, now: time.addingTimeInterval(91)))
        XCTAssertFalse(try first.finish(id: id, lease: old, taskID: UUID().uuidString))
        XCTAssertTrue(try second.finish(id: id, lease: current, taskID: "confirmed-task"))
        XCTAssertNil(try first.claim(id: id, origin: origin, now: time.addingTimeInterval(300)))
        let item = try XCTUnwrap(first.list().first)
        XCTAssertEqual(item.state, "submitted"); XCTAssertEqual(item.taskID, "confirmed-task")
        XCTAssertEqual(item.share, share); XCTAssertEqual(item.attempts, 2)
    }
    func testWrongOriginCannotClaimAndBlockedPayloadRemains() throws {
        let box = try Outbox(directory: directory); let share = fixture(); let id = share.submission.submissionId
        try box.insert(share, origin: "https://one.example")
        XCTAssertNil(try box.claim(id: id, origin: "https://other.example"))
        let lease = try XCTUnwrap(box.claim(id: id, origin: "https://one.example"))
        try box.finish(id: id, lease: lease, blocked: true, message: "HTTP 409")
        XCTAssertEqual(try box.list().first?.share, share)
        XCTAssertEqual(try box.list().first?.state, "blocked")
    }
    func testCachedDevicesAreScopedToOriginAndReopenOffline() throws {
        let first = try Outbox(directory: directory)
        let worker = Device(id: UUID().uuidString, name: "电脑", role: "worker", revokedAt: nil, online: false, agents: ["codex"])
        try first.cacheDevices([worker], origin: "https://one.example")
        let second = try Outbox(directory: directory)
        XCTAssertEqual(try second.cachedDevices(origin: "https://one.example").map(\.id), [worker.id])
        XCTAssertEqual(try second.cachedDevices(origin: "https://other.example").count, 0)
    }
}
