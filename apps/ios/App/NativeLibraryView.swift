import SwiftUI
import UIKit

struct NativeLibraryView<Reader: View>: View {
  @ObservedObject var model: NativeLibraryModel
  @Binding var module: NativeAppModule
  @Binding var reading: Bool
  @Binding var path: [ReadEntry]
  let reader: (ReadEntry) -> Reader
  var pair: () -> Void
  var initialPanel: String? = nil
  @Environment(\.colorScheme) private var scheme
  @Environment(\.dynamicTypeSize) private var dynamicType
  @ScaledMetric private var size: CGFloat = 34
  private var selected: ReadEntry? { model.entries.first(where: { $0.id == model.selectedID }) }
  @State private var panel: String?
  @State private var categorySegment = 0
  @State private var searchDismiss = 0
  private var p: NativePalette { .init(dark: scheme == .dark) }
  private var searching: Bool { !model.query.text.isEmpty }
  private var statePage: Bool { model.isStatePage }
  private var title: String {
    model.favoritesOnly ? "我的收藏" : model.query.type.map(LibraryTypes.label) ?? "资料库"
  }
  private var segment: Binding<Int> {
    Binding(
      get: { model.query.status == "archived" ? 1 : model.query.status == "partial" ? 2 : 0 },
      set: { model.query.status = [nil, "archived", "partial"][$0] })
  }
  var body: some View {
    GeometryReader { geometry in
      let tablet = UIDevice.current.userInterfaceIdiom == .pad && geometry.size.width >= 760
      Group {
        if tablet {
          NativeThreeColumnLayout {
            NativeLibrarySidebar(module: $module, library: model).toolbar(.hidden, for: .navigationBar)
          } content: {
            list(tablet: true).toolbar(
              .hidden, for: .navigationBar)
          } detail: {
            if statePage {
              VStack(alignment: .leading, spacing: 0) {
                NativeText("资料库", size: 24, bold: true).padding(.leading, 24).padding(.top, 25)
                state(tablet: true).padding(.top, 145 - 25 - 24 * 1.42)
                Spacer(minLength: 0)
              }.background(p.surface).toolbar(.hidden, for: .navigationBar)
            } else if let entry = selected ?? model.entries.first {
              reader(entry).toolbar(.hidden, for: .navigationBar)
            } else {
              p.surface
            }
          }.ignoresSafeArea(.container, edges: [.top, .bottom])
        } else {
          NavigationStack(path: $path) {
            list(tablet: false).ignoresSafeArea(.container, edges: .top).toolbar(
              .hidden, for: .navigationBar
            )
            .navigationDestination(for: ReadEntry.self) { entry in
              reader(entry).toolbar(.hidden, for: .navigationBar)
            }
          }.ignoresSafeArea(.container, edges: .top)
        }
      }.background(p.paper.ignoresSafeArea()).foregroundStyle(p.label).tint(p.accent).buttonStyle(
        .plain
      )
      .safeAreaInset(edge: .bottom, spacing: 0) {
        if !tablet && !reading { NativeBottomNavigation(module: $module) }
      }
      .overlay {
        if let panel {
          NativePanel(
            title: panel == "分类" ? "分类导航" : panel, height: panel == "分类" ? 690 : 610,
            dismiss: { self.panel = nil }
          ) { if panel == "分类" { categoriesPanel } else { filterPanel } }
        }
      }
    }
    .onAppear {
      panel = initialPanel
      reading = !path.isEmpty
    }
    .onChange(of: path) { reading = !$0.isEmpty }
    .onChange(of: model.phase) { value in
      if value == .expired || value == .unpaired {
        path = []
        model.selectedID = nil
      }
    }
    .onChange(of: model.entries) { values in
      if let selected, !values.contains(where: { $0.id == selected.id }) { model.selectedID = nil }
    }
    .task(id: reloadKey) {
      do {
        try await Task.sleep(nanoseconds: 220_000_000)
        try Task.checkCancellation()
        await model.reload()
      } catch {}
    }
  }
  private var reloadKey: String {
    model.query.path + "|" + String(model.favoritesOnly) + "|"
      + (model.favoritesOnly ? model.favorites.sorted().joined(separator: "\n") : "")
  }
  private func list(tablet: Bool) -> some View {
    VStack(spacing: 0) {
      GeometryReader { geometry in
        NativeText(
          tablet && searching && !statePage ? "搜索结果" : title, size: tablet ? 24 : 34, bold: true
        ).frame(
          width: max(0, geometry.size.width - 90), alignment: .leading
        ).padding(.leading, 20).padding(.top, tablet ? 24 : 72).accessibilityIdentifier(
          "library.title")
        Button {
          panel = "筛选与排序"
        } label: {
          NativeGlyph(name: "filter").frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .position(x: geometry.size.width - (tablet ? 30 : 32), y: tablet ? 39 : 89).foregroundStyle(
          p.accent
        ).accessibilityLabel("筛选与排序").accessibilityIdentifier("library.filter")
        if !tablet {
          Button {
            panel = "分类"
          } label: {
            NativeGlyph(name: "menu", size: 22).frame(width: 44, height: 44).contentShape(
              Rectangle())
          }
          .position(x: 31, y: 58).foregroundStyle(p.accent).accessibilityLabel("分类")
          .accessibilityIdentifier("library.menu")
        }
      }.frame(height: (tablet ? 70 : 126) + max(0, size - 34) * 1.42)
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          if statePage && tablet {
            searchControls(tablet: true)
          } else {
            searchControls(tablet: tablet)
            if !searching && !statePage
              && (!tablet || model.query.type == nil && !model.favoritesOnly)
            {
              NativeSegmentedControl(labels: ["全部", "已归档", "待补齐"], selection: segment).padding(
                .horizontal, tablet ? 16 : 20
              ).padding(.top, tablet ? 12 : 16)
            }
            if statePage {
              state(tablet: false).padding(.top, 32)
            } else {
              if model.phase == .offline || model.phase == .failure {
                Button {
                  Task { await model.reload() }
                } label: {
                  NativeText(model.phase == .offline ? "离线 · 重试" : "读取失败 · 重试", size: 14)
                    .foregroundStyle(p.accent).padding(.horizontal, 20).frame(minHeight: 44)
                }
              }
              if !model.index.complete {
                NativeText(model.index.failed > 0 ? "部分资料尚未完成索引" : "资料索引处理中", size: 12)
                  .foregroundStyle(p.secondary).padding(.horizontal, 20).padding(.top, 12)
              }
              VStack(spacing: 0) {
                ForEach(model.entries) { entry in
                  ZStack(alignment: .topTrailing) {
                    Button {
                      if tablet { model.selectedID = entry.id } else { path.append(entry) }
                    } label: {
                      if searching {
                        NativeSearchResultRow(
                          entry: entry, query: model.query.text,
                          favorite: model.favorites.contains(entry.id),
                          selected: tablet && (selected ?? model.entries.first)?.id == entry.id)
                      } else {
                        NativeMaterialRow(
                          title: entry.title, summary: entry.summary ?? "", date: entry.dateLabel,
                          sourceType: entry.typeLabel, state: entry.statusLabel,
                          favorite: model.favorites.contains(entry.id),
                          selected: tablet && (selected ?? model.entries.first)?.id == entry.id,
                          compactColumn: tablet, identifier: entry.id)
                      }
                    }.accessibilityIdentifier("library.entry.\(entry.id)")
                    Button {
                      model.toggleFavorite(entry.id)
                    } label: {
                      Color.clear.frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .padding(.top, 6).accessibilityLabel(
                      model.favorites.contains(entry.id)
                        ? "取消收藏：\(entry.title)" : "收藏：\(entry.title)"
                    ).accessibilityIdentifier("library.bookmark.\(entry.id)")
                    .accessibilityAddTraits(model.favorites.contains(entry.id) ? .isSelected : [])
                  }.accessibilityElement(children: .contain)
                }
              }.padding(.top, rowsGap(tablet: tablet))
              if model.canLoadMore {
                Button {
                  Task { await model.loadMore() }
                } label: {
                  if model.loadingMore {
                    ProgressView()
                  } else {
                    NativeText(model.nextPageFailed ? "重试" : "更多资料", size: 16).foregroundStyle(
                      p.accent)
                  }
                }.frame(maxWidth: .infinity, minHeight: 48).accessibilityIdentifier("library.more")
              }
            }
          }
        }.padding(.top, tablet ? 5 : 0)
      }.scrollDismissesKeyboard(.interactively).refreshable { await model.reload() }
    }.background(tablet ? p.surface : p.paper).overlay(alignment: .trailing) {
      if tablet { Rectangle().fill(p.separator).frame(width: 1).allowsHitTesting(false) }
    }
  }
  private func rowsGap(tablet: Bool) -> CGFloat {
    if searching { return tablet ? 22 : 16 }
    if tablet && (model.query.type != nil || model.favoritesOnly) {
      return model.favoritesOnly ? 22 : 24
    }
    return tablet ? 15 : 17
  }
  private func searchControls(tablet: Bool) -> some View {
    HStack(alignment: .top, spacing: 8) {
      NativeSearchField(
        text: $model.query.text,
        placeholder: model.favoritesOnly
          ? "搜索收藏" : model.query.type.map { "搜索" + LibraryTypes.label($0) } ?? "搜索资料",
        dismissTrigger: searchDismiss, activeSecondary: true)
      if searching && !statePage {
        Button {
          model.query.text = ""
          searchDismiss += 1
        } label: {
          NativeText("取消", size: 16).fixedSize().padding(.top, 11).frame(
            width: tablet ? 48 : 40, height: max(38, 16 * 1.42 * size / 34 + 14),
            alignment: .topTrailing
          ).contentShape(Rectangle().inset(by: -3))
        }.foregroundStyle(p.accent).accessibilityIdentifier("library.search.cancel")
      }
    }.padding(.horizontal, tablet ? 16 : 20)
  }
  @ViewBuilder private func state(tablet: Bool) -> some View {
    if model.phase == .loading {
      NativeContentState(kind: .loading, title: "", actionTitle: "") {}
    } else {
      let title: String = {
        switch model.phase {
        case .empty: return "暂无资料"
        case .noResults: return "没有找到资料"
        case .unpaired: return "尚未配对"
        case .expired: return "授权已失效"
        case .offline: return "离线"
        default: return "资料暂时无法读取"
        }
      }()
      let action: String = {
        switch model.phase {
        case .empty: return "刷新"
        case .noResults: return "清除搜索"
        case .unpaired: return "连接资料库"
        case .expired: return "重新配对"
        default: return "重试"
        }
      }()
      let glyph: String = {
        switch model.phase {
        case .empty: return "book"
        case .noResults: return "search"
        case .unpaired: return "devices"
        case .expired: return "lock"
        default: return "alert"
        }
      }()
      VStack(spacing: 0) {
        NativeGlyph(name: glyph, size: 48).foregroundStyle(p.secondary).frame(maxWidth: .infinity)
          .padding(.top, 135)
        NativeText(title, size: 20, bold: true).fixedSize(
          horizontal: !dynamicType.isAccessibilitySize, vertical: true
        ).multilineTextAlignment(.center).frame(
          maxWidth: .infinity
        ).padding(.horizontal, 20).padding(.top, 28).accessibilityIdentifier("library.state.title")
        NativeButton(title: action) {
          switch model.phase {
          case .unpaired, .expired: pair()
          case .noResults: model.query.text = ""
          default: Task { await model.reload() }
          }
        }.frame(width: dynamicType.isAccessibilitySize ? nil : 220).padding(
          .horizontal, dynamicType.isAccessibilitySize ? 20 : 0
        ).padding(.top, 130 - 76 - 20 * 1.42).accessibilityIdentifier("library.state.action")
        if model.phase == .noResults {
          Button {
            model.resetFilters()
            model.favoritesOnly = false
            model.query.text = ""
          } label: {
            NativeText("重置筛选", size: 16).fixedSize().foregroundStyle(p.accent).frame(
              minHeight: 44, alignment: .top)
          }.padding(.top, 42).accessibilityIdentifier("library.state.reset")
        }
      }
    }
  }
  private var categoriesPanel: some View {
    VStack(spacing: 0) {
      NativeSegmentedControl(labels: ["类型", "主题"], selection: $categorySegment).padding(.bottom, 17)
      if categorySegment == 0 {
        ForEach(Array((["全部资料", "我的收藏"] + LibraryTypes.labels).enumerated()), id: \.offset) {
          index, label in
          let selected =
            index == 0
            ? model.query.type == nil && !model.favoritesOnly
            : index == 1 ? model.favoritesOnly : model.query.type == LibraryTypes.values[index - 2]
          Button {
            if index == 1 {
              model.selectFavorites()
            } else {
              model.selectCategory(index == 0 ? nil : LibraryTypes.values[index - 2])
            }
            panel = nil
          } label: {
            categoryRow(label, selected: selected)
          }.accessibilityIdentifier("library.categoryMenu.\(index)")
        }
      } else {
        ForEach(
          [ReadFacet(value: "全部", count: model.categories.total)] + model.categories.tags,
          id: \.value
        ) { tag in
          Button {
            model.query.tag = tag.value == "全部" ? nil : tag.value
            panel = nil
          } label: {
            categoryRow(
              tag.value,
              selected: model.query.tag == tag.value || tag.value == "全部" && model.query.tag == nil)
          }.accessibilityIdentifier("library.categoryTopic.\(tag.value)")
        }
      }
    }
  }
  private func categoryRow(_ title: String, selected: Bool) -> some View {
    HStack(alignment: .top) {
      NativeText(title, size: 17).padding(.leading, 12)
      Spacer()
      if selected { NativeGlyph(name: "check", size: 20).padding(.trailing, 13).padding(.top, 1) }
    }.foregroundStyle(selected ? p.accent : p.label).frame(
      height: max(39, 17 * 1.42 * size / 34 + 14), alignment: .top
    ).contentShape(Rectangle().inset(by: -2.5)).overlay(alignment: .top) {
      Rectangle().fill(p.separator).frame(height: 1).offset(y: max(31, 17 * 1.42 * size / 34 + 6))
    }
  }
  private var filterPanel: some View {
    VStack(alignment: .leading, spacing: 0) {
      let groups = [
        ["全部"] + LibraryTypes.labels, ["全部"] + model.categories.tags.map(\.value),
        ["全部", "已归档", "待补齐", "待处理"], LibrarySort.allCases.map(\.label),
      ]
      ForEach(0..<4, id: \.self) { group in
        NativeText(["类型", "主题", "完整度", "排序"][group], size: 14).foregroundStyle(p.secondary).padding(
          .bottom, 29 - 14 * 1.42)
        let labels = groups[group]
        let columns = min(4, labels.count > 4 ? 3 : max(1, labels.count))
        LazyVGrid(
          columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: columns), spacing: 8
        ) {
          ForEach(labels.indices, id: \.self) { index in
            NativeChoice(title: labels[index], selected: choiceSelected(group, index, labels)) {
              choose(group, index, labels)
            }.accessibilityIdentifier("library.filter.\(group).\(index)")
          }
        }.padding(.bottom, 23)
      }
      Button {
        model.resetFilters()
      } label: {
        NativeText("重置", size: 16).fixedSize().foregroundStyle(p.accent).frame(
          maxWidth: .infinity, minHeight: 44, alignment: .top
        ).contentShape(Rectangle())
      }.offset(y: -2).accessibilityIdentifier("library.filter.reset")
    }
  }
  private func choiceSelected(_ group: Int, _ index: Int, _ labels: [String]) -> Bool {
    switch group {
    case 0: return model.query.type == (index == 0 ? nil : LibraryTypes.values[index - 1])
    case 1: return model.query.tag == (index == 0 ? nil : labels[index])
    case 2: return model.query.status == [nil, "archived", "partial", "pending"][index]
    default: return (model.query.sort ?? .recent) == LibrarySort.allCases[index]
    }
  }
  private func choose(_ group: Int, _ index: Int, _ labels: [String]) {
    switch group {
    case 0: model.query.type = index == 0 ? nil : LibraryTypes.values[index - 1]
    case 1: model.query.tag = index == 0 ? nil : labels[index]
    case 2: model.query.status = [nil, "archived", "partial", "pending"][index]
    default: model.query.sort = LibrarySort.allCases[index]
    }
  }
}
