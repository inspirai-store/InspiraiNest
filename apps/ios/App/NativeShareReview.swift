#if DEBUG
  import SwiftUI
  import UIKit

  @MainActor
  struct NativeShareReview: View {
    let configuration: NativeReviewConfiguration
    @StateObject private var model: ShareModel
    @State private var started = false
    init(configuration: NativeReviewConfiguration) {
      self.configuration = configuration
      let fixture = NativeShareFixture(page: configuration.page)
      let model = ShareModel(dependencies: fixture.dependencies)
      model.requirements = "提炼导航与阅读的设计要点，保留代码片段。"
      model.tags = "SwiftUI,阅读"
      model.autoArchive = false
      _model = StateObject(wrappedValue: model)
    }
    var body: some View {
      Group {
        if ProcessInfo.processInfo.arguments.contains("--review-system-share") {
          NativeSystemShareReview()
        } else {
          NativeShareView(model: model, sourceContext: true, start: false)
        }
      }
      .task {
        guard !started, !ProcessInfo.processInfo.arguments.contains("--review-system-share") else {
          return
        }
        started = true
        await model.capture()
        await model.loadDevices()
        if configuration.page == "P15" { model.advanced = true }
        if ["P16", "P17"].contains(configuration.page) { await model.save() }
      }
    }
  }

  /// Exercises the real extension in a separate review bundle and App Group.
  @MainActor
  private struct NativeSystemShareReview: View {
    @State private var sharing = false
    var body: some View {
      Button("分享原文") { sharing = true }.accessibilityIdentifier("review.systemShare")
        .sheet(isPresented: $sharing) { NativeSystemActivity() }
    }
  }
  private struct NativeSystemActivity: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIActivityViewController {
      UIActivityViewController(
        activityItems: ["SwiftUI 原生界面实践", URL(string: "https://example.com/swiftui")!],
        applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
  }

  /// Entirely in-memory. No live adapters, disk, Keychain or network are initialized.
  @MainActor
  final class NativeShareFixture {
    let page: String
    var reads = 0
    var records: [SavedShare] = []
    init(page: String) { self.page = page }
    static let devices = [
      Device(
        id: "mac", name: "我的 Mac", role: "worker", revokedAt: nil, online: true,
        agents: ["codex", "codebuddy"]),
      Device(
        id: "work", name: "工作电脑", role: "worker", revokedAt: nil, online: false, agents: ["codex"]),
    ]
    var dependencies: ShareDependencies {
      ShareDependencies(
        capture: { [self] in
          reads += 1
          if page == "S15" && reads == 1 { throw CollectorError.message("原文读取失败") }
          let long = ProcessInfo.processInfo.arguments.contains("--review-long-share")
          return ShareCaptureResult(
            parts: [
              SharedPart(
                item: 0, attachment: nil, kind: "title", representation: nil,
                value: "SwiftUI 原生界面实践"),
              SharedPart(
                item: 0, attachment: nil, kind: "url", representation: nil,
                value: "https://example.com/swiftui"),
            ]
              + (long
                ? [
                  SharedPart(
                    item: 0, attachment: nil, kind: "text", representation: nil,
                    value: String(repeating: "原始正文保留段落、空格和来源定位。\n", count: 30))
                ] : []),
            omittedAttachments: page == "S11" ? 1 : 0)
        },
        credential: { [self] in
          page == "P16"
            ? nil
            : DeviceCredential(
              origin: "https://library.inspirai.store",
              deviceID: "00000000-0000-0000-0000-000000000001", name: "审核设备",
              token: "review-fixture")
        }, cachedDevices: { _ in Self.devices }, refreshDevices: { _ in Self.devices },
        persist: { [self] share, _ in records.append(share) }, send: { _, _ in true }, complete: {},
        cancel: {}, openMainApp: { _ in true })
    }
  }
#endif
