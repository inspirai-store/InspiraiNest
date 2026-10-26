import PDFKit
import XCTest

@testable import PersonalLibrary

private final class ReaderTransport: URLProtocol {
  static var handler: ((URLRequest) throws -> (Int, Data, [String: String]))?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do {
      let (code, data, headers) = try Self.handler!(request)
      let response = HTTPURLResponse(
        url: request.url!, statusCode: code, httpVersion: "HTTP/1.1", headerFields: headers)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
}
private actor ReaderTestService: LibraryReadingService {
  let detail: ReadDetail
  let data: Data
  let delay: UInt64
  let failure: Int?
  init(detail: ReadDetail, data: Data, delay: UInt64 = 0, failure: Int? = nil) {
    self.detail = detail
    self.data = data
    self.delay = delay
    self.failure = failure
  }
  func readDetail(id: String) async throws -> ReadDetail { detail }
  func readFile(entry: ReadDetail, file: ReadFile) async throws -> Data {
    if delay > 0 { try await Task.sleep(nanoseconds: delay) }
    if let failure { throw CollectorError.http(failure) }
    return data
  }
  func readArchiveData(digest: String) async throws -> Data { data }
}
final class NativeReaderTests: XCTestCase {
  func testExplicitNewlinesRestartNativeLineWrappingWithoutAddingBlankLines() {
    for separator in ["\n", "\r\n", "\n\n"] {
      let text = "甲乙丙丁" + separator + "日期"
      XCTAssertEqual(NativeText.wrappedValue(text, width: 80, size: 17, bold: false), text)
    }
    XCTAssertEqual(
      NativeText.wrappedValue("甲乙丙丁甲", width: 80, size: 17, bold: false), "甲乙丙丁\n甲")
  }
  private let bytes = Data("## 标题\n\n原始正文。".utf8)
  private func metadata(
    id: String = "资料/1 & ? #", file: String = "source/资料 & #.md",
    digest: String = String(repeating: "a", count: 64), source: String? = nil
  ) throws -> Data {
    var value: [String: Any] = [
      "id": id, "archive_id": digest, "title": "资料标题",
      "files": [
        ["path": file, "role": "source", "bytes": bytes.count, "sha256": ReadFile.digest(bytes)]
      ],
    ]
    if let source { value["source_url"] = source }
    return try JSONSerialization.data(withJSONObject: value)
  }
  private func detail() throws -> ReadDetail {
    try JSONDecoder().decode(ReadDetail.self, from: metadata())
  }
  override func tearDown() { ReaderTransport.handler = nil }
  func testOriginalFileBytesAndHeaderMustBothMatchRegisteredDigest() throws {
    let file = try detail().files[0]
    XCTAssertNoThrow(try file.verify(bytes, header: ReadFile.digest(bytes)))
    XCTAssertThrowsError(try file.verify(Data("modified".utf8)))
    XCTAssertThrowsError(try file.verify(bytes, header: String(repeating: "b", count: 64)))
    for path in ["../secret", "/etc/file", "a/../b", "a\\b", "a\0b", "a//b"] {
      XCTAssertThrowsError(
        try ReadFile(path: path, role: nil, bytes: 1, sha256: ReadFile.digest(Data([1]))).validate()
      )
    }
  }
  func testMetadataRetainsUnknownFieldsWithoutInventingAuthorDateOrVerification() throws {
    let value = try detail()
    XCTAssertEqual(value.info.map(\.0), ["资料"])
    XCTAssertEqual(value.categories, [.source, .attachments])
    XCTAssertThrowsError(try value.validate(expectedID: "wrong"))
    let hostile = try JSONDecoder().decode(
      ReadDetail.self, from: metadata(source: "javascript:alert(1)"))
    XCTAssertNil(hostile.safeSource)
  }
  func testMarkdownASTAndOutlinePreserveHierarchyAndDuplicateTitles() {
    let source =
      "## 重复\n\n段落 **加粗 *强调*** [来源](https://example.com) `代码`。\n\n### 子标题\n\n```swift\nlet x = 1\n```\n\n## 重复\n\n<script>alert(1)</script>\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] 完成\n- 待办\n\n> 引用\n"
    let document = NativeMarkdownDocument(source)
    XCTAssertEqual(document.original, source)
    XCTAssertEqual(document.headings.map(\.level), [2, 3, 2])
    XCTAssertEqual(Set(document.headings.map(\.id)).count, 3)
    XCTAssertEqual(document.headings.map(\.line), [1, 5, 11])
    XCTAssertTrue(
      document.blocks.contains {
        if case .literal = $0.kind { return $0.text.contains("<script>") }
        return false
      })
    XCTAssertTrue(
      document.blocks.contains {
        if case .table(let rows) = $0.kind { return rows == [["A", "B"], ["1", "2"]] }
        return false
      })
    XCTAssertTrue(
      document.blocks.contains {
        if case .quote = $0.kind { return true }
        return false
      })
    let inline = document.blocks.compactMap(\.inline).first!
    XCTAssertTrue(inline.runs.contains { $0.link?.host == "example.com" })
    XCTAssertTrue(
      inline.runs.contains {
        ($0.inlinePresentationIntent ?? []).contains([.emphasized, .stronglyEmphasized])
      })
  }
  func testSubtitleTimingAndCompleteOriginalRemainSeparate() {
    let raw =
      "1\r\n00:00:01,200 --> 00:00:04,600\r\n第一行\r\n第二行\r\n\r\n2\r\n00:00:05,000 --> 00:00:06,000\r\n结束"
    let cues = NativeSubtitleCue.parse(raw)
    XCTAssertEqual(cues.count, 2)
    XCTAssertEqual(cues[0].timestamp, "00:00:01,200 → 00:00:04,600")
    XCTAssertEqual(cues[0].text, "第一行\n第二行")
    XCTAssertTrue(raw.contains(" --> "))
  }
  func testReaderTransportEncodesIdentifiersAndRejectsChangedArchive() async throws {
    let entry = try detail()
    let file = entry.files[0]
    var changed = false
    ReaderTransport.handler = { request in
      XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-reader")
      XCTAssertNil(request.url?.fragment)
      let fields = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      XCTAssertEqual(fields.first(where: { $0.name == "id" })?.value, entry.id)
      if request.url?.path == "/api/read/v1/file" {
        XCTAssertEqual(fields.first(where: { $0.name == "file" })?.value, file.path)
        return (200, self.bytes, ["X-Content-SHA256": file.sha256])
      }
      return (
        200,
        try self.metadata(digest: changed ? String(repeating: "b", count: 64) : entry.archiveID),
        [:]
      )
    }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ReaderTransport.self]
    let client = CollectorAPI(
      origin: try ServerOrigin("https://fixture.invalid"), token: "fixture-reader",
      configuration: config)
    let read = try await client.readDetail(id: entry.id)
    XCTAssertEqual(read.id, entry.id)
    let received = try await client.readFile(entry: entry, file: file)
    XCTAssertEqual(received, bytes)
    changed = true
    do {
      _ = try await client.readFile(entry: entry, file: file)
      XCTFail("updated archive published")
    } catch { XCTAssertEqual(error as? ReaderFailure, .changed) }
  }
  @MainActor func testSessionChangeDiscardsLatePrivateFileAndInlineImagesAreRegisteredOnly()
    async throws
  {
    let entry = try detail()
    let model = NativeReaderModel(
      service: ReaderTestService(detail: entry, data: bytes, delay: 150_000_000))
    let pending = Task { await model.open(entry.id) }
    try await Task.sleep(nanoseconds: 50_000_000)
    model.configure(service: nil)
    await pending.value
    XCTAssertNil(model.detail)
    XCTAssertNil(model.data)
    XCTAssertNil(model.document)
    XCTAssertNil(model.exportData)
    model.configure(service: ReaderTestService(detail: entry, data: bytes))
    await model.open(entry.id)
    for path in [
      "https://outside.invalid/image.png", "../../secret", "/etc/file", "unregistered.png",
    ] {
      do {
        _ = try await model.inlineImage(path)
        XCTFail("unregistered image fetched")
      } catch {}
    }
    XCTAssertEqual(model.data, bytes)
  }
  @MainActor func testRevocationClearsReaderAndCorruptDataCannotBecomeVisible() async throws {
    let entry = try detail()
    for status in [401, 403] {
      let model = NativeReaderModel(
        service: ReaderTestService(detail: entry, data: bytes, failure: status))
      await model.open(entry.id)
      XCTAssertEqual(model.phase, .expired)
      XCTAssertNil(model.detail)
      XCTAssertNil(model.data)
    }
    let model = NativeReaderModel(service: ReaderTestService(detail: entry, data: Data("bad".utf8)))
    await model.open(entry.id)
    XCTAssertEqual(model.phase, .integrity)
    XCTAssertNil(model.data)
  }
  func testArchiveExportKeepsExactVerifiedResponseBytesAndRejectsCorruption() async throws {
    let body: [String: Any] = [
      "meta": ["title": "资料", "summary": "摘要", "coverage_note": "正文已保存", "status": "archived"],
      "files": [
        [
          "path": "summary.md", "role": "summary", "bytes": bytes.count,
          "sha256": ReadFile.digest(bytes), "body": bytes.base64EncodedString(),
        ]
      ],
    ]
    let packet = try JSONSerialization.data(
      withJSONObject: body, options: [.prettyPrinted, .sortedKeys])
    let digest = ReadFile.digest(packet)
    ReaderTransport.handler = { request in
      XCTAssertEqual(request.url?.path, "/api/archives/" + digest)
      return (200, packet, [:])
    }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ReaderTransport.self]
    let client = CollectorAPI(
      origin: try ServerOrigin("https://fixture.invalid"), token: "fixture-reader",
      configuration: config)
    let original = try await client.readArchiveData(digest: digest)
    XCTAssertEqual(original, packet)
    ReaderTransport.handler = { _ in (200, Data("corrupt".utf8), [:]) }
    do {
      _ = try await client.readArchiveData(digest: digest)
      XCTFail("corrupted package exported")
    } catch { XCTAssertEqual(error as? ReaderFailure, .integrity) }
  }
  @MainActor func testOutlinePositionAndRegisteredLocalLinkRemainWithinArchive() async throws {
    let entry = try detail()
    let model = NativeReaderModel(service: ReaderTestService(detail: entry, data: bytes))
    await model.open(entry.id)
    let heading = try XCTUnwrap(model.document?.headings.first)
    model.jump(to: heading.id)
    model.showAttachments()
    await model.back()
    XCTAssertEqual(model.anchor, heading.id)
    await model.openLocalLink("#标题")
    XCTAssertEqual(model.selectedHeading, heading.id)
    await model.openLocalLink("../../outside.md")
    XCTAssertEqual(model.notice, "找不到附件")
    XCTAssertEqual(model.data, bytes)
  }
  func testRealPDFFixtureHasFourPagesAndAllFixtureMetadataMatchesBytes() async throws {
    let fixture = NativeReaderFixtureService(page: "P11", width: 393, detailHeight: 773)
    let entry = try await fixture.readDetail(id: "library-0")
    let packet = try await fixture.readArchiveData(digest: entry.archiveID)
    XCTAssertEqual(ReadFile.digest(packet), entry.archiveID)
    XCTAssertNoThrow(
      try AttachmentIntegrity.validate(JSONDecoder().decode(DraftBundle.self, from: packet)))
    for file in entry.files {
      let data = try await fixture.readFile(entry: entry, file: file)
      try file.verify(data)
      if file.suffix == "pdf" { XCTAssertEqual(PDFDocument(data: data)?.pageCount, 4) }
      if file.suffix == "png" {
        XCTAssertNotNil(UIImage(data: data))
        XCTAssertEqual(file.sizeLabel, "320 KB")
      }
    }
  }
}
