import SwiftUI

enum NativeTone {
  case accent, secondary, destructive
  func color(_ palette: NativePalette) -> Color {
    switch self {
    case .accent: return palette.accent
    case .secondary: return palette.secondary
    case .destructive: return palette.destructive
    }
  }
}

struct NativeSearchField: View {
  @Binding var text: String
  var placeholder: String
  var dismissTrigger = 0
  var activeSecondary = false
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var size: CGFloat = 16
  @FocusState private var focused: Bool
  private var palette: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    HStack(spacing: 8) {
      NativeGlyph(name: "search", size: 20).foregroundStyle(palette.secondary)
      TextField("", text: $text)
        .font(.system(size: size)).foregroundStyle(activeSecondary && !focused && !text.isEmpty ? Color.clear : activeSecondary ? palette.secondary : palette.label)
        .tracking(NativeFontMetrics.inputTracking(text, size: size, baseSize: 16))
        .textInputAutocapitalization(.never).autocorrectionDisabled()
        .focused($focused).submitLabel(.search).accessibilityLabel(placeholder)
        .accessibilityIdentifier("component.search")
        .overlay(alignment: .topLeading) {
          if text.isEmpty || activeSecondary && !focused {
            NativeText(text.isEmpty ? placeholder : text, size: 16).foregroundStyle(palette.secondary)
              .offset(y: 3).allowsHitTesting(false).accessibilityHidden(true)
          }
        }
      Button {
        text = ""
      } label: {
        NativeGlyph(name: "close", size: 16).frame(width: 44, height: 44)
      }.foregroundStyle(palette.secondary).accessibilityLabel("清除搜索")
        .accessibilityIdentifier("component.search.clear")
        .opacity(text.isEmpty ? 0 : 1).disabled(text.isEmpty).accessibilityHidden(text.isEmpty)
    }.padding(.leading, 10)
      .frame(height: max(38, size * 1.42 + 14))
      .background(palette.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .onChange(of: dismissTrigger) { _ in focused = false }
  }
}

struct NativeSegmentedControl: View {
  let labels: [String]
  @Binding var selection: Int
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var size: CGFloat = 13
  private var palette: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    HStack(spacing: 0) {
      ForEach(labels.indices, id: \.self) { index in
        Button {
          selection = index
        } label: {
          NativeText(labels[index], size: 13, bold: selection == index)
            .fixedSize(horizontal: size <= 13.01, vertical: true)
            .frame(maxWidth: .infinity)
            .padding(.top, 7).padding(.bottom, 2)
            .frame(minHeight: max(28, size * 1.42 + 8), alignment: .top)
            .foregroundStyle(selection == index ? palette.label : palette.secondary)
            .background(
              selection == index ? palette.surface : .clear,
              in: RoundedRectangle(cornerRadius: 7, style: .continuous)
            )
            .padding(.horizontal, 2)
            .contentShape(Rectangle().inset(by: -6))
        }.buttonStyle(.plain).accessibilityIdentifier("component.segment.\(index)")
          .accessibilityAddTraits(selection == index ? .isSelected : [])
      }
    }.padding(.vertical, 2)
      .background(palette.well, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
  }
}

