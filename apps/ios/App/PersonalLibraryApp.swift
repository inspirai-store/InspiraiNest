import SwiftUI

@main
struct PersonalLibraryApp: App {
    @UIApplicationDelegateAdaptor(NativeRecordAppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model)
                .task(id: scenePhase) {
                    guard scenePhase == .active else { return }
                    while !Task.isCancelled {
                        await model.refresh()
                        do { try await Task.sleep(nanoseconds: 5_000_000_000) } catch { break }
                    }
                }
                // Cover private content in the app-switcher.
                .overlay { if scenePhase != .active { Color(.systemBackground).ignoresSafeArea().overlay(Text("灵藏")) } }
        }
    }
}

struct RootView: View {
    var body: some View { NativeLibraryRoot() }
}
