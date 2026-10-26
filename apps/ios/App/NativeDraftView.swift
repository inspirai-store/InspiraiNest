import PDFKit
import SwiftUI
import UIKit

struct NativeDraftView: View {
  @ObservedObject var model: NativeDraftModel
  let taskID: String
  let tablet: Bool
  var pair: () -> Void = {}
  var archived: () -> Void = {}
  @Environment(\.dismiss) private var dismiss
  @Environment(\.colorScheme) private var scheme
  @Environment(\.scenePhase) private var scenePhase
  @ScaledMetric private var scale: CGFloat = 1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { geo in
      VStack(spacing: 0) {
        if !tablet { p.paper.frame(height: 44) }
        navigation.frame(height: scale > 1.3 ? 88 : 44)
        GeometryReader { area in
          Group {
            if model.bundle != nil { article(width: area.size.width) } else { stateContent }
          }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }.clipped().background(p.surface)
        footer
      }.frame(width: geo.size.width, height: geo.size.height).overlay {
        if model.filesPanel {
          NativePanel(
            title: "草稿文件", height: min(660, geo.size.height - 60),
            dismiss: {
              model.filesPanel = false
            }
          ) {
            VStack(alignment: .leading, spacing: 16) {
              NativeText(model.bundle?.meta.coverage_note ?? "", size: 14)
                .foregroundStyle(p.secondary).textSelection(.enabled)
                .accessibilityIdentifier("draft.coverage.note")
              if let summary = model.bundle?.meta.summary, !summary.isEmpty {
                NativeText(summary, size: 16).textSelection(.enabled).accessibilityIdentifier(
                  "draft.summary")
              }
              fileList
            }
          }
        }
      }
    }.ignoresSafeArea(.container, edges: [.top, .bottom]).toolbar(.hidden, for: .navigationBar)
      .background(p.surface).foregroundStyle(p.label).tint(p.accent).buttonStyle(.plain)
      .task(id: taskID + model.sessionKey.uuidString) { await model.load(taskID) }
      .task(id: scenePhase) {
        guard scenePhase == .active else { return }
        while !Task.isCancelled {
          await model.checkVersion()
          do { try await Task.sleep(nanoseconds: 5_000_000_000) } catch { return }
        }
      }
      .onChange(of: model.phase) { phase in if phase == .archived { archived() } }
      .onDisappear {
        model.confirmation = false
        model.filesPanel = false
      }
      .environment(
        \.openURL,
        OpenURLAction { url in
          if url.scheme == "lingnest-file",
            let source = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
              .first(where: { $0.name == "source" })?.value,
            let file = model.localFile(source)
          {
            model.chooseFile(file)
            return .handled
          }
          guard ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil,
            url.user == nil, url.password == nil
          else { return .discarded }
          return .systemAction(url)
        })
  }
  private var navigation: some View {
    GeometryReader { geo in
      ZStack(alignment: .top) {
        p.paper
        HStack {
          if !tablet {
            Button {
              dismiss()
            } label: {
              HStack(spacing: 0) {
                NativeGlyph(name: "back").frame(width: 24, height: 24)
                NativeText("任务", size: 16).frame(height: 24).offset(y: 2.2)
              }.frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }.accessibilityIdentifier("draft.back").accessibilityLabel("任务")
          }
          Spacer()
          Button {
            model.filesPanel = true
          } label: {
            NativeGlyph(name: "file").frame(width: 44, height: 44).contentShape(Rectangle())
          }.buttonStyle(NativeDraftToolbarStyle()).disabled(model.bundle == nil)
            .accessibilityIdentifier("draft.files")
            .accessibilityLabel("草稿文件")
        }.padding(.leading, 14).padding(.trailing, 4).foregroundStyle(p.accent)
        NativeText("草稿审核", size: 17, bold: true)
          .fixedSize(horizontal: scale <= 1.3, vertical: true)
          .frame(width: max(0, geo.size.width - (scale > 1.3 ? 40 : 140)))
          .padding(.top, scale > 1.3 ? 48 : 13).accessibilityIdentifier("draft.nav.title")
          .allowsHitTesting(false)
      }
    }
  }
  private func article(width: CGFloat) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        banner.padding(.horizontal, 20).padding(.top, 22)
        segments.padding(.horizontal, 20).padding(.top, model.phase == .changed ? 36 : 21).padding(
          .bottom, 21)
        if let bundle = model.bundle {
          NativeText(
            bundle.meta.title, size: 26, bold: true, lineHeight: 34,
            explicitLineWidth: width - 48
          )
          .padding(.horizontal, 24).padding(.bottom, 17).accessibilityIdentifier("draft.title")
          metadata
            .foregroundStyle(p.secondary).padding(.horizontal, 24)
            .padding(.bottom, 35 - 13 * 1.42).accessibilityIdentifier("draft.metadata")
          Rectangle().fill(p.separator).frame(height: 1).padding(.horizontal, 24).padding(
            .bottom, 25)
        }
        Group {
          if model.category == 4 && model.selectedPath.isEmpty {
            fileList
          } else if let file = model.selected, let bytes = model.selectedData {
            fileBody(file, bytes: bytes, width: width - 48)
          } else {
            NativeText("暂无文件", size: 17).foregroundStyle(p.secondary)
              .accessibilityIdentifier("draft.file.empty")
          }
        }.padding(.horizontal, 24)
      }.padding(.bottom, 30).frame(maxWidth: .infinity, alignment: .leading)
    }.accessibilityIdentifier("draft.body")
  }
  private var metadata: some View {
    let status =
      [.archived, .terminal].contains(model.phase)
      ? model.task?.stateLabel ?? "任务状态已变化" : "待确认归档"
    let date = NativeTaskDate.display(model.task?.createdAt ?? "")
    let prefix = status + "   ·   "
    let advance =
      CGFloat(status.count) * 13 + NativeLatinAdvances.width("   ·   ", size: 13, bold: false)
    return Group {
      if scale > 1.3 {
        NativeText(prefix + date, size: 13)
      } else {
        HStack(spacing: 0) {
          NativeText(prefix, size: 13, trackingCorrection: -1.6).frame(
            width: advance - 1.5, alignment: .leading)
          NativeText(date, size: 13, trackingCorrection: 1.5)
            .fixedSize(horizontal: true, vertical: true)
        }.accessibilityElement(children: .ignore).accessibilityLabel(prefix + date)
      }
    }
  }
  private var banner: some View {
    VStack(alignment: .leading, spacing: 0) {
      if model.phase == .changed {
        NativeText("草稿已更新", size: 18, bold: true).accessibilityIdentifier("draft.changed")
          .padding(.bottom, 40 - 18 * 1.42)
        draftButton("重新读取", kind: .secondary) { Task { await model.reload() } }
          .accessibilityIdentifier("draft.reload")
      } else {
        NativeText("来源完整度 · " + model.coverage, size: 14).foregroundStyle(p.secondary)
          .accessibilityIdentifier("draft.coverage")
        if let omitted = model.bundle?.omitted, !omitted.isEmpty {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(omitted, id: \.self) { path in
              NativeText(path + " · 未上传", size: 14, trackingCorrection: -0.8).foregroundStyle(
                p.accent
              )
              .textSelection(.enabled).accessibilityIdentifier("draft.omitted.\(path)")
            }
          }.padding(.top, 33 - 14 * 1.42)
        }
        if ![.ready, .loading, .changed].contains(model.phase) {
          NativeText(stateTitle, size: 14).foregroundStyle(p.destructive).padding(.top, 12)
            .accessibilityIdentifier("draft.notice")
        }
      }
    }.padding(.horizontal, 16).padding(.top, 16)
      .padding(.bottom, model.phase == .changed ? 13 : 11.12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        model.phase == .changed ? p.surface : p.paper,
        in: RoundedRectangle(cornerRadius: 12, style: .continuous)
      )
      .overlay {
        if model.phase == .changed {
          RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(p.separator, lineWidth: 1)
        }
      }
  }
  @ViewBuilder private var segments: some View {
    if scale > 1.3 {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 4) {
          ForEach(Array(ReaderCategory.allCases.enumerated()), id: \.offset) { index, category in
            Button {
              model.chooseCategory(index)
            } label: {
              Text(category.rawValue).font(
                .system(
                  size: 13 * scale,
                  weight: index == model.category ? .bold : .regular)
              )
              .padding(.horizontal, 12).padding(.vertical, 8)
              .background(
                index == model.category ? p.surface : .clear,
                in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            }.accessibilityIdentifier("component.segment.\(index)")
          }
        }.padding(2)
      }.background(p.well, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    } else {
      NativeSegmentedControl(
        labels: ReaderCategory.allCases.map(\.rawValue),
        selection: Binding(
          get: { model.category }, set: { model.chooseCategory($0) }))
    }
  }
  private var fileList: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(model.files) { file in
        Button {
          model.chooseFile(file)
        } label: {
          HStack(alignment: .top, spacing: 12) {
            NativeGlyph(name: "file").foregroundStyle(p.accent)
            VStack(alignment: .leading, spacing: 8) {
              NativeText(file.path, size: 17).textSelection(.enabled)
              NativeText(file.sizeLabel, size: 13).foregroundStyle(p.secondary)
            }
            Spacer(minLength: 4)
            NativeGlyph(name: "chevron", size: 18).foregroundStyle(p.secondary)
          }.padding(.vertical, 14).frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }.accessibilityIdentifier("draft.file.\(file.path)")
        Rectangle().fill(p.separator).frame(height: 1)
      }
      ForEach(model.bundle?.omitted ?? [], id: \.self) { path in
        NativeText(path + " · 未上传", size: 14).foregroundStyle(p.secondary).padding(.top, 16)
      }
    }
  }
  @ViewBuilder private func fileBody(_ file: ReadFile, bytes: Data, width: CGFloat) -> some View {
    if ["md", "markdown"].contains(file.suffix), let text = String(data: bytes, encoding: .utf8) {
      let doc = NativeMarkdownDocument(text)
      VStack(alignment: .leading, spacing: 0) {
        ForEach(doc.blocks) { block in
          NativeDraftMarkdownBlock(block: block, width: width, model: model)
        }
      }.accessibilityIdentifier("draft.markdown")
    } else if file.isText {
      if let text = String(data: bytes, encoding: .utf8) {
        NativeText(text, size: 17, lineHeight: 29).textSelection(.enabled)
          .accessibilityIdentifier("draft.text")
      } else {
        NativeText("文件不是有效 UTF-8 文本，无法预览。", size: 17)
      }
    } else if file.suffix == "pdf" {
      if PDFDocument(data: bytes) != nil {
        NativeDraftPDFCanvas(data: bytes, digest: file.sha256).frame(height: 520)
          .accessibilityIdentifier("draft.pdf")
      } else {
        NativeText("PDF 无法预览", size: 17)
      }
    } else if let image = UIImage(data: bytes) {
      Image(uiImage: image).resizable().scaledToFit().accessibilityLabel(file.name)
        .accessibilityIdentifier("draft.image")
    } else {
      NativeText("此附件无法在本机预览：" + file.path, size: 17)
    }
  }
  private var footer: some View {
    VStack(spacing: 0) {
      draftButton(
        model.phase == .archived ? "已归档" : "确认归档", enabled: model.canApprove,
        busy: model.busy
      ) { model.requestApproval() }
      .padding(.horizontal, 20).padding(.top, 11)
      .accessibilityIdentifier("draft.approve")
      p.paper.frame(height: tablet ? 23 : 58)
    }.background(p.paper)
  }
  private var stateTitle: String {
    switch model.phase {
    case .integrity: return "草稿校验失败"
    case .changed: return "草稿已更新"
    case .offline: return "离线"
    case .unpaired: return "尚未配对"
    case .expired: return "授权已失效"
    case .terminal: return model.task?.state == "completed" ? "任务已归档" : "任务状态已变化"
    case .archived: return "已归档"
    default: return "草稿暂时无法读取"
    }
  }
  private var stateContent: some View {
    VStack(spacing: 0) {
      if model.phase == .loading {
        ProgressView().padding(.top, 170).accessibilityIdentifier("draft.loading")
      } else {
        NativeGlyph(name: "alert", size: 48).foregroundStyle(p.secondary).padding(.top, 166)
        NativeText(stateTitle, size: 20, bold: true).fixedSize(
          horizontal: scale <= 1.3, vertical: true
        ).multilineTextAlignment(.center)
          .padding(.top, 28).accessibilityIdentifier("draft.state.title")
        draftButton([.unpaired, .expired].contains(model.phase) ? "连接资料库" : "重新读取") {
          if [.unpaired, .expired].contains(model.phase) {
            pair()
          } else {
            Task { await model.reload() }
          }
        }.frame(width: min(340, max(220, 220 * scale)))
          .padding(.top, 54 - 20 * 1.42).accessibilityIdentifier("draft.state.reload")
      }
    }.frame(maxWidth: .infinity)
  }
  private func draftButton(
    _ title: String, kind: NativeButton.Kind = .primary,
    enabled: Bool = true, busy: Bool = false, action: @escaping () -> Void
  ) -> some View {
    Group {
      if scale > 1.3 {
        Button(action: action) {
          HStack {
            if busy { ProgressView() }
            Text(title).font(.system(size: 17 * scale, weight: .bold))
          }
          .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(14)
          .foregroundStyle(
            enabled ? (kind == .primary ? (p.dark ? p.paper : p.surface) : p.accent) : p.secondary
          )
          .background(
            enabled && kind == .primary ? p.accent : p.well,
            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }.disabled(!enabled || busy)
      } else {
        NativeButton(title: title, kind: kind, enabled: enabled, busy: busy, action: action)
      }
    }
  }
}

