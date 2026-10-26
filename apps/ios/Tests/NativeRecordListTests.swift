import XCTest

@testable import PersonalLibrary

private actor RecordListTestService: NativeRecordListService {
  let records: [NativeRecord]
  let error: Error?
  init(_ records: [NativeRecord] = [], error: Error? = nil) {
    self.records = records
    self.error = error
  }
  func listRecords() throws -> [NativeRecord] {
    if let error { throw error }
    return records
  }
}
private actor RecordListDelayedService: NativeRecordListService {
  var started = false
  private var continuation: CheckedContinuation<[NativeRecord], Never>?
  func listRecords() async throws -> [NativeRecord] {
    started = true
    return await withCheckedContinuation { continuation = $0 }
  }
  func finish(_ records: [NativeRecord]) {
    continuation?.resume(returning: records)
    continuation = nil
  }
}
private final class RecordListURLProtocol: URLProtocol {
  static var handler: ((URLRequest) throws -> (Int, Data))?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do {
      let (code, data) = try Self.handler!(request)
      client?.urlProtocol(
        self,
        didReceive: HTTPURLResponse(
          url: request.url!, statusCode: code, httpVersion: nil, headerFields: [:])!,
        cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
}
final class NativeRecordListTests: XCTestCase {
  private func record(
    _ id: String, created: String = "2026-10-16T10:00:00+08:00", sync: NativeRecordSync = .synced
  ) -> NativeRecord {
    .init(id: id, text: "标题 \(id)\n正文与附件保留", createdAt: created, sync: sync)
  }
  @MainActor func testSearchFiltersAndTwoIndependentStates() {
    let values = NativeRecordListReview.examples
    let model = NativeRecordListModel(snapshot: .init(records: values))
    XCTAssertEqual(model.visible.map(\.id), ["record-1", "record-2", "record-3", "record-4"])
    model.filter = .unprocessed
    XCTAssertEqual(model.visible.map(\.id), ["record-1", "record-2"])
    model.filter = .review
    XCTAssertEqual(model.visible.map(\.id), ["record-3"])
    XCTAssertEqual(model.visible.first?.sync, .synced)
    model.filter = .pending
    XCTAssertEqual(model.visible.map(\.id), ["record-2"])
    XCTAssertEqual(model.visible.first?.processingTitle, "未加工")
    model.filter = .all
    model.query = "10月16日.m4a"
    XCTAssertEqual(model.visible.map(\.id), ["record-3"])
    model.query = "不存在"
    XCTAssertTrue(model.visible.isEmpty)
    XCTAssertEqual(model.snapshot.records.count, 4)
  }
  @MainActor func testGroupsUseCreationDateBeijingTimeAndStableTieOrder() {
    let values = [
      record("b", created: "2026-10-15T16:05:00Z"), record("a", created: "2026-10-15T16:05:00Z"),
      record("c", created: "2026-10-15T15:59:00Z"),
    ]
    let model = NativeRecordListModel(
      snapshot: .init(records: values),
      now: { NativeRecordListModel.date("2026-10-16T10:00:00+08:00")! })
    XCTAssertEqual(model.groups.map(\.title), ["今天", "昨天"])
    XCTAssertEqual(model.groups[0].records.map(\.id), ["a", "b"])
    XCTAssertEqual(model.time(values[0].createdAt), "00:05")
  }
  func testStoreReopensAndIsolatesOriginsAndDeviceIdentities() async throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let a = NativeRecordListStore.scope(origin: "https://a.invalid", deviceID: "one")
    let b = NativeRecordListStore.scope(origin: "https://b.invalid", deviceID: "one")
    let c = NativeRecordListStore.scope(origin: "https://a.invalid", deviceID: "two")
    let store = try NativeRecordListStore(directory: dir)
    let value = NativeRecordListSnapshot(
      records: [record("a")],
      draft: .init(id: "draft", title: "本机草稿", modifiedAt: "2026-10-16T10:00:00Z"))
    try await store.save(value, scope: a)
    let reopened = try NativeRecordListStore(directory: dir)
    let loaded = try await reopened.load(scope: a)
    let otherOrigin = try await reopened.load(scope: b)
    let otherIdentity = try await reopened.load(scope: c)
    XCTAssertEqual(loaded, value)
    XCTAssertTrue(otherOrigin.records.isEmpty)
    XCTAssertNil(otherIdentity.draft)
  }
  @MainActor func testOfflineKeepsCachedContentAndLocalDraft() async throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = try NativeRecordListStore(directory: dir)
    let scope = NativeRecordListStore.scope(origin: "https://a.invalid", deviceID: "one")
    let value = NativeRecordListSnapshot(
      records: [record("pending", sync: .pending)],
      draft: .init(id: "draft", title: "尚未提交", modifiedAt: "2026-10-16T10:00:00Z"))
    try await store.save(value, scope: scope)
    let model = NativeRecordListModel()
    await model.configure(
      service: RecordListTestService(error: URLError(.notConnectedToInternet)), storage: store,
      origin: "https://a.invalid", deviceID: "one", expired: false)
    XCTAssertEqual(model.phase, .offline)
    XCTAssertEqual(model.snapshot, value)
    await model.configure(service: nil, storage: store, origin: "", deviceID: "", expired: true)
    XCTAssertEqual(model.phase, .expired)
    XCTAssertTrue(model.snapshot.records.isEmpty)
    let preserved = try await store.load(scope: scope)
    XCTAssertEqual(preserved, value)
  }
  @MainActor func testSessionChangesAndRevocationCannotPublishEarlierResponse() async {
    let old = RecordListDelayedService()
    let model = NativeRecordListModel(service: old)
    let loading = Task { await model.reload() }
    while !(await old.started) { await Task.yield() }
    await model.configure(
      service: RecordListTestService([record("new")]), storage: nil, origin: "https://new.invalid",
      deviceID: "new", expired: false)
    await old.finish([record("old-private")])
    await loading.value
    XCTAssertEqual(model.snapshot.records.map(\.id), ["new"])
    await model.configure(
      service: RecordListTestService(error: CollectorError.http(401)), storage: nil,
      origin: "https://new.invalid", deviceID: "new", expired: false)
    XCTAssertEqual(model.phase, .expired)
    XCTAssertTrue(model.snapshot.records.isEmpty)
  }
  @MainActor func testOldServerIsUnavailableRatherThanFalseEmptyAndLocalPendingIsNotReplaced() async
  {
    let value = record("local", sync: .pending)
    let model = NativeRecordListModel(
      snapshot: .init(records: [value]),
      service: RecordListTestService([record("local"), record("remote")]))
    await model.reload()
    XCTAssertEqual(model.snapshot.records.first(where: { $0.id == "local" })?.sync, .pending)
    await model.configure(
      service: RecordListTestService(error: CollectorError.http(404)), storage: nil,
      origin: "https://old.invalid", deviceID: "one", expired: false)
    XCTAssertEqual(model.phase, .unavailable)
  }
  func testReadEndpointAuthPayloadAndRichDocumentRoundTrip() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [RecordListURLProtocol.self]
    let api = CollectorAPI(
      origin: try ServerOrigin("https://fixture.invalid"), token: "record-test-owner",
      configuration: configuration)
    defer { RecordListURLProtocol.handler = nil }
    let json =
      #"{"records":[{"id":"r","text":"原文\n正文","version":2,"createdAt":"2026-10-16T10:00:00Z","attachments":[],"document":{"version":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"原文","marks":[{"type":"bold"}]}]}]}},"tasks":[{"id":"task","state":"awaiting_review","recordVersion":2}]}]}"#
    RecordListURLProtocol.handler = { request in
      XCTAssertEqual(request.url?.absoluteString, "https://fixture.invalid/api/records")
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertNil(request.httpBody)
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer record-test-owner")
      return (200, Data(json.utf8))
    }
    let values = try await api.listRecords()
    XCTAssertEqual(values[0].text, "原文\n正文")
    XCTAssertEqual(values[0].sync, .synced)
    XCTAssertEqual(values[0].processingTitle, "待确认")
    let bytes = try JSONEncoder().encode(values)
    let decoded = try JSONDecoder().decode([NativeRecord].self, from: bytes)
    XCTAssertEqual(decoded, values)
    RecordListURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
    do {
      _ = try await api.listRecords()
      XCTFail("Offline request succeeded")
    } catch { XCTAssertEqual((error as NSError).code, URLError.notConnectedToInternet.rawValue) }
  }
  func testPrimaryNavigationKeepsSubpagesUnderMy() {
    XCTAssertEqual(NativeAppModule.primary, [.records, .library, .tasks, .account])
    XCTAssertEqual(NativeAppModule.outbox.root, .account)
    XCTAssertEqual(NativeAppModule.devices.root, .account)
  }
  @MainActor func testUnavailablePersistentCacheIsVisibleAndLargeCollectionKeepsAllRecords() async {
    let records = (0..<1000).map { record(String(format: "%04d", $0)) }
    let model = NativeRecordListModel()
    await model.configure(
      service: RecordListTestService(records), storage: nil, origin: "https://a.invalid",
      deviceID: "one", expired: false, persistentCacheRequired: true)
    XCTAssertTrue(model.cacheFailed)
    XCTAssertEqual(model.phase, .content)
    XCTAssertEqual(model.visible.count, 1000)
    XCTAssertEqual(model.visible.first?.id, "0000")
    XCTAssertEqual(model.visible.last?.id, "0999")
    model.query = "0099"
    XCTAssertEqual(model.visible.map(\.id), ["0099"])
  }
  func testOlderVersionReviewRemainsVisibleAndCompletedMeansArchived() {
    var value = record("versioned")
    value.version = 4
    value.tasks = [
      .init(id: "older-review", state: "awaiting_review", recordVersion: 3),
      .init(id: "newer-done", state: "completed", recordVersion: 4),
    ]
    XCTAssertEqual(value.processingTitle, "待确认")
    value.tasks.removeFirst()
    XCTAssertEqual(value.processingTitle, "已归档")
    XCTAssertEqual(value.sync, .synced)
  }
}
