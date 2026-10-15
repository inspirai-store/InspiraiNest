import XCTest
import WebKit
@testable import PersonalLibrary

@MainActor final class WritingBridgeTests: XCTestCase {
    func testBundledWritingPageRendersInNativeWebKit() async throws {
        let controller = CaptureController(onNavigate: { _ in })
        controller.loadViewIfNeeded()
        let web = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        web.configuration.userContentController.addUserScript(WKUserScript(source: "window.__writingErrors=[]; addEventListener('error',e=>window.__writingErrors.push(e.message||e.target?.src||'resource'),true); addEventListener('unhandledrejection',e=>window.__writingErrors.push(String(e.reason)));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let root = try XCTUnwrap(Bundle.main.url(forResource: "CaptureAssets", withExtension: nil))
        web.loadFileURL(root.appendingPathComponent("writing/index.html"), allowingReadAccessTo: root)
        for _ in 0..<100 {
            let title = try? await web.evaluateJavaScript("document.querySelector('[data-region=页面标题栏] h1')?.textContent || ''")
            if title as? String == "写作" { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let diagnostic = try? await web.evaluateJavaScript("JSON.stringify({url:location.href,state:document.readyState,errors:window.__writingErrors,bridge:typeof window.library})")
        XCTFail("Writing WKWebView did not render: \(String(describing: diagnostic))")
    }
    func testWritingAllowsOwnerSessionHistoryAndDraftAssets() {
        let controller = CaptureController(onNavigate: { _ in })
        let session = UUID().uuidString.lowercased(), task = UUID().uuidString.lowercased()
        XCTAssertTrue(controller.allowed("/api/writing/sessions/\(session)/answers", "POST"))
        XCTAssertTrue(controller.allowed("/api/writing/sessions/\(session)/history", "GET"))
        XCTAssertTrue(controller.allowed("/api/writing/sessions/\(session)/drafts/\(task)/files/" + String(repeating: "a", count: 64), "GET"))
        XCTAssertFalse(controller.allowed("/api/writing/tasks/\(task)/result", "POST"))
        XCTAssertFalse(controller.allowed("/api/writing/sessions/\(session)/files/../../secret", "GET"))
        XCTAssertTrue(controller.binaryRead("/api/writing/sessions/\(session)/files/\(task)", "GET"))
        XCTAssertFalse(controller.binaryRead("/api/writing/sessions/\(session)/drafts/\(task)", "GET"))
        XCTAssertFalse(controller.binaryRead("/api/writing/sessions/\(session)/files/\(task)", "POST"))
    }
}
