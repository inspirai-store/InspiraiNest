import XCTest

@testable import PersonalLibrary

private actor LibraryTestService: LibraryReadService {
  let values: [ReadEntry]
  let legacy: Bool
  let failure: Int?
  var requests: [ReadQuery] = []
  init(values: [ReadEntry], legacy: Bool = false, failure: Int? = nil) {
    self.values = values
    self.legacy = legacy
    self.failure = failure
  }
  func readCategories() async throws -> ReadCategories {
    if legacy { throw CollectorError.http(404) }
    return ReadCategories.from(values)
  }
  func readEntries(_ query: ReadQuery) async throws -> ReadPage {
    requests.append(query)
    if let failure { throw CollectorError.http(failure) }
    let values = self.values.filter { query.ids == nil || query.ids!.contains($0.id) }
    return .init(
      items: Array(values.dropFirst(query.offset).prefix(query.limit)), total: values.count,
      limit: query.limit, offset: query.offset, index: .init(complete: true, pending: 0, failed: 0))
  }
}
final class NativeLibraryTests: XCTestCase {
  private func entry(_ id: String, title: String? = nil) -> ReadEntry {
    .init(
      id: id, title: title ?? id, summary: "正文摘要", type: "document", status: "archived",
      collectedAt: "2026-10-09T23:30:00Z", tags: ["阅读"], matches: nil)
  }
  func testQueryEncodingPreservesUnicodeLiteralSeparatorsAndEmptyCollection() throws {
    var query = ReadQuery()
    query.text = "SwiftUI & 阅读 # ?"
    query.tag = "A+B"
    query.ids = []
    query.sort = .title
    let url = try XCTUnwrap(URLComponents(string: query.path))
    let items = Dictionary(
      uniqueKeysWithValues: (url.queryItems ?? []).map { ($0.name, $0.value!) })
    XCTAssertEqual(url.path, "/api/read/v1/search")
    XCTAssertNil(url.fragment)
    XCTAssertEqual(items["q"], query.text)
    XCTAssertEqual(items["tag"], "A+B")
    XCTAssertEqual(items["ids"], "[]")
    XCTAssertEqual(items["sort"], "title")
    XCTAssertEqual(entry("a").dateLabel, "2026-10-10")
  }
  func testHighlightUsesAllTermsAndPreservesOriginalUnicode() {
    let text = "ﬃ ＳＷＩＦＴＵＩ 阅读 SwiftUI"
    let ranges = LibrarySearchHighlight.ranges(in: text, query: "ffi SwiftUI 阅读")
    XCTAssertEqual(ranges.map { String(text[$0]) }, ["ﬃ", "ＳＷＩＦＴＵＩ", "SwiftUI", "阅读"])
    XCTAssertEqual(text, "ﬃ ＳＷＩＦＴＵＩ 阅读 SwiftUI")
  }
  func testFavoritesArePersistentAndIsolatedByOrigin() {
    let suite = "library.test." + UUID().uuidString
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    let a = NativeFavoritesStore(defaults: defaults, origin: "https://a.invalid")
    let b = NativeFavoritesStore(defaults: defaults, origin: "https://b.invalid")
    a.save(["资料/1", "item2"])
    XCTAssertEqual(a.load(), ["资料/1", "item2"])
    XCTAssertTrue(b.load().isEmpty)
    b.save(["other"])
    XCTAssertEqual(a.load().count, 2)
    XCTAssertEqual(b.load(), ["other"])
  }
  @MainActor func testPaginationAndRevocationDiscardPrivateMetadata() async {
    let service = LibraryTestService(values: [entry("a"), entry("b"), entry("c")])
    let model = NativeLibraryModel(service: service)
    model.query.limit = 2
    await model.reload()
    XCTAssertEqual(model.entries.map(\.id), ["a", "b"])
    XCTAssertTrue(model.canLoadMore)
    await model.loadMore()
    XCTAssertEqual(model.entries.map(\.id), ["a", "b", "c"])
    XCTAssertFalse(model.canLoadMore)
    model.configure(
      service: LibraryTestService(values: [entry("secret")], failure: 401),
      origin: "https://a.invalid")
    await model.reload()
    XCTAssertEqual(model.phase, .expired)
    XCTAssertTrue(model.entries.isEmpty)
    XCTAssertEqual(model.categories.total, 0)
  }
  @MainActor func testRevocationInvalidatesGlobalSessionAndPreservesOutbox() throws {
    let credentials = CredentialStore()
    try credentials.save(
      .init(
        origin: "https://library.invalid", deviceID: UUID().uuidString, name: "审核测试设备",
        token: "fixture-revoked-token"))
    defer { try? credentials.clear() }
    let box = try Outbox.shared()
    let parts = [
      SharedPart(
        item: 0, attachment: nil, kind: "text", representation: "public.plain-text",
        value: "原文\n保留 & 不截断")
    ]
    let share = SavedShare(
      submission: Submission(id: UUID(), parts: parts, requirements: "附加要求"),
      originalParts: parts, additionalRequirements: "附加要求", createdAt: Date())
    try box.insert(share, origin: "https://library.invalid")
    let app = AppModel()
    XCTAssertTrue(app.paired)
    let saved = try box.list()
    let previous = app.sessionID
    app.expireAuthorization()
    XCTAssertTrue(app.authorizationExpired)
    XCTAssertFalse(app.paired)
    XCTAssertNotEqual(app.sessionID, previous)
    XCTAssertNil(app.snapshot)
    XCTAssertEqual(app.serverName, "")
    XCTAssertNil(try credentials.load())
    XCTAssertEqual(try box.list().map(\.id), saved.map(\.id))
    XCTAssertEqual(
      try box.list().first(where: { $0.id == share.submission.submissionId })?.share, share)
    let expired = app.sessionID
    app.expireAuthorization()
    XCTAssertEqual(app.sessionID, expired)
  }
  @MainActor func testOlderServerFallbackFiltersCollectionsAfterAllPagesAndSortsGlobally() async {
    let service = LibraryTestService(
      values: [entry("z", title: "① first"), entry("b"), entry("a")], legacy: true)
    let model = NativeLibraryModel(service: service, favorites: ["a", "z"])
    model.query.limit = 1
    model.query.sort = .title
    model.favoritesOnly = true
    await model.reload()
    XCTAssertEqual(model.entries.map(\.id), ["z", "a"])
    XCTAssertEqual(model.total, 2)
    XCTAssertFalse(model.canLoadMore)
    let requests = await service.requests
    XCTAssertEqual(requests.count, 4)
    XCTAssertTrue(requests.allSatisfy { $0.ids == nil && $0.sort == nil })
  }
  @MainActor func testChangingSessionDuringAwaitCannotPublishOldContent() async {
    let gate = LibraryDelayedService(entry: entry("old-secret"))
    let model = NativeLibraryModel(service: gate)
    let load = Task { await model.reload() }
    while !(await gate.started) { await Task.yield() }
    model.configure(service: nil, origin: "", expired: true)
    await gate.resume()
    await load.value
    XCTAssertTrue(model.entries.isEmpty)
    XCTAssertEqual(model.phase, .expired)
  }
}
private actor LibraryDelayedService: LibraryReadService {
  let entry: ReadEntry
  var started = false
  var continuation: CheckedContinuation<Void, Never>?
  init(entry: ReadEntry) { self.entry = entry }
  func readCategories() async throws -> ReadCategories { .empty }
  func readEntries(_ query: ReadQuery) async throws -> ReadPage {
    started = true
    await withCheckedContinuation { continuation = $0 }
    return .init(
      items: [entry], total: 1, limit: 40, offset: 0,
      index: .init(complete: true, pending: 0, failed: 0))
  }
  func resume() {
    continuation?.resume()
    continuation = nil
  }
}
