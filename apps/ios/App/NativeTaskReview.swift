#if DEBUG
  import SwiftUI

  struct NativeTaskReview: View {
    let configuration: NativeReviewConfiguration
    @StateObject private var model: NativeTaskModel
    @StateObject private var library = NativeLibraryModel()
    @State private var module: NativeAppModule = .tasks
    init(configuration: NativeReviewConfiguration) {
      self.configuration = configuration
      let args = ProcessInfo.processInfo.arguments
      let fixture = NativeTaskFixture(
        page: configuration.page, long: args.contains("--review-long-tasks"),
        fail: args.contains("--review-task-error"), slow: args.contains("--review-task-loading"),
        longTitle: args.contains("--review-long-task-title"))
      let model = NativeTaskModel(service: fixture)
      if ["P22", "P23", "S09"].contains(configuration.page) {
        let id = configuration.page == "S09" ? NativeTaskFixture.id(3) : NativeTaskFixture.id(0)
        model.selectedID = id
        model.path = [id]
        if configuration.page == "P23" { model.cancellationID = id }
      }
      if args.contains("--review-task-unpaired") { model.configure(service: nil) }
      if args.contains("--review-task-expired") { model.configure(service: nil, expired: true) }
      _model = StateObject(wrappedValue: model)
    }
    var body: some View {
      NativeTaskView(model: model, module: $module, library: library) { _ in
        // Existing draft destination remains a separate, not-yet-redesigned module.
        Text("草稿审核").font(.title).accessibilityIdentifier("tasks.existing.draft")
      }.task {
        if ProcessInfo.processInfo.arguments.contains("--review-task-offline") {
          await model.reload()
          model.setOffline(true)
        }
      }
    }
  }
  actor NativeTaskFixture: NativeTaskService {
    var tasks: [LibraryTask]
    var failure: Bool
    let slow: Bool
    static func id(_ index: Int) -> String {
      String(format: "00000000-0000-0000-0000-%012d", index + 1)
    }
    static let owner = Device(
      id: id(9), name: "审核设备", role: "owner", revokedAt: nil, online: nil, agents: nil)
    init(
      page: String, long: Bool = false, fail: Bool = false, slow: Bool = false,
      longTitle: Bool = false
    ) {
      failure = fail
      self.slow = slow
      let titles = ["SwiftUI 原生界面实践", "Markdown 资料整理", "SwiftUI 原生界面实践", "长文阅读与信息结构", "资料来源与核验"]
      let states = ["running", "waiting_action", "awaiting_review", "failed", "completed"]
      tasks =
        page == "S16"
        ? []
        : titles.enumerated().map { index, title in
          var events = [
            TaskEvent(at: "2026-10-09T14:30:00+08:00", state: "queued", message: "已创建"),
            TaskEvent(at: "2026-10-09T14:30:00+08:00", state: "assigned", message: "已分配 · 我的 Mac"),
            TaskEvent(
              at: "2026-10-09T14:31:00+08:00", state: index == 3 ? "failed" : "running",
              message: index == 3 ? "来源读取失败" : "来源读取完成"),
          ]
          if index != 3 {
            events.append(
              .init(at: "2026-10-09T14:32:00+08:00", state: "running", message: "正在整理正文"))
          }
          if long && index == 0 {
            events += (0..<20).map {
              .init(
                at: "2026-10-09T14:32:00+08:00", state: "running",
                message: "核对来源正文、附件路径与段落定位 \($0 + 1)")
            }
          }
          return LibraryTask(
            id: Self.id(index), submissionId: Self.id(index),
            content: longTitle && index == 0
              ? String(repeating: "SwiftUI 原生界面实践与来源内容核对 ", count: 10) : title, url: nil,
            state: states[index], events: events, deviceId: Self.id(7), archiveId: nil,
            draftId: index == 2 ? String(repeating: "a", count: 64) : nil,
            createdAt: "2026-10-09T14:30:00+08:00")
        }
    }
    func state() async throws -> ServerState {
      if slow { try await Task.sleep(nanoseconds: 30_000_000_000) }
      if failure {
        failure = false
        throw CollectorError.http(503)
      }
      return ServerState(me: Self.owner, devices: [], tasks: tasks, archives: [])
    }
    func taskAction(_ id: String, action: String) async throws {
      tasks = tasks.map { task in
        guard task.id == id else { return task }
        let state = action == "cancel" ? "cancelled" : "assigned"
        return LibraryTask(
          id: task.id, submissionId: task.submissionId, content: task.content, url: task.url,
          state: state,
          events: (task.events ?? []) + [
            .init(
              at: "2026-10-09T14:33:00+08:00", state: state,
              message: action == "cancel" ? "用户取消" : "等待原电脑继续")
          ],
          deviceId: task.deviceId, archiveId: task.archiveId, draftId: task.draftId,
          createdAt: task.createdAt)
      }
    }
  }
#endif
