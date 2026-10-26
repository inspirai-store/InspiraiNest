#if DEBUG
import SwiftUI

/// Same business view, with in-memory queue and composition adapters only.
@MainActor
struct NativeOutboxRemovalReview: View {
  let configuration: NativeReviewConfiguration
  @StateObject private var model: NativeOutboxModel
  @StateObject private var library = NativeLibraryModel()
  @StateObject private var composition: NativeCompositionFixture
  @State private var module: NativeAppModule = .outbox
  init(configuration: NativeReviewConfiguration) {
    self.configuration = configuration
    let fixture = NativeOutboxFixture(page: "P18")
    let composition = NativeCompositionFixture(page: "C03")
    composition.drafts = []
    let model = NativeOutboxModel(dependencies: .init(
      list: { fixture.items + composition.records }, credential: { fixture.credential },
      bind: fixture.dependencies.bind, send: fixture.dependencies.send, copy: fixture.dependencies.copy,
      remove: { id in
        fixture.items.removeAll { $0.id == id }
        composition.records.removeAll { $0.id == id }
      }))
    model.reload()
    let index = configuration.page == "R04" ? 2 : configuration.page == "R06" ? 1 : 0
    let selected = fixture.items[index].id
    if configuration.page == "R05" {
      fixture.items = [fixture.items[2]]
      model.reload(); model.requestRemoval(fixture.items[0].id); model.confirmRemoval()
    } else if configuration.page != "R01" {
      model.selectedID = selected; model.path = [selected]
      if ["R03", "R04", "R06"].contains(configuration.page) { model.requestRemoval(selected) }
    }
    _model = StateObject(wrappedValue: model)
    _composition = StateObject(wrappedValue: composition)
  }
  var body: some View {
    NativeOutboxView(model: model, module: $module, library: library,
      localDrafts: composition.drafts, newDraft: { composition.open(LocalComposition()) },
      openDraft: { composition.open($0) }, removeDraft: { composition.deleting = $0 })
      .overlay {
        if let editor = composition.editor {
          NativeShareView(model: editor, start: false, compositionContext: true).id(composition.editorID)
        } else if let draft = composition.deleting {
          NativeConfirmation(title: "删除草稿", bodyText: draft.title, actionTitle: "删除", destructive: true,
            confirm: { composition.drafts.removeAll { $0.id == draft.id }; composition.deleting = nil },
            cancel: { composition.deleting = nil })
        }
      }
  }
}
#endif
