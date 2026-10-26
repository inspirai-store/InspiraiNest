import Network
import SwiftUI

protocol NativeTaskService: Sendable {
  func state() async throws -> ServerState
  func taskAction(_ id: String, action: String) async throws
}
extension CollectorAPI: NativeTaskService {}

enum NativeTaskPhase: Equatable { case loading, content, failure, offline, unpaired, expired }
enum NativeTaskFilter: Int { case active, review, all }

@MainActor
final class NativeTaskModel: ObservableObject {
  @Published private(set) var tasks: [LibraryTask] = []
  @Published private(set) var phase: NativeTaskPhase = .unpaired
  @Published private(set) var busy = false
  @Published private(set) var refreshing = false
  @Published private(set) var notice: String?
  @Published private(set) var offline = false
  @Published var filter = 2
  @Published var selectedID: String?
  @Published var path: [String] = []
  @Published var menu = false
  @Published var cancellationID: String?
  private var service: (any NativeTaskService)?
  private var generation = UUID()
  private var readSequence = 0
  private var monitor: NWPathMonitor?

  init(service: (any NativeTaskService)? = nil, watchConnectivity: Bool = false) {
    self.service = service
    phase = service == nil ? .unpaired : .loading
    if watchConnectivity {
      let monitor = NWPathMonitor()
      self.monitor = monitor
      monitor.pathUpdateHandler = { [weak self] path in
        let disconnected = path.status == .unsatisfied
        Task { @MainActor in self?.setOffline(disconnected) }
      }
      monitor.start(queue: DispatchQueue(label: "native.tasks.connectivity"))
    }
  }
  deinit { monitor?.cancel() }
  func setOffline(_ value: Bool) {
    offline = value
    guard service != nil, phase != .expired else { return }
    if value {
      phase = .offline
      notice = "离线"
      cancellationID = nil
    } else if phase == .offline {
      phase = tasks.isEmpty ? .loading : .content
      notice = nil
    }
  }
  var visibleTasks: [LibraryTask] {
    tasks.filter {
      switch NativeTaskFilter(rawValue: filter) ?? .all {
      case .active:
        return ["queued", "assigned", "running", "uploading", "waiting_action"].contains($0.state)
      case .review: return $0.state == "awaiting_review"
      case .all: return true
      }
    }
  }
  var selected: LibraryTask? { selectedID.flatMap(task) ?? visibleTasks.first }
  func task(_ id: String) -> LibraryTask? { tasks.first { $0.id == id } }
  func configure(service: (any NativeTaskService)?, expired: Bool = false) {
    generation = UUID()
    readSequence += 1
    self.service = service
    tasks = []
    selectedID = nil
    path = []
    menu = false
    cancellationID = nil
    busy = false
    refreshing = false
    notice = nil
    phase = expired ? .expired : service == nil ? .unpaired : offline ? .offline : .loading
  }
  func open(_ id: String, tablet: Bool) {
    selectedID = id
    if !tablet { path = [id] }
  }
  func reload() async {
    guard let service, !refreshing, !busy, !offline, phase != .expired else { return }
    let session = generation
    readSequence += 1
    let sequence = readSequence
    refreshing = true
    defer { if generation == session && readSequence == sequence { refreshing = false } }
    do {
      let result = try await service.state()
      guard generation == session, readSequence == sequence, !Task.isCancelled else { return }
      try accept(result)
      notice = offline ? "离线" : nil
    } catch {
      guard generation == session, readSequence == sequence, !Task.isCancelled else { return }
      handle(error)
    }
  }
  private func accept(_ state: ServerState) throws {
    guard state.me.role == "owner", state.me.revokedAt == nil else {
      throw CollectorError.http(403)
    }
    tasks = state.tasks
    phase = offline ? .offline : .content
    if let id = cancellationID, task(id)?.canCancel != true { cancellationID = nil }
  }
  func requestCancellation(_ id: String) {
    guard phase == .content, !busy, task(id)?.canCancel == true else { return }
    menu = false
    cancellationID = id
  }
  func confirmCancellation() async {
    guard let id = cancellationID else { return }
    cancellationID = nil
    await perform(id, action: "cancel")
  }
  func retry(_ id: String) async { await perform(id, action: "retry") }
  private func perform(_ id: String, action: String) async {
    guard let service, phase == .content, !busy,
      let existing = task(id), action == "retry" ? existing.canRetry : existing.canCancel
    else { return }
    let session = generation
    busy = true
    notice = nil
    readSequence += 1
    refreshing = false
    defer { if generation == session { busy = false } }
    do {
      // Refresh before changing state: the selected task may have completed on the computer.
      let latest = try await service.state()
      guard generation == session, !Task.isCancelled else { return }
      try accept(latest)
      guard !offline, let current = task(id),
        action == "retry" ? current.canRetry : current.canCancel
      else {
        notice = "任务状态已变化"
        return
      }
      try await service.taskAction(id, action: action)
      guard generation == session, !Task.isCancelled else { return }
      let updated = try await service.state()
      guard generation == session, !Task.isCancelled else { return }
      try accept(updated)
    } catch {
      guard generation == session, !Task.isCancelled else { return }
      handle(error)
    }
  }
  private func handle(_ error: Error) {
    if case CollectorError.http(let code) = error, code == 401 || code == 403 {
      configure(service: nil, expired: true)
    } else {
      phase = offline || (error as? URLError)?.code == .notConnectedToInternet ? .offline : .failure
      notice = phase == .offline ? "离线" : "任务暂时无法读取"
    }
  }
}

extension LibraryTask {
  var nativeTaskTitle: String {
    if recordId != nil,let preset=NativeRecordPreset(rawValue:processing?.preset ?? "") {
      return preset.title+" · "+(content?.components(separatedBy:.newlines).first ?? "记录")
    }
    return title.components(separatedBy: .newlines).first {
      !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    } ?? title
  }
  var nativeTaskTone: NativeTone {
    state == "failed"
      ? .destructive : ["completed", "cancelled"].contains(state) ? .secondary : .accent
  }
}
enum NativeTaskDate {
  static func display(_ raw: String, timeOnly: Bool = false) -> String {
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = iso.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    guard let date else { return raw }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
    formatter.dateFormat = timeOnly ? "HH:mm" : "yyyy-MM-dd"
    return formatter.string(from: date)
  }
}
