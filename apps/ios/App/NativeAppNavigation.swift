import SwiftUI
import UIKit

enum NativeAppModule: String, CaseIterable, Identifiable {
  case records, library, tasks, account, outbox, devices
  static var primary: [Self] { [.records, .library, .tasks, .account] }
  var root: Self { self == .outbox || self == .devices ? .account : self }
  var id: String { rawValue }
  var title: String {
    switch self {
    case .records: return "记录"
    case .library: return "资料库"
    case .tasks: return "任务"
    case .outbox: return "发件箱"
    case .devices: return "设备"
    case .account: return "我的"
    }
  }
  var glyph: String { self == .library ? "book" : rawValue }
  var systemSymbol: String {
    switch self {
    case .records: return "square.and.pencil"
    case .library: return "books.vertical"
    case .tasks: return "checklist"
    case .account: return "person.crop.circle"
    case .outbox: return "tray"
    case .devices: return "laptopcomputer.and.iphone"
    }
  }
}
struct NativeThreeColumnLayout<Sidebar: View, Content: View, Detail: View>: View {
  let sidebar: Sidebar
  let content: Content
  let detail: Detail
  @Environment(\.colorScheme) private var scheme
  init(@ViewBuilder sidebar: () -> Sidebar, @ViewBuilder content: () -> Content,
       @ViewBuilder detail: () -> Detail) {
    self.sidebar = sidebar()
    self.content = content()
    self.detail = detail()
  }
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    HStack(spacing: 0) {
      sidebar.frame(width: 240).frame(maxHeight: .infinity)
      Rectangle().fill(p.separator).frame(width: 0.5)
      content.frame(width: 320).frame(maxHeight: .infinity)
      Rectangle().fill(p.separator).frame(width: 0.5)
      detail.frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}
struct NativeBottomNavigation: View {
  @Binding var module: NativeAppModule
  var titleTracking: [NativeAppModule: CGFloat] = [:]
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var size: CGFloat = 34
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    GeometryReader { geometry in
      Rectangle().fill(p.separator).frame(height: 0.5)
      HStack(spacing: 0) {
        ForEach(NativeAppModule.primary) { item in
          Button {
            module = item
          } label: {
            VStack(spacing: 5) {
              RecordSymbol(name: item.systemSymbol, size: 24)
                .foregroundStyle(module.root == item ? p.accent : p.secondary)
              RecordText(item.title, 10).fixedSize(horizontal: true, vertical: true)
            }.padding(.top, 10).frame(maxWidth: .infinity).frame(
              height: 49 + max(0, size - 34) * 0.42, alignment: .top
            ).contentShape(Rectangle())
          }.foregroundStyle(module.root == item ? p.accent : p.secondary)
            .accessibilityIdentifier("native.tab.\(item.rawValue)").accessibilityAddTraits(
              module.root == item ? .isSelected : [])
        }
      }.frame(width: max(0, geometry.size.width), alignment: .leading)
    }.frame(height: 49 + max(0, size - 34) * 0.42).background(
      p.surface.ignoresSafeArea(edges: .bottom)
    ).buttonStyle(.plain)
  }
}
struct NativePrimarySidebarNavigation: View {
  @Binding var module: NativeAppModule
  var onReselect: (NativeAppModule) -> Void = { _ in }
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 13) {
        RecordSymbol(name: "books.vertical", size: 25).foregroundStyle(p.accent).padding(.top, 3)
        RecordText("灵藏", 20, weight: .semibold)
      }.padding(.leading, 24).padding(.top, 22 * scale).frame(height: 91 * scale, alignment: .topLeading)
      ForEach(NativeAppModule.primary) { item in
        Button {
          if module == item { onReselect(item) }
          module = item
        } label: {
          HStack(alignment: .top, spacing: 15) {
            RecordSymbol(name: item.systemSymbol, size: 23).foregroundStyle(module.root == item ? p.accent : p.secondary)
            RecordText(item.title, 17, weight: module.root == item ? .semibold : .regular)
              .foregroundStyle(module.root == item ? p.accent : p.label)
            Spacer(minLength: 0)
          }.padding(.leading, 14).padding(.top, 9 * scale).padding(.bottom, 10 * scale)
            .frame(minHeight: 44 * scale, alignment: .topLeading)
            .background(module.root == item ? p.selection : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }.padding(.horizontal, 12).padding(.bottom, 8 * scale).accessibilityIdentifier("native.tab.\(item.rawValue)")
          .accessibilityAddTraits(module.root == item ? .isSelected : [])
      }
    }.foregroundStyle(p.label).buttonStyle(.plain)
  }
}
struct NativeLibrarySidebar: View {
  @Binding var module: NativeAppModule
  @ObservedObject var library: NativeLibraryModel
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var size: CGFloat = 34
  private var p: NativePalette { .init(dark: scheme == .dark) }
  private func expanded(_ height: CGFloat, _ font: CGFloat) -> CGFloat {
    height + max(0, size - 34) * font / 34 * 1.42
  }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        NativePrimarySidebarNavigation(module: $module) { item in
            if item == .library {
              library.selectCategory(nil)
              library.query.tag = nil
            }
        }
        if module == .library {
          NativeText("类型", size: 13).foregroundStyle(p.secondary).padding(.leading, 26).padding(
            .top, 24
          ).frame(height: expanded(59, 13), alignment: .topLeading)
          ForEach(LibraryTypes.values.indices, id: \.self) { index in
            let type = LibraryTypes.values[index]
            let selected = library.query.type == type && !library.favoritesOnly
            Button {
              library.selectCategory(type)
            } label: {
              NativeText(LibraryTypes.labels[index], size: 16, bold: selected).padding(.leading, 42)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 31 * size / 34, alignment: .top).contentShape(
                  Rectangle().inset(by: -6.5))
            }.foregroundStyle(selected ? p.accent : p.label)
              .background(alignment: .top) {
                if selected {
                  RoundedRectangle(cornerRadius: 12, style: .continuous).fill(p.selection).padding(
                    .horizontal, 12
                  ).frame(height: 38).offset(y: -9)
                }
              }
              .accessibilityIdentifier("library.category.\(type)")
              .accessibilityValue(
                "\(library.categories.types.first(where: { $0.value == type })?.count ?? 0) 份资料"
              )
              .accessibilityAddTraits(selected ? .isSelected : [])
          }
          Button {
            library.selectFavorites()
          } label: {
            HStack(alignment: .top, spacing: 18) {
              NativeGlyph(name: "bookmark", size: 20).foregroundStyle(p.accent)
              NativeText("我的收藏", size: 16, bold: library.favoritesOnly).padding(.top, 3)
            }.padding(.leading, 26).padding(.top, 19).frame(
              maxWidth: .infinity, alignment: .leading
            ).frame(height: expanded(77, 16), alignment: .top).contentShape(Rectangle())
          }.foregroundStyle(library.favoritesOnly ? p.accent : p.label)
            .background(alignment: .top) {
              if library.favoritesOnly {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(p.selection).frame(
                  height: 44
                ).padding(.horizontal, 12).padding(.top, 9)
              }
            }
            .accessibilityIdentifier("library.favorites")
          NativeText("主题", size: 13).foregroundStyle(p.secondary).padding(.leading, 26).frame(
            height: expanded(31, 13), alignment: .top)
          ForEach(library.categories.tags, id: \.value) { topic in
            Button {
              library.query.tag = topic.value
            } label: {
              NativeText(topic.value, size: 15, bold: library.query.tag == topic.value).padding(
                .leading, 42
              ).frame(maxWidth: .infinity, alignment: .leading).frame(
                height: 31 * size / 34, alignment: .top
              ).contentShape(Rectangle().inset(by: -6.5))
            }.foregroundStyle(library.query.tag == topic.value ? p.accent : p.secondary)
              .accessibilityIdentifier("library.topic.\(topic.value)").accessibilityValue(
                "\(topic.count) 份资料")
          }
        }
      }.padding(.bottom, 24)
    }.ignoresSafeArea(.container, edges: .top).background(p.paper.ignoresSafeArea()).overlay(
      alignment: .trailing
    ) {
      Rectangle().fill(p.separator).frame(width: 1).allowsHitTesting(false)
    }.buttonStyle(.plain)
  }
}