struct NativeMaterialRow: View {
  let title: String
  let summary: String
  let date: String
  let sourceType: String
  let state: String
  let favorite: Bool
  let selected: Bool
  let compactColumn: Bool
  let identifier: String
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  private var palette: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    NativeLibraryLayout(height: compactColumn ? 126 : 115, scale: scale) {
      NativeText(title, size: 17, bold: true, lineHeight: 23)
        .accessibilityIdentifier("review.library.title.\(identifier)")
      NativeText(summary, size: 14, lineHeight: 20, explicitLineWidth: compactColumn ? 248 : 321)
        .foregroundStyle(palette.secondary).accessibilityLabel(summary)
        .accessibilityIdentifier("review.library.summary.\(identifier)")
      NativeText("\(date)  ·  \(sourceType)", size: 12).foregroundStyle(palette.secondary)
        .accessibilityIdentifier("review.library.date.\(identifier)")
      NativeText(state, size: 12).foregroundStyle(
        state == "已归档" ? palette.accent : palette.secondary
      )
      .accessibilityIdentifier("review.library.state.\(identifier)")
    }.background {
      if selected {
        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.selection)
          .padding(.horizontal, 8).padding(.bottom, 5)
      }
    }.overlay(alignment: .topLeading) {
      NativeGlyph(name: "file").foregroundStyle(palette.accent)
        .padding(.leading, 16).padding(.top, 18)
    }.overlay(alignment: .topTrailing) {
      NativeGlyph(name: "bookmark", size: 18)
        .foregroundStyle(favorite ? palette.accent : palette.secondary)
        .padding(.trailing, 12).padding(.top, 19)
    }.overlay(alignment: .bottom) {
      Rectangle().fill(palette.separator).frame(height: 1)
        .padding(.leading, 52).padding(.trailing, 16).offset(y: 1)
    }.contentShape(Rectangle())
  }
}

struct NativeStatusLabel: View {
  let title: String
  var tone: NativeTone = .accent
  var badge = false
  @Environment(\.colorScheme) private var scheme
  private var palette: NativePalette { .init(dark: scheme == .dark) }
  init(_ title: String, tone: NativeTone = .accent, badge: Bool = false) {
    self.title = title
    self.tone = tone
    self.badge = badge
  }
  var body: some View {
    NativeText(title, size: badge ? 12 : 14, bold: badge)
      .fixedSize(horizontal: true, vertical: true).foregroundStyle(tone.color(palette))
      .padding(.horizontal, badge ? 9 : 0).padding(.top, badge ? 5 : 0)
      .padding(.bottom, badge ? 2 : 0)
      .background(
        badge ? (tone == .accent ? palette.selection : palette.well) : .clear,
        in: RoundedRectangle(cornerRadius: 7, style: .continuous)
      )
      .accessibilityLabel(title)
  }
}

struct NativeStatusRow: View {
  let title: String
  let status: String
  let date: String
  var tone: NativeTone = .accent
  var selected = false
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  private var palette: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    Group {
      if scale > 1.001 {
        VStack(alignment: .leading, spacing: 12) {
          NativeText(title, size: 17, bold: true, lineHeight: 23)
          NativeStatusLabel(status, tone: tone)
          NativeText(date, size: 12).foregroundStyle(palette.secondary)
        }.padding(.leading, 52).padding(.trailing, 16).padding(.vertical, 18)
      } else {
        GeometryReader { geometry in
          NativeText(title, size: 17, bold: true, lineHeight: 23)
            .frame(width: geometry.size.width - 80, alignment: .leading).offset(x: 52, y: 18)
          NativeStatusLabel(status, tone: tone).offset(x: 52, y: 65)
          NativeText(date, size: 12).foregroundStyle(palette.secondary).fixedSize()
            .frame(maxWidth: .infinity, alignment: .trailing).padding(.trailing, 16).offset(y: 66)
        }.frame(height: 105)
      }
    }.background {
      if selected {
        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.selection)
          .padding(.horizontal, 8).padding(.bottom, 5)
      }
    }.overlay(alignment: .topLeading) {
      NativeGlyph(name: "tasks").foregroundStyle(
        tone == .accent ? palette.accent : palette.secondary
      )
      .offset(x: 16, y: 18)
    }.overlay(alignment: .bottom) {
      Rectangle().fill(palette.separator).frame(height: 1).padding(.leading, 52).padding(
        .trailing, 16
      ).offset(y: 1)
    }.contentShape(Rectangle())
  }
}

