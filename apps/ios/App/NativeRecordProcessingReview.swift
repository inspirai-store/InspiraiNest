#if DEBUG
import SwiftUI

@MainActor struct NativeRecordProcessingReview:View {
  let configuration:NativeReviewConfiguration
  @StateObject private var records=NativeRecordListModel(snapshot:.init(records:NativeRecordListReview.examples),phase:.content,origin:"https://library.inspirai.store",now:{NativeRecordListModel.date("2026-10-16T12:00:00+08:00")!})
  @StateObject private var workbench=NativeRecordWorkbench()
  @State private var module:NativeAppModule = .records
  @State private var started=false
  @State private var ready=false
  @StateObject private var reader=NativeReaderModel()
  @State private var readingEntry:String?
  var body:some View {
    NativeRecordWorkspace(records:records,workbench:workbench,module:$module,autoReload:false,focusEditor:false)
      .accessibilityElement(children:.contain).accessibilityIdentifier(ready ? "record.processing.review.ready" : "record.processing.review.loading")
      .fullScreenCover(isPresented:.init(get:{readingEntry != nil},set:{if !$0 {readingEntry=nil}})) {
        if let id=readingEntry {NavigationStack {NativeReaderView(model:reader,entryID:id,tablet:UIDevice.current.userInterfaceIdiom == .pad,favorite:false,toggleFavorite:{},modalReturn:"加工结果").overlay {NativeReaderPanels(model:reader)}.modifier(NativeReaderExportPresentation(model:reader))}}
      }
      .task {
        guard !started else{return};started=true
        do {
          let args=ProcessInfo.processInfo.arguments
          var key=UUID().uuidString
          if let i=args.firstIndex(of:"--review-record-store"),args.indices.contains(i+1) {key=String(args[i+1].filter {$0.isASCII&&($0.isLetter||$0.isNumber||$0=="-")}.prefix(80))}
          let dir=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("RecordsProcessingReview/"+key,isDirectory:true)
          let scope="process-review",store=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Originals"))
          let assets=try await NativeRecordMediaReview.assets(directory:dir,media:media,scope:scope,dark:configuration.appearance == .dark)
          let source=try NativeRecordMediaReview.discussion(attachment:assets[1])
          var record=NativeRecord(id:"0e46deaf-b6ce-4ec3-9d66-0622cf730fb7",text:source.text,attachments:source.attachments,version:3,createdAt:source.createdAt,updatedAt:source.updatedAt,document:source.document,tasks:source.tasks)
          if configuration.page=="HTTP" {try await http(record:record,store:store,media:media,scope:scope);ready=true;return}
          let live=configuration.page=="LIVE" || configuration.page=="HTTP"
          let service=try NativeRecordProcessingFixture(record:record,directory:dir,seed:!live,lostReply:args.contains("--review-process-lost-reply"))
          let initial=await service.recordValue();record=initial
          try await store.mergeRemote([record],scope:scope)
          _ = try await store.begin(record:NativeRecordListReview.examples[3],scope:scope)
          workbench.mediaStore=media;workbench.recordingDirectory=dir.appendingPathComponent("Recordings")
          await workbench.configure(store:store,scope:scope,list:records)
          var examples=NativeRecordListReview.examples;examples[2]=record
          await records.configure(service:NativeRecordReviewService(records:examples),storage:nil,origin:"https://library.inspirai.store",deviceID:scope,expired:false)
          records.selectedID=record.id
          if UIDevice.current.userInterfaceIdiom != .pad || configuration.narrow {records.path=[record.id]}
          await workbench.refresh()
          await workbench.sync.configure(store:store,media:media,service:nil,scope:scope,origin:"https://library.inspirai.store",watchNetwork:false,autoStart:false)
          await workbench.processing.configure(store:store,service:service,scope:scope,sync:workbench.sync)
          workbench.processing.updated={ [weak workbench] in
            let latest=await service.recordValue();try? await store.mergeRemote([latest],scope:scope);await workbench?.refresh()
          }
          await workbench.processing.open(record)
          if live {ready=true;return}
          let model=workbench.processing,state=await service.stateValue(),page=configuration.page
          model.review(record:record,jobs:state.tasks,devices:state.devices,route:.form)
          model.form.advanced=page=="N08"
          if page=="N08-C" {model.form.preset = .custom;model.form.instructions="按议题分组，保留每项决定、负责人和截止时间。"}
          if page=="N08-D" {model.route = .device}
          if page=="N08-G" {model.route = .agent}
          if page=="N08-Q" {model.route = .queue}
          if page=="N08-S" {var pending=record;pending.sync = .pending;model.record=pending;model.route = .sync}
          if page=="N08-F" {
            let request=NativeRecordProcessRequest(requestId:UUID().uuidString.lowercased(),baseVersion:3,preset:.summary,instructions:model.form.instructions)
            model.frozen = .init(scope:scope,recordID:record.id,request:request,body:try request.data());model.route = .submissionFailure;model.failure="无法连接资料空间。原始记录与本次加工要求已保留。"
          }
          if page=="N09-H" {model.route = .history}
          if ["N09-P","N09-F","N09-C"].contains(page),let first=state.tasks.first {
            let changed=await service.changeJob(first.id,state:page=="N09-F" ? "failed" : "running")
            model.review(record:record,jobs:changed.tasks,devices:changed.devices,route:.task(first.id))
            if page=="N09-C" {model.confirmation="cancel"}
          }
          if page.hasPrefix("N10"),let first=state.tasks.first {
            await model.openJob(first)
            if page=="N10-A" {model.resultCategory=1}
            if page=="N10-M" {model.resultCategory=2}
            if page=="N10-C" {model.confirmation="approve"}
            if page=="N10-D" {try await service.approveDraft(first.id,expectedDigest:first.draftId!);await model.reload();if let job=model.jobs.first {await model.openJob(job)}}
            if page=="N10-V" {await service.replaceDraft();await model.draft.checkVersion()}
          }
          model.debugReadOnly=true
          ready=true
        } catch {workbench.openError=String(describing:error);ready=true}
      }
  }
  private func http(record original:NativeRecord,store:NativeRecordLocalStore,media:NativeRecordMediaStore,scope:String) async throws {
    let args=ProcessInfo.processInfo.arguments
    let acceptance=args.contains("--records-final-acceptance")
    let address=acceptance ? "https://127.0.0.1:54130" : "https://127.0.0.1:54128"
    let origin=try ServerOrigin(address),api=CollectorAPI(origin:origin,token:acceptance ? "records-final-ios-acceptance" : "stage05-process-ios-fixture")
    let audioAcceptance=acceptance && args.contains("--acceptance-audio")
    let id=audioAcceptance ? "86268207-f549-4d32-a3de-41190461c9b4" : "e64725d7-2ed8-426e-a76b-128d9ffed642"
    let record:NativeRecord
    do {record=try await api.record(id)}catch NativeRecordSyncFailure.http(404,_,_) {
      if audioAcceptance {throw NativeRecordSyncFailure.http(404,nil,"验收音频记录不存在")}
      let a=original.attachments[0],attachment=NativeRecordAttachment(id:"cb875857-e03b-448e-9d5a-1b09d1912b66",name:a.name,mime:a.mime,bytes:a.bytes,sha256:a.sha256)
      if try await api.mediaReceipt(a.sha256)==nil {let url=try await media.verifiedURL(a,scope:scope);_ = try await api.upload(attachment,url:url,progress:{_,_ in})}
      func replace(_ input:NativeRecordNode)->NativeRecordNode {var node=input;if node.attachmentID==a.id {node.attrs?["attachmentId"] = .string(attachment.id)};node.content=node.content?.map(replace);return node}
      var document=try NativeRecordDocument(record:original);document.doc=replace(document.doc)
      let payload=NativeRecordSaveRequest(requestId:UUID().uuidString.lowercased(),baseVersion:0,text:original.text,document:try document.json(),attachments:[attachment],createdAt:original.createdAt)
      let op=NativeRecordSyncOperation(id:payload.requestId,scope:scope,recordID:id,localRevision:1,payload:payload,body:try payload.data(),state:.pending,origin:origin.value,createdAt:original.createdAt)
      record=try await api.putRecord(op)
    }
    try await store.mergeRemote([record],scope:scope)
    workbench.mediaStore=media;await workbench.configure(store:store,scope:scope,list:records)
    var examples=NativeRecordListReview.examples;examples[2]=record
    await records.configure(service:NativeRecordReviewService(records:examples),storage:nil,origin:origin.value,deviceID:NativeRecordProcessingFixture.ownerID,expired:false)
    records.selectedID=id;if UIDevice.current.userInterfaceIdiom != .pad || configuration.narrow {records.path=[id]}
    await workbench.refresh()
    await workbench.sync.configure(store:store,media:media,service:api,scope:scope,origin:origin.value,watchNetwork:false,autoStart:false)
    await workbench.processing.configure(store:store,service:api,scope:scope,sync:workbench.sync)
    workbench.processing.updated={ [weak workbench] in if let latest=try? await api.record(id){try? await store.mergeRemote([latest],scope:scope);await workbench?.refresh()} }
    reader.configure(service:api)
    workbench.processing.openLibrary={archive in readingEntry=archive.entryId}
    await workbench.processing.open(record)
    if args.contains("--acceptance-open-latest") {
      await workbench.processing.reload(force:true)
      if let job=workbench.processing.jobs.first {await workbench.processing.openJob(job)}
    }
  }
}

