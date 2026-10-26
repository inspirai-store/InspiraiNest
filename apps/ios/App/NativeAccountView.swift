import SwiftUI
import UIKit

/// Organizes existing destinations. No new account/settings system is introduced.
struct NativeAccountView: View {
  @EnvironmentObject private var app: AppModel
  @State private var destination: String?
  @Binding var module: NativeAppModule
  @ObservedObject var records: NativeRecordListModel
  var origin: String
  var paired: Bool
  var outboxPending: Int
  var deviceCount: Int
  var pair: () -> Void
  var showSync:(()->Void)?
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    GeometryReader { geometry in
      let tablet = UIDevice.current.userInterfaceIdiom == .pad && geometry.size.width >= 760
      HStack(spacing: 0) {
        if tablet { NativeRecordSidebar(model: records, module: $module).frame(width: 240) }
        VStack(alignment: .leading, spacing: 0) {
          RecordText("我的", tablet ? 28 : 34, weight: .bold, relativeTo: .largeTitle).padding(
            .top, tablet ? 25 : 67
          )
          .padding(.bottom, 29).accessibilityIdentifier("account.title")
          ScrollView {
            VStack(alignment: .leading, spacing: 0) {
              HStack(alignment: .top, spacing: 15) {
                RecordSymbol(name: "externaldrive.connected.to.line.below", size: 33)
                  .foregroundStyle(p.accent).padding(.top, 7)
                VStack(alignment: .leading, spacing: 0) {
                  RecordText(origin.isEmpty ? "资料空间" : "个人资料空间", 20, weight: .semibold)
                  if !origin.isEmpty {
                    RecordText(URL(string: origin)?.host ?? origin, 13).foregroundStyle(p.secondary)
                      .padding(.top, 7 * scale)
                  }
                  RecordText(paired ? "已连接" : "未连接", 12).foregroundStyle(
                    paired ? Color(hex: scheme == .dark ? 0x77BD92 : 0x2A7F51) : p.secondary)
                    .padding(.top, 9 * scale)
                }
                Spacer(minLength: 0)
              }.padding(.horizontal, 17).padding(.top, 15 * scale).padding(.bottom, 14 * scale)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(minHeight: 111 * scale, alignment: .topLeading).background(
                  p.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(p.separator, lineWidth: 0.5) }
              destination("新知",symbol:"sparkles",id:"learning") { destination="learning" }.disabled(app.plugins?.supports("learning") != true)
              destination("积木",symbol:"square.stack.3d.up",id:"blocks") { destination="blocks" }.disabled(app.plugins?.supports("blocks") != true)
              destination("插件",symbol:"puzzlepiece",id:"plugins") { destination="plugins" }
              destination("帮助与隐私",symbol:"info.circle",id:"about") { destination="about" }
              destination(
                "记录同步", symbol: "arrow.triangle.2.circlepath", subtitle: syncSubtitle, id: "records"
              ) {
                if let showSync {showSync()} else {records.filter = .pending;module = .records}
              }.padding(.top, 38 * scale)
              destination("本机发件箱", symbol: "tray", subtitle: "\(outboxPending) 条待提交", id: "outbox")
              { module = .outbox }
              destination(
                "授权设备", symbol: "laptopcomputer.and.iphone", subtitle: "\(deviceCount) 台设备",
                id: "devices"
              ) { module = .devices }
              destination(
                "资料空间连接", symbol: "link", subtitle: paired ? "个人资料空间" : "未连接", id: "pairing",
                action: pair)
            }.padding(.bottom, 24)
          }
        }.padding(.horizontal, tablet ? 122 : 20).frame(
          maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }.safeAreaInset(edge: .bottom, spacing: 0) {
        if !tablet { NativeBottomNavigation(module: $module) }
      }
    }.sheet(isPresented: Binding(get: { destination != nil }, set: { if !$0 { destination = nil } })) {
      NavigationStack {
        Group {
          if destination == "learning" { LearningView() }
          else if destination == "blocks" { BlocksLibraryView() }
          else if destination == "about" { List {
            Text("灵藏 \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")")
            Link("使用帮助与联系支持",destination:URL(string:"https://library.inspirai.store/support")!)
            Link("隐私政策",destination:URL(string:"https://library.inspirai.store/privacy")!)
          }.navigationTitle("关于") }
          else { PluginSettingsView() }
        }
          .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { destination = nil } } }
      }.environmentObject(app)
    }.background(p.paper.ignoresSafeArea()).foregroundStyle(p.label).buttonStyle(.plain)
      .ignoresSafeArea(.container, edges: .top)
  }
  private var p: NativePalette { .init(dark: scheme == .dark) }
  private var syncSubtitle: String {
    let failed = records.snapshot.records.filter { $0.sync == .failed }.count
    return "\(records.count(.pending)) 条待同步" + (failed > 0 ? " · \(failed) 条失败" : "")
  }
  private func destination(
    _ title: String, symbol: String, subtitle: String = "", id: String, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(alignment: .top, spacing: 14) {
        RecordSymbol(name: symbol, size: 22).foregroundStyle(p.accent).padding(.top, 4)
        VStack(alignment: .leading, spacing: 5 * scale) {
          RecordText(title, 16)
          if !subtitle.isEmpty {RecordText(subtitle, 12).foregroundStyle(p.secondary)}
        }
        Spacer(minLength: 4)
        RecordSymbol(name: "chevron.right", size: 12).foregroundStyle(p.secondary).padding(.top, 7)
      }.padding(.horizontal, 16).padding(.vertical, 12 * scale).frame(
        maxWidth: .infinity, alignment: .leading
      )
      .frame(minHeight: 72 * scale).background(
        p.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }.padding(.bottom, 24 * scale).accessibilityIdentifier("account.\(id)")
  }
}
