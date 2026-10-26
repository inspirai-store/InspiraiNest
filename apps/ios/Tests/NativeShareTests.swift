import XCTest

@testable import PersonalLibrary

@MainActor
final class NativeShareTests: XCTestCase {
  private final class Harness {
    var credential: DeviceCredential? = DeviceCredential(
      origin: "https://library.example.com", deviceID: "00000000-0000-0000-0000-000000000001",
      name: "fixture", token: "fixture")
    var records: [SavedShare] = []
    var origins: [String?] = []
    var ids: [String] = []
    var sends = 0
    var completed = 0
    var cancelled = 0
    var persistFails = false
    var sendFails = false
    var readFails = false
    var unlockFails = false
    var acknowledged = true
    let raw = "  原文\n重复句\n重复句\nhttps://example.com/a?x=1&x=2#定位  "
    var dependencies: ShareDependencies {
      ShareDependencies(
        capture: { [self] in
          if readFails { throw CollectorError.message("原文读取失败") }
          return ShareCaptureResult(
            parts: [
              SharedPart(item: 0, attachment: nil, kind: "text", representation: nil, value: raw)
            ], omittedAttachments: 1)
        },
        credential: { [self] in
          if unlockFails { throw CollectorError.message("Keychain 锁定") }
          return credential
        }, cachedDevices: { _ in [] }, refreshDevices: { _ in [] },
        persist: { [self] record, origin in
          ids.append(record.submission.submissionId)
          if persistFails { throw CollectorError.message("本机保存失败") }
          records.append(record)
          origins.append(origin)
        },
        send: { [self] _, _ in
          sends += 1
          if sendFails { throw CollectorError.http(401) }
          return acknowledged
        }, complete: { [self] in completed += 1 }, cancel: { [self] in cancelled += 1 },
        openMainApp: { _ in false })
    }
  }
  func testRawOriginalRequirementsTagsAndDispatchSurviveSave() async {
    let h = Harness()
    let model = ShareModel(dependencies: h.dependencies)
    await model.capture()
    await model.loadDevices()
    model.requirements = "追加\n要求"
    model.tags = "SwiftUI，阅读,SwiftUI"
    model.agent = "codex"
    model.deviceID = "offline"
    model.autoArchive = false
    await model.save()
    await model.save()
    XCTAssertEqual(h.records.count, 1)
    XCTAssertEqual(h.sends, 1)
    XCTAssertEqual(h.records[0].originalParts[0].value, h.raw)
    XCTAssertEqual(h.records[0].submission.content, h.raw + "\n\n【附加要求】\n追加\n要求")
    XCTAssertEqual(h.records[0].submission.tags, ["SwiftUI", "阅读"])
    XCTAssertEqual(h.records[0].submission.deviceId, "offline")
    XCTAssertFalse(h.records[0].submission.autoArchive)
    XCTAssertTrue(model.submitted)
  }
  func testDurableSaveFailureDoesNotShowSavedAndRetryUsesSameID() async {
    let h = Harness()
    h.persistFails = true
    let model = ShareModel(dependencies: h.dependencies)
    await model.capture()
    await model.save()
    XCTAssertFalse(model.saved)
    XCTAssertEqual(h.sends, 0)
    h.persistFails = false
    await model.save()
    XCTAssertTrue(model.saved)
    XCTAssertEqual(Set(h.ids).count, 1)
  }
  func testLockedKeychainStillSavesUnboundOriginal() async {
    let h = Harness()
    h.unlockFails = true
    let model = ShareModel(dependencies: h.dependencies)
    await model.capture()
    await model.save()
    XCTAssertTrue(model.saved)
    XCTAssertFalse(model.submitted)
    XCTAssertEqual(h.sends, 0)
    XCTAssertNil(h.origins[0])
  }
  func testCredentialSwitchPinsOriginalOriginAndDoesNotSendElsewhere() async {
    let h = Harness()
    let model = ShareModel(dependencies: h.dependencies)
    await model.capture()
    await model.loadDevices()
    model.deviceID = "chosen"
    h.credential = DeviceCredential(
      origin: "https://different.example.com", deviceID: "00000000-0000-0000-0000-000000000002",
      name: "other", token: "fixture")
    await model.save()
    XCTAssertTrue(model.saved)
    XCTAssertEqual(h.sends, 0)
    XCTAssertEqual(h.origins[0], "https://library.example.com")
    XCTAssertEqual(h.records[0].submission.deviceId, "chosen")
  }
  func testServerFailureOrMissingReceiptNeverClaimsSubmitted() async {
    for failure in [false, true] {
      let h = Harness()
      h.sendFails = failure
      h.acknowledged = false
      let model = ShareModel(dependencies: h.dependencies)
      await model.capture()
      await model.save()
      XCTAssertTrue(model.saved)
      XCTAssertFalse(model.submitted)
      XCTAssertEqual(h.records.count, 1)
    }
  }
  func testFailedCaptureBlocksSaveAndCanRetry() async {
    let h = Harness()
    h.readFails = true
    let model = ShareModel(dependencies: h.dependencies)
    await model.capture()
    await model.save()
    XCTAssertTrue(model.captureFailed)
    XCTAssertTrue(h.records.isEmpty)
    h.readFails = false
    await model.capture()
    await model.save()
    XCTAssertTrue(model.saved)
  }
  func testCompletionAndCancelAreExclusiveAndIdempotent() async {
    let h = Harness()
    let model = ShareModel(dependencies: h.dependencies)
    model.close()
    XCTAssertEqual(h.completed, 0)
    await model.capture()
    await model.save()
    model.cancel()
    model.close()
    model.close()
    XCTAssertEqual(h.completed, 1)
    XCTAssertEqual(h.cancelled, 0)
  }
  func testRejectedMainAppOpenRetainsResultAndShowsRecovery() async {
    let h = Harness()
    h.credential = nil
    let model = ShareModel(dependencies: h.dependencies)
    await model.capture()
    await model.save()
    await model.openMainApp()
    XCTAssertTrue(model.saved)
    XCTAssertFalse(model.openedMainApp)
    XCTAssertTrue(model.message!.hasPrefix("请从主屏幕"))
  }
}