actor NativeRecordProcessingFixture:NativeRecordProcessService {
  struct Ledger:Codable {var jobs:[LibraryTask];var accepted:[String:LibraryTask]=[:];var bodies:[String:Data]=[:]}
  private var ledger:Ledger
  private var record:NativeRecord
  private let file:URL
  private let lostReply:Bool
  private var reads=0
  private var data:Data
  private var bundles:[String:Data]=[:]
  private let seeded:Bool
  static let workerID="6f91d48c-e6fa-425e-b2db-9657d6d7547c"
  static let ownerID="7af57b63-5ae1-4810-90ef-4198cbd57e0f"
  static let summary="## 关键结论\n\n移动端以记录为高频入口，拍照和录音紧邻输入区。原始记录与加工结果分别保存。\n\n## 下一步行动\n\n- 完成记录入口与底栏调整。\n- 验证附件原件与同步状态。\n- 核对 iPhone 与 iPad 排版。\n"
  init(record:NativeRecord,directory:URL,seed:Bool,lostReply:Bool=false)throws {
    self.record=record;self.file=directory.appendingPathComponent("processing-fixture.json");self.lostReply=lostReply;seeded=seed
    data=try Self.bundle(record:record,summary:Self.summary);let digest=ReadFile.digest(data);bundles[digest]=data
    if !seed,let bytes=try? Data(contentsOf:file),let saved=try? JSONDecoder().decode(Ledger.self,from:bytes) {ledger=saved}
    else {
      var jobs:[LibraryTask]=[]
      if seed {for i in 0..<3 {
        let kind=["summary","transcribe","actions"][i],created=i==0 ? "2026-10-16T10:32:00+08:00" : "2026-10-15T18:\(i==1 ? "45" : "42"):00+08:00"
        var task=Self.job(id:UUID().uuidString.lowercased(),record:record,version:3-i,preset:kind,state:i==0 ? "awaiting_review" : "completed",created:created)
        task.draftVersion=2
        task=try Self.change(task,["draftId":digest,"archiveId":i==0 ? NSNull() : digest]);jobs.append(task)
      }}
      ledger=Ledger(jobs:jobs)
    }
    try JSONEncoder().encode(ledger).write(to:file,options:.atomic)
  }
  nonisolated static func bundle(record:NativeRecord,summary:String)throws->Data {
    func f(_ path:String,_ role:String,_ value:String)->[String:Any]{let data=Data(value.utf8);return ["path":path,"role":role,"body":data.base64EncodedString(),"bytes":data.count,"sha256":ReadFile.digest(data)]}
    return try JSONSerialization.data(withJSONObject:["meta":["title":"产品讨论 · 要点与行动","summary":"记录入口与同步核对。","coverage_note":"完整正文与原件已保留。","status":"archived"],"files":[f("summary.md","summary",summary),f("original.txt","original",record.text)],"omitted":[]],options:[.sortedKeys])
  }
  nonisolated static func job(id:String,record:NativeRecord,version:Int,preset:String,state:String,created:String)->LibraryTask {
    var task=LibraryTask(id:id,submissionId:nil,content:record.text,url:nil,state:state,events:[.init(at:state=="completed" ? "2026-10-16T10:38:00+08:00" : state=="awaiting_review" ? "2026-10-16T10:35:00+08:00" : "2026-10-16T10:33:00+08:00",state:state,message:state=="failed" ? "未生成审核草稿" : "Codex")],deviceId:workerID,archiveId:nil,draftId:nil,createdAt:created)
    task.recordId=record.id;task.recordVersion=version;task.processing = .init(preset:preset,instructions:"");task.agent="codex";task.recordSnapshot=record;task.draftVersion=2
    return task
  }
  nonisolated static func change(_ task:LibraryTask,_ fields:[String:Any])throws->LibraryTask {var value=try JSONSerialization.jsonObject(with:JSONEncoder().encode(task)) as! [String:Any];for (k,v) in fields {value[k]=v};return try JSONDecoder().decode(LibraryTask.self,from:JSONSerialization.data(withJSONObject:value))}
  private func save()throws {try JSONEncoder().encode(ledger).write(to:file,options:.atomic)}
  func stateValue()->ServerState {
    let owner=Device(id:Self.ownerID,name:"iPhone",role:"owner",revokedAt:nil,online:true,agents:nil)
    let workers=[Device(id:Self.workerID,name:"m4-macmini-home",role:"worker",revokedAt:nil,online:true,agents:["codex","codebuddy"],recordProtocol:1,capabilities:["note"]),Device(id:"4dd4b42c-37e1-4ee5-a95a-1256ce5669e4",name:"熊熊的小窝",role:"worker",revokedAt:nil,online:false,agents:["codex"],recordProtocol:1,capabilities:["note"])]
    return .init(me:owner,devices:[owner]+workers,tasks:ledger.jobs,archives:[])
  }
  func recordValue()->NativeRecord {var value=record;value.tasks=ledger.jobs.map {.init(id:$0.id,state:$0.state,recordVersion:$0.recordVersion,createdAt:$0.createdAt,title:NativeRecordPreset(rawValue:$0.processing?.preset ?? "")?.title)};return value}
  func record(_ id:String) async throws ->NativeRecord {recordValue()}
  func state() async throws ->ServerState {
    if !seeded,let first=ledger.jobs.first,["queued","running"].contains(first.state) {
      reads+=1
      if reads>=2 {let next=first.state=="queued" ? "running" : "awaiting_review";ledger.jobs[0]=try Self.change(first,["state":next,"draftId":ReadFile.digest(data)]);try save();reads=0}
    }
    return stateValue()
  }
  func processRecord(_ operation:NativeRecordProcessOperation) async throws ->LibraryTask {
    if let old=ledger.accepted[operation.id] {guard ledger.bodies[operation.id]==operation.body else {throw NativeRecordSyncFailure.changed};return old}
    var job=Self.job(id:UUID().uuidString.lowercased(),record:record,version:operation.request.baseVersion,preset:operation.request.preset.rawValue,state:"queued",created:"2026-10-16T10:32:00+08:00")
    job=try Self.change(job,["submissionId":"record:"+record.id+":"+operation.id]);ledger.jobs.insert(job,at:0);ledger.accepted[operation.id]=job;ledger.bodies[operation.id]=operation.body;try save()
    if lostReply {throw URLError(.networkConnectionLost)}
    return job
  }
  func taskAction(_ id:String,action:String) async throws {
    guard let index=ledger.jobs.firstIndex(where:{$0.id==id}) else {throw CollectorError.http(404)}
    ledger.jobs[index]=try Self.change(ledger.jobs[index],["state":action=="cancel" ? "cancelled" : "queued"]);try save()
  }
  func draft(_ id:String,expectedDigest:String) async throws ->DraftBundle {
    guard let job=ledger.jobs.first(where:{$0.id==id}),job.state=="awaiting_review",job.draftId==expectedDigest,let data=bundles[expectedDigest] else {throw CollectorError.http(409)}
    return try JSONDecoder().decode(DraftBundle.self,from:data)
  }
  func approveDraft(_ id:String,expectedDigest:String) async throws {
    guard let index=ledger.jobs.firstIndex(where:{$0.id==id}),ledger.jobs[index].draftId==expectedDigest else {throw CollectorError.http(409)}
    ledger.jobs[index]=try Self.change(ledger.jobs[index],["state":"completed","archiveId":expectedDigest,"events":[["at":"2026-10-16T10:38:00+08:00","state":"completed","message":"用户已确认归档"]]]);try save()
  }
  func recordArchive(_ digest:String) async throws ->DraftBundle {guard let data=bundles[digest],ReadFile.digest(data)==digest else {throw ReaderFailure.integrity};return try JSONDecoder().decode(DraftBundle.self,from:data)}
  func changeJob(_ id:String,state:String)->ServerState {
    if let i=ledger.jobs.firstIndex(where:{$0.id==id}) {ledger.jobs[i]=Self.job(id:id,record:record,version:ledger.jobs[i].recordVersion ?? 3,preset:ledger.jobs[i].processing?.preset ?? "summary",state:state,created:ledger.jobs[i].createdAt)}
    return stateValue()
  }
  func replaceDraft() {
    guard !ledger.jobs.isEmpty,let replacement=try? Self.bundle(record:record,summary:Self.summary+"\n更新的内容。") else{return}
    let digest=ReadFile.digest(replacement);bundles[digest]=replacement
    ledger.jobs[0]=(try? Self.change(ledger.jobs[0],["draftId":digest,"draftVersion":3])) ?? ledger.jobs[0]
  }
}
#endif
