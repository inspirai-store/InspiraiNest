#if DEBUG
  import SwiftUI

  struct NativeOutboxReview: View {
    let configuration: NativeReviewConfiguration
    @StateObject private var model: NativeOutboxModel
    @StateObject private var library = NativeLibraryModel()
    @State private var module: NativeAppModule = .outbox
    init(configuration: NativeReviewConfiguration) {
      self.configuration = configuration
      let fixture = NativeOutboxFixture(
        page: configuration.page,
        long: ProcessInfo.processInfo.arguments.contains("--review-long-outbox"))
      let model = NativeOutboxModel(dependencies: fixture.dependencies)
      model.reload()
      model.setOffline(configuration.page == "S05")
      if ["P19", "P20", "S10"].contains(configuration.page) { model.path = [fixture.items[0].id] }
      if configuration.page == "P20" { model.requestBinding(fixture.items[0].id) }
      _model = StateObject(wrappedValue: model)
    }
    var body: some View {
      NativeOutboxView(model: model, module: $module, library: library)
    }
  }
  @MainActor
  final class NativeOutboxFixture {
    var items: [OutboxItem]
    var capturedCopy = ""
    let credential = DeviceCredential(
      origin: "https://library.inspirai.store", deviceID: "review-owner", name: "审核设备",
      token: "review")
    init(page: String = "P18", long: Bool = false) {
      let titles = ["SwiftUI 原生界面实践", "Markdown 资料整理", "长文阅读与信息结构", "资料来源与核验"]
      let date = ISO8601DateFormatter().date(from: "2026-10-09T14:30:00+08:00")!
      items =
        page == "S17"
        ? []
        : titles.enumerated().map { index, title in
          let id = UUID(uuidString: "00000000-0000-0000-0000-00000000000\(index+1)")!
          var parts = [
            SharedPart(
              item: 0, attachment: 0, kind: "text", representation: "public.plain-text",
              value: title),
            SharedPart(
              item: 0, attachment: 1, kind: "url", representation: "public.url",
              value: "https://example.com/swiftui"),
          ]
          if long && index == 0 {
            parts.append(
              .init(
                item: 1, attachment: 0, kind: "text", representation: "public.plain-text",
                value: String(repeating: "完整原文保留空格、换行和来源定位。\n", count: 30)))
          }
          let submission = Submission(
            id: id, parts: parts, requirements: "提炼导航与阅读的设计要点，保留代码片段。", autoArchive: false,
            tags: ["SwiftUI", "阅读"], deviceId: nil, agent: "codex")
          let share = SavedShare(
            submission: submission, originalParts: parts,
            additionalRequirements: "提炼导航与阅读的设计要点，保留代码片段。", createdAt: date)
          return OutboxItem(
            id: submission.submissionId, share: share,
            origin: index == 0 && page == "P20"
              ? nil
              : index == 0 && page == "S10"
                ? "https://archive.example.com" : "https://library.inspirai.store",
            state: index == 2 ? "submitted" : index == 3 ? "blocked" : "queued", attempts: index,
            taskID: index == 2 ? "review-task" : nil, message: nil,
            leaseUntil: index == 1 && page != "S05" ? Date().timeIntervalSince1970 + 3600 : nil)
        }
    }
    var dependencies: NativeOutboxDependencies {
      .init(
        list: { self.items }, credential: { self.credential },
        bind: { id, origin in
          self.items = self.items.map { item in
            guard item.id == id && item.origin == nil else { return item }
            return self.updated(item, origin: origin)
          }
        },
        send: { id, _ in
          self.items = self.items.map {
            $0.id == id ? self.updated($0, state: "submitted", taskID: "review-task") : $0
          }
        }, copy: { self.capturedCopy = $0 }, remove: { id in self.items.removeAll { $0.id == id } })
    }
    private func updated(
      _ item: OutboxItem, origin: String? = nil, state: String? = nil, taskID: String? = nil
    ) -> OutboxItem {
      .init(
        id: item.id, share: item.share, origin: origin ?? item.origin, state: state ?? item.state,
        attempts: item.attempts, taskID: taskID ?? item.taskID, message: item.message,
        leaseUntil: item.leaseUntil)
    }
  }
#endif
