import Foundation
import Network
import SwiftUI
import UIKit

@MainActor
struct NativeOutboxDependencies {
  var list: () throws -> [OutboxItem]
  var credential: () throws -> DeviceCredential?
  var bind: (String, String) throws -> Void
  var send: (String, DeviceCredential) async throws -> Void
  var copy: (String) -> Void
  var remove: (String) throws -> Void = { _ in throw CollectorError.message("本机记录移除不可用") }
  static func live() -> Self {
    .init(
      list: { try Outbox.shared().list() }, credential: { try CredentialStore().load() },
      bind: { try Outbox.shared().bindUnassigned(id: $0, origin: $1) },
      send: { try await OutboxSender.send(id: $0, outbox: Outbox.shared(), credential: $1) },
      copy: { UIPasteboard.general.string = $0 },
      remove: { try Outbox.shared().remove(id: $0) })
  }
}
struct NativeOutboxBinding: Equatable {
  let itemID: String
  let origin: String
  let deviceID: String
}
@MainActor
final class NativeOutboxModel: ObservableObject {
  @Published private(set) var items: [OutboxItem] = []
  @Published var selectedID: String?
  @Published var path: [String] = []
  @Published var binding: NativeOutboxBinding?
  @Published var menu = false
  @Published var removal: OutboxItem?
  @Published private(set) var busy = false
  @Published private(set) var loading = true
  @Published private(set) var origin = ""
  @Published private(set) var paired = false
  @Published private(set) var expired = false
  @Published private(set) var offline = false
  @Published var notice: String?
  private let dependencies: NativeOutboxDependencies
  private var monitor: NWPathMonitor?
  private var networkUnavailable = false
  init(dependencies: NativeOutboxDependencies, watchConnectivity: Bool = false) {
    self.dependencies = dependencies
    if watchConnectivity {
      let monitor = NWPathMonitor()
      self.monitor = monitor
      monitor.pathUpdateHandler = { [weak self] path in
        let disconnected = path.status == .unsatisfied
        Task { @MainActor in self?.setOffline(disconnected) }
      }
      monitor.start(queue: DispatchQueue(label: "native.outbox.connectivity"))
    }
  }
  deinit { monitor?.cancel() }
  var selected: OutboxItem? { item(selectedID ?? path.last ?? "") }
  func item(_ id: String) -> OutboxItem? { items.first { $0.id == id } }
  func reload() {
    defer { loading = false }
    do {
      let values = try dependencies.list()
      items = values
      let credential: DeviceCredential?
      do { credential = try dependencies.credential() } catch {
        paired = false
        origin = ""
        binding = nil
        throw error
      }
      paired = credential != nil
      origin = credential?.origin ?? ""
      if selectedID == nil || !values.contains(where: { $0.id == selectedID }) {
        selectedID = values.first?.id
      }
      if let index = path.firstIndex(where: { id in !values.contains(where: { $0.id == id }) }) {
        path = Array(path[..<index])
      }
      if let removal, !values.contains(where: { $0.id == removal.id }) { self.removal = nil }
      if let binding, binding.origin != origin || binding.deviceID != credential?.deviceID {
        self.binding = nil
      }
    } catch {
      // Keep the last readable list. Never turn a storage or Keychain error into an empty inbox.
      notice = safeMessage(error)
    }
  }
  func setOffline(_ value: Bool) {
    networkUnavailable = value
    offline = value
  }
  func refresh() {
    offline = networkUnavailable
    notice = nil
    reload()
  }
  func invalidateSession(expired: Bool) {
    binding = nil
    self.expired = expired
    reload()
  }
  func mismatch(_ item: OutboxItem) -> Bool {
    paired && item.origin != nil && item.origin != origin
  }
  func canSend(_ item: OutboxItem) -> Bool {
    !busy && !offline && paired && !expired && !item.leased && item.state != "submitted"
      && (item.origin == nil || item.origin == origin)
  }
  func canOpenTask(_ item: OutboxItem) -> Bool {
    paired && !expired && item.origin == origin && item.state == "submitted" && item.taskID != nil
  }
  func status(_ item: OutboxItem) -> String {
    if item.state == "submitted" { return "已提交" }
    if item.leased { return "发送中" }
    if item.state == "blocked" || mismatch(item) { return "需要处理" }
    return "待提交"
  }
  func requestBinding(_ id: String) {
    guard let item = item(id), canSend(item), item.origin == nil else { return }
    do {
      guard let credential = try dependencies.credential() else {
        reload()
        notice = "尚未配对"
        return
      }
      binding = .init(itemID: id, origin: credential.origin, deviceID: credential.deviceID)
    } catch { notice = safeMessage(error) }
  }
  func confirmBinding() async {
    guard let pending = binding, !busy, !offline else { return }
    binding = nil
    await send(pending.itemID, confirmed: pending)
  }
  func retry(_ id: String) async {
    guard let item = item(id), canSend(item), item.origin != nil else { return }
    await send(id, confirmed: nil)
  }
  private func send(_ id: String, confirmed: NativeOutboxBinding?) async {
    guard !busy, !offline else { return }
    busy = true
    notice = nil
    defer {
      busy = false
      reload()
    }
    do {
      guard let credential = try dependencies.credential() else {
        throw CollectorError.message("尚未配对")
      }
      guard let current = try dependencies.list().first(where: { $0.id == id }),
        current.state != "submitted", !current.leased
      else { return }
      if let confirmed {
        guard confirmed.itemID == id, current.origin == nil,
          credential.origin == confirmed.origin, credential.deviceID == confirmed.deviceID
        else {
          throw CollectorError.message("服务器已变化，请重新确认绑定。")
        }
        try dependencies.bind(id, confirmed.origin)
        guard try dependencies.list().first(where: { $0.id == id })?.origin == confirmed.origin
        else {
          throw CollectorError.message("绑定未确认，原文仍在本机。")
        }
      } else {
        guard current.origin == credential.origin else {
          throw CollectorError.message("服务器不匹配")
        }
      }
      try await dependencies.send(id, credential)
    } catch {
      notice = safeMessage(error)
      if let code = (error as? URLError)?.code,
        [.notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .timedOut].contains(
          code)
      {
        offline = true
      }
      if case CollectorError.http(let status) = error, [401, 403].contains(status) {
        expired = true
      }
    }
  }
  func retryQueued() async {
    guard !busy, !offline, paired, !expired else { return }
    let candidates = items.filter { $0.origin == origin && $0.state == "queued" && !$0.leased }
    for item in candidates {
      if Task.isCancelled { break }
      await retry(item.id)
      if self.item(item.id)?.state != "submitted" { break }
    }
  }
  func copyOriginal(_ item: OutboxItem) {
    dependencies.copy(
      SharedPart.uniqueValues(in: item.share.originalParts).map(\.value).joined(separator: "\n\n"))
  }
  func requestRemoval(_ id: String) {
    guard let record = item(id) else { return }
    menu = false
    binding = nil
    removal = record
  }
  func cancelRemoval() { removal = nil }
  func confirmRemoval() {
    guard let pending = removal else { return }
    do {
      try dependencies.remove(pending.id)
      let remaining = try dependencies.list()
      guard !remaining.contains(where: { $0.id == pending.id }) else {
        throw CollectorError.message("本机记录移除未确认，请刷新后重试。")
      }
      items = remaining
      if selectedID == pending.id { selectedID = remaining.first?.id }
      if let index = path.firstIndex(of: pending.id) { path = Array(path[..<index]) }
      if binding?.itemID == pending.id { binding = nil }
      removal = nil
      notice = nil
    } catch {
      removal = nil
      notice = "本机记录移除未确认，请刷新后重试。"
    }
  }
}
extension OutboxItem {
  var nativeTitle: String {
    SharedPart.uniqueValues(in: share.originalParts).first?.value.components(separatedBy: .newlines)
      .first ?? "分享"
  }
  var nativeHost: String { origin.flatMap { URL(string: $0)?.host } ?? "未绑定" }
  var nativeDate: String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "Asia/Shanghai")
    f.dateFormat = "yyyy-MM-dd  HH:mm"
    return f.string(from: share.createdAt)
  }
}
