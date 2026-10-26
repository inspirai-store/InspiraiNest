import SwiftUI
import UIKit

struct NativeReaderPanels: View {
  @ObservedObject var model: NativeReaderModel
  @Environment(\.colorScheme) private var scheme
  @Environment(\.openURL) private var openURL
  @ScaledMetric private var scale: CGFloat = 1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    Group {
      if let panel = model.panel {
        NativePanel(
          title: panel.rawValue, height: panel == .info ? 690 : 470, dismiss: { model.panel = nil }
        ) {
          switch panel {
          case .files: files
          case .outline: outline
          case .info: info
          case .menu: menu
          case .thumbnails:
            if let data = model.data { NativePDFThumbnailList(data: data, model: model) }
          }
        }
      }
    }

  }
  private var files: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(model.detail?.readableFiles ?? []) { file in
        Button {
          Task { await model.select(file, preview: false) }
        } label: {
          HStack(alignment: .top, spacing: 11) {
            NativeGlyph(name: "file").foregroundStyle(p.secondary).padding(.top, 12)
            NativeText(file.path, size: 15, bold: file == model.selectedFile).padding(.top, 16)
            Spacer(minLength: 8)
            NativeGlyph(name: file == model.selectedFile ? "check" : "chevron", size: 20)
              .foregroundStyle(file == model.selectedFile ? p.accent : p.secondary).padding(
                .top, 15
              ).padding(.trailing, 6)
          }.padding(.leading, 3).frame(minHeight: max(74, 74 * scale), alignment: .topLeading)
            .contentShape(Rectangle())
            .overlay(alignment: .top) {
              Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 38).offset(
                y: max(63, 63 * scale))
            }
        }.accessibilityIdentifier("reader.file.\(file.path)")
      }
    }
  }
  private var outline: some View {
    VStack(alignment: .leading, spacing: 0) {
      let headings = model.document?.headings ?? []
      let base = headings.map(\.level).min() ?? 1
      ForEach(headings) { heading in
        Button {
          model.jump(to: heading.id)
        } label: {
          NativeText(heading.title, size: 17, bold: heading.id == model.selectedHeading)
            .foregroundStyle(heading.id == model.selectedHeading ? p.accent : p.label)
            .padding(.leading, 14 + CGFloat(max(0, heading.level - base)) * 22).padding(.top, 12)
            .frame(maxWidth: .infinity, minHeight: max(43, 43 * scale), alignment: .topLeading)
            .background(
              heading.id == model.selectedHeading ? p.selection : .clear,
              in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }.padding(.bottom, 10).accessibilityIdentifier("reader.heading.\(heading.title)")
      }
      if headings.isEmpty { NativeText("暂无大纲", size: 17).foregroundStyle(p.secondary).padding(14) }
    }.offset(y: -9)
  }
  private var info: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let detail = model.detail {
        ForEach(Array(detail.info.enumerated()), id: \.offset) { _, row in
          NativeReaderInfoRowLayout(minimumHeight: max(36, 36 * scale)) {
            NativeText(row.0, size: 16)
            NativeText(row.1, size: 15).foregroundStyle(p.secondary).multilineTextAlignment(
              .trailing)
          }.padding(.horizontal, 4)
            .overlay(alignment: .bottom) {
              Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 4)
            }
        }
        if !model.related.isEmpty {
          NativeText("相关资料", size: 14).foregroundStyle(p.secondary).padding(.top, 20).padding(
            .bottom, 32 - 14 * 1.42)
          ForEach(model.related) { entry in
            Button {
              Task { await model.openRelated(entry) }
            } label: {
              HStack(alignment: .top) {
                NativeText(entry.title, size: 16)
                Spacer(minLength: 8)
                NativeGlyph(name: "chevron", size: 18).foregroundStyle(p.secondary).padding(
                  .trailing, 5
                ).padding(.top, 2)
              }.frame(minHeight: max(39, 39 * scale), alignment: .top).contentShape(Rectangle())
            }.accessibilityIdentifier("reader.related.\(entry.id)")
          }
        }
        HStack(alignment: .top, spacing: 0) {
          sourceButton("打开来源") { if let url = detail.safeSource { openURL(url) } }
          sourceButton("复制地址") { UIPasteboard.general.string = detail.sourceURL }
          Button {
            Task { await model.saveArchive() }
          } label: {
            NativeText(model.exporting ? "保存中" : "保存归档包", size: 14).fixedSize(
              horizontal: scale <= 1.001, vertical: true
            ).frame(maxWidth: .infinity, minHeight: 44, alignment: .top)
          }
          .disabled(model.exporting).accessibilityIdentifier("reader.saveArchive")
        }.foregroundStyle(p.accent).padding(.top, 27)
      }
    }
  }
  private func sourceButton(_ label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      NativeText(label, size: 14).fixedSize(horizontal: scale <= 1.001, vertical: true).frame(
        maxWidth: .infinity, minHeight: 44, alignment: .top)
    }
    .disabled(model.detail?.safeSource == nil).opacity(model.detail?.safeSource == nil ? 0.4 : 1)
    .accessibilityIdentifier("reader.\(label)")
  }
  private var menu: some View {
    VStack(alignment: .leading, spacing: 16) {
      if model.canBack {
        Button {
          Task { await model.back() }
          model.panel = nil
        } label: {
          NativeText("返回正文", size: 17).frame(
            maxWidth: .infinity, minHeight: 44, alignment: .leading
          ).contentShape(Rectangle())
        }.accessibilityIdentifier("reader.returnBody")
      }
      Button {
        model.panel = .files
      } label: {
        NativeText("正文文件", size: 17).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          .contentShape(Rectangle())
      }.accessibilityIdentifier("reader.showFiles")
      Button {
        model.panel = .info
      } label: {
        NativeText("归档信息与相关资料", size: 17).frame(
          maxWidth: .infinity, minHeight: 44, alignment: .leading
        ).contentShape(Rectangle())
      }.accessibilityIdentifier("reader.info")
      Button {
        model.showAttachments()
      } label: {
        NativeText("附件列表", size: 17).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          .contentShape(Rectangle())
      }
      if model.selectedFile?.isText == true {
        Button {
          UIPasteboard.general.string = model.text
          model.panel = nil
        } label: {
          NativeText("复制文本", size: 17).frame(
            maxWidth: .infinity, minHeight: 44, alignment: .leading
          ).contentShape(Rectangle())
        }
      }
    }.foregroundStyle(p.accent)
  }
}

