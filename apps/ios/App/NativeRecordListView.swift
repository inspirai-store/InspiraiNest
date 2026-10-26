import SwiftUI
import UIKit

// A separate native text treatment for the approved records artboards. Uses
// system font fallback (including PingFang UI), with no per-string width edits.
struct RecordTextLayout: Layout {
  let size: CGFloat
  let lineHeight: CGFloat
  let weight: UIFont.Weight
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let d = subviews[0].dimensions(in: proposal)
    return .init(
      width: d.width, height: lineHeight + max(0, d[.lastTextBaseline] - d[.firstTextBaseline]))
  }
  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    let p = ProposedViewSize(width: bounds.width, height: nil)
    let d = subviews[0].dimensions(in: p)
    let font = UIFont.systemFont(ofSize: size, weight: weight)
    let baseline = (lineHeight + font.ascender + font.descender) / 2 + size * 0.14
    subviews[0].place(
      at: .init(x: bounds.minX, y: bounds.minY + baseline - d[.firstTextBaseline]),
      anchor: .topLeading, proposal: p)
  }
}
struct RecordText: View {
  let value: String
  let weight: Font.Weight
  let nativeWeight: UIFont.Weight
  let base: CGFloat
  let requestedHeight: CGFloat?
  let lines: Int?
  let alignment: TextAlignment
  @ScaledMetric(relativeTo: .body) private var size: CGFloat = 17
  init(
    _ value: String, _ size: CGFloat = 17, weight: Font.Weight = .regular,
    height: CGFloat? = nil, lines: Int? = nil, align: TextAlignment = .leading,
    relativeTo: Font.TextStyle = .body
  ) {
    self.value = value
    self.weight = weight
    base = size
    requestedHeight = height
    self.lines = lines
    alignment = align
    nativeWeight =
      weight == .bold
      ? .bold : weight == .semibold ? .semibold : weight == .medium ? .medium : .regular
    _size = ScaledMetric(wrappedValue: size, relativeTo: relativeTo)
  }
  var body: some View {
    RecordTextLayout(
      size: size, lineHeight: (requestedHeight ?? ceil(base * 1.42)) * size / base,
      weight: nativeWeight
    ) {
      Text(verbatim: value).font(.system(size: size, weight: weight)).lineLimit(lines)
        .multilineTextAlignment(alignment).fixedSize(horizontal: false, vertical: true)
    }
  }
}
struct RecordSymbol: View {
  let name: String
  var size: CGFloat = 22
  var body: some View {
    Image(systemName: name).symbolRenderingMode(.palette).resizable().scaledToFit().frame(width: size * 0.8, height: size * 0.8)
      .frame(width: size, height: size).accessibilityHidden(true)
  }
}

