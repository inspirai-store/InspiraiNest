#if DEBUG
  import PDFKit
  import SwiftUI
  import UIKit

  @MainActor struct NativeDraftReview: View {
    let configuration: NativeReviewConfiguration
    @StateObject private var model: NativeDraftModel
    @StateObject private var tasks: NativeTaskModel
    @StateObject private var library = NativeLibraryModel()
    @State private var module: NativeAppModule = .tasks
    @State private var applied = false
    @State private var fixture: NativeDraftFixture
    private let entry: Bool
    init(configuration: NativeReviewConfiguration) {
      self.configuration = configuration
      let args = ProcessInfo.processInfo.arguments
      let fixture = NativeDraftFixture(page: configuration.page, arguments: args)
      _fixture = State(initialValue: fixture)
      entry = args.contains("--review-draft-entry")
      let draftModel = NativeDraftModel(service: fixture)
      if args.contains("--review-draft-unpaired") { draftModel.configure(service: nil) }
      if args.contains("--review-draft-expired") {
        draftModel.configure(service: nil, expired: true)
      }
      _model = StateObject(wrappedValue: draftModel)
      let taskModel = NativeTaskModel(service: fixture)
      taskModel.selectedID = NativeTaskFixture.id(2)
      _tasks = StateObject(wrappedValue: taskModel)
    }
    var body: some View {
      GeometryReader { geo in
        let tablet = UIDevice.current.userInterfaceIdiom == .pad && geo.size.width >= 760
        Group {
          if tablet || entry {
            NativeTaskView(
              model: tasks, module: $module, library: library,
              directDraftID: tablet && !entry ? NativeTaskFixture.id(2) : nil
            ) { id in
              NativeDraftView(model: model, taskID: id, tablet: tablet)
            }
          } else {
            NativeDraftView(model: model, taskID: NativeTaskFixture.id(2), tablet: false)
          }
        }.overlay { NativeDraftConfirmation(model: model) }
          .task { if tablet || entry { await tasks.reload() } }
          .onChange(of: model.loading) { loading in
            if !loading, model.bundle != nil, !applied, !entry {
              applied = true
              Task {
                if configuration.page == "P25" {
                  await fixture.changeVersion()
                  await model.checkVersion()
                }
                if configuration.page == "P26" { model.requestApproval() }
                if ProcessInfo.processInfo.arguments.contains("--review-draft-offline") {
                  model.setOffline(true)
                }
              }
            }
          }
      }
    }
  }
  /// In-memory draft data only: real byte counts and hashes, no production dependencies.
  actor NativeDraftFixture: NativeDraftService, NativeTaskService {
    var items: [LibraryTask]
    var packet: Data
    var corrupted: Bool
    var failure: Bool
    let slow: Bool
    let changeOnApprove: Bool
    var generation = 0
    init(page: String, arguments: [String] = []) {
      packet = Self.makePacket(long: arguments.contains("--review-long-draft"))
      if arguments.contains("--review-draft-no-transcript") {
        var json = try! JSONSerialization.jsonObject(with: packet) as! [String: Any]
        json["files"] = (json["files"] as! [[String: Any]]).filter {
          $0["role"] as? String != "transcript"
        }
        packet = try! JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
      }
      items = Self.tasks(digest: ReadFile.digest(packet))
      corrupted = page == "S13"
      failure = arguments.contains("--review-draft-error")
      slow = arguments.contains("--review-draft-loading")
      changeOnApprove = arguments.contains("--review-draft-change-on-approve")
    }
    static func tasks(digest: String, state: String = "awaiting_review", archive: String? = nil)
      -> [LibraryTask]
    {
      let titles = ["SwiftUI 原生界面实践", "Markdown 资料整理", "SwiftUI 原生界面实践", "长文阅读与信息结构", "资料来源与核验"]
      return titles.enumerated().map { i, title in
        LibraryTask(
          id: NativeTaskFixture.id(i), submissionId: NativeTaskFixture.id(i),
          content: title, url: "https://example.com/swiftui",
          state: i == 2
            ? state : ["running", "waiting_action", "awaiting_review", "failed", "completed"][i],
          events: [.init(at: "2026-10-09T14:30:00+08:00", state: "queued", message: "已创建")],
          deviceId: NativeTaskFixture.id(8), archiveId: i == 2 ? archive : nil,
          draftId: i == 2 ? digest : nil, createdAt: "2026-10-09T14:30:00+08:00")
      }
    }
    static func makePacket(long: Bool = false, version: Int = 0) -> Data {
      var report = NativeReaderFixtureService.markdown
      if long {
        report += String(
          repeating: "\n\n## 草稿正文与来源核对\n\n" + String(repeating: "保留完整业务内容，检查来源事实与附件定位。", count: 5),
          count: 14)
      }
      if version > 0 { report += "\n\n## 补充核验\n\n新版本保留完整来源。" }
      let pdf = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 360, height: 480)).pdfData {
        context in
        for n in 1...2 {
          context.beginPage()
          ("草稿附件 · 第 \(n) 页" as NSString).draw(
            at: CGPoint(x: 24, y: 24), withAttributes: [.font: UIFont.systemFont(ofSize: 20)])
        }
      }
      let png = UIGraphicsImageRenderer(size: CGSize(width: 320, height: 200)).image { context in
        UIColor.systemOrange.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 320, height: 200))
        ("原生界面结构" as NSString).draw(
          at: CGPoint(x: 30, y: 70),
          withAttributes: [.font: UIFont.systemFont(ofSize: 24), .foregroundColor: UIColor.black])
      }.pngData()!
      let values: [(String, String, Data)] = [
        ("summary.md", "summary", Data(report.utf8)),
        (
          "source/article.md", "source",
          Data(
            "## 来源正文\n\n完整原文保留在草稿包。\n\n[附件](../architecture.pdf)\n\n<script>source text remains inert</script>"
              .utf8)
        ),
        ("transcript/subtitles.srt", "transcript", Data(NativeReaderFixtureService.subtitles.utf8)),
        ("analysis.md", "scenario", Data("## 场景分析\n\n提炼导航与阅读的设计要点，保留代码片段。".utf8)),
        ("architecture.pdf", "document", pdf), ("layout.png", "image", png),
      ]
      return try! JSONSerialization.data(
        withJSONObject: [
          "meta": [
            "title": "SwiftUI 原生界面实践", "summary": "原生导航与阅读", "coverage_note": "正文已保存，媒体未上传",
            "status": "partial",
          ],
          "files": values.map {
            [
              "path": $0.0, "role": $0.1, "body": $0.2.base64EncodedString(), "bytes": $0.2.count,
              "sha256": ReadFile.digest($0.2),
            ] as [String: Any]
          },
          "omitted": ["recording.mp4"],
        ], options: [.sortedKeys])
    }
    func state() async throws -> ServerState {
      if slow { try await Task.sleep(nanoseconds: 10_000_000_000) }
      return ServerState(me: NativeTaskFixture.owner, devices: [], tasks: items, archives: [])
    }
    func draft(_ id: String, expectedDigest: String) async throws -> DraftBundle {
      if failure {
        failure = false
        throw CollectorError.http(503)
      }
      guard expectedDigest == ReadFile.digest(packet) else { throw CollectorError.http(409) }
      if corrupted {
        corrupted = false
        var json = try! JSONSerialization.jsonObject(with: packet) as! [String: Any]
        var files = json["files"] as! [[String: Any]]
        files[0]["body"] = Data("损坏附件".utf8).base64EncodedString()
        json["files"] = files
        return try JSONDecoder().decode(
          DraftBundle.self, from: JSONSerialization.data(withJSONObject: json))
      }
      return try JSONDecoder().decode(DraftBundle.self, from: packet)
    }
    func changeVersion() {
      generation += 1
      packet = Self.makePacket(version: generation)
      items = Self.tasks(digest: ReadFile.digest(packet))
    }
    func approveDraft(_ id: String, expectedDigest: String) async throws {
      if changeOnApprove { changeVersion() }
      guard expectedDigest == ReadFile.digest(packet) else { throw CollectorError.http(409) }
      items = Self.tasks(digest: expectedDigest, state: "completed", archive: expectedDigest)
    }
    func taskAction(_ id: String, action: String) async throws {}
  }
#endif
