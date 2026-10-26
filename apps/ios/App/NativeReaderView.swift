import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ReaderExportDocument: FileDocument {
  static var readableContentTypes: [UTType] { [.json] }
  var data: Data
  init(data: Data) { self.data = data }
  init(configuration: ReadConfiguration) throws {
    data = configuration.file.regularFileContents ?? Data()
  }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: data)
  }
}

struct NativeReaderView: View {
  @ObservedObject var model: NativeReaderModel
  let entryID: String
  let tablet: Bool
  var favorite = false
  var toggleFavorite: () -> Void = {}
  var modalReturn: String? = nil
  private var showsBack: Bool { !tablet || modalReturn != nil }
  private var topInset: CGFloat { tablet ? (modalReturn == nil ? 0 : 24) : 44 }
  @Environment(\.dismiss) private var dismiss
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { geometry in
      VStack(spacing: 0) {
        if topInset > 0 { p.paper.frame(height: topInset) }
        p.paper.frame(height: max(44, 44 * scale))
        GeometryReader { content in
          Group {
            if model.phase == .loading {
              ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("reader.loading")
            } else if model.phase != .ready {
              failure(width: content.size.width)
            } else {
              switch model.route {
              case .body: article(width: content.size.width)
              case .attachments: attachments
              case .preview(let file): preview(file, size: content.size)
              }
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .background(model.route == .body ? p.surface : p.paper)
        }
        .clipped()
        if !tablet || modalReturn != nil { p.paper.frame(height: tablet ? 24 : 35) }
      }.frame(width: geometry.size.width, height: geometry.size.height)
        .overlay(alignment: .top) {
          navigation.frame(
            height: max(44, 44 * scale)
          ).padding(.top, topInset)
        }
    }
    .ignoresSafeArea(.container, edges: [.top, .bottom]).toolbar(.hidden, for: .navigationBar)
    .foregroundStyle(p.label).tint(p.accent).buttonStyle(.plain)
    .task(id: entryID + model.sessionKey.uuidString) {
      await model.open(entryID, resetHistory: true)
    }
    .environment(
      \.openURL,
      OpenURLAction { url in
        if url.scheme == "lingnest-file",
          let source = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(
            where: { $0.name == "source" })?.value
        {
          Task { await model.openLocalLink(source) }
          return .handled
        }
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil,
          url.user == nil, url.password == nil
        else { return .discarded }
        return .systemAction(url)
      }
    )
    .onDisappear {
      model.rememberPosition()
      model.panel = nil
    }
  }
  private var navigation: some View {
    GeometryReader { geo in
      ZStack(alignment: .top) {
        p.paper
        HStack(spacing: 0) {
          if showsBack {
            Button(action: goBack) {
              HStack(spacing: 0) {
                NativeGlyph(name: "back").frame(width: 24, height: 24)
                Text(backLabel).font(.system(size: 16 * scale)).frame(height: 24)
              }.frame(width: max(44, 24 + CGFloat(backLabel.count) * 16 * scale), height: 44)
                .contentShape(Rectangle())
            }.accessibilityLabel(backLabel).accessibilityIdentifier("reader.back")
          }
          Spacer(minLength: 0)
          if model.route == .body {
            navButton("more", "正文文件", "reader.files") { model.panel = .menu }
            navButton(
              "bookmark", favorite ? "取消收藏" : "收藏", "reader.favorite", action: toggleFavorite)
            navButton("outline", "正文大纲", "reader.outline") { model.panel = .outline }
          } else {
            navButton("more", "更多", "reader.more") { model.panel = .menu }
            if case .preview(let file) = model.route, file.suffix == "pdf", model.phase == .ready {
              navButton("outline", "页面缩略图", "reader.thumbnails") { model.panel = .thumbnails }
            }
          }
        }.padding(.leading, showsBack ? 14 : 0).padding(.trailing, 7).foregroundStyle(p.accent)
        let leadingWidth = showsBack ? 14 + max(44, 24 + CGFloat(backLabel.count) * 16 * scale) : 0
        let trailingWidth: CGFloat = model.route == .body ? 121 : 83
        NativeText(navTitle, size: 17, bold: true, centered: true)
        .lineLimit(1).truncationMode(.tail)
        .frame(width: max(0, geo.size.width - 2 * max(leadingWidth, trailingWidth) - 16))
        .clipped().accessibilityLabel(navTitle)
        .padding(.top, 13).accessibilityIdentifier("reader.nav.title").allowsHitTesting(false)
      }.overlay(alignment: .bottom) { Rectangle().fill(p.separator).frame(height: 1) }
    }
  }
  private func navButton(
    _ name: String, _ label: String, _ id: String, action: @escaping () -> Void
  ) -> some View {
    Button(action: {
      action()
    }) {
      Rectangle().fill(p.paper).frame(width: 38, height: 44).contentShape(Rectangle())
        .overlay { NativeGlyph(name: name) }
    }
    .foregroundStyle(p.accent).accessibilityLabel(label).accessibilityIdentifier(id)
  }
  private func goBack() {
    if model.canBack { Task { await model.back() } } else { dismiss() }
  }
  private var backLabel: String {
    switch model.route {
    case .body: return model.canBack ? "资料正文" : (modalReturn ?? "资料库")
    case .attachments: return "资料正文"
    case .preview: return "附件"
    }
  }
  private var navTitle: String {
    switch model.route {
    case .body: return tablet ? (model.detail?.title ?? "") : ""
    case .attachments: return "附件列表"
    case .preview(let file): return file.name
    }
  }
  private func article(width: CGFloat) -> some View {
    let columnWidth = min(width, 720)
    return ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          let categories = model.detail?.categories ?? []
          NativeSegmentedControl(
            labels: categories.map(\.rawValue),
            selection: Binding(
              get: { categories.firstIndex(of: model.category) ?? 0 },
              set: { index in
                guard categories.indices.contains(index) else { return }
                Task { await model.choose(categories[index]) }
              })
          ).padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 21)
          if let detail = model.detail {
            NativeText(
              detail.title, size: 26, bold: true, lineHeight: 34, explicitLineWidth: columnWidth - 48
            )
            .padding(.horizontal, 24).padding(.bottom, 17).accessibilityIdentifier(
              "review.detail.title")
            let subtitle = [detail.entry.statusLabel, detail.entry.dateLabel].filter { !$0.isEmpty }
              .joined(separator: "   ·   ")
            if !subtitle.isEmpty {
              NativeText(subtitle, size: 13).foregroundStyle(p.secondary).padding(.horizontal, 24)
                .padding(.bottom, 35 - 13 * 1.42).accessibilityIdentifier("reader.metadata")
            }
            Rectangle().fill(p.separator).frame(height: 1).padding(.horizontal, 24).padding(
              .bottom, 25)
          }
          if let document = model.document {
            VStack(alignment: .leading, spacing: 0) {
              ForEach(document.blocks) { block in
                NativeMarkdownBlockView(block: block, width: columnWidth - 48, model: model)
                  .id(block.id)
                  .background {
                    if case .heading = block.kind {
                      GeometryReader { location in
                        Color.clear.preference(
                          key: ReaderHeadingPositions.self,
                          value: [block.id: location.frame(in: .named("reader-scroll")).minY])
                      }
                    }
                  }
              }
            }.padding(.horizontal, 24)
          } else if let text = model.text {
            NativeText(text, size: 17, lineHeight: 29).textSelection(.enabled).padding(
              .horizontal, 24)
          }
        }.padding(.bottom, 30).frame(width: columnWidth, alignment: .leading).frame(maxWidth: .infinity)
      }.coordinateSpace(name: "reader-scroll").accessibilityIdentifier("reader.body")
        .onChange(of: model.anchor) { id in if let id { proxy.scrollTo(id, anchor: .top) } }
        .onPreferenceChange(ReaderHeadingPositions.self) { positions in
          if let id = positions.filter({ $0.value <= 30 }).max(by: { $0.value < $1.value })?.key {
            model.selectedHeading = id
          }
        }
    }
  }
  private var attachments: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(model.detail?.files ?? []) { file in
          Button {
            Task { await model.select(file, preview: true) }
          } label: {
            HStack(alignment: .top, spacing: 12) {
              NativeGlyph(name: "file").foregroundStyle(p.accent).padding(.top, 14)
              VStack(alignment: .leading, spacing: 0) {
                NativeText(file.name, size: 17).padding(.top, 14)
                NativeText(file.sizeLabel, size: 13).foregroundStyle(p.secondary).padding(
                  .top, max(0, 30 - 17 * 1.42))
              }
              Spacer(minLength: 4)
              NativeGlyph(name: "chevron", size: 18).foregroundStyle(p.secondary).padding(.top, 29)
                .padding(.trailing, 0)
            }.padding(.horizontal, 20).frame(minHeight: max(76, 76 * scale), alignment: .topLeading)
              .contentShape(Rectangle())
              .overlay(alignment: .top) {
                Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 56).padding(
                  .trailing, 20
                ).offset(y: max(67, 67 * scale))
              }
          }.accessibilityIdentifier("reader.attachment.\(file.name)")
        }
        if let omitted = model.detail?.omitted, !omitted.isEmpty {
          VStack(alignment: .leading, spacing: 0) {
            NativeText("仅留在采集电脑", size: 14).foregroundStyle(p.secondary).padding(
              .bottom, 40 - 14 * 1.42)
            ForEach(omitted, id: \.self) { path in
              HStack(alignment: .top, spacing: 12) {
                NativeGlyph(name: "file").foregroundStyle(p.secondary)
                VStack(alignment: .leading, spacing: 0) {
                  NativeText((path as NSString).lastPathComponent, size: 17).foregroundStyle(
                    p.secondary
                  ).padding(.top, 2)
                  NativeText("未上传", size: 13).foregroundStyle(p.secondary).padding(
                    .top, max(0, 32 - 17 * 1.42))
                }
              }.padding(.bottom, 18)
            }
          }.padding(.horizontal, 20).padding(.top, 26)
        }
      }.padding(.top, 35)
    }.accessibilityIdentifier("reader.attachments")
  }
  @ViewBuilder private func preview(_ file: ReadFile, size: CGSize) -> some View {
    if let data = model.data {
      if file.suffix == "pdf" {
        NativePDFPreview(data: data, model: model, size: size)
      } else if ["png", "jpg", "jpeg", "webp", "gif", "heic", "avif"].contains(file.suffix) {
        NativeImagePreview(data: data, model: model, size: size)
      } else if file.isText {
        VStack(spacing: 0) {
          ScrollView {
            let text = model.text ?? ""
            let cues = ["srt", "vtt"].contains(file.suffix) ? NativeSubtitleCue.parse(text) : []
            VStack(alignment: .leading, spacing: 0) {
              if !cues.isEmpty {
                ForEach(cues) { cue in
                  NativeMonoText(cue.timestamp, size: 13).foregroundStyle(p.accent).padding(
                    .bottom, 31 - 13 * 1.42)
                  NativeText(cue.text, size: 17, lineHeight: 28, explicitLineWidth: size.width - 48)
                    .padding(.bottom, 34)
                }
              } else if let document = model.document {
                ForEach(document.blocks) { block in
                  NativeMarkdownBlockView(block: block, width: size.width - 48, model: model)
                }
              } else {
                NativeText(text, size: 17, lineHeight: 28).textSelection(.enabled)
              }
            }.padding(.horizontal, 24).padding(.top, 36).frame(
              maxWidth: .infinity, alignment: .leading)
          }
          NativeButton(
            title: "复制文本", kind: .secondary, action: { UIPasteboard.general.string = model.text }
          )
          .padding(.horizontal, 20).padding(.bottom, 29).accessibilityIdentifier("reader.copyText")
        }
      } else {
        NativeContentState(kind: .failure, title: "暂不支持预览", actionTitle: "返回附件列表") {
          model.showAttachments()
        }.padding(.top, 36)
      }
    }
  }
  private func failure(width: CGFloat) -> some View {
    ScrollView {
      VStack(spacing: 0) {
        NativeGlyph(name: "alert", size: 48).foregroundStyle(p.secondary)
        NativeText(model.errorTitle, size: 20, bold: true).fixedSize(
          horizontal: scale <= 1.001, vertical: true
        ).padding(.top, 28 * scale)
          .accessibilityIdentifier("reader.failure.title")
        NativeButton(title: "重试", action: { Task { await model.retry() } }).frame(
          width: min(220 * scale, width - 40)
        )
        .padding(.top, 25.6 * scale).accessibilityIdentifier("reader.retry")
        Button {
          model.showAttachments()
        } label: {
          NativeText("返回附件列表", size: 16).fixedSize(horizontal: scale <= 1.001, vertical: true)
            .foregroundStyle(p.accent).frame(
              minHeight: 44, alignment: .top)
        }
        .padding(.top, 67 * scale).accessibilityIdentifier("reader.returnAttachments")
      }.frame(maxWidth: .infinity).padding(.top, 171)
    }.accessibilityIdentifier("reader.failure")
  }

}

