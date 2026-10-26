import Network
import SwiftUI

protocol NativeDraftService: Sendable {
  func state() async throws -> ServerState
  func draft(_ id: String, expectedDigest: String) async throws -> DraftBundle
  func approveDraft(_ id: String, expectedDigest: String) async throws
}
extension CollectorAPI: NativeDraftService {}

enum NativeDraftPhase: Equatable {
  case loading, ready, changed, integrity, failure, offline, unpaired, expired, terminal, archived
}

@MainActor final class NativeDraftModel: ObservableObject {
  @Published private(set) var phase: NativeDraftPhase = .unpaired
  @Published private(set) var bundle: DraftBundle?
  @Published private(set) var task: LibraryTask?
  @Published private(set) var reviewedDigest: String?
  @Published private(set) var busy = false
  @Published private(set) var loading = false
  @Published private(set) var offline = false
  @Published private(set) var notice: String?
  @Published var selectedPath = ""
  @Published var category = 0
  @Published var filesPanel = false
  @Published var confirmation = false
  private var service: (any NativeDraftService)?
  private var monitor: NWPathMonitor?
  private(set) var sessionKey = UUID()
  private var request = UUID()
  private var checking = false
  private var taskID = ""

  init(service: (any NativeDraftService)? = nil, watchConnectivity: Bool = false) {
    self.service = service
    phase = service == nil ? .unpaired : .loading
    if watchConnectivity {
      let monitor = NWPathMonitor()
      self.monitor = monitor
      monitor.pathUpdateHandler = { [weak self] path in
        Task { @MainActor in self?.setOffline(path.status == .unsatisfied) }
      }
      monitor.start(queue: DispatchQueue(label: "native.drafts.connectivity"))
    }
  }
  deinit { monitor?.cancel() }
  func configure(service: (any NativeDraftService)?, expired: Bool = false) {
    sessionKey = UUID()
    request = UUID()
    self.service = service
    taskID = ""
    bundle = nil
    task = nil
    reviewedDigest = nil
    selectedPath = ""
    category = 0
    confirmation = false
    filesPanel = false
    busy = false
    loading = false
    checking = false
    notice = nil
    phase = expired ? .expired : service == nil ? .unpaired : offline ? .offline : .loading
  }
  var canApprove: Bool {
    phase == .ready && !busy && !loading && !offline && bundle != nil
      && reviewedDigest != nil && task?.state == "awaiting_review"
      && task?.draftId == reviewedDigest
  }
  var files: [ReadFile] {
    (bundle?.files ?? []).map {
      ReadFile(path: $0.path, role: $0.role, bytes: $0.bytes, sha256: $0.sha256)
    }
  }
  var selected: ReadFile? { files.first { $0.path == selectedPath } }
  var selectedData: Data? { data(selectedPath) }
  func data(_ path: String) -> Data? {
    bundle?.files.first { $0.path == path }.flatMap { Data(base64Encoded: $0.body) }
  }
  static func category(_ file: ReadFile) -> Int {
    switch file.role {
    case "summary", "analysis": return 0
    case "source", "original", "source_snapshot": return 1
    case "transcript", "transcript_raw": return 2
    case "scenario": return 3
    default: return 4
    }
  }
  func files(in index: Int) -> [ReadFile] {
    index == 4 ? files : files.filter { Self.category($0) == index }
  }
  func chooseCategory(_ index: Int) {
    category = index
    selectedPath = index == 4 ? "" : files(in: index).first?.path ?? ""
  }
  func chooseFile(_ file: ReadFile) {
    guard files.contains(file) else { return }
    selectedPath = file.path
    category = Self.category(file)
    filesPanel = false
  }
  func localFile(_ source: String) -> ReadFile? {
    guard let components = URLComponents(string: source), components.scheme == nil,
      components.host == nil, !source.hasPrefix("/"), !source.contains("\\"),
      let path = components.path.removingPercentEncoding, !path.contains("\0")
    else { return nil }
    let directory = (selectedPath as NSString).deletingLastPathComponent
    let resolved = String(
      URL(fileURLWithPath: "/" + (directory.isEmpty ? "" : directory + "/") + path)
        .standardizedFileURL.path.dropFirst())
    return files.first { $0.path == resolved }
  }
  var coverage: String {
    let status = bundle?.meta.status ?? ""
    return ["archived": "已归档", "partial": "待补齐", "pending": "待处理"][status] ?? status
  }
  func setOffline(_ value: Bool) {
    offline = value
    guard service != nil, phase != .expired, phase != .archived else { return }
    if value {
      phase = .offline
      confirmation = false
    } else if phase == .offline {
      phase = bundle == nil ? .failure : .changed
      // Recheck current task and digest before enabling any mutation after reconnection.
      Task { await checkVersion() }
    }
  }
  private func current(_ state: ServerState, id: String) throws -> LibraryTask? {
    guard state.me.role == "owner", state.me.revokedAt == nil else {
      throw CollectorError.http(403)
    }
    return state.tasks.first { $0.id == id }
  }
  func load(_ id: String) async {
    // A replaced navigation destination starts a new request even if its cancelled
    // predecessor has not finished unwinding. Only the latest request can publish.
    guard let service, !busy, !offline, phase != .expired else { return }
    let session = sessionKey
    let token = UUID()
    request = token
    taskID = id
    loading = true
    confirmation = false
    notice = nil
    phase = .loading
    bundle = nil
    reviewedDigest = nil
    defer { if session == sessionKey && request == token { loading = false } }
    do {
      let snapshot = try await service.state()
      guard session == sessionKey, request == token, !Task.isCancelled else { return }
      guard let item = try current(snapshot, id: id), item.state == "awaiting_review",
        let digest = item.draftId, ReadFile.validDigest(digest)
      else {
        task = try current(snapshot, id: id)
        phase = .terminal
        return
      }
      task = item
      let result = try await service.draft(id, expectedDigest: digest)
      try AttachmentIntegrity.validate(result)
      for file in result.files {
        try ReadFile(path: file.path, role: file.role, bytes: file.bytes, sha256: file.sha256)
          .validate()
      }
      let latest = try await service.state()
      guard session == sessionKey, request == token, !Task.isCancelled else { return }
      task = try current(latest, id: id)
      bundle = result
      reviewedDigest = digest
      selectedPath = files(in: 0).first?.path ?? files.first?.path ?? ""
      category = selected.map(Self.category) ?? 0
      phase =
        offline
        ? .offline
        : task?.state != "awaiting_review"
          ? .terminal
          : task?.draftId == digest ? .ready : .changed
    } catch {
      guard session == sessionKey, request == token, !Task.isCancelled else { return }
      handle(error)
    }
  }
  func reload() async { await load(taskID) }
  func checkVersion() async {
    guard let service, !taskID.isEmpty, !busy, !loading, !checking, !offline,
      phase != .expired, phase != .archived
    else { return }
    let session = sessionKey
    let token = request
    checking = true
    defer { if session == sessionKey { checking = false } }
    do {
      let snapshot = try await service.state()
      guard session == sessionKey, request == token, !Task.isCancelled else { return }
      task = try current(snapshot, id: taskID)
      if offline {
        phase = .offline
        confirmation = false
        return
      }
      if task?.state != "awaiting_review" {
        phase = .terminal
      } else if bundle != nil {
        phase = task?.draftId == reviewedDigest ? .ready : .changed
      }
      if !canApprove { confirmation = false }
    } catch {
      guard session == sessionKey, request == token, !Task.isCancelled else { return }
      handle(error)
    }
  }
  func requestApproval() { if canApprove { confirmation = true } }
  func approve() async {
    guard confirmation, canApprove, let service, let digest = reviewedDigest else { return }
    confirmation = false
    busy = true
    let session = sessionKey
    let token = UUID()
    request = token
    defer { if session == sessionKey { busy = false } }
    do {
      let snapshot = try await service.state()
      guard session == sessionKey, request == token, !Task.isCancelled else { return }
      task = try current(snapshot, id: taskID)
      guard !offline, task?.state == "awaiting_review", task?.draftId == digest else {
        phase = offline ? .offline : task?.state == "awaiting_review" ? .changed : .terminal
        return
      }
      try await service.approveDraft(taskID, expectedDigest: digest)
      guard session == sessionKey, request == token, !Task.isCancelled else { return }
      let latest = try await service.state()
      guard session == sessionKey, request == token, !Task.isCancelled else { return }
      task = try current(latest, id: taskID)
      if task?.state == "completed", task?.archiveId == digest {
        phase = .archived
      } else {
        phase = task?.state == "awaiting_review" ? .changed : .terminal
      }
    } catch {
      guard session == sessionKey, request == token, !Task.isCancelled else { return }
      handle(error)
    }
  }
  private func handle(_ error: Error) {
    confirmation = false
    if case CollectorError.http(let code) = error, code == 401 || code == 403 {
      configure(service: nil, expired: true)
    } else if case CollectorError.http(409) = error {
      phase = .changed
    } else if offline || (error as? URLError)?.code == .notConnectedToInternet {
      phase = .offline
    } else if error is ReaderFailure || error is DecodingError
      || (error as? CollectorError).map({
        if case .message(let value) = $0 { return value.contains("校验") || value.contains("完整性") }
        return false
      }) == true
    {
      bundle = nil
      reviewedDigest = nil
      phase = .integrity
      notice = safeMessage(error)
    } else if (error as? CollectorError).map({
      if case .message(let value) = $0 { return value.contains("草稿已变化") }
      return false
    }) == true {
      phase = .changed
    } else {
      phase = .failure
      notice = safeMessage(error)
    }
  }
}