struct NativeDraftConfirmation: View {
  @ObservedObject var model: NativeDraftModel
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    if model.confirmation {
      if scale > 1.3 {
        GeometryReader { geo in
          let p = NativePalette(dark: scheme == .dark)
          ZStack {
            Color.black.opacity(p.dark ? 0.44 : 0.25).ignoresSafeArea()
            VStack(spacing: 24) {
              Text("确认归档？").font(.system(size: 18 * scale, weight: .bold))
              Text(model.bundle?.meta.title ?? "").font(.system(size: 14 * scale)).foregroundStyle(
                p.secondary)
              Button("取消") { model.confirmation = false }.accessibilityIdentifier(
                "component.confirm.cancel")
              Button("确认归档") { Task { await model.approve() } }.accessibilityIdentifier(
                "component.confirm.accept")
            }.font(.system(size: 17 * scale)).tint(p.accent).multilineTextAlignment(.center)
              .padding(24).frame(width: min(460, geo.size.width - 40))
              .background(p.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
              .accessibilityAddTraits(.isModal).accessibilityAction(.escape) {
                model.confirmation = false
              }
          }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }.ignoresSafeArea()
      } else {
        NativeConfirmation(
          title: "确认归档？", bodyText: model.bundle?.meta.title ?? "",
          actionTitle: "确认归档", confirm: { Task { await model.approve() } },
          cancel: { model.confirmation = false })
      }
    }
  }
}

