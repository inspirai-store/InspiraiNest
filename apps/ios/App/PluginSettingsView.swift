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

struct BlocksLibraryView: View {
 @EnvironmentObject var model: AppModel
 @State private var blocks: [BlockSummary] = []
 @State private var materials: [BlockMaterials.Material] = []
 @State private var selected: String = ""
 @State private var error: String?
 @State private var busy = false
 @State private var joined = false
 var body: some View {
  List {
   Picker("加入的资料或记录",selection:$selected) { Text("查看进展").tag("");ForEach(materials) { Text($0.title).tag($0.id) } }
   if joined { Text("已加入积木") }
   if let error { Text(error).foregroundStyle(.red) }
   ForEach(blocks) { block in Section(block.title+(block.paused ? " · 已暂停" : "")) {
    ForEach(block.goals) { goal in Text(goal.title).font(.headline)
     ForEach(goal.parts) { part in
      if let material = materials.first(where:{$0.id==selected}) { Button(part.title) { Task { await join(block,part.id,material) } }.disabled(busy) }
      else { VStack(alignment:.leading,spacing:8) { Text(part.title);ForEach(part.conditions,id:\.self) { Text($0).foregroundStyle(.secondary) } } }
     }
    }
   } }
   Button("刷新") { Task { await load() } }.disabled(busy)
  }.navigationTitle("积木").task { await load() }.id(model.sessionID)
 }
 @MainActor private func load() async {
  busy=true;defer{busy=false};let session=model.sessionID
  do { let client=try model.client();let b=try await client.blocks();let m=try await client.blockMaterials();guard session==model.sessionID else{return};blocks=b.items;materials=m.items;error=nil } catch { self.error=safeMessage(error) }
 }
 @MainActor private func join(_ block:BlockSummary,_ part:String,_ material:BlockMaterials.Material) async {
  busy=true;defer{busy=false};let session=model.sessionID
  do { try await model.client().joinBlock(block,partID:part,material:material);guard session==model.sessionID else{return};joined=true;await load() } catch { self.error=safeMessage(error) }
 }
}
