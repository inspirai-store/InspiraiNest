import XCTest
import WebKit
@testable import PersonalLibrary

final class SubmissionTests: XCTestCase {
    func testOriginalPartsAndRequirementsAreNotRewritten() throws {
        let values = ["  原始标题\n", "分享原文\nhttps://example.com/a?x=1&x=2#段落", "https://example.com/b", "重复", "重复"]
        let parts = values.enumerated().map { SharedPart(item: $0.offset, attachment: nil, kind: "text", representation: nil, value: $0.element) }
        let id = UUID()
        let input = Submission(id: id, parts: parts, requirements: "  请保留数字\n")
        XCTAssertEqual(input.content, values.joined(separator: "\n\n") + "\n\n【附加要求】\n  请保留数字\n")
        XCTAssertEqual(input.submissionId, id.uuidString.lowercased())
        XCTAssertTrue(input.autoArchive); XCTAssertEqual(input.type, "auto")
        XCTAssertEqual(input.tags, []); XCTAssertNil(input.agent); XCTAssertNil(input.deviceId)
        let roundtrip = try JSONDecoder().decode(Submission.self, from: JSONEncoder().encode(input))
        XCTAssertEqual(roundtrip, input)
    }
    func testUTF16LimitMatchesJavaScriptRatherThanSwiftGraphemeCount() throws {
        func payload(_ value: String) -> Submission {
            Submission(id: UUID(), parts: [SharedPart(item: 0, attachment: nil, kind: "text", representation: nil, value: value)], requirements: "")
        }
        XCTAssertNoThrow(try payload(String(repeating: "😀", count: 5_000)).validateForSending())
        let oversized = payload(String(repeating: "😀", count: 5_001))
        XCTAssertThrowsError(try oversized.validateForSending())
        XCTAssertEqual(oversized.content.utf16.count, 10_002) // never truncated
    }
    func testTagParsingAndLimits() {
        XCTAssertEqual(Submission.tags(from: "研究, iOS，研究\n  分享 "), ["研究", "iOS", "分享"])
        let input = Submission(id: UUID(), parts: [SharedPart(item: 0, attachment: nil, kind: "text", representation: nil, value: "x")], requirements: "", tags: [String(repeating: "😀", count: 31)])
        XCTAssertThrowsError(try input.validateForSending())
    }
    func testChosenDispatchIsPartOfTheImmutablePayload() throws {
        let device = UUID().uuidString.lowercased()
        let parts = [SharedPart(item: 0, attachment: nil, kind: "text", representation: nil, value: "full original")]
        let input = Submission(id: UUID(), parts: parts, requirements: "", autoArchive: false, tags: ["保留"], deviceId: device, agent: "codebuddy")
        let restored = try JSONDecoder().decode(Submission.self, from: JSONEncoder().encode(input))
        XCTAssertEqual(restored.deviceId, device); XCTAssertEqual(restored.agent, "codebuddy")
        XCTAssertFalse(restored.autoArchive); XCTAssertEqual(restored.tags, ["保留"])
    }
    func testOriginValidationAndReaderBoundary() throws {
        for input in ["http://example.com", "https://user:pass@example.com", "https://example.com/api", "https://example.com?token=x", "https://example.com/#x", "file:///tmp/test", "https://example.com\\@evil.test", "https://example.com:0"] {
            XCTAssertThrowsError(try ServerOrigin(input), input)
        }
        let origin = try ServerOrigin("HTTPS://Example.com:443/")
        XCTAssertEqual(origin.value, "https://example.com")
        XCTAssertTrue(ReaderPolicy.allows(URL(string: "https://example.com/library/")!, origin: origin))
        XCTAssertTrue(ReaderPolicy.allows(URL(string: "https://example.com/library/files/a/report.md")!, origin: origin))
        for target in ["https://example.com.evil.test/library/", "https://example.com:444/library/", "http://example.com/library/", "https://example.com/library", "https://example.com/api/state", "https://user@example.com/library/"] {
            XCTAssertFalse(ReaderPolicy.allows(URL(string: target)!, origin: origin), target)
        }
        XCTAssertNoThrow(try JSONSerialization.jsonObject(with: Data(ReaderPolicy.rules(origin: origin).utf8)))
    }
    func testReaderContentRulesCompileInWebKit() throws {
        let origin = try ServerOrigin("https://example.com")
        let done = expectation(description: "WebKit content rules compile")
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "CollectorRulesTest", encodedContentRuleList: try ReaderPolicy.rules(origin: origin)
        ) { list, error in
            XCTAssertNotNil(list, error?.localizedDescription ?? "No list returned")
            done.fulfill()
        }
        wait(for: [done], timeout: 10)
    }
    func testCookieScopeValidation() throws {
        let origin = try ServerOrigin("https://example.com")
        let valid = "library_session=fixture-only; Path=/library/; HttpOnly; Secure; SameSite=Strict"
        let cookie = try CollectorAPI.validatedCookie(valid, origin: origin)
        XCTAssertTrue(cookie.isHTTPOnly); XCTAssertTrue(cookie.isSecure); XCTAssertEqual(cookie.path, "/library/")
        for invalid in [valid.replacingOccurrences(of: "HttpOnly; ", with: ""), valid.replacingOccurrences(of: "Secure; ", with: ""), valid + "; Domain=example.com", valid.replacingOccurrences(of: "Path=/library/", with: "Path=/")] {
            XCTAssertThrowsError(try CollectorAPI.validatedCookie(invalid, origin: origin))
        }
    }
}
