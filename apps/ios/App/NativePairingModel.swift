import CoreImage
import Foundation
import ImageIO
import Network
import SwiftUI
import Vision

enum NativePairingFailure: Error, Equatable {
  case invalidImage, multipleCodes
}

enum NativePairingImageDecoder {
  static func decode(_ data: Data) async throws -> [String] {
    guard !data.isEmpty, data.count <= 15_000_000 else { throw NativePairingFailure.invalidImage }
    return try await Task.detached(priority: .userInitiated) {
      guard let source = CGImageSourceCreateWithData(data as CFData, nil),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let width = properties[kCGImagePropertyPixelWidth] as? Int,
        let height = properties[kCGImagePropertyPixelHeight] as? Int,
        width > 0, height > 0, width <= 16000, height <= 16000,
        Double(width) * Double(height) <= 60_000_000
      else { throw NativePairingFailure.invalidImage }
      let orientation =
        CGImagePropertyOrientation(
          rawValue: (properties[kCGImagePropertyOrientation] as? UInt32) ?? 1) ?? .up
      let request = VNDetectBarcodesRequest()
      request.symbologies = [.qr]
      var codes: [String] = []
      do {
        try VNImageRequestHandler(data: data, orientation: orientation).perform([request])
        codes = (request.results ?? []).compactMap(\.payloadStringValue)
      } catch {
        // Some simulator runtimes omit a Vision filter bundle. The native
        // Core Image decoder also supports QR and retains the same parser checks.
      }
      if codes.isEmpty, let image = CIImage(data: data),
        let detector = CIDetector(
          ofType: CIDetectorTypeQRCode, context: CIContext(options: [.useSoftwareRenderer: true]),
          options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
      {
        codes = detector.features(
          in: image, options: [CIDetectorImageOrientation: orientation.rawValue]
        )
        .compactMap { ($0 as? CIQRCodeFeature)?.messageString }
      }
      codes = Array(Set(codes))
      guard !codes.isEmpty else { throw NativePairingFailure.invalidImage }
      return codes
    }.value
  }
}

@MainActor struct NativePairingDependencies {
  var pair: (String, String, String) async throws -> Void
  var verify: ((String, String, String, String?, String?) async throws -> Void)? = nil
  var cancel: () -> Void = {}
  var now: () -> Date = { Date() }
  var decode: (Data) async throws -> [String] = { try await NativePairingImageDecoder.decode($0) }
  static func live(app: AppModel) -> Self {
    .init(pair: { server, key, name in
      try await app.login(server: server, key: key, name: name)
    }, verify: { server,key,name,otp,recovery in
      try await app.login(server: server,key:key,name:name,otp:otp,recoveryCode:recovery)
    }, cancel: { app.cancelLogin() })
  }
}

@MainActor final class NativePairingModel: ObservableObject {
  enum Route { case manual, scanner }
  @Published var server = "https://library.inspirai.store"
  @Published var name: String
  @Published var key = ""
  @Published var factor = ""
  @Published var recovery = false
  @Published private(set) var challenge = false
  private var pendingSecret: String?
  private var pendingOrigin: String?
  private var generation = UUID()
  @Published var route: Route = .manual
  @Published var photos = false
  @Published private(set) var scanned: PairingQRCode?
  @Published private(set) var notice: String?
  @Published private(set) var busy = false
  @Published private(set) var recognizing = false
  @Published private(set) var completed = false
  @Published private(set) var offline = false
  private let dependencies: NativePairingDependencies
  private var photoRequest = UUID()
  private var monitor: NWPathMonitor?
  init(name: String, dependencies: NativePairingDependencies, watchConnectivity: Bool = false) {
    self.name = name
    self.dependencies = dependencies
    if watchConnectivity {
      let monitor = NWPathMonitor()
      self.monitor = monitor
      monitor.pathUpdateHandler = { [weak self] path in
        Task { @MainActor in self?.setOffline(path.status == .unsatisfied) }
      }
      monitor.start(queue: DispatchQueue(label: "native.pairing.connectivity"))
    }
  }
  deinit { monitor?.cancel() }
  var canPair: Bool {
    !busy && !recognizing && !offline && !completed
      && (try? ServerOrigin(server)) != nil
      && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.utf16.count <= 100
      && (challenge ? !factor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && key.utf16.count <= 200)
  }
  var canConfirm: Bool {
    !busy && !offline && !completed && scanned != nil
      && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.utf16.count <= 100
  }
  func setOffline(_ value: Bool) {
    offline = value
    if value { notice = "离线" } else if notice == "离线" { notice = nil }
  }
  func edit() { if !busy && !offline { notice = nil;pendingSecret=nil;pendingOrigin=nil;challenge=false;factor="" } }
  func openScanner() {
    guard !busy else { return }
    photoRequest = UUID()
    recognizing = false
    key = ""
    scanned = nil
    notice = offline ? "离线" : nil
    route = .scanner
  }
  func manual() {
    clearTransient()
  }
  @discardableResult func accept(_ raw: String) -> Bool {
    guard !busy, !completed, scanned == nil else { return false }
    do {
      let code = try PairingQRCode.parse(raw, now: dependencies.now())
      key = ""
      server = code.server
      scanned = code
      route = .manual
      notice = offline ? "离线" : nil
      return true
    } catch {
      notice = Self.message(error)
      return false
    }
  }
  func recognize(_ data: Data) async {
    guard !busy, !recognizing else { return }
    let request = UUID()
    photoRequest = request
    recognizing = true
    notice = offline ? "离线" : nil
    defer { if request == photoRequest { recognizing = false } }
    do {
      let raw = try await dependencies.decode(data)
      guard request == photoRequest, !Task.isCancelled else { return }
      let valid = raw.compactMap { try? PairingQRCode.parse($0, now: dependencies.now()) }
      guard valid.count <= 1 else { throw NativePairingFailure.multipleCodes }
      if let code = valid.first {
        scanned = code
        key = ""
        server = code.server
        route = .manual
        notice = offline ? "离线" : nil
      } else if let first = raw.first {
        _ = accept(first)
      } else {
        throw NativePairingFailure.invalidImage
      }
    } catch {
      guard request == photoRequest, !Task.isCancelled else { return }
      notice = Self.message(error)
    }
  }
  func photoFailed() { notice = "照片读取失败" }
  func cancelConfirmation() {
    guard !busy else { return }
    scanned = nil
    key = ""
  }
  func clearTransient() {
    generation=UUID();dependencies.cancel();busy=false
    pendingSecret=nil;pendingOrigin=nil;challenge=false;factor=""
    photoRequest = UUID()
    recognizing = false
    scanned = nil
    key = ""
    photos = false
    route = .manual
    notice = offline ? "离线" : nil
  }
  func submitManual() async {
    guard canPair else { return }
    if challenge, let pendingSecret, let pendingOrigin {
      let code=factor;factor=""
      await submit(server:pendingOrigin,key:pendingSecret,otp:recovery ? nil:code,recoveryCode:recovery ? code:nil)
    } else {
      let secret = key;key = ""
      await submit(server: server, key: secret)
    }
  }
  func confirm() async {
    guard canConfirm, let code = scanned else { return }
    guard let expiry = code.expiresAt, expiry > dependencies.now() else {
      scanned = nil
      key = ""
      notice = "配对码已失效"
      return
    }
    await submit(server: code.server, key: code.key)
  }
  private func submit(server: String, key: String, otp:String?=nil, recoveryCode:String?=nil) async {
    guard !busy, !offline else { return }
    busy = true
    notice = nil
    let started=generation
    defer { if started==generation {busy=false;scanned=nil} }
    do {
      let origin = try ServerOrigin(server)
      if let verify=dependencies.verify { try await verify(origin.value,key,name,otp,recoveryCode) }
      else { try await dependencies.pair(origin.value, key, name) }
      guard started==generation,!Task.isCancelled else{return}
      pendingSecret=nil;pendingOrigin=nil;challenge=false;completed = true
    } catch {
      guard started==generation,!Task.isCancelled else{return}
      if case CollectorError.login(let code,_) = error, ["mfa_required","mfa_invalid"].contains(code) {
        pendingSecret=key;pendingOrigin=server;challenge=true;notice=code=="mfa_invalid" ? "验证码无效":nil
      } else { pendingSecret=nil;pendingOrigin=nil;challenge=false;notice=Self.message(error) }
    }
  }
  static func message(_ error: Error) -> String {
    if let failure = error as? QRPairingError {
      switch failure {
      case .invalid: return "二维码无效"
      case .worker: return "需要管理端配对码"
      case .expired: return "配对码已失效"
      }
    }
    if let failure = error as? NativePairingFailure {
      return failure == .multipleCodes ? "照片包含多个配对二维码" : "未识别到配对二维码"
    }
    if case CollectorError.http(let status) = error {
      switch status {
      case 401, 404, 410: return "配对码已失效"
      case 403: return "需要管理端配对码"
      case 429: return "请求过于频繁"
      default: return "服务器连接失败"
      }
    }
    // Never reflect QR contents, URLs, authentication responses or raw transport errors.
    return "配对未完成"
  }
}
