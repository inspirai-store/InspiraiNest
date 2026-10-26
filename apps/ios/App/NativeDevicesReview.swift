#if DEBUG
  import SwiftUI
  import UIKit

  struct NativeDevicesReview: View {
    let configuration: NativeReviewConfiguration
    @StateObject private var model: NativeDevicesModel
    @StateObject private var library = NativeLibraryModel()
    @StateObject private var pairing = NativePairingModel(name: UIDevice.current.userInterfaceIdiom == .pad ? "我的 iPad" : "我的 iPhone", dependencies: .init(pair: { _, _, _ in }))
    @State private var module: NativeAppModule = .devices
    @State private var connecting = false
    init(configuration: NativeReviewConfiguration) {
      self.configuration = configuration
      let flags = ProcessInfo.processInfo.arguments
      let tablet = UIDevice.current.userInterfaceIdiom == .pad
      let service = NativeDevicesFixture(tablet: tablet, empty: configuration.page == "S18",
        flags: flags)
      let model = NativeDevicesModel(service: service, origin: "https://library.inspirai.store", forget: {
        if flags.contains("--review-device-forget-fail") { throw CollectorError.message("Review failure") }
      })
      if ["P32", "P33", "P34"].contains(configuration.page) {
        let id = NativeDevicesFixture.id(configuration.page == "P34" ? 0 : 1)
        model.selectedID = id; model.path = [id]
        if configuration.page == "P33" { model.confirmation = .revoke(id) }
        if configuration.page == "P34" { model.confirmation = .forget }
      }
      if flags.contains("--review-device-unpaired") { model.configure(service: nil) }
      if flags.contains("--review-device-expired") { model.configure(service: nil, expired: true) }
      _model = StateObject(wrappedValue: model)
    }
    var body: some View {
      Group {
        if connecting {
          NativePairingShell(model: pairing, module: .init(get: { module }, set: { module = $0; connecting = false }), library: library,
            close: { connecting = false }, reviewCamera: true,
            cameraTheme: configuration.appearance ?? .light)
        } else {
          NativeDevicesView(model: model, module: $module, library: library,
            pair: { connecting = true })
        }
      }.task {
        if ProcessInfo.processInfo.arguments.contains("--review-device-offline") {
          await model.reload(); model.setOffline(true)
        }
      }
    }
  }
  actor NativeDevicesFixture: NativeDevicesService {
    var devices: [Device]
    let me: Device
    var flags: [String]
    init(tablet: Bool, empty: Bool, flags: [String]) {
      self.flags = flags
      me = Device(id: Self.id(0), name: tablet ? "我的 iPad" : "我的 iPhone",
        role: "owner", revokedAt: nil, online: nil, agents: nil)
      devices = empty ? [me] : [me,
        Device(id: Self.id(1), name: "我的 Mac", role: "worker", revokedAt: nil, online: true, agents: ["Codex", "CodeBuddy"]),
        Device(id: Self.id(2), name: "工作电脑", role: "worker", revokedAt: nil, online: false, agents: []),
        Device(id: Self.id(3), name: tablet ? "我的 iPhone" : "我的 iPad", role: "owner", revokedAt: nil, online: nil, agents: nil)]
      if flags.contains("--review-device-many") {
        devices += (4..<12).map { Device(id: Self.id($0), name: "授权设备 \($0)",
          role: "owner", revokedAt: nil, online: nil, agents: nil) }
      }
    }
    static func id(_ i: Int) -> String { String(format: "00000000-0000-0000-0001-%012d", i+1) }
    func state() async throws -> ServerState {
      if flags.contains("--review-device-loading") { try await Task.sleep(nanoseconds: 30_000_000_000) }
      if flags.contains("--review-device-error") {
        flags.removeAll { $0 == "--review-device-error" }; throw CollectorError.http(503)
      }
      return ServerState(me: me, devices: devices.filter { $0.revokedAt == nil }, tasks: [], archives: [])
    }
    func revoke(_ id: String) async throws {
      if flags.contains("--review-device-slow") { try await Task.sleep(nanoseconds: 2_000_000_000) }
      if flags.contains("--review-device-revoke-fail") { throw CollectorError.http(503) }
      if flags.contains("--review-device-revoke-expired") { throw CollectorError.http(401) }
      devices = devices.map { $0.id == id ? Device(id: $0.id, name: $0.name, role: $0.role,
        revokedAt: "2026-10-11T10:00:00+08:00", online: false, agents: nil) : $0 }
    }
  }
#endif
