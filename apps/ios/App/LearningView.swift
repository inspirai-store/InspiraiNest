import SwiftUI
import WebKit
import AVKit
import CryptoKit

struct LearningView: View {
    @EnvironmentObject var model: AppModel
    @State private var index: LearningIndex?
    @State private var sources: [LearningSource] = []
    @State private var selected = ""
    @State private var text = ""
    @State private var title = ""
    @State private var error: String?
    @State private var busy = false
    @State private var requestID = UUID().uuidString
    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            Section("学习目标") {
                ForEach(index?.goals ?? []) { goal in
                    NavigationLink { LearningGoalView(goalID: goal.id) } label: {
                        VStack(alignment: .leading, spacing: 6) { Text(goal.title);Text("\(goal.nodes.filter{$0.mastery == "mastered"}.count) / \(goal.nodes.count) 已掌握").foregroundStyle(.secondary) }
                    }
                }
            }
            Section("加入学习材料") {
                TextField("目标或材料标题", text: $title)
                TextEditor(text: $text).frame(minHeight: 110).accessibilityLabel("学习材料内容")
                Picker("已有资料与记录",selection:$selected) { Text("手动输入").tag("");ForEach(sources) { Text($0.title).tag($0.id) } }
                Button("提取学习目标") { Task { await intake() } }.disabled(busy || text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && selected.isEmpty)
            }
            Section("待确认") {
                ForEach(index?.candidates.filter{$0.state == "pending"} ?? []) { candidate in
                    VStack(alignment:.leading,spacing:12) {
                        Text(candidate.title).font(.headline);Text(candidate.expectedAbility);Text(candidate.reason)
                        ForEach(candidate.citations) { source in Text(source.title+"："+(source.quote ?? "")).foregroundStyle(.secondary) }
                        HStack { Button("确认加入") { Task { await confirm(candidate,ignore:false) } };Button("忽略") { Task { await confirm(candidate,ignore:true) } } }.buttonStyle(.bordered).disabled(busy)
                    }
                }
            }
        }.navigationTitle("新知").toolbar { Button("刷新") { Task { await load() } }.disabled(busy) }.task { await load() }.id(model.sessionID)
    }
    @MainActor private func load() async {
        busy=true;defer{busy=false};let generation=model.sessionID
        do { let client=try model.client();let value=try await client.learningIndex();let materials=try await client.learningSources();guard generation==model.sessionID else{return};index=value;sources=materials.items;error=nil } catch { if generation==model.sessionID {self.error=safeMessage(error)} }
    }
    @MainActor private func intake() async {
        busy=true;defer{busy=false};let generation=model.sessionID
        do { var input:[String:Any] = ["requestId":requestID,"text":text,"title":title.isEmpty ? String(text.prefix(120)) : title];if !selected.isEmpty {input["sourceKeys"]=[selected]};try await model.client().learningPost("/api/learning/intake",input:input);guard generation==model.sessionID else{return};text="";requestID=UUID().uuidString;await load() } catch { if generation==model.sessionID {self.error=safeMessage(error)} }
    }
    @MainActor private func confirm(_ candidate:LearningCandidate,ignore:Bool) async {
        busy=true;defer{busy=false};let generation=model.sessionID
        do { try await model.client().learningPost("/api/learning/candidates/"+candidate.id,input:["revision":candidate.revision,"action":ignore ? "ignore":"confirm","foundation":""]);guard generation==model.sessionID else{return};await load() } catch {if generation==model.sessionID {self.error=safeMessage(error)}}
    }
}
struct LearningGoalView: View {
    @EnvironmentObject var model: AppModel
    let goalID:String
    @State private var goal:LearningGoal?
    @State private var error:String?
    var body: some View {
        List {
            if let error {Text(error).foregroundStyle(.red)}
            if let goal {
                Section {Text(goal.expectedAbility);Text(goal.foundation)}
                ForEach(goal.stageNames,id:\.self) { stage in
                    Section(stage) { ForEach(goal.nodes.filter{$0.stage==stage}) { node in NavigationLink { LearningNodeView(goalID:goalID,nodeID:node.id) } label: { VStack(alignment:.leading,spacing:6) {Text(node.title);Text((learningMasteryLabels[node.mastery] ?? node.mastery)+(goal.nextNodeId==node.id ? " · 下一步":"")).foregroundStyle(.secondary)} } } }
                }
            }
        }.navigationTitle(goal?.title ?? "学习路径").task { let generation=model.sessionID;do {let result=try await model.client().learningGoal(goalID);guard generation==model.sessionID else{return};goal=result} catch {if generation==model.sessionID {self.error=safeMessage(error)}} }.id(model.sessionID)
    }
}
struct LearningNodeView: View {
    @EnvironmentObject var model:AppModel
    let goalID:String;let nodeID:String
    @State private var goal:LearningGoal?
    @State private var notes=""
    @State private var question=""
    @State private var answer=""
    @State private var error:String?
    @State private var busy=false
    @State private var artifact:LearningArtifact?
    @State private var artifactData:Data?
    @State private var notesRevision:Int?
    @State private var attemptID=UUID().uuidString
    private var node:LearningNode? {goal?.nodes.first{$0.id==nodeID}}
    var body:some View {
        List {
            if let error {Text(error).foregroundStyle(.red)}
            if let node,let goal {
                Section {
                    Picker("掌握状态",selection:Binding(get:{node.mastery},set:{value in Task{await mutate("progress",input:["mastery":value])}})) {ForEach(["pending","learning","review","mastered"],id:\.self){Text(learningMasteryLabels[$0] ?? $0).tag($0)}}.disabled(busy)
                    ForEach(node.objectives,id:\.self){Text($0)}
                }
                if !node.dependsOn.isEmpty {Section("先修知识"){ForEach(node.dependsOn,id:\.self){id in if let prior=goal.nodes.first(where:{$0.id==id}) {NavigationLink(prior.title){LearningNodeView(goalID:goalID,nodeID:id)}}}}}
                Section("概念讲解") {Text(.init(node.explanation)).textSelection(.enabled)}
                Section("来源资料") {ForEach(node.citations){source in VStack(alignment:.leading,spacing:8){Text(source.title);Text(source.quote ?? "");if let raw=source.url,let url=URL(string:raw),["https","http"].contains(url.scheme ?? ""){Link("打开来源",destination:url)}}}}
                Section("复述与练习") {
                    Picker("题目",selection:$question){ForEach(node.recall+node.exercises,id:\.self){Text($0).tag($0)}}
                    TextEditor(text:$answer).frame(minHeight:140).accessibilityLabel("我的回答")
                    Button("保存并获取反馈"){Task{await mutate("attempts",input:["requestId":attemptID,"question":question,"answer":answer]);if error==nil {answer="";attemptID=UUID().uuidString}}}.disabled(busy||answer.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty||question.isEmpty)
                    ForEach(goal.attempts?.filter{$0.nodeId==nodeID} ?? []){a in DisclosureGroup(a.question){Text(a.answer);Text(a.feedback ?? "等待练习反馈")}}
                }
                Section("学习笔记"){TextEditor(text:$notes).onChange(of:notes){value in if value != node.notes && notesRevision == nil {notesRevision=goal.revision}}.frame(minHeight:160).accessibilityLabel("我的理解");Button("保存笔记"){Task{await mutate("progress",input:["notes":notes])}}.disabled(busy||notes==node.notes);if let notesRevision,notesRevision != goal.revision {DisclosureGroup("云端笔记"){Text(node.notes);Button("以当前版本保存"){self.notesRevision=goal.revision;Task{await mutate("progress",input:["notes":notes])}}.disabled(busy)}}}
                Section("教学成果"){ForEach(goal.artifacts?.filter{$0.nodeId==nodeID} ?? []){a in Button(a.title+(a.nodeRevision != node.contentRevision ? " · 历史版本":"")){Task{await open(a)}}.disabled(busy)}}
            }
        }.navigationTitle(node?.title ?? "知识节点").toolbar {Button("刷新"){Task{await load()}}.disabled(busy)}.task{await load()}.id(model.sessionID)
        .sheet(item:$artifact){a in if let artifactData {LearningArtifactView(artifact:a,data:artifactData)}}
    }
    @MainActor private func load() async {
        let generation=model.sessionID
        do{let value=try await model.client().learningGoal(goalID);guard generation==model.sessionID else{return};goal=value;if notes.isEmpty{notes=node?.notes ?? ""};if question.isEmpty{question=node?.recall.first ?? node?.exercises.first ?? ""};error=nil}catch{if generation==model.sessionID{self.error=safeMessage(error)}}
    }
    @MainActor private func mutate(_ action:String,input:[String:Any]) async {
        guard let goal else{return};busy=true;defer{busy=false};let generation=model.sessionID
        do{var value=input;value["revision"]=input["notes"] != nil ? (notesRevision ?? goal.revision):goal.revision;value["nodeId"]=nodeID;try await model.client().learningPost("/api/learning/goals/"+goalID+"/"+action,input:value);guard generation==model.sessionID else{return};if input["notes"] != nil {notesRevision=nil};await load()}catch{if generation==model.sessionID{self.error=safeMessage(error)}}
    }
    @MainActor private func open(_ value:LearningArtifact) async {
        busy=true;defer{busy=false};let generation=model.sessionID
        do{let result=try await model.client().learningArtifact(value.id);guard generation==model.sessionID else{return};guard let bytes=Data(base64Encoded:result.bytes),SHA256.hash(data:bytes).map({String(format:"%02x",$0)}).joined()==value.sha256 else{throw CollectorError.message("教学文件校验失败")};artifactData=bytes;artifact=value}catch{if generation==model.sessionID{self.error=safeMessage(error)}}
    }
}
private struct LearningArtifactView:View {
    let artifact:LearningArtifact;let data:Data
    @State private var videoURL:URL?
    var body:some View {
        Group {
            if artifact.kind=="web" {LearningIsolatedDemo(html:String(decoding:data,as:UTF8.self))}
            else if artifact.mime.hasPrefix("video/"),let videoURL {VideoPlayer(player:AVPlayer(url:videoURL))}
            else {VStack{if artifact.mime.hasPrefix("text/") || ["md","txt","json","py","js","ts","css","swift","kt"].contains((artifact.title as NSString).pathExtension.lowercased()){ScrollView{Text(String(decoding:data,as:UTF8.self)).textSelection(.enabled).padding()}}else{Text(artifact.title)};if let videoURL {ShareLink("导出文件",item:videoURL)}}}
        }.task {if artifact.kind != "web"{let ext=(artifact.title as NSString).pathExtension.lowercased();let safe=ext.range(of:"^[a-z0-9]{1,8}$",options:.regularExpression) != nil ? ext:"bin";let url=FileManager.default.temporaryDirectory.appendingPathComponent(artifact.sha256+"."+safe);do{try data.write(to:url,options:.atomic);videoURL=url}catch{videoURL=nil}}}.onDisappear{if let videoURL{try? FileManager.default.removeItem(at:videoURL)}}
    }
}
private struct LearningIsolatedDemo:UIViewRepresentable {
    let html:String
    func makeUIView(context:Context)->WKWebView {
        let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent()
        let web=WKWebView(frame:.zero,configuration:config)
        let policy="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'\">"
        let content=(policy+html).replacingOccurrences(of:"&",with:"&amp;").replacingOccurrences(of:"\"",with:"&quot;").replacingOccurrences(of:"<",with:"&lt;")
        web.loadHTMLString("<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><iframe sandbox=\"allow-scripts\" referrerpolicy=\"no-referrer\" style=\"border:0;width:100%;height:95vh\" srcdoc=\""+content+"\"></iframe>",baseURL:nil)
        return web
    }
    func updateUIView(_ uiView:WKWebView,context:Context){}
}
