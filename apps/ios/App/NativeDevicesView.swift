import SwiftUI
import UIKit

struct NativeDevicesView: View {
  @ObservedObject var model: NativeDevicesModel
  @Binding var module: NativeAppModule
  @ObservedObject var library: NativeLibraryModel
  var pair: () -> Void = {}
  var advanced: ((Device) -> AnyView)? = nil
  @Environment(\.colorScheme) private var scheme
  @Environment(\.scenePhase) private var scene
  @ScaledMetric private var scale: CGFloat = 1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { geo in
      let tablet = UIDevice.current.userInterfaceIdiom == .pad && geo.size.width >= 760
      ZStack {
        Group {
        if tablet {
          NativeThreeColumnLayout {
            NativeLibrarySidebar(module: $module, library: library)

              .toolbar(.hidden, for: .navigationBar)
          } content: {
            list(tablet: true).toolbar(.hidden, for: .navigationBar)
          } detail: {
            NavigationStack {
              if let device = model.selected { detail(device, tablet: true) }
              else { stateView.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity).background(p.surface) }
            }.toolbar(.hidden, for: .navigationBar)
          }
        } else {
          NavigationStack(path: $model.path) {
            list(tablet: false).toolbar(.hidden, for: .navigationBar)
              .safeAreaInset(edge: .bottom, spacing: 0) { NativeBottomNavigation(module: $module) }
              .navigationDestination(for: String.self) { id in
                if let device = model.device(id) { detail(device, tablet: false) }
                else { stateView.toolbar(.hidden, for: .navigationBar) }
              }
          }
        }
        }.allowsHitTesting(model.confirmation == nil).accessibilityHidden(model.confirmation != nil)
        if let intent = model.confirmation { confirmation(intent) }
      }
    }.background(p.paper.ignoresSafeArea()).foregroundStyle(p.label).tint(p.accent).buttonStyle(.plain)
      .task(id: scene) { if scene == .active { await model.reload() } }
      .onChange(of: scene) { phase in if phase != .active { model.confirmation = nil } }
      .onChange(of: module) { _ in model.confirmation = nil }
  }
  private func list(tablet: Bool) -> some View {
    GeometryReader { geo in
      VStack(spacing: 0) {
        ZStack(alignment: .topLeading) {
          NativeText("设备", size: tablet ? 24 : 34, bold: true).padding(.leading, 20)
            .padding(.top, tablet ? 24 : 72).accessibilityIdentifier("devices.title")
          HStack { Spacer(); Button(action: pair) {
            NativeGlyph(name: "qr").foregroundStyle(p.accent).frame(width: 44, height: 44).contentShape(Rectangle())
          }.padding(.trailing, tablet ? 8 : 10).padding(.top, tablet ? 17 : 67)
            .accessibilityLabel("连接资料库").accessibilityIdentifier("devices.connect") }
        }.frame(height: tablet ? 70 : 126, alignment: .topLeading)
        ScrollView {
          if let me = model.me {
            VStack(alignment: .leading, spacing: 0) {
              NativeText("当前设备", size: 14).foregroundStyle(p.secondary).padding(.leading, model.others.isEmpty && !tablet ? 20 : 16)
                .frame(height: 29 * scale, alignment: .topLeading)
              row(me, current: true, tablet: tablet)
                .frame(minHeight: (model.others.isEmpty ? (tablet ? 113 : 100) : 95) * scale, alignment: .top)
              NativeText("已授权设备", size: 14).foregroundStyle(p.secondary).padding(.leading, model.others.isEmpty && !tablet ? 20 : 16)
                .frame(height: 31 * scale, alignment: .topLeading)
              ForEach(model.others) { row($0, current: false, tablet: tablet) }
              if model.others.isEmpty {
                if model.hasLoaded { empty(tablet: tablet).padding(.top, tablet ? 51 : 56) }
                else if !tablet { stateView.padding(.top, 90) }
              }
              if model.notice != nil && !tablet { notice.padding(.top, 16).padding(.horizontal, 20) }
            }.padding(.top, tablet ? 12 : 14).padding(.bottom, 110)
          } else if !tablet { stateView.padding(.top, 130) }
          else if model.phase == .loading { ProgressView().padding(.top, 130).accessibilityIdentifier("devices.list.loading") }
        }.refreshable { await model.reload() }.accessibilityIdentifier("devices.list.scroll")
          .padding(.bottom, !tablet && model.me != nil && !model.others.isEmpty
            ? 50 + max(48, 17 * 1.42 * scale + 22) + 16 : 0)
      }
      if !tablet && model.me != nil {
        VStack { Spacer(); action("移除本机登录", kind: .destructive, enabled: !model.busy) {
          model.requestForget(tablet: false)
        }.padding(.horizontal, 20).padding(.bottom, 50).accessibilityIdentifier("devices.forget") }
      }
    }.background(tablet ? p.surface : p.paper).ignoresSafeArea(.container, edges: .top)
  }
  private func row(_ device: Device, current: Bool, tablet: Bool) -> some View {
    Button {
      model.open(device.id, tablet: tablet)
    } label: {
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .top, spacing: 12) {
          NativeGlyph(name: "devices").foregroundStyle(current ? p.accent : p.secondary)
            .padding(.top, current ? 14 : 15)
          VStack(alignment: .leading, spacing: 0) {
            NativeText(device.nativeDeviceName, size: 17, bold: true, trackingCorrection: device.nativeDeviceName == "我的 iPhone" ? 1.5 : 0)
              .fixedSize(horizontal: scale <= 1.01, vertical: true)
              .padding(.top, current ? 13 : 15)
              .accessibilityIdentifier("devices.name.\(device.id)")
            NativeText(current ? "本机 · " + device.nativeDeviceRole : device.nativeDeviceRole + " · " + device.nativeDeviceStatus, size: 14)
              .foregroundStyle(p.secondary).padding(.top, 31 - 17 * 1.42)
          }
          Spacer(minLength: 0)
        }.padding(.leading, current && model.others.isEmpty && !tablet ? 20 : 16).padding(.trailing, 30)
      }.frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: (current ? 78 : 84) * scale, alignment: .topLeading)
        .background {
          if tablet && model.selected?.id == device.id {
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(p.selection)
              .padding(.horizontal, 8).padding(.bottom, current ? 0 : 5)
          }
        }
        .overlay(alignment: .topTrailing) {
          if !current { NativeGlyph(name: "chevron", size: 18).foregroundStyle(p.secondary).padding(.trailing, 12).padding(.top, 32 * scale) }
        }
        .overlay(alignment: .bottom) {
          if !current { Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 52).padding(.trailing, 16).offset(y: 1) }
        }.contentShape(Rectangle())
    }.disabled(model.busy).accessibilityIdentifier("devices.item.\(device.id)")
      .accessibilityAddTraits(tablet && model.selected?.id == device.id ? .isSelected : [])
  }
  private func empty(tablet: Bool) -> some View {
    VStack(spacing: 0) {
      NativeGlyph(name: "devices", size: 48, scalesLineWidths: false).foregroundStyle(p.secondary)
      NativeText("暂无其他授权设备", size: tablet ? 15 : 20, bold: !tablet, baselineAdjustment: tablet ? 0 : -1)
        .fixedSize(horizontal: scale <= 1.01, vertical: true).foregroundStyle(tablet ? p.secondary : p.label)
        .padding(.top, tablet ? 26 : 28).accessibilityIdentifier("devices.empty")
    }.frame(maxWidth: .infinity)
  }
  private func detail(_ device: Device, tablet: Bool) -> some View {
    let current = device.id == model.me?.id
    return GeometryReader { geo in
      VStack(spacing: 0) {
        if !tablet { p.paper.frame(height: 44) }
        navigation(tablet: tablet)
        ScrollView {
          VStack(spacing: 0) {
            NativeGlyph(name: "devices", size: 60, scalesLineWidths: false).foregroundStyle(p.accent).padding(.top, 54)
            NativeText(device.nativeDeviceName, size: 26, bold: true).multilineTextAlignment(.center)
              .fixedSize(horizontal: scale <= 1.01, vertical: true).padding(.top, 25)
              .accessibilityIdentifier("devices.detail.name")
            NativeStatusLabel(current ? "本机" : device.nativeDeviceStatus, tone: device.revokedAt == nil ? .accent : .secondary, badge: true)
              .padding(.top, 43 - 26 * 1.42).offset(x: -4).accessibilityIdentifier("devices.detail.badge")
            VStack(spacing: 0) {
              field("角色", device.nativeDeviceRole)
              field("服务器", model.host)
              field("状态", device.nativeDeviceStatus)
            }.padding(.bottom, 2).background(tablet ? p.paper : p.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
              .padding(.horizontal, 20).padding(.top, 69 - 24)
            if device.role == "worker" && device.revokedAt == nil {
              NativeText("可用 Agent", size: 14).foregroundStyle(p.secondary)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.top, 31)
              VStack(spacing: 0) {
                if device.nativeAgents.isEmpty { field("暂无可用 Agent", "") }
                ForEach(device.nativeAgents, id: \.self) { field($0, "") }
              }.background(tablet ? p.paper : p.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.horizontal, 20).padding(.top, 30 - 14 * 1.42)
            }
            if let advanced {advanced(device).padding(20)}
            if model.notice != nil { notice.padding(.horizontal, 20).padding(.top, 20) }
          }.frame(maxWidth: .infinity).padding(.bottom, 20)
        }.refreshable { await model.reload() }.accessibilityIdentifier("devices.detail.scroll")
        action(model.busy ? "处理中" : current ? "移除本机登录" : "撤销设备", kind: .destructive,
          enabled: current ? !model.busy : model.canRevoke(device.id)) {
          if current { model.requestForget(tablet: tablet) } else { model.requestRevoke(device.id) }
        }.padding(.horizontal, 20).padding(.bottom, 34).accessibilityIdentifier(current ? "devices.forget" : "devices.revoke")
      }.background(tablet ? p.surface : p.paper)
    }.ignoresSafeArea(.container, edges: tablet ? [.top, .bottom] : .top).toolbar(.hidden, for: .navigationBar)
  }
  private func navigation(tablet: Bool) -> some View {
    ZStack(alignment: .top) {
      if !tablet { HStack { Button {
        model.path = []
      } label: { HStack(spacing: 0) { NativeGlyph(name: "back").frame(width: 24); NativeText("设备", size: 16).frame(height: scale > 1.001 ? 16 * 1.42 * scale : 24).offset(y: 2.2) }.frame(minHeight: 44) }
        .foregroundStyle(p.accent).padding(.leading, 14)
        .accessibilityIdentifier("devices.back"); Spacer() } }
      NativeText("设备详情", size: 17, bold: true, baselineAdjustment: tablet ? -3 : 0)
        .fixedSize(horizontal: scale <= 1.001, vertical: true)
        .padding(.horizontal, scale > 1.001 ? 20 : 0)
        .padding(.top, scale > 1.001 && !tablet ? max(44, 16 * 1.42 * scale) + 12 : 13)
        .accessibilityIdentifier("devices.detail.title")
    }.frame(height: scale > 1.001
      ? (!tablet ? max(44, 16 * 1.42 * scale) + 12 : 13) + 17 * 1.42 * scale + 12
      : 44).frame(maxWidth: .infinity).background(p.paper)
      .overlay(alignment: .bottom) { Rectangle().fill(p.separator).frame(height: 1) }
  }
  @ViewBuilder private func field(_ label: String, _ value: String) -> some View {
    if scale > 1.001 {
      VStack(alignment: .leading, spacing: 10) {
        NativeText(label, size: 16)
        NativeText(value, size: 15).foregroundStyle(p.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
        .overlay(alignment: .bottom) { Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 16) }
    } else { NativeFormRow(label: label) {
      NativeText(value, size: 15, trackingCorrection: label == "服务器" ? 3 : 0)
        .foregroundStyle(p.secondary).fixedSize(horizontal: scale <= 1.01, vertical: true)
        .padding(.top, 19.5)
    } }
  }
  @ViewBuilder private var stateView: some View {
    VStack(spacing: 24) {
      if model.phase == .loading { ProgressView().accessibilityIdentifier("devices.loading") }
      else {
        NativeText(model.phase == .expired ? "授权已失效" : model.phase == .unpaired ? "尚未配对" : model.phase == .offline ? "离线" : "设备暂时无法读取", size: 20, bold: true)
          .accessibilityIdentifier("devices.state")
        action(model.phase == .expired ? "重新配对" : model.phase == .unpaired ? "连接资料库" : "重试") {
          if [.unpaired, .expired].contains(model.phase) { pair() } else { Task { await model.reload() } }
        }.frame(maxWidth: 300).accessibilityIdentifier("devices.state.action")
      }
    }.frame(maxWidth: .infinity)
  }
  private var notice: some View {
    VStack(spacing: 12) {
      if let notice = model.notice { NativeText(notice, size: 14).foregroundStyle(model.offline ? p.secondary : p.destructive).accessibilityIdentifier("devices.notice") }
      if !model.offline { Button("重试") { Task { await model.reload() } }.accessibilityIdentifier("devices.retry") }
    }
  }
  private func action(_ title: String, kind: NativeButton.Kind = .primary, enabled: Bool = true, perform: @escaping () -> Void) -> some View {
    NativeButton(title: title, kind: kind, enabled: enabled, action: perform)
  }
  @ViewBuilder private func confirmation(_ intent: NativeDevicesConfirmation) -> some View {
    let forgetting = intent == .forget
    let device: Device? = { if case .revoke(let id) = intent { return model.device(id) }; return model.me }()
    if let device {
      NativeConfirmation(title: forgetting ? "移除本机登录？" : "撤销" + device.nativeDeviceName + "？",
        bodyText: forgetting ? "本机分享原文保留" : device.nativeDeviceRole,
        actionTitle: forgetting ? "移除登录" : "撤销设备", destructive: true,
        titleTrackingCorrection: device.nativeDeviceName == "我的 Mac" ? 1 : 0,
        confirm: { Task { await model.confirm() } }, cancel: { model.confirmation = nil })
    }
  }
}