struct NativeButton: View {
  enum Kind { case primary, secondary, destructive }
  let title: String
  var kind: Kind = .primary
  var enabled = true
  var busy = false
  var action: () -> Void
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var size: CGFloat = 17
  private var palette: NativePalette { .init(dark: scheme == .dark) }
  private var foreground: Color {
    if !enabled { return palette.secondary }
    if kind == .primary { return palette.dark ? palette.paper : palette.surface }
    return kind == .destructive ? palette.destructive : palette.accent
  }
  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        if busy { ProgressView().tint(foreground) }
        NativeText(title, size: 17, bold: true).multilineTextAlignment(.center)
          .fixedSize(horizontal: size <= 17.01, vertical: true)
      }.frame(maxWidth: .infinity).padding(.top, 14).padding(.bottom, 8)
        .frame(minHeight: max(48, size * 1.42 + 22), alignment: .top)
        .foregroundStyle(foreground)
        .background(
          enabled && kind == .primary ? palette.accent : palette.well,
          in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .contentShape(Rectangle())
    }.buttonStyle(NativePressStyle()).disabled(!enabled || busy)
      .accessibilityLabel(title)
  }
}

private struct NativePressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
  }
}

struct NativeFormGroup<Content: View>: View {
  @Environment(\.colorScheme) private var scheme
  var paper = true
  @ViewBuilder var content: () -> Content
  var body: some View {
    VStack(alignment: .leading, spacing: 0, content: content)
      .background(
        paper
          ? NativePalette(dark: scheme == .dark).paper
          : NativePalette(dark: scheme == .dark).surface,
        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

struct NativeFormRow<Accessory: View>: View {
  let label: String
  var value = ""
  var disclosure = false
  @ViewBuilder var accessory: () -> Accessory
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var size: CGFloat = 16
  private var palette: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      NativeText(label, size: 16).padding(.top, 19)
      Spacer(minLength: 8)
      if !value.isEmpty {
        NativeText(value, size: 15).foregroundStyle(palette.secondary).multilineTextAlignment(
          .trailing
        )
        .fixedSize(horizontal: size <= 16.01, vertical: true)
        .padding(.top, 19.5)
      }
      accessory()
      if disclosure {
        NativeGlyph(name: "chevron", size: 18, lineWidth: 1.8).foregroundStyle(palette.secondary)
          .padding(.top, 18).offset(x: 8)
      }
    }.contentShape(Rectangle()).padding(.horizontal, 16).frame(
      minHeight: max(54, size * 1.42 + 31), alignment: .top
    )
    .overlay(alignment: .bottom) {
      Rectangle().fill(palette.separator).frame(height: 1).padding(.leading, 16).offset(y: 1)
    }
  }
}

extension NativeFormRow where Accessory == EmptyView {
  init(label: String, value: String = "", disclosure: Bool = false) {
    self.label = label
    self.value = value
    self.disclosure = disclosure
    self.accessory = { EmptyView() }
  }
}

struct NativeToggle: View {
  @Binding var isOn: Bool
  let label: String
  @Environment(\.colorScheme) private var scheme
  var body: some View {
    let palette = NativePalette(dark: scheme == .dark)
    Toggle(label, isOn: $isOn).toggleStyle(NativePaperToggleStyle(palette: palette))
      .accessibilityLabel(label)
  }
}

private struct NativePaperToggleStyle: ToggleStyle {
  let palette: NativePalette
  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      RoundedRectangle(cornerRadius: 15, style: .continuous)
        .fill(configuration.isOn ? palette.accent : palette.well).frame(width: 50, height: 30)
        .overlay(alignment: configuration.isOn ? .trailing : .leading) {
          Circle().fill(.white).frame(width: 24, height: 24).padding(3)
        }.frame(width: 50, height: 44).contentShape(Rectangle())
    }.buttonStyle(.plain).accessibilityRepresentation {
      Toggle(isOn: configuration.$isOn) { configuration.label }
    }
  }
}

