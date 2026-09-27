import XCTest
@testable import PersonalLibrary

final class PairingQRCodeTests: XCTestCase {
    private func code(server: String = "https://library.example", role: String = "owner", expiry: String = "2026-09-26T11:30:00.000Z") throws -> String {
        let payload: [String: Any] = [
            "protocol": "personal-library-pairing", "version": 1,
            "server": server, "key": String(repeating: "a", count: 43),
            "role": role, "expiresAt": expiry
        ]
        return String(data: try JSONSerialization.data(withJSONObject: payload), encoding: .utf8)!
    }

    func testAcceptsExistingWebQRFormat() throws {
        let result = try PairingQRCode.parse(code(), now: Date(timeIntervalSince1970: 1_779_000_000))
        XCTAssertEqual(result.server, "https://library.example")
        XCTAssertEqual(result.key, String(repeating: "a", count: 43))
    }

    func testRejectsWorkerExpiredAndNonRootServerBeforePairing() throws {
        let now = Date(timeIntervalSince1970: 1_779_000_000)
        XCTAssertThrowsError(try PairingQRCode.parse(code(role: "worker"), now: now))
        XCTAssertThrowsError(try PairingQRCode.parse(code(expiry: "2025-01-01T00:00:00.000Z"), now: now))
        XCTAssertThrowsError(try PairingQRCode.parse(code(server: "https://library.example/redirect"), now: now))
    }
}
