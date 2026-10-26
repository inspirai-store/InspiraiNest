#if DEBUG
  import CryptoKit
  import PDFKit
  import SwiftUI
  import UIKit

  /// All files are generated in memory. This entry never constructs AppModel or a credential store.
  @MainActor struct NativeReaderReview: View {
    let configuration: NativeReviewConfiguration
    @StateObject private var library: NativeLibraryModel
    @StateObject private var reader: NativeReaderModel
    @State private var module: NativeAppModule = .library
    @State private var reading = true
    @State private var path: [ReadEntry] = [NativeLibraryFixtureService.records[0]]
    @State private var started = false
    init(configuration: NativeReviewConfiguration) {
      self.configuration = configuration
      _library = StateObject(
        wrappedValue: NativeLibraryModel(
          service: NativeLibraryFixtureService(page: "P01"), favorites: ["library-0", "library-2"]))
      _reader = StateObject(wrappedValue: NativeReaderModel())
    }
    var body: some View {
      GeometryReader { geometry in
        let tablet = UIDevice.current.userInterfaceIdiom == .pad && geometry.size.width >= 760
        NativeLibraryView(
          model: library, module: $module, reading: $reading, path: $path,
          reader: { entry in
            NativeReaderView(
              model: reader, entryID: entry.id, tablet: tablet,
              favorite: library.favorites.contains(reader.detail?.id ?? entry.id),
              toggleFavorite: { library.toggleFavorite(reader.detail?.id ?? entry.id) })
          }, pair: {}
        )
        .overlay {
          NativeReaderPanels(model: reader)
            .allowsHitTesting(
              reader.panel != nil || reader.exportData != nil || reader.notice != nil
            )
            .accessibilityHidden(
              reader.panel == nil && reader.exportData == nil && reader.notice == nil)
        }
        .task {
          guard !started else { return }
          started = true
          let width: CGFloat = tablet ? geometry.size.width - 561 : geometry.size.width
          let fullHeight =
            geometry.size.height + geometry.safeAreaInsets.top + geometry.safeAreaInsets.bottom
          let height: CGFloat = tablet ? fullHeight : fullHeight - 44 - 35
          let fixture = NativeReaderFixtureService(
            page: configuration.page, width: width, detailHeight: height)
          reader.configure(service: fixture)
          await reader.open("library-0")
          switch configuration.page {
          case "P07": reader.panel = .files
          case "P08": reader.panel = .outline
          case "P09": reader.panel = .info
          case "P10": reader.showAttachments()
          case "P11", "S08":
            if let file = reader.detail?.files.first(where: { $0.suffix == "pdf" }) {
              await reader.select(file, preview: true)
            }
          case "P12":
            if let file = reader.detail?.files.first(where: { $0.suffix == "png" }) {
              await reader.select(file, preview: true)
            }
          case "P13":
            if let file = reader.detail?.files.first(where: { $0.suffix == "srt" }) {
              await reader.select(file, preview: true)
            }
          default: break
          }
        }
      }.modifier(NativeReaderExportPresentation(model: reader))
    }
  }

  actor NativeReaderFixtureService: LibraryReadingService {
    let page: String
    let payloads: [String: Data]
    let files: [ReadFile]
    private var attempts = 0
    private let archiveData: Data
    private var archiveID: String { ReadFile.digest(archiveData) }
    static let markdown = """
      ## 原生界面的结构
      ### 三栏内容组织
      将分类、资料列表和阅读内容分开组织。宽屏同时呈现三栏，窄屏依次进入列表和正文，返回时保留当前选择。

      ```swift
      NavigationSplitView {
          Sidebar()
      } detail: { ReaderView() }
      ```

      ## 导航与层级
      ### 返回与选择
      分类与主题帮助定位资料，大纲按照正文标题组织。来源与附件保留各自的定位信息，便于逐项核对。

      ## 状态与反馈
      本机保存与服务器提交分别记录。归档前重新核对草稿版本，错误状态保留可恢复的操作。

      ## 阅读体验
      正文随字号调整换行，附件保留原始文件内容，大纲对应正文标题。
      """
    static let subtitles = """
      1
      00:00:04,120 --> 00:00:09,850
      使用分类与列表定位资料，阅读区保持清晰的层级。

      2
      00:00:10,200 --> 00:00:15,600
      宽屏呈现三栏，窄屏保留选择并依次进入详情。

      3
      00:00:16,850 --> 00:00:22,180
      来源正文与转录各自保存，便于核对原始信息。

      4
      00:00:22,900 --> 00:00:28,940
      大纲根据标题组织，阅读状态随导航延续。
      """
    init(page: String, width: CGFloat, detailHeight: CGFloat) {
      self.page = page
      var values: [String: Data] = [:]
      func text(_ source: String, bytes: Int) -> Data {
        var value = Data(source.utf8)
        value.append(Data(repeating: 10, count: max(0, bytes - value.count)))
        return value
      }
      let readingPages = ["P06", "P07", "P08", "P09"].contains(page)
      values["summary.md"] = text(Self.markdown, bytes: 12000)
      values["source/article.md"] = text(Self.markdown, bytes: 45000)
      values["transcript/subtitles.srt"] = text(Self.subtitles, bytes: 28000)
      if readingPages {
        values["analysis.md"] = text("## 场景分析\n\n提炼导航与阅读的设计要点，保留代码片段。", bytes: 2000)
      } else {
        values["architecture.pdf"] = NativeReaderFixtureDrawing.pdf(
          width: width - 40, height: detailHeight - 171)
        values["layout.png"] = NativeReaderFixtureDrawing.image(
          width: width - 40, height: detailHeight - 248)
      }
      payloads = values
      let order =
        readingPages
        ? ["summary.md", "analysis.md", "source/article.md", "transcript/subtitles.srt"]
        : [
          "summary.md", "source/article.md", "transcript/subtitles.srt", "architecture.pdf",
          "layout.png",
        ]
      let registered = order.compactMap { path -> ReadFile? in
        guard let data = values[path] else { return nil }
        let role =
          path == "summary.md"
          ? "summary"
          : path == "analysis.md"
            ? "scenario"
            : path.hasPrefix("source/")
              ? "source"
              : path.hasPrefix("transcript/")
                ? "transcript" : path.hasSuffix(".pdf") ? "document" : "image"
        return ReadFile(path: path, role: role, bytes: data.count, sha256: ReadFile.digest(data))
      }
      files = registered
      let packet: [String: Any] = [
        "meta": [
          "title": "SwiftUI 原生界面实践", "summary": "原生导航与阅读", "coverage_note": "正文已保存，媒体未上传",
          "status": "archived",
        ],
        "files": registered.map { file in
          [
            "path": file.path, "role": file.role ?? "",
            "body": values[file.path]!.base64EncodedString(), "bytes": file.bytes,
            "sha256": file.sha256,
          ] as [String: Any]
        }, "omitted": ["recording.mp4"],
      ]
      archiveData = try! JSONSerialization.data(withJSONObject: packet, options: [.sortedKeys])
    }
    func readDetail(id: String) async throws -> ReadDetail {
      let record =
        id == "long-0" ? NativeLibraryFixtureService.longRecord
        : NativeLibraryFixtureService.records.first(where: { $0.id == id })
        ?? NativeLibraryFixtureService.records[0]
      let longMetadata = ProcessInfo.processInfo.arguments.contains("--review-long-metadata")
      let json: [String: Any] = [
        "id": id, "archive_id": archiveID, "title": record.title,
        "summary": record.summary ?? "", "type": record.type ?? "", "status": record.status ?? "",
        "source_url": "https://example.com/swiftui",
        "author": longMetadata ? String(repeating: "资料作者", count: 12) : "资料作者",
        "published_at": "2026-10-08",
        "collected_at": record.collectedAt ?? "", "verification_status": "source_only",
        "coverage_note": "正文已保存，媒体未上传", "tags": record.tags ?? [],
        "related": id == "library-0" ? ["library-1", "library-2"] : [],
        "files": files.map {
          ["path": $0.path, "role": $0.role ?? "", "bytes": $0.bytes, "sha256": $0.sha256]
        }, "omitted": ["recording.mp4"],
      ]
      return try JSONDecoder().decode(
        ReadDetail.self, from: JSONSerialization.data(withJSONObject: json))
    }
    func readFile(entry: ReadDetail, file: ReadFile) async throws -> Data {
      if file.suffix == "pdf" {
        attempts += 1
        if page == "S08" && attempts == 1 { throw CollectorError.http(503) }
      }
      guard let data = payloads[file.path] else { throw CollectorError.http(404) }
      try file.verify(data)
      return data
    }
    func readArchiveData(digest: String) async throws -> Data {
      guard digest == archiveID else { throw CollectorError.http(404) }
      let bundle = try JSONDecoder().decode(DraftBundle.self, from: archiveData)
      try AttachmentIntegrity.validate(bundle)
      return archiveData
    }
  }

  /// Actual 4-page PDF and PNG original files, rendered by PDFKit/UIImage at runtime.
  private enum NativeReaderFixtureDrawing {
    static func text(
      _ value: String, x: CGFloat, y: CGFloat, size: CGFloat, bold: Bool = false,
      width: CGFloat? = nil, color: UIColor = .label, pitch: CGFloat? = nil, mono: Bool = false
    ) {
      var px = x
      var py = y
      let latin =
        mono
        ? UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
        : UIFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
      for ch in value {
        let chinese = ch.unicodeScalars.contains { $0.value > 255 }
        let font =
          chinese
          ? UIFont(name: bold ? "PingFangSC-Semibold" : "PingFangSC-Regular", size: size)! : latin
        let advance =
          chinese
          ? size
          : mono ? size * 0.602 : NativeLatinAdvances.width(String(ch), size: size, bold: bold)
        if ch == "\n" {
          px = x
          py += pitch ?? size * 1.42
          continue
        }
        if let width, px > x, px + advance > x + width {
          px = x
          py += pitch ?? size * 1.42
        }
        (String(ch) as NSString).draw(
          at: CGPoint(
            x: px + (ch == "。" ? 3 * size / 14 : 0),
            y: py + size * 0.93 - font.ascender - (ch == "。" ? 4.5 * size / 14 : 0)),
          withAttributes: [.font: font, .foregroundColor: color])
        px += advance
      }
    }
    static func diagram(x: CGFloat, y: CGFloat, width: CGFloat) {
      let cw = (width - 26) / 3
      for (index, label) in ["分类", "列表", "阅读"].enumerated() {
        let xx = x + CGFloat(index) * (cw + 13)
        let box = UIBezierPath(
          roundedRect: CGRect(x: xx, y: y, width: cw, height: 112), cornerRadius: 12)
        UIColor(red: 246 / 255, green: 245 / 255, blue: 241 / 255, alpha: 1).setFill()
        box.fill()
        UIColor(red: 217 / 255, green: 213 / 255, blue: 202 / 255, alpha: 1).setStroke()
        box.lineWidth = 1
        box.stroke()
        text(
          label, x: xx + cw / 2 - 14, y: y + 18, size: 14, bold: true,
          color: UIColor(red: 56 / 255, green: 56 / 255, blue: 46 / 255, alpha: 1))
        for line in 0..<3 {
          UIColor(red: 216 / 255, green: 211 / 255, blue: 199 / 255, alpha: 1).setFill()
          UIBezierPath(
            roundedRect: CGRect(
              x: xx + 12, y: y + 53 + CGFloat(line) * 13, width: cw - 24, height: 4),
            cornerRadius: 2
          ).fill()
        }
        if index < 2 {
          UIColor(red: 217 / 255, green: 119 / 255, blue: 6 / 255, alpha: 1).setStroke()
          let arrow = UIBezierPath()
          arrow.move(to: CGPoint(x: xx + cw + 4.5, y: y + 50.25))
          arrow.addLine(to: CGPoint(x: xx + cw + 7, y: y + 56.25))
          arrow.addLine(to: CGPoint(x: xx + cw + 4.5, y: y + 62.25))
          arrow.lineWidth = 1
          arrow.lineJoinStyle = .round
          arrow.stroke()
        }
      }
    }
    static func pdf(width: CGFloat, height: CGFloat) -> Data {
      let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: width, height: height))
      var data = renderer.pdfData { context in
        for page in 1...4 {
          context.beginPage()
          UIColor.white.setFill()
          context.cgContext.fill(CGRect(x: 0, y: 0, width: width, height: height))
          text(
            page == 1 ? "原生界面结构与阅读" : "原生界面结构与阅读 · \(page)", x: 20, y: 30, size: 21, bold: true,
            width: width - 40,
            color: UIColor(red: 28 / 255, green: 28 / 255, blue: 30 / 255, alpha: 1))
          text("分类、列表与正文", x: 20, y: 98, size: 17, bold: true, color: .black)
          text(
            "根据窗口宽度安排导航层级。正文与附件分别保留来源定位。", x: 20, y: 136, size: 15, width: width - 40,
            color: UIColor(white: 59 / 255, alpha: 1), pitch: 25)
          diagram(x: 18, y: 264, width: width - 36)
        }
      }
      // Legal PDF trailing whitespace. Recorded bytes and checksum describe the actual fixture.
      data.append(Data(repeating: 10, count: max(0, 1_400_000 - data.count)))
      return data
    }
    static func image(width: CGFloat, height: CGFloat) -> Data {
      let format = UIGraphicsImageRendererFormat()
      format.scale = 2
      format.opaque = false
      let image = UIGraphicsImageRenderer(
        size: CGSize(width: width, height: height), format: format
      ).image { _ in diagram(x: 15, y: 115, width: width - 30) }
      let png = image.pngData()!
      var chunk = Data("tEXt".utf8)
      let paddingSize = max(13, 320000 - png.count - 12)
      chunk.append(Data("ReviewPadding\0".utf8))
      chunk.append(Data(repeating: 32, count: max(0, paddingSize - 14)))
      var crc: UInt32 = 0xffff_ffff
      for byte in chunk {
        crc ^= UInt32(byte)
        for _ in 0..<8 { crc = crc & 1 == 1 ? (crc >> 1) ^ 0xedb8_8320 : crc >> 1 }
      }
      crc ^= 0xffff_ffff
      func bigEndian(_ value: UInt32) -> Data {
        var v = value.bigEndian
        return withUnsafeBytes(of: &v) { Data($0) }
      }
      var result = png.dropLast(12)
      result.append(bigEndian(UInt32(chunk.count - 4)))
      result.append(chunk)
      result.append(bigEndian(crc))
      result.append(png.suffix(12))
      return result
    }
  }
#endif
