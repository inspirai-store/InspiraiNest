import Foundation
import SwiftUI

@MainActor final class NativeReaderModel: ObservableObject {
  enum Phase: Equatable { case loading, ready, unavailable, offline, expired, changed, integrity }
  enum Route: Equatable {
    case body, attachments
    case preview(ReadFile)
  }
  enum Panel: String {
    case files = "阅读文件切换"
    case outline = "阅读大纲"
    case info = "归档信息与相关资料"
    case menu = "更多"
    case thumbnails = "页面缩略图"
  }
  @Published private(set) var detail: ReadDetail?
  @Published private(set) var data: Data?
  @Published private(set) var document: NativeMarkdownDocument?
  @Published private(set) var phase: Phase = .loading
  @Published private(set) var related: [ReadEntry] = []
  @Published var route: Route = .body
  @Published var panel: Panel?
  @Published private(set) var selectedFile: ReadFile?
  @Published private(set) var category: ReaderCategory = .report
  @Published var anchor: String?
  @Published var selectedHeading: String?
  @Published var pdfPage = 1
  @Published var pdfPageCount = 0
  @Published var pdfZoom: CGFloat = 1
  @Published var imageZoom: CGFloat = 1
  @Published var exportData: Data?
  @Published var exporting = false
  @Published var notice: String?
  private var service: (any LibraryReadingService)?
  @Published private(set) var sessionKey = UUID()
  private var generation = UUID()
  private var operation = UUID()
  private var currentID: String?
  private var positions: [String: String] = [:]
  private var history: [String] = []
  init(service: (any LibraryReadingService)? = nil) { self.service = service }
  func configure(service: (any LibraryReadingService)?) {
    clear()
    self.service = service
    sessionKey = UUID()
  }
  func clear() {
    generation = UUID()
    operation = UUID()
    currentID = nil
    detail = nil
    data = nil
    document = nil
    selectedFile = nil
    related = []
    panel = nil
    route = .body
    category = .report
    positions = [:]
    history = []
    exportData = nil
    exporting = false
    notice = nil
    phase = .loading
  }
  var text: String? { data.flatMap { String(data: $0, encoding: .utf8) } }
  var canBack: Bool { route != .body || !history.isEmpty }
  var errorTitle: String {
    switch phase {
    case .integrity: return "附件校验失败"
    case .changed: return "归档已更新"
    case .offline: return "离线"
    case .expired: return "授权已失效"
    default: return route == .body ? "正文暂不可用" : "附件暂不可用"
    }
  }
  func open(_ id: String, resetHistory: Bool = false) async {
    if resetHistory { history = [] }
    guard currentID != id || (detail == nil && phase != .loading) else { return }
    rememberPosition()
    currentID = id
    operation = UUID()
    let op = operation
    let gen = generation
    detail = nil
    data = nil
    document = nil
    related = []
    selectedFile = nil
    panel = nil
    route = .body
    phase = .loading
    guard let service else {
      phase = .unavailable
      return
    }
    do {
      let entry = try await service.readDetail(id: id)
      try entry.validate(expectedID: id)
      guard op == operation, gen == generation, !Task.isCancelled else { return }
      detail = entry
      category = entry.categories.first(where: { $0 != .attachments }) ?? .attachments
      if let first = entry.files(in: category).first ?? entry.readableFiles.first {
        await select(first, preview: false)
      } else {
        route = .attachments
        phase = .ready
      }
      guard currentID == id, gen == generation else { return }
      var records: [ReadEntry] = []
      for target in (entry.related ?? []) where target != id {
        do { records.append(try await service.readDetail(id: target).entry) } catch {
          if Self.authorization(error) {
            fail(error)
            return
          }
        }
      }
      guard currentID == id, gen == generation else { return }
      related = records
    } catch { if op == operation, gen == generation { fail(error) } }
  }
  func select(_ file: ReadFile, preview: Bool) async {
    guard let detail, let service else { return }
    rememberPosition()
    operation = UUID()
    let op = operation
    let gen = generation
    selectedFile = file
    data = nil
    document = nil
    phase = .loading
    panel = nil
    route = preview ? .preview(file) : .body
    if !preview,
      let group = detail.categories.first(where: {
        $0 != .attachments && detail.files(in: $0).contains(file)
      })
    {
      category = file.role == "scenario" ? .scenario : group
    }
    pdfPage = 1
    pdfPageCount = 0
    pdfZoom = 1
    imageZoom = 1
    do {
      guard detail.files.contains(file) else { throw ReaderFailure.integrity }
      let bytes = try await service.readFile(entry: detail, file: file)
      try file.verify(bytes)
      try Task.checkCancellation()
      guard op == operation, gen == generation else { return }
      if file.isText {
        guard let source = String(data: bytes, encoding: .utf8) else {
          throw ReaderFailure.invalidText
        }
        if ["md", "markdown"].contains(file.suffix) { document = NativeMarkdownDocument(source) }
      }
      data = bytes
      phase = .ready
      anchor = positions[detail.id + "|" + file.path]
      selectedHeading = anchor ?? document?.headings.first?.id
    } catch { if op == operation, gen == generation { fail(error) } }
  }
  func choose(_ category: ReaderCategory) async {
    guard let detail else { return }
    self.category = category
    if category == .attachments {
      rememberPosition()
      route = .attachments
      phase = .ready
      panel = nil
    } else if let file = detail.files(in: category).first {
      await select(file, preview: false)
    }
  }
  func showAttachments() {
    rememberPosition()
    panel = nil
    route = .attachments
    phase = .ready
  }
  func back() async {
    if case .preview = route {
      showAttachments()
    } else if route == .attachments {
      if let file = detail?.files(in: .report).first ?? detail?.readableFiles.first {
        category = .report
        await select(file, preview: false)
      } else {
        route = .body
      }
    } else if let id = history.popLast() {
      currentID = nil
      await open(id)
    }
  }
  func openRelated(_ entry: ReadEntry) async {
    if let currentID { history.append(currentID) }
    panel = nil
    currentID = nil
    await open(entry.id)
  }
  func retry() async {
    if phase == .changed || detail == nil {
      if let id = currentID {
        let path = selectedFile?.path
        let preview = route != .body
        currentID = nil
        await open(id)
        if preview, let path, let file = detail?.files.first(where: { $0.path == path }) {
          await select(file, preview: true)
        }
      }
    } else if let file = selectedFile {
      await select(file, preview: route != .body)
    }
  }
  func jump(to id: String) {
    selectedHeading = id
    anchor = id
    panel = nil
  }
  func rememberPosition() {
    if let detail, let file = selectedFile, let selectedHeading {
      positions[detail.id + "|" + file.path] = selectedHeading
    }
  }
  func saveArchive() async {
    guard !exporting, let detail, let service else { return }
    exporting = true
    let gen = generation
    let id = detail.id
    do {
      let bytes = try await service.readArchiveData(digest: detail.archiveID)
      guard ReadFile.digest(bytes) == detail.archiveID else { throw ReaderFailure.integrity }
      let current = try await service.readDetail(id: id)
      guard current.archiveID == detail.archiveID else { throw ReaderFailure.changed }
      guard gen == generation, currentID == id else { return }
      exportData = bytes
    } catch {
      if gen == generation {
        if Self.authorization(error) { fail(error) } else { notice = "归档包保存失败" }
      }
    }
    if gen == generation { exporting = false }
  }
  private func localFile(_ source: String) -> ReadFile? {
    guard let detail, let selectedFile, !source.hasPrefix("/"), URL(string: source)?.scheme == nil,
      !source.contains("\\"), !source.contains("\0")
    else { return nil }
    let decoded = source.removingPercentEncoding ?? source
    let parent = (selectedFile.path as NSString).deletingLastPathComponent
    let path = ((parent.isEmpty ? "" : parent + "/") + decoded as NSString).standardizingPath
    guard !path.hasPrefix("../"), !path.hasPrefix("/") else { return nil }
    return detail.files.first(where: { $0.path == path })
  }
  func openLocalLink(_ source: String) async {
    let target = URLComponents(string: source)
    if let fragment = target?.fragment, target?.path.isEmpty == true {
      func slug(_ title: String) -> String {
        title.lowercased().replacingOccurrences(of: " ", with: "-").replacingOccurrences(
          of: "[^\\p{L}\\p{N}_-]", with: "", options: .regularExpression)
      }
      if let heading = document?.headings.first(where: {
        $0.title == fragment || slug($0.title) == fragment
      }) {
        jump(to: heading.id)
      }
      return
    }
    guard let path = target?.percentEncodedPath, let file = localFile(path) else {
      notice = "找不到附件"
      return
    }
    await select(file, preview: !["md", "markdown"].contains(file.suffix))
    if let fragment = target?.fragment,
      let heading = document?.headings.first(where: { $0.title == fragment })
    {
      jump(to: heading.id)
    }
  }
  func inlineImage(_ source: String) async throws -> Data {
    guard let detail, let file = localFile(source), let service else {
      throw ReaderFailure.unsupported
    }
    let gen = generation
    do {
      let bytes = try await service.readFile(entry: detail, file: file)
      guard gen == generation else { throw CancellationError() }
      try file.verify(bytes)
      return bytes
    } catch {
      if gen == generation, Self.authorization(error) { fail(error) }
      throw error
    }
  }
  private static func authorization(_ error: Error) -> Bool {
    if case CollectorError.http(let status) = error { return status == 401 || status == 403 }
    return false
  }
  private func fail(_ error: Error) {
    data = nil
    document = nil
    if Self.authorization(error) {
      clear()
      phase = .expired
      return
    }
    if let error = error as? ReaderFailure {
      phase = error == .changed ? .changed : error == .integrity ? .integrity : .unavailable
    } else if let error = error as? URLError,
      [.notConnectedToInternet, .networkConnectionLost, .timedOut].contains(error.code)
    {
      phase = .offline
    } else if case CollectorError.http(409) = error {
      phase = .changed
    } else {
      phase = .unavailable
    }
  }
}
