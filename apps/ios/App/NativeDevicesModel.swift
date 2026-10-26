import Network
import SwiftUI

protocol NativeDevicesService: Sendable {
  func state() async throws -> ServerState
  func revoke(_ id: String) async throws
}
extension CollectorAPI: NativeDevicesService {}

enum NativeDevicesPhase: Equatable { case loading, content, offline, failure, unpaired, expired }
enum NativeDevicesConfirmation: Equatable { case revoke(String), forget }

@MainActor
final class NativeDevicesModel: ObservableObject {
  @Published private(set) var me: Device?
  @Published private(set) var others: [Device] = []
  @Published private(set) var phase: NativeDevicesPhase = .unpaired
  @Published private(set) var origin = ""
  @Published private(set) var busy = false
  @Published private(set) var refreshing = false
  @Published private(set) var offline = false
  @Published private(set) var notice: String?
  @Published private(set) var hasLoaded = false
  @Published var selectedID: String?
  @Published var path: [String] = []
  @Published var confirmation: NativeDevicesConfirmation?
  private var service: (any NativeDevicesService)?
  private var forget: () async throws -> Void
  private var generation = UUID()
  private var sequence = 0
  private var monitor: NWPathMonitor?

  init(service: (any NativeDevicesService)? = nil, origin: String = "",
       watchConnectivity: Bool = false, forget: @escaping () async throws -> Void = {}) {
    self.service = service; self.origin = origin; self.forget = forget
    phase = service == nil ? .unpaired : .loading
    if watchConnectivity {
      let monitor = NWPathMonitor(); self.monitor = monitor
      monitor.pathUpdateHandler = { [weak self] path in
        Task { @MainActor in self?.setOffline(path.status == .unsatisfied) }
      }
      monitor.start(queue: DispatchQueue(label: "native.devices.connectivity"))
    }
  }
  deinit { monitor?.cancel() }
  var selected: Device? { selectedID.flatMap(device) ?? me }
  var host: String { (try? ServerOrigin(origin))?.value.replacingOccurrences(of: "https://", with: "") ?? "" }
  func device(_ id: String) -> Device? { me?.id == id ? me : others.first { $0.id == id } }
  func configure(service: (any NativeDevicesService)?, origin: String = "", expired: Bool = false,
    localDevice: Device? = nil, forget: (() async throws -> Void)? = nil) {
    generation = UUID(); sequence += 1
    self.service = service; self.origin = origin
    if let forget { self.forget = forget }
    me = !expired && service != nil ? localDevice : nil
    hasLoaded = false; others = []; path = []; selectedID = nil; confirmation = nil
    busy = false; refreshing = false; notice = nil
    phase = expired ? .expired : service == nil ? .unpaired : offline ? .offline : .loading
  }
  func setOffline(_ value: Bool) {
    offline = value
    guard service != nil, phase != .expired else { return }
    if value { phase = .offline; confirmation = nil; notice = "离线" }
    else if phase == .offline { phase = me == nil ? .loading : .content; notice = nil }
  }
  func open(_ id: String, tablet: Bool) {
    guard device(id) != nil, !busy else { return }
    selectedID = id
    if !tablet { path = [id] }
  }
  func reload() async {
    guard let service, !refreshing, !busy, !offline, phase != .expired else { return }
    let session = generation; sequence += 1; let read = sequence
    refreshing = true
    defer { if session == generation && read == sequence { refreshing = false } }
    do {
      let state = try await service.state()
      guard session == generation, read == sequence, !Task.isCancelled else { return }
      try accept(state); notice = offline ? "离线" : nil
    } catch {
      guard session == generation, read == sequence, !Task.isCancelled else { return }
      handle(error, action: false)
    }
  }
  private func accept(_ state: ServerState) throws {
    guard state.me.role == "owner", state.me.revokedAt == nil else { throw CollectorError.http(403) }
    guard UUID(uuidString: state.me.id) != nil,
      state.devices.allSatisfy({ UUID(uuidString: $0.id) != nil }) else {
      throw CollectorError.message("设备数据无效")
    }
    var seen = Set([state.me.id])
    me = state.me
    hasLoaded = true
    others = state.devices.filter { seen.insert($0.id).inserted }
    phase = offline ? .offline : .content
    if let id = selectedID, device(id) == nil { selectedID = state.me.id; path = [] }
    if case .revoke(let id) = confirmation, !others.contains(where: { $0.id == id && $0.revokedAt == nil }) { confirmation = nil }
  }
  func canRevoke(_ id: String) -> Bool {
    phase == .content && !offline && !busy && !refreshing && id != me?.id
      && others.contains { $0.id == id && $0.revokedAt == nil }
  }
  func requestRevoke(_ id: String) {
    guard canRevoke(id) else { return }
    confirmation = .revoke(id)
  }
  func requestForget(tablet: Bool) {
    guard me != nil, !busy else { return }
    open(me!.id, tablet: tablet); confirmation = .forget
  }
  func confirm() async {
    guard let intent = confirmation, !busy else { return }
    confirmation = nil
    switch intent {
    case .forget:
      guard me != nil else { return }
      let session = generation; busy = true; notice = nil
      defer { if session == generation { busy = false } }
      do {
        try await forget()
        guard session == generation, !Task.isCancelled else { return }
        configure(service: nil)
      } catch {
        guard session == generation, !Task.isCancelled else { return }
        notice = "移除登录未完成"
      }
    case .revoke(let id):
      guard let service, canRevoke(id) else { return }
      let session = generation; busy = true; notice = nil
      var acknowledged = false
      sequence += 1
      defer { if session == generation { busy = false } }
      do {
        let latest = try await service.state()
        guard session == generation, !Task.isCancelled else { return }
        try accept(latest)
        guard !offline, let target = others.first(where: { $0.id == id }), target.revokedAt == nil else {
          notice = "设备状态已变化"; return
        }
        try await service.revoke(id)
        guard session == generation, !Task.isCancelled else { return }
        acknowledged = true
        // The POST is acknowledged. Never restore active actions if the following read fails.
        others = others.map { device in
          device.id == id ? Device(id: device.id, name: device.name, role: device.role,
            revokedAt: ISO8601DateFormatter().string(from: Date()), online: false, agents: nil) : device
        }
        let updated = try await service.state()
        guard session == generation, !Task.isCancelled else { return }
        try accept(updated)
      } catch {
        guard session == generation, !Task.isCancelled else { return }
        handle(error, action: true)
        if acknowledged && phase != .expired && !offline { notice = "撤销已确认，设备状态暂时无法读取" }
      }
    }
  }
  private func handle(_ error: Error, action: Bool) {
    if case CollectorError.http(let status) = error, [401, 403].contains(status) {
      configure(service: nil, expired: true)
    } else {
      let disconnected = offline || (error as? URLError)?.code == .notConnectedToInternet
      phase = disconnected ? .offline : me == nil ? .failure : .content
      notice = disconnected ? "离线" : action ? "撤销未确认完成" : "设备暂时无法读取"
    }
  }
}

extension Device {
  var nativeDeviceName: String { name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "未命名设备" : name }
  var nativeDeviceRole: String { role == "owner" ? "管理端" : role == "worker" ? "采集电脑" : "设备" }
  var nativeDeviceStatus: String {
    revokedAt != nil ? "已撤销" : role == "owner" ? "已授权" : online == true ? "在线" : online == false ? "离线" : "状态未知"
  }
  var nativeAgents: [String] {
    guard role == "worker", revokedAt == nil else { return [] }
    var seen = Set<String>()
    return (agents ?? []).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && seen.insert($0).inserted }
  }
}