struct NativeReaderExportPresentation: ViewModifier {
  @ObservedObject var model: NativeReaderModel
  func body(content: Content) -> some View {
    content
      .fileExporter(
        isPresented: Binding(
          get: { model.exportData != nil }, set: { if !$0 { model.exportData = nil } }),
        document: model.exportData.map { ReaderExportDocument(data: $0) }, contentType: .json,
        defaultFilename: "归档包-\(model.detail?.id.replacingOccurrences(of: "/", with: "-") ?? "资料")"
      ) { result in
        model.exportData = nil
        if case .failure = result { model.notice = "归档包保存失败" }
      }
      .alert(
        model.notice ?? "归档包保存失败",
        isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })
      ) { Button("完成") { model.notice = nil } }
  }
}

private struct NativeReaderInfoRowLayout: Layout {
  let minimumHeight: CGFloat
  private func measurements(_ proposal: ProposedViewSize, _ views: Subviews) -> (
    CGFloat, CGSize, CGSize
  ) {
    let labelNatural = views[0].sizeThatFits(.unspecified)
    let valueNatural = views[1].sizeThatFits(.unspecified)
    let width = proposal.width ?? labelNatural.width + valueNatural.width + 12
    let labelWidth = min(labelNatural.width, width * 0.42)
    let valueWidth = min(valueNatural.width, max(1, width - labelWidth - 12))
    return (
      width, views[0].sizeThatFits(.init(width: labelWidth, height: nil)),
      views[1].sizeThatFits(.init(width: valueWidth, height: nil))
    )
  }
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let (width, label, value) = measurements(proposal, subviews)
    return .init(
      width: width, height: max(minimumHeight, max(label.height + 10, value.height + 10.5) + 1))
  }
  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    let (_, label, value) = measurements(.init(width: bounds.width, height: nil), subviews)
    subviews[0].place(
      at: .init(x: bounds.minX, y: bounds.minY + 10), anchor: .topLeading,
      proposal: .init(width: label.width, height: label.height))
    subviews[1].place(
      at: .init(x: bounds.maxX - value.width, y: bounds.minY + 10.5), anchor: .topLeading,
      proposal: .init(width: value.width, height: value.height))
  }
}
