import SwiftUI
import UIKit

@MainActor
final class ShareModel: ObservableObject {
  @Published var parts: [SharedPart] = [] { didSet { autosave() } }
  @Published var requirements = "" { didSet { autosave() } }
  @Published var autoArchive = true { didSet { autosave() } }
  @Published var tags = "" { didSet { autosave() } }
  @Published var loading = true
  @Published var saving = false
  @Published var saved = false
  @Published var message: String?
  @Published var captureNotice: String?
  @Published var captureFailed = false
  @Published var agent = "" { didSet { autosave() } }
  @Published var deviceID = "" { didSet { autosave() } }
  @Published var devices: [Device] = []
  @Published var dispatchNotice = "电脑与 Agent 默认自动选择。"
  @Published var loadingDevices = false
  private let dependencies: ShareDependencies
  @Published var omittedAttachments = 0
  @Published var advanced = false
  @Published var submitted = false
  @Published var savedOrigin: String?
  @Published var openedMainApp = false
  @Published var submissionFailure: String?
  @Published var dispatchFailure: String?
  @Published var hasPairing: Bool?
  private let submissionID: UUID
  let manual: Bool
  private var composition: LocalComposition
  private var compositionReady = false
  @Published private(set) var draftFailure: String?
  private var finished = false
  private var dispatchOrigin: String?
  init(dependencies: ShareDependencies, composition: LocalComposition? = nil) {
    self.dependencies = dependencies
    let draft = composition ?? LocalComposition(manual: false)
    self.composition = draft
    submissionID = UUID(uuidString: draft.id) ?? UUID()
    manual = draft.manual
    if composition != nil {
      parts = draft.parts
      requirements = draft.requirements
      tags = draft.tags
      autoArchive = draft.autoArchive
      deviceID = draft.deviceID
      agent = draft.agent
      dispatchOrigin = draft.origin
      omittedAttachments = draft.omittedAttachments ?? 0
      if omittedAttachments > 0 {
        captureNotice = "已读取下方文字与链接；另有 \(omittedAttachments) 份图片、视频或其他附件未收录。请核对原文后保存。"
      }
      loading = false
      compositionReady = true
    }
  }
  convenience init(context: NSExtensionContext?) {
    self.init(dependencies: .live(context: context))
  }
  func capture() async {
    loading = true
    captureFailed = false
    message = nil
    captureNotice = nil
    defer { loading = false }
    do {
      let captured = try await dependencies.capture()
      omittedAttachments = captured.omittedAttachments
      parts = captured.parts
      compositionReady = true
      autosave()
      if captured.omittedAttachments > 0 {
        captureNotice = "已读取下方文字与链接；另有 \(captured.omittedAttachments) 份图片、视频或其他附件未收录。请核对原文后保存。"
      }
    } catch {
      captureFailed = true
      message = safeMessage(error)
    }
  }
  func save() async {
    guard !saving, !saved, !loading, !captureFailed, !finished else { return }
    guard flushDraft() else { message = draftFailure; return }
    saving = true
    defer { saving = false }
    do {

      // A locked/unavailable Keychain does not prevent durable capture.
      // Unbound items require explicit binding in the main application.
      let credential = try? dependencies.credential()
      // A credential disappearing mid-sheet must never discard a chosen
      // device or the original share. Pin to the origin whose options were
      // displayed, then leave it queued if the current credential differs.
      let savedOrigin = dispatchOrigin ?? credential?.origin
      let submission = Submission(
        id: submissionID, parts: parts, requirements: requirements,
        autoArchive: autoArchive, tags: Submission.tags(from: tags),
        deviceId: deviceID.isEmpty ? nil : deviceID, agent: agent.isEmpty ? nil : agent)
      if manual { try submission.validateForSending() }
      try dependencies.persist(
        SavedShare(
          submission: submission, originalParts: parts,
          additionalRequirements: requirements, createdAt: composition.createdAt), savedOrigin)
      self.savedOrigin = savedOrigin
      saved = true  // Only after SQLite COMMIT succeeds.
      message = "完整原文已保存到本机发件箱，尚未确认提交。"
      if let credential, credential.origin == savedOrigin {
        do {
          submitted = try await dependencies.send(submission.submissionId, credential)
          if !submitted { submissionFailure = "尚未确认提交，请在主应用重试。" }
          message = submitted ? "已提交到服务器，可在主应用查看任务进度。" : "已保存到本机，打开主应用重试提交。"
        } catch {
          submissionFailure = safeMessage(error)
          message = "已保存到本机发件箱。" + safeMessage(error)
        }
      } else {
        message = "已保存到本机，尚未提交。请打开主应用配对，在发件箱查看绑定服务器并重试。"
      }
    } catch { message = safeMessage(error) }
  }
  func loadDevices() async {
    guard !loadingDevices else { return }
    loadingDevices = true
    dispatchFailure = nil
    defer { loadingDevices = false }
    do {
      guard let credential = try dependencies.credential() else {
        hasPairing = false
        dispatchNotice = "尚未配对。完整分享仍可保存；配对后在主应用确认服务器并提交。"
        return
      }
      hasPairing = true
      if let origin = dispatchOrigin, origin != credential.origin {
        dispatchFailure = "草稿属于另一台服务器"
        return
      }
      let cached = try dependencies.cachedDevices(credential.origin)
      devices = cached.filter { $0.role == "worker" && $0.revokedAt == nil }
      dispatchOrigin = credential.origin
      autosave()
      dispatchNotice = "显示缓存电脑列表；正在刷新。离线仍保留你的选择。"
      let refreshed = try await dependencies.refreshDevices(credential)
      devices = refreshed.filter { $0.role == "worker" && $0.revokedAt == nil }
      dispatchNotice = "电脑在线状态来自最近一次刷新。指定电脑离线时任务会等待，不会自动换机。"
    } catch {
      dispatchFailure = safeMessage(error)
      dispatchNotice = "电脑列表未能刷新，保留缓存与当前选择。自动派发仍可用。"
    }
  }
  func openMainApp() async {
    guard saved, !saving else { return }
    openedMainApp = await dependencies.openMainApp(submitted ? "tasks" : "outbox")
    if !openedMainApp { message = "请从主屏幕打开灵感小窝，查看" + (submitted ? "任务。" : "发件箱。") }
  }
  var resultHost: String {
    savedOrigin.flatMap { URL(string: $0)?.host } ?? "待提交"
  }
  func close() {
    guard saved, !saving, !finished else { return }
    finished = true
    dependencies.complete()
  }
  func cancel() {
    guard !saved, !saving, !finished else { return }
    guard flushDraft() else { return }
    finished = true
    dependencies.cancel()
  }
  var editableOriginal: String {
    get { SharedPart.uniqueValues(in: parts).map(\.value).joined(separator: "\n\n") }
    set {
      parts = [SharedPart(item: 0, attachment: nil, kind: "text", representation: nil, value: newValue)]
    }
  }
  @discardableResult func flushDraft() -> Bool {
    autosave()
    return draftFailure == nil
  }
  private func autosave() {
    guard compositionReady, !saved, !saving, !finished, let persist = dependencies.saveComposition else { return }
    composition.parts = parts
    composition.requirements = requirements
    composition.tags = tags
    composition.autoArchive = autoArchive
    composition.deviceID = deviceID
    composition.agent = agent
    composition.omittedAttachments = omittedAttachments
    composition.origin = dispatchOrigin ?? composition.origin ?? (try? dependencies.credential())?.origin
    dispatchOrigin = composition.origin
    guard composition.hasContent || composition.revision > 0 else { return }
    do {
      composition = try persist(composition)
      draftFailure = nil
    } catch { draftFailure = safeMessage(error) }
  }
}