struct NativeRecordDetailBounds:PreferenceKey {
  static var defaultValue=CGRect.zero
  static func reduce(value:inout CGRect,nextValue:()->CGRect) {let next=nextValue();if next.width > 0 {value=next}}
}
struct NativeRecordListView: View {
  @ObservedObject var model: NativeRecordListModel
  @Binding var module: NativeAppModule
  var pair: () -> Void = {}
  var newRecord: (() -> Void)? = nil
  var continueDraft: (() -> Void)? = nil
  var editRecord: ((NativeRecord) -> Void)? = nil
  var suppressSelection = false
  var recordsHome:(() -> Void)? = nil
  var illustration: ((NativeRecordAttachment) -> AnyView?)? = nil
  var mediaStore: NativeRecordMediaStore?
  var mediaScope: String = NativeRecordLocalStore.unbound
  var recordScopes: [String:String] = [:]
  var syncModel:NativeRecordSyncModel?
  var processingModel:NativeRecordProcessingModel?
  var autoReload = true
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  @ScaledMetric(relativeTo: .largeTitle) private var headerScale: CGFloat = 1
  @FocusState private var searchFocused: Bool
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { geometry in
      let tablet = UIDevice.current.userInterfaceIdiom == .pad && geometry.size.width >= 760
      Group {
        if tablet {
          NativeThreeColumnLayout {
            NativeRecordSidebar(model: model, module: $module,recordsHome:recordsHome)

              .toolbar(.hidden, for: .navigationBar)
          } content: {
            list(tablet: true).toolbar(
              .hidden, for: .navigationBar)
          } detail: {
            Group {
            if let record = model.selected {
              NativeRecordSelectionPreview(
                record: record, model: model, illustration: illustration, pair: pair,
                edit: editRecord.map { action in { action(record) } },mediaStore:mediaStore,mediaScope:recordScopes[record.id] ?? mediaScope,syncModel:syncModel,processingModel:processingModel
              )
              .toolbar(.hidden, for: .navigationBar)
            } else {
              p.paper.toolbar(.hidden, for: .navigationBar)
            }
            }.background(GeometryReader {geometry in Color.clear.preference(key:NativeRecordDetailBounds.self,value:geometry.frame(in:.global))})
          }.ignoresSafeArea(.container, edges: [.top, .bottom])
        } else {
          NavigationStack(path: $model.path) {
            list(tablet: false).toolbar(.hidden, for: .navigationBar)
              .navigationDestination(for: String.self) { id in
                if let record = model.snapshot.records.first(where: { $0.id == id }) {
                  NativeRecordSelectionPreview(
                    record: record, model: model, back: { model.path.removeLast() },
                    illustration: illustration, pair: pair,
                    edit: editRecord.map { action in { action(record) } },mediaStore:mediaStore,mediaScope:recordScopes[record.id] ?? mediaScope,syncModel:syncModel,processingModel:processingModel
                  )
                  .toolbar(.hidden, for: .navigationBar)
                }
              }
          }.ignoresSafeArea(.container, edges: .top)
            .safeAreaInset(edge: .bottom, spacing: 0) {
              if model.path.isEmpty { NativeBottomNavigation(module: $module) }
            }
        }
      }
    }.background(p.paper.ignoresSafeArea()).foregroundStyle(p.label).tint(p.accent).buttonStyle(
      .plain
    )
    .onChange(of: model.phase) { phase in
      if phase == .expired || phase == .unpaired { model.path = [] }
    }
    .task { if autoReload { await model.reload() } }
  }
  private func list(tablet: Bool) -> some View {
    VStack(spacing: 0) {
      ZStack(alignment: .topLeading) {
        RecordText("记录", tablet ? 24 : 34, weight: .bold, relativeTo: .largeTitle).padding(.leading, 20)
          .padding(.top, tablet ? 22 : 67).accessibilityIdentifier("records.title")
        HStack {
          Spacer()
          Group {
            if let newRecord {
              Button(action: newRecord) {
                RecordSymbol(name: "square.and.pencil", size: tablet ? 23 : 26).frame(
                  width: 44, height: 44)
              }
            } else {
              RecordSymbol(name: "square.and.pencil", size: tablet ? 23 : 26).frame(
                width: 44, height: 44
              ).accessibilityHidden(true)
            }
          }.foregroundStyle(p.accent)
            .padding(.trailing, tablet ? 13 : 10).padding(.top, tablet ? 16 : 68)
            .accessibilityLabel("新建记录").accessibilityIdentifier("records.new")
        }
      }.frame(height: (tablet ? 22 : 67) + ceil((tablet ? 24 : 34) * 1.42) * headerScale + (tablet ? 21 : 13), alignment: .topLeading)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          search.padding(.horizontal, tablet ? 16 : 20)
          segments.padding(.horizontal, tablet ? 16 : 20).padding(.top, (tablet ? 12 : 13) * scale)
          if bannerTitle != nil && !tablet {
            banner.padding(.horizontal, tablet ? 16 : 20).padding(.top, 22 * scale)
          }
          if let draft = model.snapshot.draft, !model.isSearching {
            draftCard(draft).padding(.horizontal, tablet ? 16 : 20).padding(
              .top, (!tablet && bannerTitle != nil ? 28 : 20) * scale)
          }
          if model.phase == .loading && model.snapshot.records.isEmpty {
            loading.padding(.top, 43 * scale)
          } else if model.visible.isEmpty {
            empty(tablet: tablet).padding(.horizontal, tablet ? 16 : 20)
              .padding(.top, emptyTop(tablet: tablet) * scale)
          } else {
            ForEach(Array(model.groups.enumerated()), id: \.element.id) { index, group in
              RecordText(group.title, 13).foregroundStyle(p.secondary).padding(.horizontal, 20)
                .padding(.top, groupGap(index: index, tablet: tablet))
                .padding(
                  .bottom, (tablet ? 15 : bannerTitle != nil ? (index == 0 ? 17 : 15) : 12) * scale)
              ForEach(group.records) { record in
                Button {
                  model.selectedID = record.id
                  searchFocused = false
                  if !tablet { model.path.append(record.id) }
                } label: {
                  NativeRecordRow(
                    record: record, time: model.time(record.createdAt),
                    selected: tablet && !suppressSelection && model.selected?.id == record.id)
                }.accessibilityIdentifier("records.row.\(record.id)")
              }
            }
          }
        }.padding(.bottom, 20)
      }.refreshable { await model.reload() }.scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("records.scroll")
      if tablet {
        RecordText("\(model.visible.count) 条记录", 12).foregroundStyle(p.secondary).padding(
          .leading, 20
        )
        .padding(.top, 8).frame(maxWidth: .infinity, alignment: .leading).frame(
          height: 47, alignment: .top)
      }
    }.background(tablet ? p.surface : p.paper).ignoresSafeArea(.container, edges: tablet ? [.top, .bottom] : .top)
      .overlay(alignment: .trailing) {
        if tablet { Rectangle().fill(p.separator).frame(width: 0.5) }
      }
  }
  private func groupGap(index: Int, tablet: Bool) -> CGFloat {
    if index == 0 {
      return
        (model.snapshot.draft != nil && !model.isSearching
        ? (tablet ? 25 : bannerTitle != nil ? 28 : 21) : 25) * scale
    }
    return (tablet ? 12 : bannerTitle != nil ? 6 : 5) * scale
  }
  private var search: some View {
    ZStack(alignment: .topLeading) {
      RoundedRectangle(cornerRadius: 12, style: .continuous).fill(p.well)
      RecordSymbol(name: "magnifyingglass", size: 18).foregroundStyle(p.secondary).padding(
        .leading, 12
      ).padding(.top, 10 * scale)
      if model.query.isEmpty {
        RecordText("搜索记录", 16).foregroundStyle(p.secondary).padding(.leading, 40).padding(
          .top, 7 * scale
        ).allowsHitTesting(false)
      }
      TextField("", text: $model.query).font(.system(size: 16 * scale)).textInputAutocapitalization(
        .never
      )
      .autocorrectionDisabled().focused($searchFocused).padding(.leading, 40).padding(.trailing, 35)
      .frame(minHeight: 38 * scale).accessibilityLabel("搜索记录").accessibilityIdentifier(
        "records.search")
      if !model.query.isEmpty {
        HStack {
          Spacer()
          Button {
            model.query = ""
          } label: {
            RecordSymbol(name: "xmark.circle", size: 18).foregroundStyle(p.secondary).frame(
              width: 36, height: 38 * scale)
          }.accessibilityLabel("清除搜索").accessibilityIdentifier("records.search.clear")
        }
      }
    }.frame(height: max(38, 38 * scale))
  }
  private var segments: some View {
    HStack(spacing: 0) {
      ForEach(NativeRecordFilter.allCases) { filter in
        Button {
          model.filter = filter
          model.selectedID = nil
        } label: {
          RecordText(
            filter.rawValue, 13, weight: model.filter == filter ? .semibold : .regular,
            align: .center
          )
          .frame(maxWidth: .infinity).padding(.top, 4 * scale).padding(.bottom, 3 * scale)
          .background(
            model.filter == filter ? p.surface : .clear,
            in: RoundedRectangle(cornerRadius: 7, style: .continuous)
          )
          .padding(.horizontal, 2)
        }.foregroundStyle(model.filter == filter ? p.label : p.secondary)
          .accessibilityIdentifier("records.filter.\(filter.id)").accessibilityAddTraits(
            model.filter == filter ? .isSelected : [])
      }
    }.padding(.vertical, 2).frame(minHeight: 32 * scale).background(
      p.well, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
  }
  private func draftCard(_ draft: NativeRecordDraftIndex) -> some View {
    let content =
      HStack(alignment: .top, spacing: 13) {
        RecordSymbol(name: "square.and.pencil", size: 24).foregroundStyle(p.accent).padding(
          .top, 17 * scale)
        VStack(alignment: .leading, spacing: 1 * scale) {
          RecordText("继续编辑草稿", 15, weight: .medium)
          RecordText(draft.title + " · " + model.time(draft.modifiedAt), 12, lines: 1)
            .foregroundStyle(p.secondary)
        }.padding(.top, 9 * scale)
        Spacer(minLength: 4)
        RecordSymbol(name: "chevron.right", size: 13).foregroundStyle(p.secondary).padding(
          .top, 23 * scale)
      }.padding(.horizontal, 14).padding(.bottom, 8 * scale).frame(
        minHeight: 59 * scale, alignment: .top
      )
      .background(p.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    return Group {
      if let continueDraft {
        Button(action: continueDraft) { content }
      } else {
        content.accessibilityElement(children: .combine)
      }
    }.accessibilityIdentifier("records.draft")
  }
  private var bannerTitle: String? {
    if model.cacheFailed { return "本机缓存保存失败" }
    switch model.phase {
    case .offline: return "离线 · \(model.count(.pending)) 条待同步"
    case .unpaired: return "未连接资料空间"
    case .expired: return "资料空间授权已失效"
    case .failure where !model.snapshot.records.isEmpty: return "记录读取失败"
    case .unavailable: return "记录服务暂不可用"
    default: return nil
    }
  }
  private var banner: some View {
    Button {
      if model.phase == .expired || model.phase == .unpaired {
        pair()
      } else if model.phase == .offline {
        if let syncModel {syncModel.show()} else {model.filter = .pending}
      } else {
        Task { await model.reload() }
      }
    } label: {
      HStack(spacing: 9) {
        RecordSymbol(
          name: model.phase == .offline
            ? "wifi.slash" : model.phase == .unpaired ? "link" : "exclamationmark.circle", size: 18)
        RecordText(bannerTitle ?? "", 14)
        Spacer(minLength: 4)
        RecordText(
          model.phase == .unpaired
            ? "连接" : model.phase == .expired ? "重新配对" : model.phase == .offline ? "查看队列" : "重试", 14,
          weight: .medium)
      }.padding(.horizontal, 12).padding(.vertical, 12).frame(minHeight: 48 * scale)
        .foregroundStyle(p.accent).background(
          p.selection, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }.accessibilityIdentifier("records.banner")
  }
  private var loading: some View {
    VStack(spacing: 33) {
      ProgressView().frame(height: 22)
      VStack(alignment: .leading, spacing: 34) {
        ForEach(0..<4) { _ in
          HStack(alignment: .top, spacing: 14) {
            RoundedRectangle(cornerRadius: 7).fill(p.well).frame(width: 25, height: 25)
            VStack(alignment: .leading, spacing: 14) {
              RoundedRectangle(cornerRadius: 4).fill(p.well).frame(height: 15)
              RoundedRectangle(cornerRadius: 4).fill(p.well).frame(height: 12).padding(
                .trailing, 27)
              RoundedRectangle(cornerRadius: 4).fill(p.well).frame(width: 96, height: 9)
            }
          }
        }
      }.padding(.leading, 24).padding(.trailing, 40).accessibilityHidden(true)
    }.accessibilityElement(children: .ignore).accessibilityLabel("记录加载中").accessibilityIdentifier(
      "records.loading")
  }
  private func emptyTop(tablet: Bool) -> CGFloat {
    let failed = [.failure, .unavailable].contains(model.phase)
    return (failed ? 120 : model.isSearching ? 118 : 114) + (tablet ? 6 : 0)
  }
  private func empty(tablet: Bool) -> some View {
    let failed = [.failure, .unavailable].contains(model.phase)
    let title = failed ? "记录加载失败" : model.isSearching ? "没有找到相关记录" : "还没有记录"
    return VStack(spacing: 0) {
      RecordSymbol(
        name: failed
          ? "exclamationmark.arrow.triangle.2.circlepath"
          : model.isSearching ? "magnifyingglass" : "square.and.pencil", size: failed ? 46 : 48
      ).foregroundStyle(p.secondary)
      RecordText(
        title, failed ? 19 : model.isSearching ? 18 : 20, weight: .semibold, align: .center
      ).padding(.top, (model.isSearching || failed ? 28 : 27) * scale)
        .accessibilityIdentifier("records.state.title")
      if failed {
        RecordText("无法连接资料空间", 14, align: .center).foregroundStyle(p.secondary).padding(.top, 12)
      }
      let actionContent = RecordText(
          failed ? "重试" : model.isSearching ? "清除筛选" : "新建记录", 17, weight: .semibold, align: .center
        )
        .foregroundStyle(model.isSearching ? p.accent : scheme == .dark ? p.paper : p.surface)
        .frame(maxWidth: .infinity).padding(.vertical, 11.5)
        .background(
          model.isSearching ? p.well : p.accent,
          in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      Group {
        if failed || model.isSearching || newRecord != nil {
          Button {
            if failed { Task { await model.reload() } }
            else if model.isSearching { model.query = ""; model.filter = .all }
            else { newRecord?() }
          } label: { actionContent }
        } else { actionContent.accessibilityElement(children: .combine) }
      }
        .padding(.horizontal, failed ? 48 : model.isSearching ? 42 : 38).padding(
          .top, failed ? 26 : model.isSearching ? 33 : 30
        )
        .accessibilityIdentifier("records.state.action")
    }.frame(maxWidth: .infinity)
  }
}

struct NativeRecordRow: View {
  let record: NativeRecord
  let time: String
  let selected: Bool
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    HStack(alignment: .top, spacing: 13) {
      RecordSymbol(name: record.symbol, size: 22).foregroundStyle(p.accent).padding(.top, 3 * scale)
      VStack(alignment: .leading, spacing: 0) {
        RecordText(record.title, 17, weight: .semibold, lines: scale > 1.2 ? 3 : 2).accessibilityIdentifier(
          "records.row.title.\(record.id)")
        RecordText(record.excerpt, 14, lines: scale > 1.2 ? 3 : 1).foregroundStyle(p.secondary)
          .padding(.top, 4 * scale).accessibilityIdentifier("records.row.excerpt.\(record.id)")
        HStack(alignment: .top, spacing: 8) {
          RecordText(time + " · " + record.sync.title, 12).foregroundStyle(
            record.sync == .synced ? p.secondary : p.accent
          )
          .accessibilityIdentifier("records.row.sync.\(record.id)")
          Spacer(minLength: 0)
          RecordText(record.processingTitle, 12, align: .trailing).fixedSize(
            horizontal: true, vertical: true
          )
          .foregroundStyle(record.processingTitle == "待确认" ? p.accent : p.secondary)
          .accessibilityIdentifier("records.row.processing.\(record.id)")
        }.padding(.top, 9 * scale)
        Rectangle().fill(p.separator).frame(height: 0.5).padding(.top, 12 * scale)
      }
    }.padding(.leading, 17).padding(.trailing, 16).padding(.bottom, 11.5 * scale)
      .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
      .background {
        if selected {
          GeometryReader { g in
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(p.selection)
              .frame(width: max(0, g.size.width - 16), height: max(94, g.size.height - 6)).offset(
                x: 8, y: -6)
          }
        }
      }.accessibilityElement(children: .contain)
  }
}

struct NativeRecordSidebar: View {
  @ObservedObject var model: NativeRecordListModel
  @Binding var module: NativeAppModule
  var recordsHome:(() -> Void)? = nil
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        NativePrimarySidebarNavigation(module: $module) { item in if item == .records { recordsHome?() } }
        if module == .records {
          RecordText("记录状态", 13).foregroundStyle(p.secondary).padding(.leading, 26).padding(
            .top, 38 * scale)
          VStack(spacing: 0) {
            ForEach(NativeRecordFilter.allCases) { filter in
              Button {
                model.filter = filter
              } label: {
                HStack(alignment: .top) {
                  RecordText(filter == .all ? "全部记录" : filter.rawValue, 15).foregroundStyle(
                    model.filter == filter ? p.accent : p.secondary)
                  Spacer()
                  RecordText(String(model.count(filter)), 13, align: .trailing).foregroundStyle(
                    p.secondary
                  ).frame(width: 22, alignment: .trailing)
                }.padding(.leading, 42).padding(.trailing, 20).padding(.top, 11 * scale).padding(
                  .bottom, 6 * scale)
              }.accessibilityIdentifier("records.sidebar.\(filter.id)")
            }
          }.padding(.top, 7 * scale)
        }
      }.padding(.bottom, 95)
    }.safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(alignment: .leading, spacing: 8) {
        HStack(alignment: .top, spacing: 11) {
          RecordSymbol(name: "externaldrive.connected.to.line.below", size: 20)
          RecordText(model.origin.isEmpty ? "未连接资料空间" : "个人资料空间", 13).offset(y: -3)
        }
        RecordText(URL(string: model.origin)?.host ?? "", 11, lines: 1)
      }.foregroundStyle(p.secondary).padding(.leading, 25).padding(.top, 13).padding(.bottom, 37)
        .frame(maxWidth: .infinity, alignment: .leading).background(p.paper)
    }.background(p.paper).overlay(alignment: .trailing) {
      Rectangle().fill(p.separator).frame(width: 0.5)
    }
    .foregroundStyle(p.label).buttonStyle(.plain).ignoresSafeArea(
      .container, edges: [.top, .bottom])
  }
}

