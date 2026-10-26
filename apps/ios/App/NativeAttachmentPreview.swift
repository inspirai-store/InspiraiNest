import PDFKit
import SwiftUI
import UIKit

struct NativePDFPreview: View {
  let data: Data
  @ObservedObject var model: NativeReaderModel
  let size: CGSize
  @Environment(\.openURL) private var openURL
  @Environment(\.colorScheme) private var scheme
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    if PDFDocument(data: data)?.pageCount ?? 0 > 0 {
      ZStack(alignment: .top) {
        NativeText("\(model.pdfPage) / \(max(1, model.pdfPageCount))", size: 14).fixedSize()
          .foregroundStyle(p.secondary).padding(.top, 18).accessibilityIdentifier(
            "reader.pdf.count")
        NativePDFCanvas(data: data, model: model, openLink: { openURL($0) })
          .frame(width: max(1, size.width - 40), height: max(1, size.height - 127))
          .background(.white).clipShape(RoundedRectangle(cornerRadius: 3))
          .overlay(RoundedRectangle(cornerRadius: 3).stroke(p.separator, lineWidth: 1))
          .padding(.top, 57).accessibilityIdentifier("reader.pdf.canvas")
        NativeText("\(Int((model.pdfZoom * 100).rounded()))%", size: 14).fixedSize()
          .foregroundStyle(p.secondary)
          .padding(.top, size.height - 44).accessibilityIdentifier("reader.pdf.zoom")
      }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    } else {
      NativeContentState(kind: .failure, title: "PDF 无法预览", actionTitle: "返回附件列表") {
        model.showAttachments()
      }.padding(.top, 36)
    }
  }
}

private struct NativePDFCanvas: UIViewRepresentable {
  let data: Data
  @ObservedObject var model: NativeReaderModel
  let openLink: (URL) -> Void
  func makeCoordinator() -> Coordinator { Coordinator(model: model, openLink: openLink) }
  func makeUIView(context: Context) -> PDFContainer {
    let container = PDFContainer()
    let view = container.pdf
    view.backgroundColor = .white
    view.displayMode = .singlePageContinuous
    view.displayDirection = .vertical
    view.displaysPageBreaks = false
    view.pageBreakMargins = .zero
    view.autoScales = true
    view.delegate = context.coordinator
    context.coordinator.view = view
    NotificationCenter.default.addObserver(
      context.coordinator, selector: #selector(Coordinator.changed), name: .PDFViewPageChanged,
      object: view)
    NotificationCenter.default.addObserver(
      context.coordinator, selector: #selector(Coordinator.changed), name: .PDFViewScaleChanged,
      object: view)
    return container
  }
  func updateUIView(_ container: PDFContainer, context: Context) {
    let view = container.pdf
    let digest = ReadFile.digest(data)
    if context.coordinator.digest != digest {
      context.coordinator.digest = digest
      view.document = PDFDocument(data: data)
      DispatchQueue.main.async { context.coordinator.changed() }
    }
    if let page = view.document?.page(at: max(0, model.pdfPage - 1)), view.currentPage != page {
      UIView.performWithoutAnimation {
        view.go(to: page)
        view.layoutIfNeeded()
      }
    }
  }
  static func dismantleUIView(_ container: PDFContainer, coordinator: Coordinator) {
    NotificationCenter.default.removeObserver(coordinator)
    container.pdf.document = nil

  }
  final class PDFContainer: UIView {
    let pdf = PDFView()
    override init(frame: CGRect) {
      super.init(frame: frame)
      clipsToBounds = true
      pdf.clipsToBounds = true
      addSubview(pdf)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
      super.layoutSubviews()
      pdf.frame = bounds
    }
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
      bounds.contains(point)
    }
  }
  final class Coordinator: NSObject, PDFViewDelegate {
    weak var view: PDFView?
    let model: NativeReaderModel
    var digest = ""
    let openLink: (URL) -> Void
    init(model: NativeReaderModel, openLink: @escaping (URL) -> Void) {
      self.model = model
      self.openLink = openLink
    }
    func pdfViewWillClick(onLink sender: PDFView, with url: URL) {
      guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil,
        url.user == nil, url.password == nil
      else { return }
      openLink(url)
    }
    @objc func changed() {
      guard let view, let document = view.document else { return }
      DispatchQueue.main.async { [weak self] in
        guard let self, let view = self.view, view.document === document else { return }
        let page = view.currentPage.map { document.index(for: $0) + 1 } ?? 1
        let count = document.pageCount
        let fit = view.scaleFactorForSizeToFit
        let zoom = fit > 0 ? view.scaleFactor / fit : 1
        if self.model.pdfPage != page { self.model.pdfPage = page }
        if self.model.pdfPageCount != count { self.model.pdfPageCount = count }
        if abs(self.model.pdfZoom - zoom) > 0.001 { self.model.pdfZoom = zoom }
      }
    }
  }
}

