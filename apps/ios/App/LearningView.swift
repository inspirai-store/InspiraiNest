import SwiftUI
import UniformTypeIdentifiers

private struct LearningCard<Content:View>:View {
    @Environment(\.colorScheme) private var scheme
    let content:Content
    init(@ViewBuilder content:()->Content){self.content=content()}
    var body:some View{let colors=NativePalette(dark:scheme == .dark);VStack(alignment:.leading,spacing:16){content}.frame(maxWidth:.infinity,alignment:.leading).padding(20).background(colors.surface,in:RoundedRectangle(cornerRadius:16)).overlay(RoundedRectangle(cornerRadius:16).stroke(colors.separator)).foregroundStyle(colors.label)}
}
private struct LearningAction:View {
    let title:String;let icon:String
    var body:some View{HStack(spacing:14){Image(systemName:icon).font(.title3).foregroundStyle(.tint);Text(title).font(.headline);Spacer(minLength:8);Image(systemName:"chevron.right").foregroundStyle(.secondary)}.padding(.vertical,8).frame(minHeight:36)}
}
private struct LearningCanvas<Content:View>:View {
    @Environment(\.colorScheme) private var scheme
    let content:Content
    init(@ViewBuilder content:()->Content){self.content=content()}
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:20){content}.frame(maxWidth:1000).padding(20).frame(maxWidth:.infinity)}.background(NativePalette(dark:scheme == .dark).paper)}
}
struct LearningView:View {
    @EnvironmentObject var model:AppModel
    @State private var index:LearningIndex?
    @State private var sources:[LearningSource]=[]
    @State private var error:String?
    @State private var busy=false
    @State private var adding=false
    @State private var pendingOnly=false
    @State private var manual=false
    @State private var name=""
    @State private var intakeTask:String?
    var body:some View {
        LearningCanvas {
            if let error{LearningCard{Text(error).foregroundStyle(.red);Button("重试"){Task{await load()}}}}
            if let intakeTask{LearningTaskCard(taskID:intakeTask)}
            HStack{Text(pendingOnly ? "待确认目标":"学习目标").font(.title2.bold());Spacer();Button{pendingOnly.toggle()}label:{Label(pendingOnly ? "全部目标":"待确认 \(index?.candidates.filter{$0.state == "pending"}.count ?? 0)",systemImage:pendingOnly ? "books.vertical":"tray")}.buttonStyle(.bordered)}
            if pendingOnly {
                ForEach(index?.candidates.filter{$0.state == "pending"} ?? []){candidate in
                    LearningCandidateCard(candidate:candidate,goals:index?.goals ?? [],busy:busy,confirm:{input in await confirm(candidate,input:input)},ignore:{await confirm(candidate,input:["action":"ignore"])})
                }
                if index?.candidates.filter({$0.state == "pending"}).isEmpty == true{LearningCard{Label("暂无待确认目标",systemImage:"tray")}}
            }else{
                LazyVGrid(columns:[GridItem(.adaptive(minimum:280),spacing:16)],spacing:16){
                    ForEach(index?.goals.filter{$0.state != "archived"} ?? []){goal in
                        NavigationLink{LearningGoalView(goalID:goal.id)}label:{LearningCard{
                            Label(goal.title,systemImage:"graduationcap").font(.title3.bold()).fixedSize(horizontal:false,vertical:true)
                            if !goal.expectedAbility.isEmpty{Text(goal.expectedAbility).foregroundStyle(.secondary).lineLimit(3)}
                            let mastered=goal.nodes.filter{$0.mastery == "mastered"}.count
                            ProgressView(value:Double(mastered),total:Double(max(1,goal.nodes.count))).accessibilityLabel("\(mastered) / \(goal.nodes.count) 已掌握")
                            Text("\(mastered) / \(goal.nodes.count) 已掌握")
                            if let next=goal.nodes.first(where:{$0.id==goal.nextNodeId}){Text("下一步 · "+next.title).font(.subheadline)}
                            Label("继续学习",systemImage:"arrow.right").font(.headline).foregroundStyle(.tint)
                        }}.buttonStyle(.plain)
                    }
                }
                if index?.goals.isEmpty == true{LearningCard{Label("从一份材料开始",systemImage:"graduationcap").font(.title3);Button{adding=true}label:{Label("添加材料",systemImage:"plus")}.buttonStyle(.borderedProminent)}}
            }
        }.navigationTitle("新知").toolbar{
            Button{adding=true}label:{Label("添加材料",systemImage:"plus")}
            Menu{Button("刷新",systemImage:"arrow.clockwise"){Task{await load()}};Button("手动建立",systemImage:"square.and.pencil"){name="";manual=true}}label:{Label("更多",systemImage:"ellipsis")}
        }.task{await load()}.id(model.sessionID)
        .sheet(isPresented:$adding){NavigationStack{LearningIntakeView(sources:sources){receipt in adding=false;pendingOnly=true;intakeTask=receipt.sourceTaskId ?? (receipt.state=="queued" ? receipt.id:nil);Task{await load()}}.environmentObject(model)}}
        .sheet(isPresented:$manual){NavigationStack{Form{TextField("目标名称",text:$name)}.navigationTitle("手动建立目标").toolbar{ToolbarItem(placement:.cancellationAction){Button("取消"){manual=false}};ToolbarItem(placement:.confirmationAction){Button("建立"){Task{await create()}}.disabled(busy||name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)}}}}
    }
    @MainActor private func load()async {
        busy=true;defer{busy=false};let generation=model.sessionID
        do{let client=try model.client();let value=try await client.learningIndex();let materials=try await client.learningSources();guard generation==model.sessionID else{return};index=value;sources=materials.items;error=nil}catch{if generation==model.sessionID{self.error=safeMessage(error)}}
    }
    @MainActor private func create()async {
        busy=true;defer{busy=false};let generation=model.sessionID
        do{try await model.client().learningPost("/api/learning/goals",input:["title":name]);guard generation==model.sessionID else{return};manual=false;await load()}catch{if generation==model.sessionID{self.error=safeMessage(error)}}
    }
    @MainActor private func confirm(_ candidate:LearningCandidate,input:[String:Any])async -> Bool {
        if busy{return false};busy=true;defer{busy=false};let generation=model.sessionID
        do{var value=input;value["revision"]=candidate.revision;if value["action"] == nil{value["action"]="confirm"};try await model.client().learningPost("/api/learning/candidates/"+candidate.id,input:value);guard generation==model.sessionID else{return false};await load();return true}catch{if generation==model.sessionID{self.error=safeMessage(error)};return false}
    }
}
private struct LearningCandidateCard:View {
    let candidate:LearningCandidate;let goals:[LearningGoal];let busy:Bool
    let confirm:([String:Any])async->Bool;let ignore:()async->Bool
    @State private var editing=false;@State private var joining=false
    @State private var title:String;@State private var ability:String
    @State private var draftTitle="";@State private var draftAbility="";@State private var goalQuery=""
    init(candidate:LearningCandidate,goals:[LearningGoal],busy:Bool,confirm:@escaping([String:Any])async->Bool,ignore:@escaping()async->Bool){self.candidate=candidate;self.goals=goals;self.busy=busy;self.confirm=confirm;self.ignore=ignore;_title=State(initialValue:candidate.title);_ability=State(initialValue:candidate.expectedAbility)}
    var body:some View{LearningCard{
        HStack(alignment:.top){Text(title).font(.title3.bold());Spacer();Button{draftTitle=title;draftAbility=ability;editing=true}label:{Label("修改",systemImage:"pencil")}}
        Text(ability);Text(candidate.reason).foregroundStyle(.secondary)
        ViewThatFits(in:.horizontal){HStack{createButton;joinButton;ignoreButton};VStack(alignment:.leading,spacing:12){createButton;joinButton;ignoreButton}}.disabled(busy)
    }.sheet(isPresented:$joining){NavigationStack{LearningCanvas{TextField("搜索学习目标",text:$goalQuery).textFieldStyle(.roundedBorder);ForEach(goals.filter{$0.state != "archived" && (goalQuery.isEmpty || $0.title.localizedCaseInsensitiveContains(goalQuery))}){goal in Button{Task{if await confirm(["title":title,"expectedAbility":ability,"goalId":goal.id,"goalRevision":goal.revision]){joining=false}}}label:{LearningCard{LearningAction(title:goal.title,icon:"graduationcap")}}.buttonStyle(.plain).disabled(busy)}}.navigationTitle("加入已有目标").toolbar{Button("取消"){joining=false}}}}
    .sheet(isPresented:$editing){NavigationStack{Form{TextField("目标名称",text:$draftTitle);Section("预期能力"){TextEditor(text:$draftAbility).frame(minHeight:140)}}.navigationTitle("修改学习目标").toolbar{ToolbarItem(placement:.cancellationAction){Button("取消"){editing=false}};ToolbarItem(placement:.confirmationAction){Button("完成"){title=draftTitle;ability=draftAbility;editing=false}.disabled(draftTitle.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)}}}}
    }
    private var createButton:some View{Button{Task{_ = await confirm(["title":title,"expectedAbility":ability])}}label:{Label("建立目标",systemImage:"plus")}.buttonStyle(.borderedProminent)}
    private var joinButton:some View{Button("加入已有目标"){joining=true}.buttonStyle(.bordered).disabled(goals.filter{$0.state != "archived"}.isEmpty)}
    private var ignoreButton:some View{Button("忽略"){Task{_ = await ignore()}}}

}
private struct LearningIntakeView:View {
    @EnvironmentObject var model:AppModel
    @Environment(\.dismiss) private var dismiss
    let sources:[LearningSource];let completed:(LearningSubmission)->Void
    @State private var mode=""
    @State private var selected=Set<String>()
    @State private var query="";@State private var limit=20
    @State private var text="";@State private var title="";@State private var extra=""
    @State private var files:[NativeRecordAttachment]=[]
    @State private var filePicker=false;@State private var busy=false;@State private var error:String?
    @State private var requestID=UUID().uuidString
    private var ready:Bool{mode=="sources" ? !selected.isEmpty:mode=="files" ? !files.isEmpty:!text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty}
    var body:some View{LearningCanvas{
        if let error{LearningCard{Text(error).foregroundStyle(.red)}}
        if busy{ProgressView("正在保存材料")}
        if mode.isEmpty{
            Button{mode="sources"}label:{LearningCard{LearningAction(title:"选择资料",icon:"folder")}}.buttonStyle(.plain)
            Button{mode="files";filePicker=true}label:{LearningCard{LearningAction(title:"导入文件",icon:"doc.badge.plus")}}.buttonStyle(.plain)
            Button{mode="paste"}label:{LearningCard{LearningAction(title:"粘贴内容",icon:"doc.on.clipboard")}}.buttonStyle(.plain)
        }else{
            Button("更换来源方式"){mode=""}.disabled(busy)
            if mode=="sources"{
                TextField("搜索资料",text:$query).textFieldStyle(.roundedBorder).onChange(of:query){_ in limit=20}
                let filtered=sources.filter{query.isEmpty||$0.title.localizedCaseInsensitiveContains(query)}
                ForEach(Array(filtered.prefix(limit))){source in Button{if selected.contains(source.id){selected.remove(source.id)}else if selected.count<30{selected.insert(source.id)}}label:{LearningCard{HStack(alignment:.top){Image(systemName:selected.contains(source.id) ? "checkmark.circle.fill":"circle").foregroundStyle(.tint);VStack(alignment:.leading,spacing:8){Text(source.title).font(.headline)}}}}.buttonStyle(.plain).accessibilityAddTraits(selected.contains(source.id) ? .isSelected:[])}
                if filtered.count>limit{Button("加载更多"){limit+=20}}
                Text("已选 \(selected.count) 份资料")
            }else if mode=="files"{
                Button{filePicker=true}label:{Label("选择文件",systemImage:"doc.badge.plus")}.buttonStyle(.bordered)
                ForEach(files){file in LearningCard{HStack{Label(file.name,systemImage:"doc");Spacer();Button("移除"){files.removeAll{$0.id==file.id}}}}}
            }else{LearningCard{TextEditor(text:$text).frame(minHeight:160).accessibilityLabel("材料内容")}}
            DisclosureGroup("修改标题或补充说明"){VStack(alignment:.leading,spacing:12){TextField("材料标题",text:$title).textFieldStyle(.roundedBorder);if mode != "sources"{TextEditor(text:$extra).frame(minHeight:100).accessibilityLabel("补充说明")}}}
            Button{Task{await submit()}}label:{Label("提取目标",systemImage:"sparkles")}.buttonStyle(.borderedProminent).disabled(busy || !ready)
        }
    }.navigationTitle("添加学习材料").toolbar{Button("取消"){dismiss()}.disabled(busy)}.interactiveDismissDisabled(busy)
    .fileImporter(isPresented:$filePicker,allowedContentTypes:[.data],allowsMultipleSelection:true){result in Task{await importFiles(result)}}
    }
    @MainActor private func importFiles(_ result:Result<[URL],Error>)async {
        busy=true;defer{busy=false};let generation=model.sessionID
        do{let store=try NativeRecordMediaStore.live();for url in try result.get(){let file=try await store.importFile(url,scope:model.sessionID.uuidString+requestID,existing:files);guard generation==model.sessionID else{return};files.append(file)};error=nil}catch{if generation==model.sessionID{self.error=safeMessage(error)}}
    }
    @MainActor private func submit()async {
        busy=true;defer{busy=false};let generation=model.sessionID
        do{let client=try model.client();var input:[String:Any]=["requestId":requestID]
            if mode=="sources"{input["sourceKeys"]=Array(selected).sorted()}else{
                var content=mode=="paste" ? text:"";var attachments:[[String:Any]]=[]
                if mode=="files"{let store=try NativeRecordMediaStore.live();for file in files{let url=try await store.verifiedURL(file,scope:model.sessionID.uuidString+requestID);_ = try await client.upload(file,url:url,progress:{_,_ in});guard generation==model.sessionID else{return};attachments.append(["id":file.id,"name":file.name,"sha256":file.sha256]);if ["md","txt","csv","json"].contains((file.name as NSString).pathExtension.lowercased()){content+="\n\n# "+file.name+"\n"+(try String(contentsOf:url,encoding:.utf8))}}}
                content=(content+"\n\n"+extra).trimmingCharacters(in:.whitespacesAndNewlines);guard content.count<=60000 else{throw CollectorError.message("材料正文超过 60000 字符，请拆分导入")}
                input["text"]=content.isEmpty ? "导入文件："+files.map(\.name).joined(separator:"、"):content;input["attachments"]=attachments;input["contentReady"] = !content.isEmpty
                if title.isEmpty && !files.isEmpty{input["title"]=String(files.map(\.name).joined(separator:"、").prefix(200))}
            }
            if !title.isEmpty{input["title"]=title};let receipt=try await client.learningSubmit("/api/learning/intake",input:input);guard generation==model.sessionID else{return};completed(receipt)
        }catch{if generation==model.sessionID{self.error=safeMessage(error)}}
    }
}
struct LearningGoalView:View {
    @EnvironmentObject var model:AppModel
    let goalID:String
    @State private var goal:LearningGoal?;@State private var error:String?
    var body:some View{LearningCanvas{
        if let error{LearningCard{Text(error).foregroundStyle(.red);Button("重试"){Task{await load()}}}}
        if let goal{
            ForEach(goal.jobs?.filter{!["completed","cancelled"].contains($0.state)} ?? []){job in LearningTaskCard(taskID:job.id)}
            LearningCard{if goal.nodes.contains(where:{$0.visualLessonId != nil}),LearningVisualDocument.supports("overview"){NavigationLink{LearningOverviewView()}label:{Label("全景图",systemImage:"square.3.layers.3d")}.buttonStyle(.bordered)};Text(goal.expectedAbility);if !goal.foundation.isEmpty{DisclosureGroup("已有基础"){Text(goal.foundation)}};if let next=goal.nextNodeId{NavigationLink{LearningNodeView(goalID:goalID,nodeID:next)}label:{Label("继续学习",systemImage:"arrow.right")}.buttonStyle(.borderedProminent)}}
            LazyVGrid(columns:[GridItem(.adaptive(minimum:280),spacing:16)],alignment:.leading,spacing:16){ForEach(goal.stageNames,id:\.self){stage in LearningCard{Text(stage).font(.headline).foregroundStyle(.secondary);ForEach(goal.nodes.filter{$0.stage==stage}){node in NavigationLink{LearningNodeView(goalID:goalID,nodeID:node.id)}label:{VStack(alignment:.leading,spacing:10){Text(node.title).font(.headline).fixedSize(horizontal:false,vertical:true);HStack{Text(learningMasteryLabels[node.mastery] ?? node.mastery);if goal.nextNodeId==node.id{Label("下一步",systemImage:"arrow.right")}}.font(.subheadline).foregroundStyle(.secondary)}.padding(.vertical,12).frame(maxWidth:.infinity,alignment:.leading)}.buttonStyle(.plain);if node.id != goal.nodes.filter({$0.stage==stage}).last?.id{Divider()}}}}}
        }
    }.navigationTitle(goal?.title ?? "学习路径").task{await load()}.id(model.sessionID)}
    @MainActor private func load()async{let generation=model.sessionID;do{let result=try await model.client().learningGoal(goalID);guard generation==model.sessionID else{return};goal=result;error=nil}catch{if generation==model.sessionID{self.error=safeMessage(error)}}}
}
struct LearningNodeView:View {
    @EnvironmentObject var model:AppModel
    let goalID:String;let nodeID:String
    @State private var goal:LearningGoal?;@State private var notes="";@State private var question="";@State private var answer=""
    @State private var tab="内容";@State private var answering=false;@State private var noting=false
    @State private var error:String?;@State private var busy=false
    @State private var notesRevision:Int?
    @State private var attemptID=UUID().uuidString
    private var node:LearningNode?{goal?.nodes.first{$0.id==nodeID}}
    var body:some View{LearningCanvas{
        if let error{LearningCard{Text(error).foregroundStyle(.red);Button("刷新"){Task{await load()}}}}
        if let node,let goal{
            Picker("节点内容",selection:$tab){ForEach(["内容","练习","笔记"],id:\.self){Text($0).tag($0)}}.pickerStyle(.segmented)
            if tab=="内容"{
                if let id=node.visualLessonId,LearningVisualDocument.supports(id){
                    LearningVisual(lessonID:id).frame(height:620).clipShape(RoundedRectangle(cornerRadius:14))
                    LearningCard{DisclosureGroup("完整讲解"){LearningMarkdown(node.explanation)}}
                }else{LearningCard{LearningMarkdown(node.explanation)}}
                LearningCard{DisclosureGroup("学习要点与先修"){ForEach(node.objectives,id:\.self){Text($0)};ForEach(node.dependsOn,id:\.self){id in if let prior=goal.nodes.first(where:{$0.id==id}){NavigationLink(prior.title){LearningNodeView(goalID:goalID,nodeID:id)}}}}}
                if let index=goal.nodes.firstIndex(where:{$0.id==nodeID}){HStack{if index>0{NavigationLink{LearningNodeView(goalID:goalID,nodeID:goal.nodes[index-1].id)}label:{Label("上一节",systemImage:"arrow.left")}.buttonStyle(.bordered)};Spacer();if index+1<goal.nodes.count{NavigationLink{LearningNodeView(goalID:goalID,nodeID:goal.nodes[index+1].id)}label:{Label("下一节",systemImage:"arrow.right")}.buttonStyle(.borderedProminent)}}}
            }else if tab=="练习"{
                LearningCard{Text("复述与练习").font(.headline);ForEach(node.recall+node.exercises,id:\.self){q in Button{question=q;attemptID=UUID().uuidString}label:{HStack(alignment:.top){Image(systemName:question==q ? "checkmark.circle.fill":"circle");Text(q).multilineTextAlignment(.leading)}.padding(12).frame(maxWidth:.infinity,alignment:.leading)}.buttonStyle(.bordered).accessibilityAddTraits(question==q ? .isSelected:[]).disabled(busy)}
                    if answering{TextEditor(text:$answer).disabled(busy).onChange(of:answer){_ in attemptID=UUID().uuidString}.frame(minHeight:180).accessibilityLabel("我的回答");HStack{Button("保存回答"){Task{if await mutate("attempts",input:["requestId":attemptID,"question":question,"answer":answer,"feedback":false]){answer="";answering=false;attemptID=UUID().uuidString}}}.buttonStyle(.borderedProminent).disabled(busy||answer.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty||question.isEmpty);Button("取消"){answering=false}.disabled(busy)}}else{Button{answering=true}label:{Label("开始回答",systemImage:"square.and.pencil")}.buttonStyle(.borderedProminent).disabled(question.isEmpty)}
                }
                ForEach(goal.attempts?.filter{$0.nodeId==nodeID} ?? []){a in LearningCard{DisclosureGroup(a.question){Text(a.answer);if let feedback=a.feedback{LearningMarkdown(feedback)}else{Button{Task{_ = await mutate("feedback",input:["attemptId":a.id])}}label:{Label("AI 帮我看看",systemImage:"sparkles")}.disabled(busy)}}}}
            }else if tab=="笔记"{
                LearningCard{Text("个人理解").font(.headline)
                    if noting{TextEditor(text:$notes).disabled(busy).frame(minHeight:200).accessibilityLabel("我的理解");HStack{Button("保存笔记"){Task{if await mutate("progress",input:["notes":notes]){noting=false}}}.buttonStyle(.borderedProminent).disabled(busy||notes==node.notes);Button("取消"){notes=node.notes;notesRevision=nil;noting=false}.disabled(busy)};if let notesRevision,notesRevision != goal.revision{DisclosureGroup("云端笔记"){Text(node.notes);Button("以当前版本保存"){self.notesRevision=goal.revision;Task{if await mutate("progress",input:["notes":notes]){noting=false}}}.disabled(busy)}}}else{if !node.notes.isEmpty{LearningMarkdown(node.notes)};Button{notes=node.notes;notesRevision=goal.revision;noting=true}label:{Label(node.notes.isEmpty ? "记下理解":"修改笔记",systemImage:"square.and.pencil")}.buttonStyle(.borderedProminent)}
                }
            }
            LearningCard{DisclosureGroup("学习状态 · \(learningMasteryLabels[node.mastery] ?? node.mastery)"){LazyVGrid(columns:[GridItem(.adaptive(minimum:90),spacing:8)],spacing:8){ForEach(["pending","learning","review","mastered"],id:\.self){value in Button{Task{_ = await mutate("progress",input:["mastery":value])}}label:{Text(learningMasteryLabels[value] ?? value).frame(maxWidth:.infinity,minHeight:32)}.buttonStyle(.bordered).tint(node.mastery==value ? .accentColor:.secondary).accessibilityAddTraits(node.mastery==value ? .isSelected:[]).disabled(busy)}}}}

        }
    }.navigationTitle(node?.title ?? "知识节点").toolbar{Button{Task{await load()}}label:{Label("刷新",systemImage:"arrow.clockwise")}.disabled(busy)}.task{await load()}.id(model.sessionID)}
    @MainActor private func load()async{let generation=model.sessionID;do{let value=try await model.client().learningGoal(goalID);guard generation==model.sessionID else{return};goal=value;if !noting{notes=node?.notes ?? ""};if question.isEmpty{question=node?.recall.first ?? node?.exercises.first ?? ""};error=nil}catch{if generation==model.sessionID{self.error=safeMessage(error)}}}
    @MainActor private func mutate(_ action:String,input:[String:Any])async->Bool{guard let goal,!busy else{return false};busy=true;defer{busy=false};let generation=model.sessionID;do{var value=input;value["revision"]=input["notes"] != nil ? (notesRevision ?? goal.revision):goal.revision;value["nodeId"]=nodeID;try await model.client().learningPost("/api/learning/goals/"+goalID+"/"+action,input:value);guard generation==model.sessionID else{return false};if input["notes"] != nil{notesRevision=nil};await load();return true}catch{if generation==model.sessionID{self.error=safeMessage(error)};return false}}

}
private struct LearningTaskCard:View {
    @EnvironmentObject var model:AppModel
    let taskID:String
    @State private var report:TaskDiagnosticReport?;@State private var error:String?;@State private var busy=false
    var body:some View{LearningCard{Label(report.map{["queued":"等待电脑处理","assigned":"已分配","running":"处理中","uploading":"保存结果中","completed":"已完成","waiting_action":"需要处理","failed":"处理失败","cancelled":"已取消"][$0.task.state] ?? $0.task.state} ?? "材料已保存",systemImage:"sparkles").font(.headline);if let reason=report?.diagnosis.reason{Text(reason)};if let error{Text(error).foregroundStyle(.red)};HStack{Button("刷新"){Task{await load()}};if ["failed","waiting_action"].contains(report?.task.state ?? ""){Button("重试"){Task{await load(retry:true)}}}}.disabled(busy)}.task{await load()}.id(model.sessionID)}
    @MainActor private func load(retry:Bool=false)async{guard !busy else{return};busy=true;defer{busy=false};let generation=model.sessionID;do{let client=try model.client();if retry{try await client.taskAction(taskID,action:"retry")};let value=try await client.taskDiagnostics(taskID:taskID);guard generation==model.sessionID else{return};report=value;error=nil}catch{if generation==model.sessionID{self.error=safeMessage(error)}}}
}