private struct ReaderHeadingPositions: PreferenceKey {
  static var defaultValue: [String: CGFloat] = [:]
  static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
    value.merge(nextValue(), uniquingKeysWith: { _, new in new })
  }
}

struct NativeMonoText: View {
  let value: String
  let baseSize: CGFloat
  let pitch: CGFloat
  @ScaledMetric private var size: CGFloat
  init(_ value: String, size: CGFloat = 13, pitch: CGFloat? = nil) {
    self.value = value
    baseSize = size
    self.pitch = pitch ?? size * 1.42
    _size = ScaledMetric(wrappedValue: size)
  }
  var body: some View {
    NativeTextBaseline(size: size, lineHeight: pitch * size / baseSize) {
      Text(value).font(.system(size: size, design: .monospaced))
        .tracking(value.contains("→") ? 4 * size / baseSize / CGFloat(max(1, value.count)) : 0)
        .fixedSize(
          horizontal: false, vertical: true
        )
        .lineSpacing(
          pitch * size / baseSize
            - UIFont.monospacedSystemFont(ofSize: size, weight: .regular).lineHeight)
    }
  }
}

struct NativeMarkdownBlockView: View {
  let block: NativeMarkdownDocument.Block
  let width: CGFloat
  @ObservedObject var model: NativeReaderModel
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View { content.accessibilityIdentifier("reader.\(block.id)") }
  private var content: AnyView {
    switch block.kind {
    case .heading(let level):
      let size: CGFloat = level <= 1 ? 26 : level == 2 ? 21 : level == 3 ? 17 : 16
      return AnyView(
        NativeText(block.text, size: size, bold: true).padding(
          .bottom, max(0, (level <= 2 ? 38 : 31) - size * 1.42) * scale))
    case .code:
      return AnyView(
        ScrollView(.horizontal) {
          NativeMonoText(
            block.text.hasSuffix("\n") ? String(block.text.dropLast()) : block.text, pitch: 23
          ).textSelection(.enabled).padding(.horizontal, 15).padding(.top, 17).padding(.bottom, 22)
        }.frame(minHeight: 108 * scale, alignment: .top).background(
          p.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        ).contextMenu { Button("复制代码") { UIPasteboard.general.string = block.text } }.padding(
          .bottom, 29 * scale))
    case .table(let rows):
      return AnyView(
        ScrollView(.horizontal) {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(rows.indices, id: \.self) { row in
              HStack(alignment: .top, spacing: 12) {
                ForEach(rows[row].indices, id: \.self) { col in
                  NativeText(rows[row][col], size: 16, bold: row == 0).frame(
                    width: 180, alignment: .leading)
                }
              }.padding(12)
                .background(row == 0 ? p.well : p.surface)
              Rectangle().fill(p.separator).frame(height: 1)
            }
          }
        }.padding(.bottom, 25 * scale))
    case .quote:
      return AnyView(
        HStack(alignment: .top, spacing: 12) {
          Rectangle().fill(p.accent).frame(width: 3)
          nested(width: width - 15)
        }.fixedSize(horizontal: false, vertical: true).padding(.bottom, 16 * scale))
    case .list(let prefix):
      if prefix.isEmpty { return AnyView(nested(width: width).padding(.bottom, 16 * scale)) }
      return AnyView(
        HStack(alignment: .top, spacing: 8) {
          NativeText(prefix, size: 17).frame(width: 28, alignment: .leading)
          nested(width: width - 36)
        })
    case .rule:
      return AnyView(Rectangle().fill(p.separator).frame(height: 1).padding(.vertical, 16))
    case .paragraph, .literal:
      return AnyView(
        VStack(alignment: .leading, spacing: 12) {
          if let inline = block.inline {
            Text(inline).font(.system(size: 17 * scale)).lineSpacing(
              29 * scale - UIFont.systemFont(ofSize: 17 * scale).lineHeight
            ).textSelection(.enabled)
          } else if !block.text.isEmpty {
            NativeText(block.text, size: 17, lineHeight: 29, explicitLineWidth: width)
              .textSelection(.enabled)
          }
          ForEach(block.images.indices, id: \.self) { index in
            NativeInlineReaderImage(
              source: block.images[index].0, alt: block.images[index].1, model: model)
          }
          if !block.children.isEmpty { nested(width: width) }
        }.padding(.bottom, 25 * scale))
    }
  }
  private func nested(width: CGFloat) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(block.children) { NativeMarkdownBlockView(block: $0, width: width, model: model) }
    }
  }
}

private struct NativeInlineReaderImage: View {
  let source: String
  let alt: String
  @ObservedObject var model: NativeReaderModel
  @State private var image: UIImage?
  var body: some View {
    Group {
      if let image {
        Image(uiImage: image).resizable().scaledToFit().accessibilityLabel(alt)
      } else {
        NativeText(alt.isEmpty ? source : alt, size: 14).textSelection(.enabled)
      }
    }.task(id: source) {
      image = nil
      if let bytes = try? await model.inlineImage(source) { image = UIImage(data: bytes) }
    }
  }
}
