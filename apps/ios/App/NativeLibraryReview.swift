#if DEBUG
  import SwiftUI
  import UIKit

  /// In-memory service and collection; never creates AppModel or reads credentials/outbox.
  actor NativeLibraryFixtureService: LibraryReadService {
    let page: String
    private var attempts = 0
    init(page: String) { self.page = page }
    static let longRecord = ReadEntry(
      id: "long-0",
      title: "12 个 AI 组队优化仓储调度代码，有的快了上千倍，有的比原来还慢｜SwiftUI 中文与 English 长标题排版验证",
      summary: "模型随机组队，接力优化仓储调度代码，交叉寻找反例并实现需求变更。记录包含缓存、计算顺序、测试覆盖、原始正文及附件定位。长摘要完整保留，用于验证真实资料超过设计示例长度时，标题、摘要、采集日期和归档状态仍按顺序排布。iPhone 和 iPad 的资料行随内容高度扩展，不遮挡下一条资料；放大字号后仍可阅读全部业务信息。",
      type: "repository", status: "archived", collectedAt: "2026-10-11",
      tags: ["SwiftUI"], matches: nil)
    private var records: [ReadEntry] {
      page == "L01" ? [Self.longRecord] + Array(Self.records.dropFirst()) : Self.records
    }
    static let records: [ReadEntry] = [
      .init(
        id: "library-0", title: "SwiftUI 原生界面实践", summary: "导航、状态与长文阅读的原生界面实践。", type: "document",
        status: "archived", collectedAt: "2026-10-09", tags: ["SwiftUI", "阅读"], matches: nil),
      .init(
        id: "library-1", title: "Markdown 资料整理", summary: "标题、列表、代码与来源的结构化整理。", type: "article",
        status: "archived", collectedAt: "2026-10-09", tags: ["资料整理"], matches: nil),
      .init(
        id: "library-2", title: "长文阅读与信息结构", summary: "段落层级、来源定位与阅读路径。", type: "note",
        status: "partial", collectedAt: "2026-10-08", tags: ["阅读"], matches: nil),
      .init(
        id: "library-3", title: "资料来源与核验", summary: "对照原文与附件，保留来源事实。", type: "webpage",
        status: "pending", collectedAt: "2026-10-08", tags: ["资料整理"], matches: nil),
    ]
    func readCategories() async throws -> ReadCategories {
      let value = ReadCategories.from(records)
      return .init(
        total: value.total, types: value.types,
        tags: [
          .init(value: "SwiftUI", count: 1), .init(value: "资料整理", count: 2),
          .init(value: "阅读", count: 2),
        ], statuses: value.statuses, index: value.index)
    }
    func readEntries(_ query: ReadQuery) async throws -> ReadPage {
      attempts += 1
      if page == "S01" { try await Task.sleep(nanoseconds: 3_600_000_000_000) }
      if page == "S04" && attempts == 1 { throw CollectorError.http(503) }
      if page == "S07" { throw CollectorError.http(401) }
      if page == "offline" && attempts == 1 { throw URLError(.notConnectedToInternet) }
      var items = records
      if page == "S02" || page == "S03" {
        items = []
      } else if !query.text.isEmpty {
        let match = ReadMatch(
          file: "summary.md", startLine: 12, endLine: 14, snippet: "SwiftUI 采用三栏导航与阅读。")
        if page == "L01" {
          let record = Self.longRecord
          let longMatch = ReadMatch(
            file: "source/研究资料/跨设备阅读与原始附件定位/长文件路径与搜索结果排版回归验证/source-article.md",
            startLine: 120, endLine: 144, snippet: "AI 中文与 English 长标题的搜索命中及原文定位。")
          items = [.init(
            id: record.id, title: record.title, summary: record.summary, type: record.type,
            status: record.status, collectedAt: record.collectedAt, tags: record.tags,
            matches: [longMatch])]
        } else if query.text.lowercased() == "swiftui" {
          items = [
            .init(
              id: "library-0", title: "SwiftUI 原生界面实践", summary: items[0].summary, type: "document",
              status: "archived", collectedAt: "2026-10-09", tags: ["SwiftUI"], matches: [match]),
            .init(
              id: "search-1", title: "SwiftUI 导航与层级", summary: "SwiftUI 的列表选择与阅读路径。",
              type: "article", status: "archived", collectedAt: "2026-10-08", tags: ["SwiftUI"],
              matches: [match]),
          ]
        } else {
          items = items.filter {
            ($0.title + ($0.summary ?? "")).localizedCaseInsensitiveContains(query.text)
          }
        }
      }
      items = items.filter { entry in
        (query.type == nil || entry.type == query.type)
          && (query.status == nil || entry.status == query.status)
          && (query.tag == nil || (entry.tags ?? []).contains(query.tag!))
          && (query.ids == nil || query.ids!.contains(entry.id))
      }
      if page == "P03" && query.sort == nil {
        items = [
          items.first(where: { $0.id == "library-0" }),
          items.first(where: { $0.id == "library-2" }),
          items.first(where: { $0.id == "library-1" }),
        ].compactMap { $0 }
      }
      if let sort = query.sort {
        items.sort { a, b in
          sort == .title
            ? a.title < b.title
            : a.collectedAt == b.collectedAt
              ? a.id < b.id
              : sort == .earliest
                ? (a.collectedAt ?? "") < (b.collectedAt ?? "")
                : (a.collectedAt ?? "") > (b.collectedAt ?? "")
        }
      }
      let total = items.count
      return .init(
        items: Array(items.dropFirst(query.offset).prefix(query.limit)), total: total,
        limit: query.limit, offset: query.offset,
        index: .init(complete: true, pending: 0, failed: 0))
    }
  }
  struct NativeLibraryReview: View {
    let configuration: NativeReviewConfiguration
    @StateObject private var model: NativeLibraryModel
    @StateObject private var reader: NativeReaderModel
    @State private var module: NativeAppModule = .library
    @State private var reading = false
    @State private var path: [ReadEntry] = []
    init(configuration: NativeReviewConfiguration) {
      self.configuration = configuration
      let model = NativeLibraryModel(
        service: ["S06", "S07"].contains(configuration.page)
          ? nil : NativeLibraryFixtureService(page: configuration.page),
        favorites: configuration.page == "P03"
          ? ["library-0", "library-1", "library-2"] : ["library-0", "library-2"],
        phase: configuration.page == "S06"
          ? .unpaired : configuration.page == "S07" ? .expired : .loading,
        categories: ["S06", "S07"].contains(configuration.page)
          ? .init(
            total: 4, types: [],
            tags: [
              .init(value: "SwiftUI", count: 1), .init(value: "资料整理", count: 2),
              .init(value: "阅读", count: 2),
            ], statuses: [], index: .init(complete: true, pending: 0, failed: 0)) : .empty)
      if ["P04", "S03"].contains(configuration.page) { model.query.text = "SwiftUI" }
      if configuration.page == "P03" { model.favoritesOnly = true }
      if configuration.page == "P02" && UIDevice.current.userInterfaceIdiom == .pad {
        model.query.type = "document"
      }
      _model = StateObject(wrappedValue: model)
      _reader = StateObject(wrappedValue: NativeReaderModel(
        service: NativeReaderFixtureService(page: "P06", width: 633, detailHeight: 834)))
    }
    var body: some View {
      GeometryReader { geometry in
        let tablet = UIDevice.current.userInterfaceIdiom == .pad && geometry.size.width >= 760
        Group {
          if module == .library {
            NativeLibraryView(
              model: model, module: $module, reading: $reading, path: $path,
              reader: { entry in
                NativeReaderView(
                  model: reader, entryID: entry.id, tablet: tablet,
                  favorite: model.favorites.contains(reader.detail?.id ?? entry.id),
                  toggleFavorite: { model.toggleFavorite(reader.detail?.id ?? entry.id) })
              },
              pair: { module = .devices },
              initialPanel: configuration.page == "P05"
                ? "筛选与排序" : configuration.page == "P02" && !tablet ? "分类" : nil)
          } else {
            NativeSkeletonShell(page: module == .devices ? "P31" : module == .tasks ? "P21" : "P18")
          }
        }
        .overlay {
          NativeReaderPanels(model: reader)
            .allowsHitTesting(reader.panel != nil || reader.exportData != nil || reader.notice != nil)
            .accessibilityHidden(reader.panel == nil && reader.exportData == nil && reader.notice == nil)
        }
      }
      .modifier(NativeReaderExportPresentation(model: reader))
    }
  }
#endif
