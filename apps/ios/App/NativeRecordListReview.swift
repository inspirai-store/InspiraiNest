#if DEBUG
  import SwiftUI
  import UIKit

  @MainActor
  struct NativeRecordListReview: View {
    let configuration: NativeReviewConfiguration
    @StateObject private var records: NativeRecordListModel
    @StateObject private var library = NativeLibraryModel(
      service: NativeLibraryFixtureService(page: "P01"))
    @StateObject private var reader = NativeReaderModel(
      service: NativeReaderFixtureService(page: "P06", width: 634, detailHeight: 834))
    @StateObject private var tasks = NativeTaskModel(service: NativeTaskFixture(page: "P21"))
    @StateObject private var devices = NativeDevicesModel(
      service: NativeDevicesFixture(
        tablet: UIDevice.current.userInterfaceIdiom == .pad, empty: false, flags: []),
      origin: "https://library.inspirai.store")
    @StateObject private var outbox = NativeOutboxModel(
      dependencies: NativeOutboxFixture().dependencies)
    @State private var module: NativeAppModule
    @State private var reading = false
    @State private var libraryPath: [ReadEntry] = []
    init(configuration: NativeReviewConfiguration) {
      self.configuration = configuration
      _module = State(initialValue: configuration.page == "A01" ? .account : .records)
      var snapshot = NativeRecordListSnapshot(
        records: Self.examples,
        draft: .init(id: "record-draft", title: "阅读摘记", modifiedAt: "2026-10-16T10:36:00+08:00"))
      let phase: NativeRecordListPhase
      switch configuration.page {
      case "N01-L":
        phase = .loading
        snapshot = .init()
      case "N01-E":
        phase = .content
        snapshot = .init()
      case "N01-F":
        phase = .failure
        snapshot = .init()
      case "N01-O": phase = .offline
      case "N01-U": phase = .unpaired
      case "N01-A": phase = .expired
      default: phase = .content
      }
      if configuration.page == "A01" {
        snapshot.records[0].sync = .failed
        snapshot.records[2].sync = .pending
      }
      if ProcessInfo.processInfo.arguments.contains("--review-long-records") {
        snapshot.records[0].text =
          "长标题与动态字号：记录正文、原始附件、跨设备同步以及中文与 English 排版验证\n"
          + String(repeating: "保留记录正文和所有业务状态。", count: 12)
        snapshot.records[0].summary = nil
      }
      let model = NativeRecordListModel(
        snapshot: snapshot, phase: phase,
        service: configuration.page == "N01-F"
          ? NativeRecordReviewService(records: Self.examples) : nil,
        origin: "https://library.inspirai.store",
        now: { NativeRecordListModel.date("2026-10-16T12:00:00+08:00")! })
      if configuration.page == "N01-Q" { model.query = "杭州出差" }
      if ["N01-O", "N01-U", "N01-A"].contains(configuration.page) { model.selectedID = "record-2" }
      _records = StateObject(wrappedValue: model)
    }
    var body: some View {
      Group {
        switch module {
        case .records:
          NativeRecordListView(
            model: records, module: $module, pair: { module = .account },
            illustration: { $0.mime == "image/jpeg" ? AnyView(NativeRecordRouteFixture()) : nil },
            autoReload: false)
        case .account:
          NativeAccountView(
            module: $module, records: records, origin: "https://library.inspirai.store",
            paired: true, outboxPending: 2, deviceCount: 3, pair: { module = .devices })
        case .library:
          NativeLibraryView(
            model: library, module: $module, reading: $reading, path: $libraryPath,
            reader: { entry in
              NativeReaderView(
                model: reader, entryID: entry.id,
                tablet: UIDevice.current.userInterfaceIdiom == .pad, favorite: false,
                toggleFavorite: {})
            }, pair: { module = .account })
        case .tasks:
          NativeTaskView(model: tasks, module: $module, library: library) { _ in
            NativeDraftReview(configuration: configuration)
          }
        case .outbox:
          NativeOutboxView(model: outbox, module: $module, library: library)
        case .devices:
          NativeDevicesView(model: devices, module: $module, library: library)
        }
      }.onAppear { outbox.reload() }
    }
    static let examples: [NativeRecord] = [
      .init(
        id: "record-1",
        text:
          "周末徒步路线\n周六上午从湖边出发，沿步道走到观景台，中午在返程路上吃饭。\n行程安排\n09:00  湖边集合\n11:30  步道出口午餐\n14:00  返回市区",
        attachments: [
          .init(
            id: "route", name: "路线草图.jpg", mime: "image/jpeg", bytes: 1_200_000,
            sha256: String(repeating: "a", count: 64))
        ],
        version: 2, createdAt: "2026-10-16T10:24:00+08:00", summary: "湖边步道、午餐与返程安排。"),
      .init(
        id: "record-2", text: "灵感随记\n碎片想法先记下，再整理成行动。\n入口调整、媒体导入和跨端同步。",
        createdAt: "2026-10-16T09:18:00+08:00", sync: .pending, summary: "碎片想法先记下，再整理成行动。"),
      .init(
        id: "record-3", text: "产品讨论纪要\n记录采集方式与移动端操作调整。",
        attachments: [
          .init(
            id: "audio", name: "产品讨论-10月16日.m4a", mime: "audio/mp4", bytes: 2_100_000,
            sha256: String(repeating: "b", count: 64))
        ],
        version: 3, createdAt: "2026-10-15T18:40:00+08:00",
        tasks: [.init(id: "task-3", state: "awaiting_review", recordVersion: 3)]),
      .init(
        id: "record-4", text: "阅读摘记\n留下关键观点与自己的理解。", createdAt: "2026-10-15T16:12:00+08:00",
        tasks: [.init(id: "task-4", state: "completed", recordVersion: 1)]),
    ]
  }
  actor NativeRecordReviewService: NativeRecordListService {
    let records: [NativeRecord]
    init(records: [NativeRecord]) { self.records = records }
    func listRecords() async throws -> [NativeRecord] { records }
  }
  // Fixed example attachment, drawn natively. This is not a screen/image of UI.
  struct NativeRecordRouteFixture: View {
    var labelAlignment:Alignment = .center
    @Environment(\.colorScheme) private var scheme
    var body: some View {
      GeometryReader { geometry in
        let w = geometry.size.width
        let h = geometry.size.height
        let dark = scheme == .dark
        let p = NativePalette(dark: dark)
        ZStack(alignment: .topLeading) {
          Color(hex: dark ? 0x37382E : 0xE7E1D4)
          RoundedRectangle(cornerRadius: min(52, h / 2 - 12), style: .continuous).fill(
            Color(hex: dark ? 0x3D5752 : 0xC9D8D3)
          )
          .frame(width: w * 0.37, height: h - 20).offset(x: w * 0.32, y: 10)
          let points = [
            CGPoint(x: w * 0.12, y: h * 0.65), .init(x: w * 0.28, y: h * 0.35),
            .init(x: w * 0.43, y: h * 0.23), .init(x: w * 0.68, y: h * 0.36),
            .init(x: w * 0.84, y: h * 0.63),
          ]
          Path { $0.addLines(points) }.stroke(
            p.paper, style: .init(lineWidth: 6, lineCap: .round, lineJoin: .round))
          Path { $0.addLines(points) }.stroke(
            p.accent, style: .init(lineWidth: 2, lineCap: .round, lineJoin: .round))
          ForEach([0, 4], id: \.self) { i in
            Circle().fill(p.surface).frame(width: 10, height: 10).position(points[i])
            Circle().fill(p.accent).frame(width: 4, height: 4).position(points[i])
          }
          RecordText("出发", 11).frame(width: 60,alignment:labelAlignment).offset(x: 10, y: h - 29)
          RecordText("湖边步道", 12).frame(width: w * 0.4,alignment:labelAlignment).offset(x: w * 0.36, y: h * 0.58)
        }.foregroundStyle(p.label)
      }
    }
  }
#endif
