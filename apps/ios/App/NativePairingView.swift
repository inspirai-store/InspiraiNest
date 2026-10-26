import PhotosUI
import SwiftUI
import UIKit

struct NativePairingHost: View {
  @StateObject private var model: NativePairingModel
  @State private var cameraTheme: ColorScheme
  @Environment(\.colorScheme) private var scheme
  @Binding var module: NativeAppModule
  let library: NativeLibraryModel
  let close: () -> Void
  init(
    app: AppModel, module: Binding<NativeAppModule>, library: NativeLibraryModel,
    appearance: ColorScheme, close: @escaping () -> Void
  ) {
    self._module = module
    self.library = library
    self.close = close
    _cameraTheme = State(initialValue: appearance)
    _model = StateObject(
      wrappedValue: NativePairingModel(
        name: UIDevice.current.userInterfaceIdiom == .pad ? "我的 iPad" : "我的 iPhone",
        dependencies: .live(app: app), watchConnectivity: true))
  }
  var body: some View {
    NativePairingShell(
      model: model, module: $module, library: library, close: close, cameraTheme: cameraTheme)
      .onChange(of: model.completed) { completed in if completed { close() } }
      .onChange(of: scheme) { value in
        if model.route == .manual && model.scanned == nil { cameraTheme = value }
      }
  }
}

struct NativePairingShell: View {
  @ObservedObject var model: NativePairingModel
  @Binding var module: NativeAppModule
  let library: NativeLibraryModel
  let close: () -> Void
  @Environment(\.colorScheme) private var scheme
  @Environment(\.scenePhase) private var scene
  @State private var photo: PhotosPickerItem?
  @State private var photoTask: Task<Void, Never>?
  var reviewCamera = false
  var reviewDenied = false
  var cameraTheme: ColorScheme = .light
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { geometry in
      let tablet = UIDevice.current.userInterfaceIdiom == .pad && geometry.size.width >= 760
      ZStack {
        HStack(spacing: 0) {
          if tablet {
            NativeLibrarySidebar(module: $module, library: library).frame(width: 240)
              .disabled(model.busy)
            VStack(alignment: .leading, spacing: 0) {
              NativeText("设备", size: 24, bold: true).padding(.leading, 20).padding(.top, 24)
              Spacer()
            }.frame(width: 320).frame(maxHeight: .infinity).background(p.surface)
              .overlay(alignment: .topTrailing) {
                Button { model.openScanner() } label: {
                  NativeGlyph(name: "qr").frame(width: 44, height: 44)
                }.foregroundStyle(p.accent).disabled(model.busy)
                  .padding(.trailing, 8).padding(.top, 17)
                  .accessibilityLabel("扫码连接").accessibilityIdentifier("pairing.sidebar.scan")
              }
            Rectangle().fill(p.separator).frame(width: 1)
          }
          NativePairingManualView(model: model, tablet: tablet, close: close)
        }.allowsHitTesting(model.scanned == nil).accessibilityHidden(model.scanned != nil)
        if model.route == .scanner {
          NativePairingCameraScreen(
            model: model, tablet: tablet, preview: reviewCamera, denied: reviewDenied,
            appTheme: cameraTheme)
        }
        if model.scanned != nil { NativePairingConfirmation(model: model, tablet: tablet) }
      }.frame(width: geometry.size.width, height: geometry.size.height)
    }.ignoresSafeArea(.container, edges: [.top, .bottom])
      .background(p.paper).foregroundStyle(p.label).tint(p.accent).buttonStyle(.plain)
      .preferredColorScheme(
        model.route == .scanner && !model.photos ? .dark : (reviewCamera ? cameraTheme : nil))
      .photosPicker(
        isPresented: $model.photos, selection: $photo, matching: .images,
        preferredItemEncoding: .current
      )
      .onChange(of: photo) { item in
        guard let item else { return }
        photoTask?.cancel()
        photoTask = Task {
          do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
              throw NativePairingFailure.invalidImage
            }
            guard !Task.isCancelled else { return }
            await model.recognize(data)
          } catch { if !Task.isCancelled { model.photoFailed() } }
          if !Task.isCancelled { photo = nil }
        }
      }
      .onChange(of: scene) { value in
        if value == .background {
          photoTask?.cancel()
          photo = nil
          model.clearTransient()
        }
      }
      .onDisappear {
        photoTask?.cancel()
        model.clearTransient()
      }
  }
}

