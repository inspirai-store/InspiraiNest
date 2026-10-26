#if DEBUG
import SwiftUI

@MainActor
struct NativeCompositionReview: View {
  let configuration: NativeReviewConfiguration
  @StateObject private var fixture: NativeCompositionFixture
  @StateObject private var outbox: NativeOutboxModel
  @StateObject private var library = NativeLibraryModel(phase: .content)
  @State private var module: NativeAppModule = .outbox
  init(configuration: NativeReviewConfiguration) {
    self.configuration = configuration
    let fixture = NativeCompositionFixture(page: configuration.page)
    _fixture = StateObject(wrappedValue: fixture)
    _outbox = StateObject(wrappedValue: NativeOutboxModel(dependencies: .init(
      list: { fixture.records }, credential: { nil }, bind: { _, _ in }, send: { _, _ in }, copy: { _ in },
      remove: { id in fixture.records.removeAll { $0.id == id } })))
  }
  var body: some View {
    NativeOutboxView(model: outbox, module: $module, library: library,
      localDrafts: fixture.drafts, newDraft: { fixture.open(LocalComposition()) },
      openDraft: { fixture.open($0) }, removeDraft: { fixture.deleting = $0 })
      .overlay {
        if let model = fixture.editor {
          NativeShareView(model: model, start: false, compositionContext: true)
            .id(fixture.editorID).zIndex(2)
        } else if let draft = fixture.deleting {
          NativeConfirmation(title: "删除草稿", bodyText: draft.title, actionTitle: "删除", destructive: true,
            confirm: { fixture.drafts.removeAll { $0.id == draft.id }; fixture.deleting = nil },
            cancel: { fixture.deleting = nil })
        }
      }.task {
        outbox.reload()
        if configuration.page == "C06", let editor = fixture.editor { await editor.save() }
      }
  }
}

/// Deliberately in memory: review screenshots never touch the user's Keychain or SQLite.
@MainActor
final class NativeCompositionFixture: ObservableObject {
  @Published var drafts: [LocalComposition]
  @Published var editor: ShareModel?
  @Published var deleting: LocalComposition?
  var records: [OutboxItem] = []
  var editorID = UUID()
  static var sample: LocalComposition {
    LocalComposition(id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
      parts: [
        SharedPart(item: 0, attachment: nil, kind: "text", representation: nil,
          value: "SwiftUI 原生界面实践\n\nhttps://example.com/swiftui")],
      requirements: "提炼导航与阅读的设计要点，保留代码片段。", tags: "SwiftUI,阅读", autoArchive: false,
      date: ISO8601DateFormatter().date(from: "2026-10-09T06:35:00Z")!)
  }
  init(page: String) {
    drafts = [Self.sample]
    if page == "C05" { deleting = drafts[0] }
    else if page != "C03" {
      open(page == "C02" ? LocalComposition() : Self.sample)
      if page == "C04" { editor?.advanced = true }
    }
  }
  func open(_ draft: LocalComposition) {
    editorID = UUID()
    var dependencies = ShareDependencies(
      capture: { ShareCaptureResult(parts: [], omittedAttachments: 0) }, credential: { nil },
      cachedDevices: { _ in [] }, refreshDevices: { _ in [] }, persist: { [weak self] share, origin in
        self?.records.append(OutboxItem(id: share.submission.submissionId, share: share,
          origin: origin, state: "queued", attempts: 0, taskID: nil, message: nil, leaseUntil: nil))
        self?.drafts.removeAll { $0.id == share.submission.submissionId }
      }, send: { _, _ in false }, complete: { [weak self] in self?.editor = nil },
      cancel: { [weak self] in self?.editor = nil }, openMainApp: { [weak self] _ in self?.editor = nil; return true },
      saveComposition: { [weak self] draft in
        var next = draft
        next.revision += 1
        if let index = self?.drafts.firstIndex(where: { $0.id == draft.id }) { self?.drafts[index] = next }
        else { self?.drafts.append(next) }
        return next
      })
    dependencies.cachedDevices = { _ in NativeShareFixture.devices }
    dependencies.refreshDevices = { _ in NativeShareFixture.devices }
    editor = ShareModel(dependencies: dependencies, composition: draft)
    editor?.devices = NativeShareFixture.devices
    editor?.hasPairing = false
  }
}
#endif
