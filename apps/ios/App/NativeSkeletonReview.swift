#if DEBUG
  import SwiftUI
  import UIKit

  /// Stage-one review entry. No service, credential store or persistence dependencies.
  struct NativeReviewConfiguration {
    let page: String
    let appearance: ColorScheme?
    let largeType: Bool
    let narrow: Bool
    let components: Bool
    let library: Bool
    let reader: Bool
    let share: Bool
    let outbox: Bool
    let tasks: Bool
    let drafts: Bool
    let pairing: Bool
    let devices: Bool
    let composition: Bool
    let outboxRemoval: Bool
    let records: Bool
    let recordEditor: Bool

    static var current: Self? {
      let arguments = ProcessInfo.processInfo.arguments
      guard arguments.contains("--native-review") else { return nil }
      func value(_ flag: String) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1)
        else { return nil }
        return arguments[index + 1]
      }
      let appearance: ColorScheme?
      switch value("--review-theme") {
      case "light": appearance = .light
      case "dark": appearance = .dark
      default: appearance = nil
      }
      return Self(
        page: value("--review-page") ?? "P01", appearance: appearance,
        largeType: arguments.contains("--review-large-type"),
        narrow: arguments.contains("--review-narrow"),
        components: arguments.contains("--review-components"),
        library: arguments.contains("--review-library"),
        reader: arguments.contains("--review-reader"),
        share: arguments.contains("--review-share"),
        outbox: arguments.contains("--review-outbox"), tasks: arguments.contains("--review-tasks"),
        drafts: arguments.contains("--review-drafts"), pairing: arguments.contains("--review-pairing"),
        devices: arguments.contains("--review-devices"),
        composition: arguments.contains("--review-compose"),
        outboxRemoval: arguments.contains("--review-outbox-removal"),
        records: arguments.contains("--review-records"),recordEditor:arguments.contains("--review-record-editor"))
    }
  }

  enum NativeReviewModule: String, CaseIterable, Identifiable {
    case library, tasks, outbox, devices
    var id: String { rawValue }
    var title: String {
      switch self {
      case .library: return "资料库"
      case .tasks: return "任务"
      case .outbox: return "发件箱"
      case .devices: return "设备"
      }
    }
    var symbol: String {
      switch self {
      case .library: return "book"
      case .tasks: return "checklist"
      case .outbox: return "tray"
      case .devices: return "iphone"
      }
    }
    var actionSymbol: String {
      switch self {
      case .library: return "slider.horizontal.3"
      case .tasks, .outbox: return "arrow.clockwise"
      case .devices: return "qrcode.viewfinder"
      }
    }
    var actionTitle: String {
      switch self {
      case .library: return "筛选与排序"
      case .tasks, .outbox: return "刷新"
      case .devices: return "连接资料库"
      }
    }
    static func forPage(_ page: String) -> Self {
      switch page {
      case "P18": return .outbox
      case "P21": return .tasks
      case "P31": return .devices
      default: return .library
      }
    }
  }

  struct NativeReviewRecord: Hashable, Identifiable {
    let id: String
    let title: String
    let module: NativeReviewModule
    var summary: String {
      ["导航、状态与长文阅读的原生界面实践。", "标题、列表、代码与来源的结构化整理。", "段落层级、来源定位与阅读路径。", "对照原文与附件，保留来源事实。"][
        fixtureIndex]
    }
    var sourceType: String { ["文档", "文章", "笔记", "网页"][fixtureIndex] }
    var archiveState: String { ["已归档", "已归档", "待补齐", "待处理"][fixtureIndex] }
    var date: String { fixtureIndex < 2 ? "2026-10-09" : "2026-10-08" }
    private var fixtureIndex: Int { min(3, Int(id.split(separator: "-").last ?? "0") ?? 0) }

    static func fixtures(for module: NativeReviewModule, tablet: Bool) -> [Self] {
      let titles: [String]
      switch module {
      case .library:
        titles = ["SwiftUI 原生界面实践", "Markdown 资料整理", "长文阅读与信息结构", "资料来源与核验"]
      case .tasks:
        titles = ["SwiftUI 原生界面实践", "Markdown 资料整理", "SwiftUI 原生界面实践", "长文阅读与信息结构", "资料来源与核验"]
      case .outbox:
        titles = ["SwiftUI 原生界面实践", "Markdown 资料整理", "长文阅读与信息结构", "资料来源与核验"]
      case .devices:
        titles = [
          tablet ? "我的 iPad" : "我的 iPhone", "我的 Mac", "工作电脑", tablet ? "我的 iPhone" : "我的 iPad",
        ]
      }
      return titles.enumerated().map {
        Self(id: "\(module.rawValue)-\($0.offset)", title: $0.element, module: module)
      }
    }
  }

  @MainActor
  private final class NativeReviewNavigation: ObservableObject {
    @Published var module: NativeReviewModule
    @Published var paths: [NativeReviewModule: [NativeReviewRecord]] = [:]
    @Published var selected: [NativeReviewModule: NativeReviewRecord] = [:]
    @Published var category = "全部资料"
    @Published var modal: String?

    init(page: String, tablet: Bool) {
      module = .forPage(page)
      for item in NativeReviewModule.allCases {
        let first = NativeReviewRecord.fixtures(for: item, tablet: tablet)[0]
        selected[item] = first
        paths[item] = page == "P06" && item == .library ? [first] : []
      }
    }

    func path(for module: NativeReviewModule) -> Binding<[NativeReviewRecord]> {
      Binding(get: { self.paths[module] ?? [] }, set: { self.paths[module] = $0 })
    }
    var currentSelection: NativeReviewRecord? {
      get { selected[module] }
      set { selected[module] = newValue }
    }
  }

  struct NativeSkeletonReview: View {
    let configuration: NativeReviewConfiguration
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
      GeometryReader { geometry in
        Group {
          if ProcessInfo.processInfo.arguments.contains("--review-record-process") {
            NativeRecordProcessingReview(configuration:configuration)
          } else if ProcessInfo.processInfo.arguments.contains("--review-record-sync") {
            NativeRecordSyncReview(configuration:configuration)
          } else if ProcessInfo.processInfo.arguments.contains("--review-record-media") {
            NativeRecordMediaReview(configuration:configuration)
          } else if configuration.recordEditor {
            NativeRecordEditorReview(configuration:configuration)
          } else if configuration.records {
            NativeRecordListReview(configuration: configuration)
          } else if configuration.outboxRemoval {
            NativeOutboxRemovalReview(configuration: configuration)
          } else if configuration.composition {
            NativeCompositionReview(configuration: configuration)
          } else if configuration.pairing {
            NativePairingReview(configuration: configuration)
          } else if configuration.drafts {
            NativeDraftReview(configuration: configuration)
          } else if configuration.devices {
            NativeDevicesReview(configuration: configuration)
          } else if configuration.tasks {
            NativeTaskReview(configuration: configuration)
          } else if configuration.outbox {
            NativeOutboxReview(configuration: configuration)
          } else if configuration.share {
            NativeShareReview(configuration: configuration)
          } else if configuration.reader {
            NativeReaderReview(configuration: configuration)
          } else if configuration.library {
            NativeLibraryReview(configuration: configuration)
          } else if configuration.components {
            NativeComponentReview(configuration: configuration)
          } else {
            NativeSkeletonShell(page: configuration.page)
          }
        }
        // A reproducible 600pt native layout harness; this is not a claim
        // that iPadOS multitasking has been exercised on a physical device.
        .frame(width: configuration.narrow ? min(600, geometry.size.width) : geometry.size.width)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .modifier(NativeReviewAppearance(configuration: configuration))
      .dynamicTypeSize(configuration.largeType ? .accessibility3 : .large)
      .statusBarHidden(UIDevice.current.userInterfaceIdiom == .pad)
      .overlay {
        if scenePhase != .active { Color(.systemBackground).ignoresSafeArea() }
      }
    }
  }

  private struct NativeReviewAppearance: ViewModifier {
    let configuration: NativeReviewConfiguration
    @ViewBuilder func body(content: Content) -> some View {
      if configuration.pairing { content }
      else { content.preferredColorScheme(configuration.appearance) }
    }
  }

  // NavigationSplitView owns the columns. Use public UIKit configuration to
  // remove the system floating primary-column background and pin both widths.
  private struct ReviewSplitConfiguration: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {
      controller.configure()
    }
    final class Controller: UIViewController {
      override func viewDidLoad() {
        super.viewDidLoad()
        view.isUserInteractionEnabled = false
      }
      override func didMove(toParent parent: UIViewController?) {
        super.didMove(toParent: parent)
        configure()
      }
      override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        configure()
      }
      func configure() {
        var ancestor = parent
        while let current = ancestor {
          if let split = current as? UISplitViewController {
            split.primaryBackgroundStyle = .none
            split.minimumPrimaryColumnWidth = 240
            split.maximumPrimaryColumnWidth = 240
            split.preferredPrimaryColumnWidth = 240
            split.minimumSupplementaryColumnWidth = 320
            split.maximumSupplementaryColumnWidth = 320
            split.preferredSupplementaryColumnWidth = 320
            break
          }
          ancestor = current.parent
        }
      }
    }
  }
  struct NativeSkeletonShell: View {
    @Environment(\.colorScheme) private var colorScheme
    @StateObject private var navigation: NativeReviewNavigation
    @State private var columns: NavigationSplitViewVisibility = .all
    @ScaledMetric(relativeTo: .body) private var rootSize: CGFloat = 34
    @ScaledMetric(relativeTo: .body) private var categoryPitch: CGFloat = 31
    private var typeScale: CGFloat { rootSize / 34 }
    private var toolbarHeight: CGFloat { 44 + max(0, rootSize - 34) * 0.7 }
    private func expanded(_ height: CGFloat, fontSize: CGFloat) -> CGFloat {
      height + max(0, rootSize - 34) * fontSize / 34 * 1.42
    }
    private let tablet = UIDevice.current.userInterfaceIdiom == .pad
    let components: Bool
    let reviewPage: String
    let componentFilterAction: (() -> Void)?
    @State private var search = ""
    @State private var segment = 0
    private var palette: NativePalette { .init(dark: colorScheme == .dark) }
    init(page: String, components: Bool = false, componentFilterAction: (() -> Void)? = nil) {
      self.componentFilterAction = componentFilterAction
      self.components = components
      reviewPage = page
      _segment = State(initialValue: page == "P21" ? 2 : 0)
      _navigation = StateObject(
        wrappedValue: NativeReviewNavigation(
          page: page, tablet: UIDevice.current.userInterfaceIdiom == .pad))
    }
    private func glyph(_ name: String, size: CGFloat = 24) -> some View {
      NativeGlyph(name: name, size: size)
    }
    private func moduleGlyph(_ module: NativeReviewModule) -> String {
      module == .library ? "book" : module.rawValue
    }
    private func actionGlyph(_ module: NativeReviewModule) -> String {
      module == .library ? "filter" : module == .devices ? "qr" : "refresh"
    }
    var body: some View {
      GeometryReader { geometry in
        Group { if tablet && geometry.size.width >= 760 { tabletShell } else { phoneShell } }
          .background(palette.paper.ignoresSafeArea()).foregroundStyle(palette.label).tint(
            palette.accent
          ).buttonStyle(.plain)
          .sheet(
            isPresented: Binding(
              get: { navigation.modal != nil }, set: { if !$0 { navigation.modal = nil } })
          ) { modalShell }
      }
    }
    private var phoneShell: some View {
      NavigationStack(path: navigation.path(for: navigation.module)) {
        rootShell(navigation.module, tablet: false).ignoresSafeArea(.container, edges: .top)
          .toolbar(.hidden, for: .navigationBar)
          .navigationDestination(for: NativeReviewRecord.self) { record in
            detailShell(record, tablet: false).ignoresSafeArea(.container, edges: .top).toolbar(
              .hidden, for: .navigationBar)
          }
      }.toolbar(.hidden, for: .navigationBar).id(navigation.module).ignoresSafeArea(
        .container, edges: .top
      )
      .safeAreaInset(edge: .bottom, spacing: 0) {
        if (navigation.paths[navigation.module] ?? []).isEmpty { bottomNavigation }
      }
    }
    private var tabletShell: some View {
      NavigationSplitView(columnVisibility: $columns) {
        sidebar.background(ReviewSplitConfiguration().frame(width: 0, height: 0))
          .navigationSplitViewColumnWidth(240).toolbar(.hidden, for: .navigationBar)
      } content: {
        rootShell(navigation.module, tablet: true).navigationSplitViewColumnWidth(320).toolbar(
          .hidden, for: .navigationBar)
      } detail: {
        if components && reviewPage.hasPrefix("S") {
          VStack(alignment: .leading, spacing: 0) {
            NativeText("资料库", size: 24, bold: true).padding(.leading, 24).padding(.top, 25)
            NativeContentState(
              kind: reviewPage == "S01" ? .loading : reviewPage == "S02" ? .empty : .failure,
              title: reviewPage == "S02" ? "暂无资料" : "资料暂时无法读取",
              actionTitle: reviewPage == "S02" ? "刷新" : "重试"
            ) {}
            .padding(.top, 145 - 25 - 24 * 1.42)
            Spacer(minLength: 0)
          }.frame(maxWidth: .infinity, alignment: .leading).background(palette.surface)
            .toolbar(.hidden, for: .navigationBar)
        } else if let record = navigation.currentSelection {
          detailShell(record, tablet: true).toolbar(.hidden, for: .navigationBar)
        }
      }.navigationSplitViewStyle(.balanced).ignoresSafeArea(.container, edges: [.top, .bottom])
    }
    private var sidebar: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          HStack(alignment: .top, spacing: 12) {
            glyph("book").foregroundStyle(palette.accent)
            NativeText("灵感小窝", size: 20, bold: true).padding(.top, 2)
          }
          .padding(.leading, 20).padding(.top, 23).frame(
            height: expanded(76, fontSize: 20), alignment: .topLeading)
          ForEach(NativeReviewModule.allCases) { module in
            Button {
              navigation.module = module
            } label: {
              HStack(alignment: .top, spacing: 14) {
                glyph(moduleGlyph(module))
                NativeText(module.title, size: 17, bold: navigation.module == module).padding(
                  .top, 1)
                Spacer(minLength: 0)
              }.padding(.leading, 14).padding(.top, 11).frame(
                height: expanded(44, fontSize: 17), alignment: .topLeading
              )
              .foregroundStyle(navigation.module == module ? palette.accent : palette.label)
              .background(
                navigation.module == module ? palette.selection : .clear,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
              )
              .contentShape(Rectangle())
            }.padding(.horizontal, 12).padding(.bottom, 4).accessibilityIdentifier(
              "review.tab.\(module.rawValue)")
          }
          if navigation.module == .library {
            NativeText("类型", size: 13).foregroundStyle(palette.secondary).padding(.leading, 26)
              .padding(.top, 24).frame(height: expanded(59, fontSize: 13), alignment: .topLeading)
            ForEach(["视频", "文章", "网页", "文档", "代码仓库", "音频", "图片", "笔记", "其他"], id: \.self) {
              category in
              Button {
                navigation.category = category
              } label: {
                NativeText(category, size: 16).padding(.leading, 42).frame(
                  maxWidth: .infinity, alignment: .leading
                )
                .frame(height: categoryPitch, alignment: .top).contentShape(Rectangle())
              }.foregroundStyle(navigation.category == category ? palette.accent : palette.label)
                .accessibilityIdentifier("review.category.\(category)")
            }
            Button {
              navigation.category = "我的收藏"
            } label: {
              HStack(alignment: .top, spacing: 18) {
                glyph("bookmark", size: 20).foregroundStyle(palette.accent)
                NativeText("我的收藏", size: 16).padding(.top, 3)
              }
              .padding(.leading, 26).padding(.top, 19).frame(
                maxWidth: .infinity, alignment: .leading
              ).frame(height: expanded(77, fontSize: 16), alignment: .top).contentShape(Rectangle())
            }
            NativeText("主题", size: 13).foregroundStyle(palette.secondary).padding(.leading, 26)
              .frame(height: expanded(31, fontSize: 13), alignment: .top)
            ForEach(["SwiftUI", "资料整理", "阅读"], id: \.self) { topic in
              Button {
                navigation.category = topic
              } label: {
                NativeText(topic, size: 15).padding(.leading, 42).frame(
                  maxWidth: .infinity, alignment: .leading
                ).frame(height: categoryPitch, alignment: .top).contentShape(Rectangle())
              }.foregroundStyle(palette.secondary)
            }
          }
        }.padding(.bottom, 24)
      }.background(palette.paper.ignoresSafeArea()).overlay(alignment: .trailing) {
        Rectangle().fill(palette.separator).frame(width: 1).allowsHitTesting(false)
      }
    }
    private func rootShell(_ module: NativeReviewModule, tablet: Bool) -> some View {
      VStack(spacing: 0) {
        GeometryReader { geometry in
          NativeText(module.title, size: tablet ? 24 : 34, bold: true).frame(
            width: geometry.size.width - 90, alignment: .leading
          )
          .padding(.leading, 20).padding(.top, tablet ? 24 : 72).accessibilityIdentifier(
            "review.root.\(module.rawValue)")
          Button {
            if components && module == .library, let action = componentFilterAction {
              action()
            } else if module == .library || module == .devices {
              navigation.modal = module.actionTitle
            } else {
              navigation.selected[module] =
                NativeReviewRecord.fixtures(for: module, tablet: self.tablet)[0]
            }
          } label: {
            glyph(actionGlyph(module)).frame(width: 44, height: 44).contentShape(Rectangle())
          }
          .foregroundStyle(palette.accent).position(
            x: geometry.size.width - (tablet ? 30 : 32), y: tablet ? 39 : 89
          )
          .accessibilityLabel(module.actionTitle).accessibilityIdentifier("review.rootAction")
          if !tablet && module == .library {
            Button {
              navigation.modal = module == .library ? "分类" : "导航"
            } label: {
              glyph("menu", size: 22).frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .foregroundStyle(palette.accent).position(x: 31, y: 58).accessibilityLabel("打开导航")
            .accessibilityIdentifier("review.menu")
          }
        }.frame(height: (tablet ? 70 : 126) + max(0, rootSize - 34) * 1.42)
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            if components && reviewPage.hasPrefix("S") {
              componentState(tablet: tablet)
            } else if module == .devices {
              deviceFixtures(tablet: tablet)
            } else {
              ForEach(NativeReviewRecord.fixtures(for: module, tablet: self.tablet)) {
                route($0, tablet: tablet)
              }
            }
          }.padding(
            .top, components && reviewPage.hasPrefix("S") ? 0 : listTopInset(module, tablet: tablet)
          )
          .overlay(alignment: .top) {
            if components { componentControls(module, tablet: tablet) }
          }
        }
      }.background(tablet ? palette.surface : palette.paper)
        .overlay(alignment: .trailing) {
          if tablet {
            Rectangle().fill(palette.separator).frame(width: 1).allowsHitTesting(false)
          }
        }
    }
    private func listTopInset(_ module: NativeReviewModule, tablet: Bool) -> CGFloat {
      switch module {
      case .library:
        if components {
          return max(
            tablet ? 102 : 103,
            max(38, 16 * 1.42 * typeScale + 14)
              + (tablet ? 12 : 16) + max(28, 13 * 1.42 * typeScale + 8) + 4 + 17)
        }
        return tablet ? 102 : 103
      case .tasks:
        return components
          ? max(tablet ? 55 : 51, max(28, 13 * 1.42 * typeScale + 8) + 4 + 19) : tablet ? 55 : 51
      case .outbox: return 12
      case .devices: return tablet ? 12 : 14
      }
    }
    private func rowHeight(_ module: NativeReviewModule, tablet: Bool) -> CGFloat {
      switch module {
      case .library: return tablet ? 126 : 115
      case .tasks: return 105
      case .outbox: return 114
      case .devices: return 84
      }
    }
    @ViewBuilder private func route(
      _ record: NativeReviewRecord, tablet: Bool, currentDevice: Bool = false
    ) -> some View {
      if tablet {
        Button {
          navigation.currentSelection = record
        } label: {
          fixtureRow(record, tablet: true, currentDevice: currentDevice)
        }.accessibilityIdentifier("review.record.\(record.id)")
      } else {
        NavigationLink(value: record) {
          fixtureRow(record, tablet: false, currentDevice: currentDevice)
        }.accessibilityIdentifier("review.record.\(record.id)")
      }
    }
    private func deviceFixtures(tablet: Bool) -> some View {
      let records = NativeReviewRecord.fixtures(for: .devices, tablet: self.tablet)
      return VStack(alignment: .leading, spacing: 0) {
        NativeText("当前设备", size: 14).foregroundStyle(palette.secondary).padding(.leading, 16).frame(
          height: 29, alignment: .top)
        route(records[0], tablet: tablet, currentDevice: true).frame(
          height: 95 + max(0, rootSize - 34) * 1.42, alignment: .top)
        NativeText("已授权设备", size: 14).foregroundStyle(palette.secondary).padding(.leading, 16)
          .frame(height: expanded(31, fontSize: 13), alignment: .top)
        ForEach(Array(records.dropFirst())) { route($0, tablet: tablet) }
      }
    }
    @ViewBuilder private func fixtureRow(
      _ record: NativeReviewRecord, tablet: Bool, currentDevice: Bool
    )
      -> some View
    {
      if record.module == .library {
        libraryFixture(record, tablet: tablet)
      } else if components && record.module == .tasks {
        let index = Int(record.id.split(separator: "-").last ?? "0") ?? 0
        NativeStatusRow(
          title: record.title, status: ["处理中", "待电脑操作", "待确认归档", "失败", "已完成"][index],
          date: "2026-10-09", tone: index == 3 ? .destructive : index < 3 ? .accent : .secondary,
          selected: tablet && navigation.currentSelection == record)
      } else {
        let height =
          (currentDevice ? CGFloat(78) : rowHeight(record.module, tablet: tablet))
          + max(0, rootSize - 34) * 1.42
        let textTop: CGFloat =
          record.module == .tasks ? 18 : record.module == .devices ? (currentDevice ? 13 : 15) : 17
        GeometryReader { geometry in
          let width = geometry.size.width
          if tablet && navigation.currentSelection == record {
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.selection).frame(
              width: width - 16, height: record.module == .devices ? height : height - 5
            ).padding(.leading, 8)
          }
          glyph(record.module == .library ? "file" : moduleGlyph(record.module))
            .foregroundStyle(
              record.module == .devices && !currentDevice ? palette.secondary : palette.accent
            )
            .padding(.leading, 16).padding(
              .top,
              record.module == .devices
                ? (currentDevice ? 14 : 15) : record.module == .outbox ? 17 : 18)
          NativeText(record.title, size: 17, bold: true).frame(
            width: width - (record.module == .library ? 91 : 80), alignment: .leading
          ).padding(.leading, 52).padding(.top, textTop)
          if record.module == .library {
            glyph("bookmark", size: 18).foregroundStyle(
              record.id.hasSuffix("-0") || record.id.hasSuffix("-2")
                ? palette.accent : palette.secondary
            ).padding(.leading, width - 30).padding(.top, 19)
          } else if record.module == .devices && !currentDevice {
            glyph("chevron", size: 18).foregroundStyle(palette.secondary).padding(
              .leading, width - 30
            ).padding(.top, 32)
          }
          if !currentDevice {
            Rectangle().fill(palette.separator).frame(width: width - 68, height: 1).padding(
              .leading, 52
            ).offset(y: height)
          }
        }.frame(height: height).contentShape(Rectangle())
      }
    }
    private func libraryFixture(_ record: NativeReviewRecord, tablet: Bool) -> some View {
      NativeMaterialRow(
        title: record.title, summary: record.summary, date: record.date,
        sourceType: record.sourceType, state: record.archiveState,
        favorite: record.id.hasSuffix("-0") || record.id.hasSuffix("-2"),
        selected: tablet && navigation.currentSelection == record,
        compactColumn: tablet, identifier: record.id)
    }
    @ViewBuilder private func componentControls(_ module: NativeReviewModule, tablet: Bool)
      -> some View
    {
      let margin: CGFloat = tablet ? 16 : 20
      VStack(spacing: tablet ? 12 : 16) {
        if module == .library {
          NativeSearchField(text: $search, placeholder: "搜索资料")
          if !reviewPage.hasPrefix("S") {
            NativeSegmentedControl(labels: ["全部", "已归档", "待补齐"], selection: $segment)
          }
        } else if module == .tasks {
          NativeSegmentedControl(labels: ["进行中", "待确认", "全部"], selection: $segment)
        }
      }.padding(.horizontal, margin).padding(.top, tablet ? 5 : 0)
    }
    private func componentState(tablet: Bool) -> some View {
      NativeContentState(
        kind: reviewPage == "S01" ? .loading : reviewPage == "S02" ? .empty : .failure,
        title: reviewPage == "S02" ? "暂无资料" : "资料暂时无法读取",
        actionTitle: reviewPage == "S02" ? "刷新" : "重试"
      ) {}
      .padding(
        .top, max(tablet ? 75 : 70, max(38, 16 * 1.42 * typeScale + 14) + (tablet ? 37 : 32)))
    }
    var libraryReviewDetail: some View {
      detailShell(NativeReviewRecord.fixtures(for: .library, tablet: true)[0], tablet: true)
    }
    private func detailShell(_ record: NativeReviewRecord, tablet: Bool) -> some View {
      VStack(spacing: 0) {
        GeometryReader { geometry in
          if !tablet {
            Button {
              var path = navigation.paths[record.module] ?? []
              if !path.isEmpty { path.removeLast() }
              navigation.paths[record.module] = path
            } label: {
              HStack(alignment: .top, spacing: 0) {
                glyph("back").padding(.top, (toolbarHeight - 24) / 2)
                NativeText(record.module.title, size: 16).fixedSize(
                  horizontal: true, vertical: true
                ).padding(.top, toolbarHeight / 2 - 9 * typeScale)
              }
              .padding(.leading, 14).frame(height: toolbarHeight, alignment: .top).contentShape(
                Rectangle())
            }.foregroundStyle(palette.accent).accessibilityIdentifier("review.back")
          } else {
            NativeText(
              record.module == .library
                ? record.title
                : record.module == .outbox ? "已保存的分享" : record.module == .tasks ? "任务详情" : "设备详情",
              size: 17, bold: true
            ).lineLimit(1).frame(width: max(0, geometry.size.width - 220)).position(
              x: geometry.size.width / 2, y: toolbarHeight / 2 + 3.07
            ).allowsHitTesting(false)
          }
          if record.module != .devices {
            HStack(spacing: 0) {
              Button {
                navigation.modal = "归档信息"
              } label: {
                glyph("more").frame(width: 38, height: toolbarHeight).contentShape(Rectangle())
              }.accessibilityLabel("更多").accessibilityIdentifier("review.more")
              if record.module == .library {
                glyph("bookmark").frame(width: 38, height: toolbarHeight)
                Button {
                  navigation.modal = "阅读大纲"
                } label: {
                  glyph("outline").frame(width: 38, height: toolbarHeight).contentShape(Rectangle())
                }.accessibilityLabel("大纲").accessibilityIdentifier("review.outline")
              }
            }.foregroundStyle(palette.accent).position(
              x: geometry.size.width - (record.module == .library ? 64 : 26), y: toolbarHeight / 2)
          }
          Rectangle().fill(palette.separator).frame(height: 1).offset(y: toolbarHeight - 0.5)
        }.frame(height: toolbarHeight).background(palette.paper)
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            if record.module == .devices {
              glyph("devices", size: 60).foregroundStyle(palette.accent).frame(maxWidth: .infinity)
                .padding(.top, 54)
              NativeText(record.title, size: 26, bold: true).fixedSize(
                horizontal: true, vertical: true
              )
              .frame(maxWidth: .infinity).padding(.top, 25).accessibilityIdentifier(
                "review.detail.title")
            } else {
              NativeText(
                record.title, size: record.module == .library ? 26 : 24, bold: true,
                lineHeight: record.module == .library ? 34 : nil
              )
              .padding(.horizontal, 24).padding(
                .top, record.module == .library ? 65 : record.module == .outbox ? 24 : 25
              )
              .accessibilityIdentifier("review.detail.title")
              if record.module == .library {
                NativeText("\(record.archiveState)   ·   \(record.date)", size: 13).foregroundStyle(
                  palette.secondary
                )
                .padding(.horizontal, 24).padding(.top, 17 * typeScale).accessibilityIdentifier(
                  "review.reader.metadata")
                Color.clear.frame(height: (35 - 13 * 1.42) * typeScale)
                Rectangle().fill(palette.separator).frame(height: 1).padding(.horizontal, 24)
              }
            }
          }.frame(maxWidth: .infinity, alignment: .leading)
        }.background(palette.surface.ignoresSafeArea(edges: .bottom))
      }.padding(.top, tablet ? 0 : 44).background(palette.paper.ignoresSafeArea())
    }
    private var bottomNavigation: some View {
      GeometryReader { geometry in
        Rectangle().fill(palette.separator).frame(height: 1)
        HStack(spacing: 0) {
          ForEach(NativeReviewModule.allCases) { module in
            Button {
              navigation.module = module
            } label: {
              VStack(spacing: 5) {
                glyph(moduleGlyph(module))
                NativeText(module.title, size: 10).fixedSize(horizontal: true, vertical: true)
              }
              .padding(.top, 10).frame(maxWidth: .infinity).frame(
                height: 49 + max(0, rootSize - 34) * 0.42, alignment: .top
              ).contentShape(Rectangle())
            }.foregroundStyle(navigation.module == module ? palette.accent : palette.secondary)
              .accessibilityIdentifier("review.tab.\(module.rawValue)")
              .accessibilityAddTraits(navigation.module == module ? .isSelected : [])
          }
        }.frame(width: geometry.size.width - 1, alignment: .leading)
      }.frame(height: 49 + max(0, rootSize - 34) * 0.42).background(
        palette.surface.ignoresSafeArea(edges: .bottom))
    }
    private var modalShell: some View {
      VStack(spacing: 0) {
        HStack {
          Text(navigation.modal ?? "").font(.headline)
          Spacer()
          Button("完成") { navigation.modal = nil }.accessibilityIdentifier("review.modal.done")
            .foregroundStyle(palette.accent).frame(minHeight: 44)
        }
        .padding(.horizontal, 20).padding(.top, 12)
        Rectangle().fill(palette.separator).frame(height: 1)
        Spacer()
      }.foregroundStyle(palette.label).tint(palette.accent).background(
        palette.surface.ignoresSafeArea()
      ).presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
  }
#endif