private struct NativePairingManualView: View {
  @ObservedObject var model: NativePairingModel
  let tablet: Bool
  let close: () -> Void
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    VStack(spacing: 0) {
      if !tablet { p.paper.frame(height: 44) }
      ZStack(alignment: .top) {
        if !tablet {
          HStack {
            Button {
              model.clearTransient()
              close()
            } label: {
              HStack(spacing: 0) {
                NativeGlyph(name: "back").frame(width: 24)
                NativeText("设备", size: 16).frame(height: scale > 1.001 ? 16 * 1.42 * scale : 24).offset(y: 2.2)
              }.frame(minHeight: 44).contentShape(Rectangle())
            }.disabled(model.busy).accessibilityIdentifier("pairing.back")
            Spacer()
          }.padding(.leading, 14).foregroundStyle(p.accent)
        }
        NativeText("连接资料库", size: 17, bold: true, baselineAdjustment: tablet ? -3 : 0)
          .fixedSize(horizontal: scale <= 1.01, vertical: true)
          .padding(.horizontal, scale > 1.001 ? 20 : 0)
          .padding(.top, scale > 1.001 && !tablet ? max(44, 16 * 1.42 * scale) + 12 : 13)
          .frame(maxWidth: .infinity).allowsHitTesting(false)
          .accessibilityIdentifier("pairing.title")
      }.frame(height: scale > 1.001
        ? (!tablet ? max(44, 16 * 1.42 * scale) + 12 : 13) + 17 * 1.42 * scale + 12
        : 44).background(p.paper)
        .overlay(alignment: .bottom) { Rectangle().fill(p.separator).frame(height: 1) }
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Button {
            model.openScanner()
          } label: {
            HStack(alignment: .top, spacing: 13) {
              NativeGlyph(name: "qr").frame(width: 24)
              NativeText("扫码连接", size: 17).padding(.top, 2)
              Spacer(minLength: 0)
              NativeGlyph(name: "chevron", size: 18).foregroundStyle(p.secondary).padding(.top, 3)
            }.padding(.leading, 16).padding(.trailing, 11).padding(.top, 20)
              .frame(minHeight: max(64, 24 * scale + 40), alignment: .top)
              .foregroundStyle(p.accent)
              .background(
                tablet ? p.paper : p.surface,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
          }.disabled(model.busy).accessibilityIdentifier("pairing.scan")
          VStack(alignment: .leading, spacing: 0) {
            if let notice = model.notice {
              NativeText(notice, size: 16, bold: true).foregroundStyle(p.destructive)
                .accessibilityIdentifier("pairing.error").padding(.leading, 2)
                .padding(.bottom, 41 - 16 * 1.42)
            }
            NativeTextInput(label: "服务器地址", text: editing($model.server), paper: tablet)
              .keyboardType(.URL).submitLabel(.next)
            NativeTextInput(label: "设备名称", text: editing($model.name), paper: tablet)
              .padding(.top, 115 - (14 * 1.42 + 9 + 56)).submitLabel(.next)
            if model.challenge {
              NativeTextInput(label: model.recovery ? "恢复码":"验证码", text: $model.factor, secure: true, paper: tablet)
                .padding(.top, 24).onSubmit { Task { await model.submitManual() } }
              Button(model.recovery ? "使用验证码":"使用恢复码") { model.recovery.toggle();model.factor="" }.padding(.top, 16)
            } else {
              NativeTextInput(label: "登录密码或配对码", text: editing($model.key), secure: true, paper: tablet)
                .padding(.top, 115 - (14 * 1.42 + 9 + 56)).submitLabel(.go)
                .onSubmit { Task { await model.submitManual() } }
            }
          }.padding(.top, 34).disabled(model.busy)
          NativeButton(
            title: model.completed ? "已连接" : "配对并登录",
            enabled: model.canPair || model.scanned != nil, busy: model.busy
          ) {
            Task { await model.submitManual() }
          }.padding(.top, 36.12).accessibilityIdentifier("pairing.submit")
          if model.notice != nil {
            Button {
              model.openScanner()
            } label: {
              NativeText("重新扫码", size: 16)
                .fixedSize(horizontal: scale <= 1.01, vertical: true)
                .frame(maxWidth: .infinity).padding(.top, 29)
            }.foregroundStyle(p.accent).disabled(model.busy).accessibilityIdentifier(
              "pairing.rescan")
          }
        }.padding(.horizontal, 20).padding(.top, 40).padding(.bottom, 50)
      }.accessibilityIdentifier("pairing.form")
    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(tablet ? p.surface : p.paper)
  }
  private func editing(_ binding: Binding<String>) -> Binding<String> {
    .init(
      get: { binding.wrappedValue },
      set: {
        binding.wrappedValue = $0
        model.edit()
      })
  }
}