struct NativeTextInput: View {
  let label: String
  @Binding var text: String
  var secure = false
  var paper = false
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var size: CGFloat = 16
  @FocusState private var focused: Bool
  var body: some View {
    let palette = NativePalette(dark: scheme == .dark)
    VStack(alignment: .leading, spacing: 9) {
      NativeText(label, size: 14).foregroundStyle(palette.secondary).padding(.leading, 2)
      Group {
        if secure { SecureField(label, text: $text) } else { TextField(label, text: $text) }
      }.font(.system(size: size))
        .foregroundStyle(secure && !focused ? Color.clear : palette.label)
        .tracking(
          secure ? 0 : NativeFontMetrics.inputTracking(text, size: size, baseSize: 16)
        )
        .focused($focused)
        .offset(y: 0.5)
        .textInputAutocapitalization(.never).autocorrectionDisabled().padding(.horizontal, 16)
        .frame(minHeight: max(56, size * 1.42 + 28))
        .background(
          paper ? palette.paper : palette.surface,
          in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .overlay(alignment: .topLeading) {
          if secure && !focused {
            NativeText(String(repeating: "•", count: text.count), size: 16)
              .foregroundStyle(palette.label).padding(.leading, 16).padding(.top, 18.5)
              .allowsHitTesting(false).accessibilityHidden(true)
          }
        }
        .accessibilityIdentifier("component.input.\(label)")
    }
    .accessibilityElement(children: .contain).accessibilityIdentifier(
      "component.fieldGroup.\(label)")
  }
}

struct NativeInlineInput: View {
  let label: String
  @Binding var text: String
  @FocusState private var focused: Bool
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var size: CGFloat = 15
  var body: some View {
    TextField(label, text: $text).font(.system(size: size)).multilineTextAlignment(.trailing)
      .tracking(NativeFontMetrics.inputTracking(text, size: size, baseSize: 15))
      .foregroundStyle(focused ? NativePalette(dark: scheme == .dark).label : .clear)
      .focused($focused).textInputAutocapitalization(.never).autocorrectionDisabled()
      .overlay(alignment: .trailing) {
        if !focused {
          NativeText(text, size: 15).foregroundStyle(NativePalette(dark: scheme == .dark).secondary)
            .fixedSize(horizontal: size <= 15.01, vertical: true)
            .allowsHitTesting(false).accessibilityHidden(true)
        }
      }.accessibilityLabel(label).accessibilityIdentifier("component.inline.\(label)")
  }
}

struct NativeChoice: View {
  let title: String
  let selected: Bool
  let action: () -> Void
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var size: CGFloat = 12
  var body: some View {
    let palette = NativePalette(dark: scheme == .dark)
    Button(action: action) {
      NativeText(title, size: 12).multilineTextAlignment(.center)
        .fixedSize(horizontal: size <= 12.01, vertical: true)
        .frame(maxWidth: .infinity).padding(.top, 10).padding(.bottom, 6)
        .frame(minHeight: max(34, size * 1.42 + 16), alignment: .top)
        .foregroundStyle(selected ? palette.accent : palette.label)
        .background(
          selected ? palette.selection : palette.paper,
          in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .contentShape(Rectangle().inset(by: -5))
    }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
  }
}

struct NativeSelectableRow: View {
  let title: String
  let selected: Bool
  let action: () -> Void
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    let palette = NativePalette(dark: scheme == .dark)
    Button(action: action) {
      HStack(alignment: .top, spacing: 10) {
        NativeText(title, size: 17).padding(.top, 17)
        Spacer(minLength: 10)
        if selected {
          NativeGlyph(name: "check", size: 20).foregroundStyle(palette.accent).padding(.top, 17)
        }
      }.padding(.horizontal, 16).frame(minHeight: max(54, 17 * 1.42 * scale + 25), alignment: .top)
        .overlay(alignment: .bottom) {
          Rectangle().fill(palette.separator).frame(height: 1).padding(.leading, 16).offset(y: 1)
        }.contentShape(Rectangle())
    }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
  }
}

struct NativePanel<Content: View>: View {
  let title: String
  let height: CGFloat
  let dismiss: () -> Void
  @ViewBuilder var content: () -> Content
  @Environment(\.colorScheme) private var scheme
  @Environment(\.dynamicTypeSize) private var typeSize
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    let palette = NativePalette(dark: scheme == .dark)
    GeometryReader { geometry in
      let tablet = geometry.size.width >= 760
      let width = tablet ? min(640, geometry.size.width - 40) : geometry.size.width
      let panelHeight =
        typeSize.isAccessibilitySize
        ? min(geometry.size.height - 44, max(height, 720)) : min(height, geometry.size.height)
      let top =
        tablet ? (geometry.size.height - panelHeight) / 2 : geometry.size.height - panelHeight
      ZStack(alignment: .topLeading) {
        Color.black.opacity(palette.dark ? 0.44 : 0.25).ignoresSafeArea()
          .onTapGesture(perform: dismiss).accessibilityHidden(true)
        VStack(spacing: 0) {
          ZStack(alignment: .topLeading) {
            if !tablet {
              Capsule().fill(palette.well).frame(width: 36, height: 5)
                .frame(maxWidth: .infinity).padding(.top, 9)
            }
            NativeText(title, size: 17, bold: true).fixedSize(
              horizontal: !typeSize.isAccessibilitySize, vertical: true
            ).frame(maxWidth: .infinity)
              .padding(.horizontal, typeSize.isAccessibilitySize ? 20 : 0)
              .padding(.top, typeSize.isAccessibilitySize ? 46 + max(44, 16 * 1.42 * scale) : 30)
              .allowsHitTesting(false).accessibilityIdentifier("component.panel.title")
            HStack {
              Spacer()
              Button(action: dismiss) {
                NativeText("完成", size: 16).fixedSize().frame(
                  minWidth: 44, minHeight: 44, alignment: .topTrailing
                ).contentShape(Rectangle())
              }
              .foregroundStyle(palette.accent).padding(.trailing, 22).padding(.top, 30)
              .accessibilityIdentifier("component.panel.done")
            }
          }.frame(
            height: typeSize.isAccessibilitySize
              ? 62 + max(44, 16 * 1.42 * scale) + 17 * 1.42 * scale * 2 : 66, alignment: .top)
          Rectangle().fill(palette.separator).frame(height: 1)
          ScrollView {
            content().padding(.horizontal, 20).padding(.top, 19).padding(.bottom, 20)
          }
        }.frame(width: width, height: panelHeight)
          .background(palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
          .offset(x: (geometry.size.width - width) / 2, y: top)
          .accessibilityElement(children: .contain).accessibilityAddTraits(.isModal)
          .accessibilityAction(.escape, dismiss)
          .gesture(
            DragGesture(minimumDistance: 30).onEnded { if $0.translation.height > 90 { dismiss() } }
          )
      }
    }.ignoresSafeArea().foregroundStyle(palette.label)
  }
}

struct NativeConfirmation: View {
  let title: String
  let bodyText: String
  let actionTitle: String
  var cancelTitle = "取消"
  var destructive = false
  var titleTrackingCorrection: CGFloat = 0
  var scrollBodyWhenLarge = false
  let confirm: () -> Void
  let cancel: () -> Void
  @Environment(\.colorScheme) private var scheme
  @Environment(\.dynamicTypeSize) private var typeSize
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    let palette = NativePalette(dark: scheme == .dark)
    GeometryReader { geometry in
      let width: CGFloat = geometry.size.width >= 760 ? 340 : min(300, geometry.size.width - 40)
      let height: CGFloat = typeSize.isAccessibilitySize ? min(600, geometry.size.height - 60) : 220
      ZStack {
        Color.black.opacity(palette.dark ? 0.44 : 0.25).ignoresSafeArea()
          .onTapGesture {}.accessibilityHidden(true)
        VStack(spacing: 0) {
          NativeText(title, size: 18, bold: true, trackingCorrection: titleTrackingCorrection).multilineTextAlignment(.center)
            .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true).padding(
              .horizontal, 20
            )
            .padding(.top, 25)
            .accessibilityAddTraits(.isStaticText)
            .accessibilityIdentifier("component.confirm.title")
          if scrollBodyWhenLarge && typeSize.isAccessibilitySize {
            ScrollView { messageBody.foregroundStyle(palette.secondary) }
              .padding(.horizontal, 18).padding(.top, 67 - 25 - 18 * 1.42)
              .accessibilityIdentifier("component.confirm.message")
          } else {
            messageBody.foregroundStyle(palette.secondary)
              .padding(.horizontal, 18).padding(.top, 67 - 25 - 18 * 1.42)
            Spacer(minLength: 10)
          }
          Rectangle().fill(palette.separator).frame(height: 1)
          HStack(spacing: 0) {
            Button(action: cancel) {
              NativeText(cancelTitle, size: 17).multilineTextAlignment(.center)
                .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true)
                .frame(maxWidth: .infinity).frame(minHeight: 52).offset(y: 2).contentShape(
                  Rectangle())
            }
            .foregroundStyle(palette.accent).accessibilityIdentifier("component.confirm.cancel")
            Rectangle().fill(palette.separator).frame(width: 1)
            Button(action: confirm) {
              NativeText(actionTitle, size: 17, bold: true).multilineTextAlignment(.center)
                .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true)
                .frame(maxWidth: .infinity).frame(minHeight: 52).offset(y: 2).contentShape(
                  Rectangle())
            }
            .foregroundStyle(destructive ? palette.destructive : palette.accent)
            .accessibilityIdentifier("component.confirm.accept")
          }.frame(height: typeSize.isAccessibilitySize ? max(100, 17 * 1.42 * scale * 3 + 12) : 52)
        }.frame(width: width, height: height)
          .background(palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
          .accessibilityElement(children: .contain).accessibilityAddTraits(.isModal)
          .accessibilityAction(.escape, cancel)
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }.ignoresSafeArea().foregroundStyle(palette.label).buttonStyle(.plain)
  }
  private var messageBody: some View {
    VStack(spacing: 0) {
      ForEach(Array(bodyText.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
        NativeText(line, size: 14, lineHeight: 23,
          opticalTrailingPunctuation: scrollBodyWhenLarge).multilineTextAlignment(.center)
          .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true)
      }
    }
  }
}