private struct NativeDraftPDFCanvas: UIViewRepresentable {
  let data: Data
  let digest: String
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeUIView(context: Context) -> PDFView {
    let view = PDFView()
    view.autoScales = true
    view.displayMode = .singlePageContinuous
    view.displayDirection = .vertical
    return view
  }
  func updateUIView(_ view: PDFView, context: Context) {
    // Task polling must not reset the page or zoom of an unchanged verified PDF.
    if context.coordinator.digest != digest {
      context.coordinator.digest = digest
      view.document = PDFDocument(data: data)
    }
  }
  final class Coordinator { var digest: String? }
}

private struct NativeDraftCodeText: View {
  let value: String
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(value.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
        NativeTextBaseline(size: 13 * scale, lineHeight: 23 * scale) {
          Text(line).font(.system(size: 13 * scale, design: .monospaced))
            .tracking(line.contains("} detail:") ? 2.3 * scale / CGFloat(max(1, line.count)) : 0)
            .fixedSize(horizontal: true, vertical: true)
        }
      }
    }.accessibilityElement(children: .ignore).accessibilityLabel(value)
  }
}

private struct NativeDraftMarkdownBlock: View {
  let block: NativeMarkdownDocument.Block
  let width: CGFloat
  @ObservedObject var model: NativeDraftModel
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View { content.accessibilityIdentifier("draft.\(block.id)") }
  @ViewBuilder private var content: some View {
    switch block.kind {
    case .heading(let level):
      let size: CGFloat = level <= 1 ? 26 : level == 2 ? 21 : level == 3 ? 17 : 16
      NativeText(block.text, size: size, bold: true)
        .padding(.bottom, max(0, (level <= 2 ? 38 : 31) - size * 1.42) * scale)
    case .code:
      ScrollView(.horizontal) {
        NativeDraftCodeText(
          value: block.text.hasSuffix("\n") ? String(block.text.dropLast()) : block.text
        )
        .textSelection(.enabled).padding(.horizontal, 15).padding(.top, 17).padding(.bottom, 22)
      }.frame(minHeight: 108 * scale, alignment: .top)
        .background(p.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .contextMenu { Button("复制代码") { UIPasteboard.general.string = block.text } }
        .padding(.bottom, 29 * scale)
    case .rule: Rectangle().fill(p.separator).frame(height: 1).padding(.vertical, 16)
    case .table(let rows):
      ScrollView(.horizontal) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(rows.indices, id: \.self) { r in
            HStack(alignment: .top, spacing: 12) {
              ForEach(rows[r].indices, id: \.self) { c in
                NativeText(rows[r][c], size: 16, bold: r == 0).frame(
                  width: 180, alignment: .leading)
              }
            }.padding(12).background(r == 0 ? p.well : p.surface)
            Rectangle().fill(p.separator).frame(height: 1)
          }
        }
      }.padding(.bottom, 25 * scale)
    case .quote:
      HStack(alignment: .top, spacing: 12) {
        Rectangle().fill(p.accent).frame(width: 3)
        nested(width: width - 15)
      }.fixedSize(horizontal: false, vertical: true).padding(.bottom, 16 * scale)
    case .list(let prefix):
      if prefix.isEmpty {
        nested(width: width).padding(.bottom, 16 * scale)
      } else {
        HStack(alignment: .top, spacing: 8) {
          NativeText(prefix, size: 17).frame(width: 28, alignment: .leading)
          nested(width: width - 36)
        }
      }
    case .paragraph, .literal:
      VStack(alignment: .leading, spacing: 12) {
        if let inline = block.inline {
          Text(inline).font(.system(size: 17 * scale)).lineSpacing(
            29 * scale - UIFont.systemFont(ofSize: 17 * scale).lineHeight
          )
          .textSelection(.enabled)
        } else if !block.text.isEmpty {
          NativeText(block.text, size: 17, lineHeight: 29, explicitLineWidth: width).textSelection(
            .enabled)
        }
        ForEach(block.images.indices, id: \.self) { i in
          if let file = model.localFile(block.images[i].0), let bytes = model.data(file.path),
            let image = UIImage(data: bytes)
          {
            Image(uiImage: image).resizable().scaledToFit().accessibilityLabel(block.images[i].1)
          } else {
            NativeText(block.images[i].1.isEmpty ? block.images[i].0 : block.images[i].1, size: 14)
          }
        }
        if !block.children.isEmpty { nested(width: width) }
      }.padding(.bottom, 25 * scale)
    }
  }
  private func nested(width: CGFloat) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(block.children) { NativeDraftMarkdownBlock(block: $0, width: width, model: model) }
    }
  }
}

private struct NativeDraftToolbarStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
  }
}