private struct NativePairingConfirmation: View {
  @ObservedObject var model: NativePairingModel
  let tablet: Bool
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { geometry in
      Color.black.opacity(p.dark ? 0.44 : 0.25).ignoresSafeArea()
      ScrollView {
        VStack(spacing: 0) {
          NativeText("确认配对", size: 21, bold: true)
            .fixedSize(horizontal: scale <= 1.01, vertical: true).padding(.top, 30)
            .accessibilityIdentifier("pairing.confirm.title")
          VStack(spacing: 0) {
            NativeFormRow(label: "服务器") {
              NativeText(
                (try? ServerOrigin(model.scanned?.server ?? ""))?.value.replacingOccurrences(
                  of: "https://", with: "") ?? "", size: 15, trackingCorrection: 3
              ).foregroundStyle(p.secondary)
                .fixedSize(horizontal: scale <= 1.01, vertical: true).padding(.top, 19.5)
            }
            .accessibilityIdentifier("pairing.confirm.server")
            NativeFormRow(label: "设备名称") {
              NativeInlineInput(label: "设备名称", text: $model.name)
                .padding(.top, tablet ? 21 : 19.5)
                .disabled(model.busy)
                .accessibilityIdentifier("pairing.confirm.name")
            }
          }.padding(.horizontal, 8).padding(.top, 84 - 30 - 21 * 1.42)
          NativeButton(title: "确认配对", enabled: model.canConfirm, busy: model.busy) {
            Task { await model.confirm() }
          }.padding(.horizontal, 20).padding(.top, 224 - 192)
            .accessibilityIdentifier("pairing.confirm.accept")
          Button {
            model.cancelConfirmation()
          } label: {
            NativeText("取消", size: 16)
              .fixedSize(horizontal: scale <= 1.01, vertical: true)
              .frame(maxWidth: .infinity).frame(
              minHeight: 44, alignment: .top)
          }.foregroundStyle(p.accent).padding(.top, 27).disabled(model.busy)
            .accessibilityIdentifier("pairing.confirm.cancel")
        }.frame(maxWidth: .infinity).frame(minHeight: 360, alignment: .top)
      }.frame(
        width: min(tablet ? 640 : 353, geometry.size.width - 40),
        height: min(360 * scale, geometry.size.height - 80)
      )
      .background(p.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
      .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
      .accessibilityAddTraits(.isModal)
    }
  }
}