struct NativeContentState: View {
  enum Kind { case loading, empty, failure }
  let kind: Kind
  let title: String
  let actionTitle: String
  let action: () -> Void
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    let palette = NativePalette(dark: scheme == .dark)
    VStack(spacing: 0) {
      if kind == .loading {
        ProgressView().tint(palette.secondary).frame(height: 24).accessibilityLabel("加载中")
        VStack(spacing: 23) {
          ForEach(0..<4) { _ in
            GeometryReader { geometry in
              RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.well)
              RoundedRectangle(cornerRadius: 6).fill(palette.separator)
                .frame(width: geometry.size.width - 70, height: 12).offset(x: 18, y: 18)
              RoundedRectangle(cornerRadius: 4).fill(palette.separator)
                .frame(width: geometry.size.width - 115, height: 9).offset(x: 18, y: 44)
            }.frame(height: 85).accessibilityHidden(true)
          }
        }.padding(.horizontal, 20).padding(.top, 21)
      } else {
        NativeGlyph(name: kind == .failure ? "alert" : "book", size: 48).foregroundStyle(
          palette.secondary
        )
        .padding(.top, 135)
        NativeText(title, size: 20, bold: true).multilineTextAlignment(.center)
          .fixedSize(horizontal: scale <= 1.001, vertical: true)
          .padding(.horizontal, 20).padding(.top, 28 * scale)
          .accessibilityIdentifier("component.state.title")
        NativeButton(title: actionTitle, action: action).frame(width: 220)
          .padding(.top, 54 * scale - 20 * 1.42 * scale)
          .accessibilityIdentifier("component.state.action")
      }
    }.frame(maxWidth: .infinity)
  }
}