struct NativeRecordSelectionPreview: View {
  let record: NativeRecord
  @ObservedObject var model: NativeRecordListModel
  var back: (() -> Void)? = nil
  var illustration: ((NativeRecordAttachment) -> AnyView?)? = nil
  var pair: () -> Void = {}
  var edit: (() -> Void)? = nil
  var mediaStore:NativeRecordMediaStore?
  var mediaScope:String=NativeRecordLocalStore.unbound
  var syncModel:NativeRecordSyncModel?
  var processingModel:NativeRecordProcessingModel?
  var body:some View {NativeRecordDetailView(record:record,list:model,back:back,edit:edit,mediaStore:mediaStore,mediaScope:mediaScope,illustration:illustration,syncModel:syncModel,processingModel:processingModel)}
}

private struct NativeRecordContextPane: View {
  let record: NativeRecord
  @ObservedObject var model: NativeRecordListModel
  let pair: () -> Void
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    VStack(alignment: .leading, spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          RecordText(record.title, 24, weight: .semibold).padding(.bottom, 50 * scale)
          Button {
            if model.phase == .offline { model.filter = .pending } else { pair() }
          } label: {
            HStack(spacing: 9) {
              RecordSymbol(
                name: model.phase == .offline
                  ? "wifi.slash" : model.phase == .unpaired ? "link" : "lock.slash", size: 18)
              RecordText(
                model.phase == .offline
                  ? "离线 · \(model.count(.pending)) 条待同步"
                  : model.phase == .unpaired ? "未连接资料空间" : "资料空间授权已失效", 14)
              Spacer(minLength: 4)
              RecordText(
                model.phase == .offline ? "查看队列" : model.phase == .unpaired ? "连接" : "重新配对", 14,
                weight: .medium)
            }.padding(.horizontal, 12).padding(.vertical, 12 * scale).frame(minHeight: 48 * scale)
              .foregroundStyle(p.accent).background(
                p.selection, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
          }.accessibilityIdentifier("records.banner")
          RecordText("今天 \(model.time(record.createdAt)) · 已保存在本机 · \(record.sync.title)", 13)
            .foregroundStyle(p.secondary).padding(.top, 28 * scale)
          RecordText(record.processingTitle, 12, weight: .medium, align: .center).frame(
            width: 78 * scale
          ).padding(.vertical, 3)
            .foregroundStyle(p.accent).background(
              p.selection, in: RoundedRectangle(cornerRadius: 7, style: .continuous)
            ).padding(.top, 18 * scale)
          VStack(alignment: .leading, spacing: 40 * scale) {
            ForEach(Array(record.lines.dropFirst().enumerated()), id: \.offset) { _, line in
              RecordText(line, 17, height: 28)
            }
          }.padding(.top, 43 * scale)
        }.padding(.top, 25 * scale)
      }
      RecordText("个人资料空间", 13).foregroundStyle(p.secondary).padding(.bottom, 86)
    }.padding(.horizontal, 24).buttonStyle(.plain)
  }
}
