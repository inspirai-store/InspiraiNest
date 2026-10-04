import XCTest
@testable import PersonalLibrary

final class DevicePresentationTests: XCTestCase {
    func device(_ fields: String) throws -> Device {
        try JSONDecoder().decode(Device.self, from: Data("{\"id\":\"fixture\",\"name\":\"Keep note\",\(fields)}".utf8))
    }
    func testBrowserAndMobileCannotExecuteEvenWithAnAvailabilityFlag() throws {
        for category in ["browser", "mobile", "integration", "unknown"] {
            let d = try device("\"role\":\"owner\",\"category\":\"\(category)\",\"workerAuthorized\":true,\"online\":true")
            XCTAssertFalse(d.canDispatch)
            XCTAssertFalse(d.statusLabel.contains("工作节点"))
        }
    }
    func testWorkerStatusIsIndependentOfManagementActivity() throws {
        let offline = try device("\"role\":\"worker\",\"category\":\"desktop\",\"online\":false,\"agents\":[\"codex\"]")
        XCTAssertTrue(offline.canDispatch); XCTAssertEqual(offline.statusLabel, "工作节点离线")
        let noAgent = try device("\"role\":\"worker\",\"category\":\"desktop\",\"online\":true,\"agents\":[]")
        XCTAssertEqual(noAgent.statusLabel, "无可用 Agent")
        let reader = try device("\"role\":\"owner\",\"category\":\"desktop\",\"online\":true")
        XCTAssertFalse(reader.canDispatch); XCTAssertEqual(reader.statusLabel, "未启用工作节点")
    }
}