struct NativeImagePreview: View {
  let data: Data
  @ObservedObject var model: NativeReaderModel
  let size: CGSize
  @Environment(\.colorScheme) private var scheme
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    if let image = UIImage(data: data) {
      ZStack(alignment: .topLeading) {
        NativeZoomImage(image: image, zoom: $model.imageZoom)
          .frame(width: max(1, size.width - 40), height: max(1, size.height - 204))
          .background(p.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          .padding(.leading, 20).padding(.top, 71).accessibilityIdentifier("reader.image.canvas")
        HStack(alignment: .top) {
          Button {
            model.imageZoom = max(1, model.imageZoom / 1.25)
          } label: {
            NativeText("−", size: 24).offset(y: -4).frame(
              width: 44, height: 44, alignment: .topLeading)
          }.accessibilityIdentifier("reader.image.minus")
          Spacer()
          NativeText("\(Int((model.imageZoom * 100).rounded()))%", size: 15).fixedSize()
            .foregroundStyle(p.secondary).padding(.top, 3).accessibilityIdentifier(
              "reader.image.zoom")
          Spacer()
          Button {
            model.imageZoom = min(8, model.imageZoom * 1.25)
          } label: {
            NativeText("+", size: 24).fixedSize().frame(
              width: 44, height: 44, alignment: .topTrailing)
          }.accessibilityIdentifier("reader.image.plus")
        }.foregroundStyle(p.accent).padding(.horizontal, 66).padding(.top, size.height - 91)
      }
    } else {
      NativeContentState(kind: .failure, title: "图片无法预览", actionTitle: "返回附件列表") {
        model.showAttachments()
      }.padding(.top, 36)
    }
  }
}

private struct NativeZoomImage: UIViewRepresentable {
  let image: UIImage
  @Binding var zoom: CGFloat
  func makeCoordinator() -> Coordinator { Coordinator(zoom: $zoom) }
  func makeUIView(context: Context) -> Canvas {
    let view = Canvas()
    view.clipsToBounds = true
    view.minimumZoomScale = 1
    view.maximumZoomScale = 8
    view.delegate = context.coordinator
    view.imageView.image = image
    view.imageView.contentMode = .scaleAspectFit
    view.addSubview(view.imageView)
    view.showsVerticalScrollIndicator = false
    view.showsHorizontalScrollIndicator = false
    view.isAccessibilityElement = true
    view.accessibilityLabel = "图片预览"
    view.accessibilityTraits = .image
    return view
  }
  func updateUIView(_ view: Canvas, context: Context) {
    context.coordinator.zoom = $zoom
    if view.imageView.image !== image { view.imageView.image = image }
    if abs(view.zoomScale - zoom) > 0.01 { view.setZoomScale(zoom, animated: false) }
  }
  final class Canvas: UIScrollView {
    let imageView = UIImageView()
    private var oldSize = CGSize.zero
    override func layoutSubviews() {
      super.layoutSubviews()
      if oldSize != bounds.size {
        oldSize = bounds.size
        let originalZoom = zoomScale
        setZoomScale(1, animated: false)
        imageView.frame = CGRect(origin: .zero, size: bounds.size)
        contentSize = bounds.size
        setZoomScale(originalZoom, animated: false)
      }
    }
  }
  final class Coordinator: NSObject, UIScrollViewDelegate {
    var zoom: Binding<CGFloat>
    init(zoom: Binding<CGFloat>) { self.zoom = zoom }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
      (scrollView as? Canvas)?.imageView
    }
    func scrollViewDidZoom(_ scrollView: UIScrollView) {
      let value = scrollView.zoomScale
      if abs(zoom.wrappedValue - value) > 0.01 {
        DispatchQueue.main.async { self.zoom.wrappedValue = value }
      }
    }
  }
}

struct NativePDFThumbnailList: View {
  let data: Data
  @ObservedObject var model: NativeReaderModel
  var body: some View {
    if let document = PDFDocument(data: data) {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 16) {
        ForEach(0..<document.pageCount, id: \.self) { index in
          if let page = document.page(at: index) {
            Button {
              model.pdfPage = index + 1
              model.panel = nil
            } label: {
              VStack {
                Image(uiImage: page.thumbnail(of: CGSize(width: 240, height: 300), for: .mediaBox))
                  .resizable().scaledToFit().frame(height: 160)
                NativeText("\(index + 1)", size: 14)
              }
            }.accessibilityLabel("第 \(index + 1) 页").accessibilityIdentifier(
              "reader.pdf.page.\(index + 1)")
          }
        }
      }
    }
  }
}