struct NativePairingCameraScreen: View {
  @ObservedObject var model: NativePairingModel
  let tablet: Bool
  var preview = false
  var denied = false
  var appTheme: ColorScheme = .light
  @State private var unavailable = false
  @State private var cameraActive = true
  @Environment(\.scenePhase) private var scene
  @Environment(\.openURL) private var openURL
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .top) {
        Color(red: 16 / 255, green: 16 / 255, blue: 16 / 255)
        if !preview && !denied && !unavailable {
          NativePairingCapture(
            active: cameraActive && !model.photos && !model.recognizing && scene == .active,
            onCode: model.accept, onUnavailable: { unavailable = true })
        }
        HStack(alignment: .top) {
          Button {
            model.manual()
          } label: {
            NativeText("关闭", size: 17)
              .fixedSize(horizontal: scale <= 1.01, vertical: true)
              .frame(minHeight: 44, alignment: .top)
          }
          .accessibilityIdentifier("pairing.camera.close")
          Spacer()
          Button {
            model.photos = true
          } label: {
            NativeText("相册", size: 17)
              .fixedSize(horizontal: scale <= 1.01, vertical: true)
              .frame(minHeight: 44, alignment: .top)
          }
          .disabled(model.recognizing).accessibilityIdentifier("pairing.camera.photos")
        }.padding(.horizontal, 24).padding(.top, tablet ? 30 : 60)
        NativeText("扫码连接", size: 17, bold: true)
          .fixedSize(horizontal: scale <= 1.01, vertical: true)
          .padding(.top, tablet ? 30 : 60).allowsHitTesting(
          false)
        if denied || unavailable {
          VStack(spacing: 0) {
            NativePairingCameraGlyph().stroke(lineWidth: 4.2).frame(width: 56, height: 56)
              .overlay { NativePairingCameraNeck().stroke(lineWidth: 1.8) }
              .foregroundStyle(
                Color(red: 171 / 255, green: 169 / 255, blue: 162 / 255)
              )
              .padding(.bottom, 29)
            NativeText("相机不可用", size: 22, bold: true)
              .fixedSize(horizontal: scale <= 1.01, vertical: true)
              .accessibilityIdentifier("pairing.camera.unavailable").padding(
                .bottom, 61 - 22 * 1.42)
            NativeButton(title: "打开设置") {
              if let url = URL(string: UIApplication.openSettingsURLString) {
                openURL(url)
              }
            }.environment(\.colorScheme, appTheme).frame(width: min(270, geometry.size.width - 40))
              .accessibilityIdentifier(
                "pairing.camera.settings")
            NativeButton(title: "从相册识别", kind: .secondary) { model.photos = true }
              .environment(\.colorScheme, appTheme)
              .frame(width: min(270, geometry.size.width - 40)).padding(.top, 20)
              .accessibilityIdentifier("pairing.camera.photo-recovery")
            Button {
              model.manual()
            } label: {
              NativeText("手动输入", size: 17)
                .fixedSize(horizontal: scale <= 1.01, vertical: true)
                .frame(minHeight: 44, alignment: .top)
            }
            .foregroundStyle(Color(red: 242 / 255, green: 163 / 255, blue: 58 / 255)).padding(
              .top, 33
            )
            .accessibilityIdentifier("pairing.camera.manual")
          }.frame(height: 338, alignment: .top).position(
            x: geometry.size.width / 2, y: geometry.size.height / 2 + 34)
        } else {
          let side = min(tablet ? 340.0 : 260.0, geometry.size.width - 90)
          NativePairingScanFrame().stroke(.white, lineWidth: 3)
            .frame(width: side, height: side)
            .background {
              if preview {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                  .fill(Color(red: 37 / 255, green: 38 / 255, blue: 35 / 255))
                  .frame(width: side + 36, height: side + 36)
              }
            }.position(x: geometry.size.width / 2, y: geometry.size.height / 2 - 25)
            .accessibilityLabel("二维码取景框")
          Button {
            model.manual()
          } label: {
            NativeText("手动输入", size: 17)
              .fixedSize(horizontal: scale <= 1.01, vertical: true)
              .frame(minHeight: 44, alignment: .top)
          }
          .position(x: geometry.size.width / 2, y: geometry.size.height - 115 + 22)
          .accessibilityIdentifier("pairing.camera.manual")
        }
        if model.recognizing { ProgressView().position(x: geometry.size.width / 2, y: 140) }
        if let notice = model.notice {
          NativeText(notice, size: 16).foregroundStyle(.white)
            .frame(width: geometry.size.width - 48).position(
              x: geometry.size.width / 2, y: 154 * scale
            )
            .accessibilityIdentifier("pairing.camera.error")
        }
      }.foregroundStyle(.white)
    }.background(Color.black).ignoresSafeArea()
      .environment(\.colorScheme, .dark)
      .onAppear { cameraActive = true }
      .onDisappear { cameraActive = false }
  }
}

private struct NativePairingScanFrame: Shape {
  func path(in rect: CGRect) -> Path {
    var p = Path()
    for (x, y, dx, dy) in [
      (0.0, 0.0, 1.0, 1.0), (rect.width, 0.0, -1.0, 1.0), (0.0, rect.height, 1.0, -1.0),
      (rect.width, rect.height, -1.0, -1.0),
    ] {
      p.move(to: CGPoint(x: x + dx * 38, y: y))
      p.addLine(to: CGPoint(x: x, y: y))
      p.addLine(to: CGPoint(x: x, y: y + dy * 38))
    }
    return p
  }
}

private struct NativePairingCameraGlyph: Shape {
  func path(in rect: CGRect) -> Path {
    let k = rect.width / 24
    // The camera outline is inset because native strokes are centered on
    // their paths; the reference rectangle draws its border inside the box.
    var p = Path(
      roundedRect: CGRect(x: 2 * k + 2, y: 6 * k + 2, width: 20 * k - 4, height: 15 * k - 4),
      cornerRadius: 3 * k - 2)
    p.addEllipse(in: CGRect(x: 8 * k + 2, y: 10 * k + 2, width: 8 * k - 4, height: 8 * k - 4))
    return p
  }
}

private struct NativePairingCameraNeck: Shape {
  func path(in rect: CGRect) -> Path {
    let k = rect.width / 24
    var p = Path()
    p.move(to: CGPoint(x: 7 * k, y: 6 * k))
    p.addLine(to: CGPoint(x: 9 * k, y: 3 * k))
    p.addLine(to: CGPoint(x: 15 * k, y: 3 * k))
    p.addLine(to: CGPoint(x: 17 * k, y: 6 * k))
    return p
  }
}
