import SwiftUI
import UIKit

/// The share extension and isolated review entry compile this same SwiftUI view.
struct NativeShareView: View {
  @ObservedObject var model: ShareModel
  var sourceContext = false
  var start = true
  var compositionContext = false
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  @State private var editingRequirements = false
  @State private var editingTags = false
  @State private var editingOriginal = false
  @FocusState private var originalFocus: Bool
  @FocusState private var requirementFocus: Bool
  @FocusState private var tagsFocus: Bool
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { geometry in
      let tablet =
        UIDevice.current.userInterfaceIdiom == .pad
        && (sourceContext || compositionContext ? geometry.size.width >= 760 : true)
      let modal = sourceContext || compositionContext
      let width = tablet && modal ? min(660, geometry.size.width - 40) : geometry.size.width
      let height =
        tablet
        ? (modal ? min(730, geometry.size.height - 40) : geometry.size.height)
        : geometry.size.height - 44
      ZStack(alignment: .top) {
        if compositionContext && tablet { Color.black.opacity(scheme == .dark ? 0.44 : 0.25) }
        else { p.paper }
        if tablet && sourceContext {
          VStack(alignment: .leading, spacing: 10) {
            NativeText("SwiftUI 原生界面实践", size: 28, bold: true)
            NativeText("https://example.com/swiftui", size: 17).foregroundStyle(p.secondary)
          }.padding(.leading, 72).padding(.top, 60).frame(maxWidth: .infinity, alignment: .leading)
          Color.black.opacity(scheme == .dark ? 0.44 : 0.25)
        }
        VStack(spacing: 0) {
          header
          if model.loading {
            ProgressView().tint(p.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
              .accessibilityLabel("正在读取分享原文")
          } else if model.captureFailed {
            failure
          } else if model.saved {
            result
          } else {
            ScrollView {
              if model.advanced { dispatchForm } else { captureForm(width: width - 40) }
            }.id(model.advanced).scrollDismissesKeyboard(.interactively)
          }
        }.frame(width: width, height: height).background(p.surface)
          .clipShape(
            RoundedRectangle(cornerRadius: tablet && modal ? 16 : 0, style: .continuous)
          )
          .offset(y: tablet ? (modal ? (geometry.size.height - height) / 2 : 0) : 44)
      }.foregroundStyle(p.label)
    }.ignoresSafeArea(.container, edges: [.top, .bottom])
      .sheet(isPresented: $editingTags) { tagsPanel }
      .task { if start && !model.manual && !compositionContext { await model.capture() } }
      .task { if start { await model.loadDevices() } }
      .onDisappear { model.flushDraft() }
  }
  private var headerTitle: some View {
    NativeText(model.advanced ? "高级派发选项" : model.manual ? "新建采集" : "收集到资料库", size: 17, bold: true)
      .fixedSize(horizontal: scale <= 1.001, vertical: true)
      .accessibilityIdentifier("share.nav.title")
  }
  private var headerActions: some View {
    HStack(alignment: .top) {
      if !model.saved {
        headerButton(model.advanced || compositionContext ? "返回" : "取消", id: "share.cancel") {
          if model.advanced { model.advanced = false } else { model.cancel() }
        }.disabled(model.saving)
      }
      Spacer(minLength: 12)
      headerButton(model.advanced || model.saved ? "完成" : model.manual ? "提交" : "保存", id: "share.save") {
        originalFocus = false
        editingOriginal = false
        requirementFocus = false
        editingRequirements = false
        if model.advanced {
          model.advanced = false
        } else if model.saved {
          model.close()
        } else {
          Task { await model.save() }
        }
      }.disabled(model.loading || model.saving || model.captureFailed)
    }.padding(.horizontal, 20)
  }
  private var header: some View {
    Group {
      if scale > 1.3 {
        VStack(spacing: 6) {
          headerActions
          headerTitle.multilineTextAlignment(.center).padding(.horizontal, 20).padding(.bottom, 12)
        }
      } else {
        ZStack(alignment: .top) {
          headerActions
          headerTitle.padding(.top, 16).padding(.horizontal, 70).allowsHitTesting(false)
        }.frame(height: 58, alignment: .top)
      }
    }.overlay(alignment: .bottom) { Rectangle().fill(p.separator).frame(height: 1) }
  }
  private func headerButton(_ title: String, id: String, action: @escaping () -> Void) -> some View
  {
    Button(action: action) {
      NativeText(title, size: 17).fixedSize(horizontal: true, vertical: true)
        .padding(.top, 16).frame(minWidth: 34, minHeight: 44, alignment: .top)
        .foregroundStyle(id == "share.save" && model.captureFailed ? p.secondary : p.accent)
        .contentShape(Rectangle())
    }.buttonStyle(NativeShareHeaderStyle()).accessibilityIdentifier(id)
  }
  private func label(_ title: String) -> some View {
    NativeText(title, size: 14).foregroundStyle(p.secondary)
      .frame(minHeight: 29 * scale, alignment: .top)
  }
  private func captureForm(width: CGFloat) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      if model.omittedAttachments > 0 {
        NativeText("\(model.omittedAttachments) 份附件未收录", size: 15)
          .foregroundStyle(p.accent).padding(.leading, 16).padding(.top, 14)
          .frame(maxWidth: .infinity, minHeight: 44, alignment: .topLeading)
          .background(p.selection, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
          .accessibilityIdentifier("share.captureNotice").padding(.bottom, 26)
      }
      if let message = model.message {
        NativeText(message, size: 14).foregroundStyle(p.destructive)
          .accessibilityIdentifier("share.status").padding(.bottom, 20)
      }
      if let message = model.draftFailure, message != model.message {
        NativeText(message, size: 14).foregroundStyle(p.destructive)
          .accessibilityIdentifier("composition.saveFailure").padding(.bottom, 20)
      }
      label("原文")
      Group {
        if model.manual && editingOriginal {
          TextEditor(text: Binding(get: { model.editableOriginal }, set: { model.editableOriginal = $0 }))
            .font(.system(size: 17 * scale)).scrollContentBackground(.hidden)
            .focused($originalFocus).padding(.horizontal, 11).padding(.vertical, 12)
            .frame(minHeight: 112 * scale)
            .background(p.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityIdentifier("composition.original.editor")
        } else if model.manual {
          Button { editingOriginal = true; originalFocus = true } label: {
            if model.parts.isEmpty || model.editableOriginal.isEmpty {
              NativeText("文字、标题或链接", size: 17).foregroundStyle(p.secondary)
                .padding(16).frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading)
                .background(p.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else { originalCard(result: false) }
          }.buttonStyle(.plain).accessibilityIdentifier("composition.original")
            .accessibilityLabel(model.editableOriginal)
        } else { originalCard(result: false) }
      }.padding(.bottom, 28)
      label("附加要求")
      Group {
        if editingRequirements {
          TextEditor(text: $model.requirements).font(.system(size: 16 * scale))
            .scrollContentBackground(.hidden).focused($requirementFocus)
            .padding(.horizontal, 11).padding(.top, 10).frame(minHeight: 90 * scale)
            .accessibilityIdentifier("share.requirements.editor")
        } else {
          Button {
            editingRequirements = true
            requirementFocus = true
          } label: {
            NativeText(
              model.requirements, size: 16, lineHeight: 25,
              explicitLineWidth: width - 32
            )
            .padding(.horizontal, 16).padding(.top, 18).padding(.bottom, 18)
            .frame(maxWidth: .infinity, minHeight: 90, alignment: .topLeading)
            .contentShape(Rectangle())
          }.buttonStyle(.plain).accessibilityIdentifier("share.requirements")
        }
      }.background(p.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.bottom, 32)
      NativeFormGroup {
        Button {
          editingTags = true
        } label: {
          NativeFormRow(
            label: "标签", value: Submission.tags(from: model.tags).joined(separator: "、"))
        }.buttonStyle(.plain).accessibilityIdentifier("share.tags")
        NativeFormRow(label: "自动归档") {
          NativeToggle(isOn: $model.autoArchive, label: "自动归档")
            .padding(.top, 4).offset(x: 1).accessibilityIdentifier("share.autoArchive")
        }
        Button {
          requirementFocus = false
          editingRequirements = false
          model.advanced = true
          originalFocus = false
          editingOriginal = false
        } label: {
          NativeFormRow(label: "高级派发选项", disclosure: true)
        }.buttonStyle(.plain).accessibilityIdentifier("share.advanced")
      }.padding(.bottom, 2)
    }.padding(.horizontal, 20).padding(.top, 30).padding(.bottom, 40)
      .disabled(model.saving)
  }
  private func originalCard(result: Bool) -> some View {
    VStack(alignment: .leading, spacing: result ? 17 : 21) {
      ForEach(Array(originalPreview.enumerated()), id: \.offset) {
        index, part in
        let link =
          part.kind.contains("url") || part.value.hasPrefix("https://")
          || part.value.hasPrefix("http://")
        NativeText(
          part.value, size: index == 0 ? (result ? 19 : 17) : (link ? (result ? 14 : 15) : 16),
          bold: index == 0,
          trackingCorrection: result ? (index == 0 ? 4 : link ? (compositionContext ? 0 : -1.5) : 0)
            : compositionContext && index > 0 && link ? -2.5 : 0
        )
        .foregroundStyle(link ? p.accent : p.label).textSelection(.enabled)
        .accessibilityIdentifier("share.original.\(index)")
      }
    }.padding(.horizontal, 16).padding(.top, result ? 22 : 20).padding(.bottom, 20)
      .frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading)
      .background(p.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
  private var originalPreview: [SharedPart] {
    let parts = SharedPart.uniqueValues(in: model.parts)
    guard model.manual, parts.count == 1, let part = parts.first, part.kind == "text" else { return parts }
    // Display paragraphs with the approved title/body hierarchy; storage remains verbatim.
    let paragraphs = part.value.components(separatedBy: "\n\n")
    let values = paragraphs.count > 1 ? paragraphs
      : part.value.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
    return values.enumerated().map { index, value in
      let link = value.trimmingCharacters(in: .whitespacesAndNewlines)
      return SharedPart(item: index, attachment: nil,
        kind: link.hasPrefix("https://") || link.hasPrefix("http://") ? "url" : "text",
        representation: nil, value: value)
    }
  }
  private var dispatchForm: some View {
    VStack(alignment: .leading, spacing: 0) {
      label("采集电脑").padding(.bottom, 2)
      NativeFormGroup {
        dispatchRow("自动", selected: model.deviceID.isEmpty, id: "auto") { model.deviceID = "" }
        ForEach(model.devices) { device in
          dispatchRow(
            device.name + (device.online == true ? "" : " · 离线"),
            selected: model.deviceID == device.id, id: device.id
          ) { model.deviceID = device.id }
        }
        if !model.deviceID.isEmpty && !model.devices.contains(where: { $0.id == model.deviceID }) {
          dispatchRow("已选择的电脑 · 不可用", selected: true, id: model.deviceID) {}
        }
      }.padding(.bottom, 35)
      label("Agent").padding(.bottom, 2)
      NativeFormGroup {
        ForEach([("自动", ""), ("Codex", "codex"), ("Claude Code", "claude"), ("Gemini", "gemini"), ("OpenCode", "opencode")], id: \.1) {
          title, value in
          dispatchRow(
            title, selected: model.agent == value, id: "agent." + (value.isEmpty ? "auto" : value)
          ) { model.agent = value }
        }
      }.padding(.bottom, 43)
      NativeButton(
        title: model.loadingDevices ? "刷新中…" : "刷新电脑列表", kind: .secondary,
        busy: model.loadingDevices
      ) { Task { await model.loadDevices() } }
      .accessibilityIdentifier("share.refresh")
      if let failure = model.dispatchFailure {
        NativeText(failure, size: 14).foregroundStyle(p.destructive).padding(.top, 20)
      }
      if model.devices.isEmpty && !model.loadingDevices {
        NativeText(model.hasPairing == false ? "尚未配对" : "暂无采集电脑", size: 14).foregroundStyle(
          p.secondary
        ).padding(.top, 20)
      }
    }.padding(.horizontal, 20).padding(.top, 37).padding(.bottom, 40)
  }
  private func dispatchRow(
    _ title: String, selected: Bool, id: String, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(alignment: .top, spacing: 8) {
        NativeText(title, size: 17,
          trackingCorrection: title == "CodeBuddy" ? (compositionContext ? 0.5 : 2) : 0).padding(
          .top, 17)
        Spacer(minLength: 8)
        if selected {
          NativeGlyph(name: "check", size: 20, scalesLineWidths: false).foregroundStyle(p.accent)
            .padding(.top, 17).padding(.trailing, 18)
        }
      }.padding(.leading, 16).frame(minHeight: max(54, 24 * scale + 30), alignment: .top)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
          Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 16).offset(y: 1)
        }
    }.buttonStyle(.plain).accessibilityIdentifier("share.choice." + id)
      .accessibilityValue(selected ? "已选择" : "未选择")
  }
  private var result: some View {
    GeometryReader { geometry in
      ScrollView {
        VStack(spacing: 0) {
          NativeGlyph(name: "check", size: 56, scalesLineWidths: false).foregroundStyle(p.accent)
            .padding(.top, 82)
          NativeText(
            model.submitted ? "已提交" : "已保存", size: 28, bold: true, baselineAdjustment: -1.5
          )
          .fixedSize(horizontal: scale <= 1.001, vertical: true).padding(.top, 33)
          .accessibilityIdentifier("share.result.title")
          NativeText(
            model.submitted ? model.resultHost : "待提交", size: 16,
            trackingCorrection: model.submitted ? 5 : 0
          )
          .fixedSize(horizontal: scale <= 1.001, vertical: true)
          .foregroundStyle(p.secondary).padding(.top, 11.24)
          .accessibilityIdentifier("share.result.destination")
          originalCard(result: true).padding(.top, 37.28)
          if let failure = model.submissionFailure {
            NativeText(failure, size: 14).foregroundStyle(p.destructive).padding(.top, 16)
              .accessibilityIdentifier("share.submissionFailure")
          }
          if model.saving { ProgressView().padding(.top, 16).accessibilityLabel("正在提交") }
          if let message = model.message, message.hasPrefix("请从主屏幕") {
            NativeText(message, size: 14).foregroundStyle(p.secondary).padding(.top, 16)
              .accessibilityIdentifier("share.status")
          }
          Spacer(minLength: 40)
          NativeButton(title: model.submitted ? "查看任务" : "打开主应用") {
            Task { await model.openMainApp() }
          }
          .accessibilityIdentifier("share.openMainApp").accessibilityValue(
            model.openedMainApp ? "已打开" : ""
          )
          .disabled(model.saving).padding(.bottom, 94)
        }.padding(.horizontal, 20).frame(minHeight: geometry.size.height, alignment: .top)
      }
    }
  }
  private var failure: some View {
    ScrollView {
      VStack(spacing: 0) {
        NativeGlyph(name: "alert", size: 48).foregroundStyle(p.secondary)
          .padding(.top, 180)
        NativeText("原文读取失败", size: 20, bold: true)
          .fixedSize(horizontal: scale <= 1.001, vertical: true).padding(.top, 28)
          .accessibilityIdentifier("share.failure.title")
        NativeButton(title: "重新读取") { Task { await model.capture() } }
          .frame(width: 220).padding(.top, 54 - 20 * 1.42)
          .accessibilityIdentifier("share.retry")
        if let message = model.message, message != "原文读取失败" {
          NativeText(message, size: 14).foregroundStyle(p.secondary)
            .padding(.horizontal, 20).padding(.top, 20)
            .accessibilityIdentifier("share.failure.detail")
        }
      }.frame(maxWidth: .infinity).padding(.bottom, 40)
    }
  }
  private var tagsPanel: some View {
    NavigationStack {
      VStack {
        TextField("标签", text: $model.tags).focused($tagsFocus).font(.system(size: 16 * scale))
          .padding(16).background(
            p.paper, in: RoundedRectangle(cornerRadius: 12, style: .continuous)
          )
          .accessibilityIdentifier("share.tags.editor")
        Spacer()
      }.padding(20).background(p.surface).navigationTitle("标签").navigationBarTitleDisplayMode(
        .inline
      )
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("完成") {
            tagsFocus = false
            editingTags = false
          }
          .foregroundStyle(p.accent).accessibilityIdentifier("component.panel.done")
        }
      }
    }.presentationDetents([.height(300)]).preferredColorScheme(scheme)
  }

}

private struct NativeShareHeaderStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
  }
}
