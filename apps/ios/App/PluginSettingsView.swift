import SwiftUI
struct PluginSettingsView: View {
 @EnvironmentObject var model: AppModel
 @State private var busy=false
 @State private var error: String?
 var body: some View {
  List {
   ForEach(model.plugins?.plugins ?? []) { plugin in
    Toggle(plugin.name,isOn:Binding(get:{model.plugins?.supports(plugin.id) ?? false},set:{enabled in Task { await toggle(plugin.id,enabled) }})).disabled(busy)
   }
   if let error { Text(error).foregroundStyle(.red) }
   Button("刷新") { Task { await model.refresh() } }.disabled(busy)
  }.navigationTitle("插件")
 }
 @MainActor private func toggle(_ id: String,_ enabled: Bool) async {
  guard let current=model.plugins else { return };busy=true;defer { busy=false };let generation=model.sessionID,origin=model.serverName
  do { let result=try await model.client().setPlugin(id,enabled:enabled,revision:current.revision);guard generation==model.sessionID else { return };model.applyPlugins(result,origin:origin,generation:generation);await model.refresh();error=nil } catch { self.error=safeMessage(error) }
 }
}
