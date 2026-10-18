import XCTest
import UIKit
import UniformTypeIdentifiers
import LinkPresentation
@testable import PersonalLibrary

final class ShareCaptureTests: XCTestCase {
    @MainActor
    func testLinkAndPreviewImageKeepLinkWithNotice() async throws {
        let item = NSExtensionItem()
        item.attributedTitle = NSAttributedString(string: "视频标题")
        item.attachments = [
            NSItemProvider(item: NSURL(string: "https://b23.tv/example")!, typeIdentifier: UTType.url.identifier),
            NSItemProvider(item: NSData(), typeIdentifier: UTType.jpeg.identifier)
        ]

        let captured = try await ShareCapture.read([item])
        XCTAssertTrue(captured.parts.contains { $0.kind == "url" && $0.value == "https://b23.tv/example" })
        XCTAssertTrue(captured.parts.contains { $0.kind == "title" && $0.value == "视频标题" })
        XCTAssertEqual(captured.omittedAttachments, 1)
    }

    @MainActor
    func testImageOnlyShareDoesNotPretendToCaptureContent() async {
        let item = NSExtensionItem()
        item.attachments = [NSItemProvider(item: NSData(), typeIdentifier: UTType.jpeg.identifier)]
        do {
            _ = try await ShareCapture.read([item])
            XCTFail("Image-only share must not be saved as empty text")
        } catch {}
    }

    @MainActor
    func testLinkPresentationMetadataKeepsTitleAndOriginalURL() async throws {
        let metadata = LPLinkMetadata()
        metadata.title = "分享标题"
        metadata.originalURL = URL(string: "https://example.com/article?source=app")!
        let item = NSExtensionItem()
        item.attachments = [NSItemProvider(item: metadata, typeIdentifier: "com.apple.linkpresentation.metadata")]

        let captured = try await ShareCapture.read([item])
        XCTAssertTrue(captured.parts.contains { $0.kind == "title" && $0.value == "分享标题" })
        XCTAssertTrue(captured.parts.contains { $0.kind == "url" && $0.value == "https://example.com/article?source=app" })
        XCTAssertEqual(captured.omittedAttachments, 0)
    }
}
