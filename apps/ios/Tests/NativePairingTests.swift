import XCTest

@testable import PersonalLibrary

@MainActor final class NativePairingTests: XCTestCase {
  private var calls: [[String]] = []
  private var now = Date(timeIntervalSince1970: 1_800_000_000)
  private var failure: Error?
  private var delay: UInt64 = 0
  private func model() -> NativePairingModel {
    .init(
      name: "我的 iPhone",
      dependencies: .init(
        pair: { server, key, name in
          self.calls.append([server, key, name])
          if self.delay > 0 { try await Task.sleep(nanoseconds: self.delay) }
          if let failure = self.failure { throw failure }
        }, now: { self.now }))
  }
  func testManualValidationAndExactPairingFields() async {
    let m = model()
    m.server = "https://LIBRARY.inspirai.store:443/"
    m.key = "manual-personal-key"
    XCTAssertTrue(m.canPair)
    await m.submitManual()
    XCTAssertEqual(calls, [["https://library.inspirai.store", "manual-personal-key", "我的 iPhone"]])
    XCTAssertTrue(m.completed)
    XCTAssertTrue(m.key.isEmpty)
    XCTAssertFalse(m.canPair)
  }
  func testInvalidManualFieldsNeverReachPairing() async {
    for (server, key, name) in [
      ("http://example.com", "abc", "名字"), ("https://example.com/path", "abc", "名字"),
      ("https://example.com", "", "名字"),
      ("https://example.com", "abc", String(repeating: "名", count: 101)),
    ] {
      let m = model()
      m.server = server
      m.key = key
      m.name = name
      await m.submitManual()
      XCTAssertFalse(m.canPair)
    }
    XCTAssertTrue(calls.isEmpty)
  }
  func testScanRequiresExplicitConfirmationAndCancelClearsSecret() async {
    let m = model()
    m.openScanner()
    XCTAssertTrue(m.accept(NativePairingFixture.code(expiry: now.addingTimeInterval(30))))
    XCTAssertTrue(calls.isEmpty)
    XCTAssertNotNil(m.scanned)
    XCTAssertTrue(m.key.isEmpty)
    m.cancelConfirmation()
    await m.confirm()
    XCTAssertTrue(calls.isEmpty)
    XCTAssertNil(m.scanned)
  }
  func testConfirmUsesScannedOriginAndExactSecret() async {
    let m = model()
    m.openScanner()
    _ = m.accept(NativePairingFixture.code(expiry: now.addingTimeInterval(30)))
    m.server = "https://other.invalid"
    m.name = "我的 iPad"
    await m.confirm()
    XCTAssertEqual(calls.first?.first, "https://library.inspirai.store")
    XCTAssertEqual(calls.first?[1], NativePairingFixture.secret)
    XCTAssertEqual(calls.first?.last, "我的 iPad")
    XCTAssertNil(m.scanned)
  }
  func testCodeExpiringDuringConfirmationCannotPair() async {
    let m = model()
    _ = m.accept(NativePairingFixture.code(expiry: now.addingTimeInterval(1)))
    now = now.addingTimeInterval(2)
    await m.confirm()
    XCTAssertEqual(m.notice, "配对码已失效")
    XCTAssertTrue(calls.isEmpty)
    XCTAssertNil(m.scanned)
  }
  func testWorkerAndExpiredScansStayOutOfConfirmation() {
    let m = model()
    XCTAssertFalse(
      m.accept(NativePairingFixture.code(expiry: now.addingTimeInterval(30), role: "worker")))
    XCTAssertEqual(m.notice, "需要管理端配对码")
    XCTAssertNil(m.scanned)
    XCTAssertFalse(m.accept(NativePairingFixture.code(expiry: now.addingTimeInterval(-1))))
    XCTAssertEqual(m.notice, "配对码已失效")
    XCTAssertTrue(calls.isEmpty)
  }
  func testFailureClearsSecretAndKeepsServerAndName() async {
    failure = CollectorError.http(401)
    let m = model()
    m.key = "manual-key"
    m.name = "设备名"
    await m.submitManual()
    XCTAssertEqual(m.notice, "配对码已失效")
    XCTAssertEqual(m.server, "https://library.inspirai.store")
    XCTAssertEqual(m.name, "设备名")
    XCTAssertTrue(m.key.isEmpty)
    XCTAssertFalse(m.completed)
  }
  func testDuplicateSubmitAndCloseWhileBusyCannotSendAgain() async throws {
    delay = 100_000_000
    let m = model()
    m.key = "manual-key"
    let request = Task { await m.submitManual() }
    try await Task.sleep(nanoseconds: 20_000_000)
    m.clearTransient()
    await m.submitManual()
    XCTAssertFalse(m.busy)
    await request.value
    XCTAssertEqual(calls.count, 1)
    XCTAssertFalse(m.completed)
  }
  func testOfflinePreservesUnsentFieldsAndBlocksBothPairingPaths() async {
    let m = model()
    m.key = "manual-key"
    m.setOffline(true)
    await m.submitManual()
    XCTAssertEqual(m.key, "manual-key")
    XCTAssertTrue(calls.isEmpty)
    m.setOffline(false)
    XCTAssertTrue(m.canPair)
    _ = m.accept(NativePairingFixture.code(expiry: now.addingTimeInterval(20)))
    m.setOffline(true)
    await m.confirm()
    XCTAssertTrue(calls.isEmpty)
  }
  func testBackgroundInvalidatesDelayedPhotoRecognition() async throws {
    let m = NativePairingModel(
      name: "设备",
      dependencies: .init(
        pair: { _, _, _ in XCTFail("Unexpected pairing") },
        decode: { _ in
          try await Task.sleep(nanoseconds: 100_000_000)
          return [NativePairingFixture.code()]
        }))
    let read = Task { await m.recognize(Data([1])) }
    try await Task.sleep(nanoseconds: 20_000_000)
    m.clearTransient()
    await read.value
    XCTAssertNil(m.scanned)
    XCTAssertFalse(m.recognizing)
    XCTAssertTrue(m.key.isEmpty)
  }
  func testPhotoRecognitionUsesRealVisionDecoderAndNoAutomaticPairing() async throws {
    let m = model()
    let data = NativePairingFixture.image(
      NativePairingFixture.code(expiry: now.addingTimeInterval(30)))
    let codes = try await NativePairingImageDecoder.decode(data)
    XCTAssertEqual(codes.count, 1)
    _ = try PairingQRCode.parse(codes[0], now: now)
    await m.recognize(data)
    XCTAssertNotNil(m.scanned)
    XCTAssertTrue(calls.isEmpty)
  }
  func testReturningToManualInvalidatesDelayedPhotoRecognition() async throws {
    let m = NativePairingModel(
      name: "设备",
      dependencies: .init(
        pair: { _, _, _ in XCTFail("Unexpected pairing") },
        decode: { _ in
          try await Task.sleep(nanoseconds: 100_000_000)
          return [NativePairingFixture.code()]
        }))
    m.openScanner()
    m.setOffline(true)
    let read = Task { await m.recognize(Data([1])) }
    try await Task.sleep(nanoseconds: 20_000_000)
    m.manual()
    await read.value
    XCTAssertNil(m.scanned)
    XCTAssertEqual(m.route, .manual)
    XCTAssertFalse(m.recognizing)
    XCTAssertEqual(m.notice, "离线")
  }
  func testMalformedAndOversizedImagesAndMultiplePairingCodesAreRejected() async {
    for data in [Data(), Data("not image".utf8), Data(repeating: 1, count: 15_000_001)] {
      let m = model()
      await m.recognize(data)
      XCTAssertNil(m.scanned)
      XCTAssertNotNil(m.notice)
    }
    let m = NativePairingModel(
      name: "设备",
      dependencies: .init(
        pair: { _, _, _ in XCTFail("Unexpected pairing") }, now: { self.now },
        decode: { _ in
          [
            NativePairingFixture.code(expiry: self.now.addingTimeInterval(30)),
            NativePairingFixture.code(
              expiry: self.now.addingTimeInterval(30), server: "https://other.invalid"),
          ]
        }))
    await m.recognize(Data([1]))
    XCTAssertNil(m.scanned)
    XCTAssertEqual(m.notice, "照片包含多个配对二维码")
  }
  func testUnsafeTransportDetailsNeverAppearInPairingError() {
    XCTAssertEqual(
      NativePairingModel.message(CollectorError.message("credential-in-response")), "配对未完成")
    XCTAssertEqual(NativePairingModel.message(URLError(.badServerResponse)), "配对未完成")
  }
}
