import SwiftUI

@MainActor
final class NativeCompositionModel: ObservableObject {
  @Published private(set) var drafts: [LocalComposition] = []
  @Published var notice: String?
  @Published var deleting: LocalComposition?
  func reload() {
    do { drafts = try Outbox.shared().compositions(); notice = nil }
    catch { notice = safeMessage(error) }
  }
  func deleteConfirmed() {
    guard let draft = deleting else { return }
    deleting = nil
    do {
      try Outbox.shared().deleteComposition(id: draft.id, revision: draft.revision)
      reload()
    } catch { notice = safeMessage(error); reloadKeepingNotice() }
  }
  private func reloadKeepingNotice() {
    if let drafts = try? Outbox.shared().compositions() { self.drafts = drafts }
  }
}

/// Uses the same form and protocol as the extension, with a real main-app return path.
@MainActor
struct NativeCompositionHost: View {
  @StateObject private var model: ShareModel
  init(draft: LocalComposition, close: @escaping () -> Void, destination: @escaping (String) -> Void) {
    var dependencies = ShareDependencies.live(context: nil)
    dependencies.complete = close
    dependencies.cancel = close
    dependencies.openMainApp = { target in destination(target); return true }
    _model = StateObject(wrappedValue: ShareModel(dependencies: dependencies, composition: draft))
  }
  var body: some View {
    NativeShareView(model: model, compositionContext: true)
  }
}
