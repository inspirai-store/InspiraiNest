import Foundation
import SwiftUI

protocol NativeRecordProcessService:NativeDraftService,NativeTaskService {
  func processRecord(_ operation:NativeRecordProcessOperation) async throws -> LibraryTask
  func record(_ id:String) async throws -> NativeRecord
  func recordArchive(_ digest:String) async throws -> DraftBundle
}
extension CollectorAPI:NativeRecordProcessService {
  func processRecord(_ op:NativeRecordProcessOperation) async throws -> LibraryTask {
    try op.request.validate()
    guard UUID(uuidString:op.recordID) != nil,op.body == (try op.request.data()) else {throw NativeRecordSyncFailure.integrity}
    let (data,_)=try await recordData(recordURLRequest("/api/records/"+op.recordID+"/process",method:"POST",mime:"application/json",body:op.body))
    let task=try JSONDecoder().decode(LibraryTask.self,from:data)
    guard UUID(uuidString:task.id) != nil,task.recordId==op.recordID,task.recordVersion==op.request.baseVersion,
      task.submissionId=="record:"+op.recordID+":"+op.id else {throw NativeRecordSyncFailure.integrity}
    return task
  }
  func recordArchive(_ digest:String) async throws -> DraftBundle {let data=try await readArchiveData(digest:digest);return try JSONDecoder().decode(DraftBundle.self,from:data)}
}
enum NativeRecordProcessRoute:Equatable {case form,device,agent,queue,sync,submissionFailure,history,task(String),result(String),archived(String),source(String)}

@MainActor final class NativeRecordProcessingModel:ObservableObject {
  @Published var route:NativeRecordProcessRoute?
  @Published var record:NativeRecord?
  @Published var form=NativeRecordProcessDraft(scope:"",recordID:"")
  @Published private(set) var jobs:[LibraryTask]=[]
  @Published private(set) var devices:[Device]=[]
  @Published private(set) var busy=false
  @Published var failure:String?
  @Published var confirmation:String?
  @Published var resultCategory=0
  @Published var archived:DraftBundle?
  @Published var archives:[ArchiveRecord]=[]
  @Published var resultPreview:NativeRecordAttachment?
  @Published var frozen:NativeRecordProcessOperation?
  @Published var reviewedVersion:Int?
  var sourceReturn:NativeRecordProcessRoute?
  let draft=NativeDraftModel()
  private var store:NativeRecordLocalStore?
  private var service:(any NativeRecordProcessService)?
  private var scope=""
  private var generation=UUID()
  private var reading=false
  private var stateRequest=UUID()
  private var pendingFlush:Task<Void,Never>?
  weak var sync:NativeRecordSyncModel?
  var updated:(() async -> Void)?
  var connect:(()->Void)?
  var openLibrary:((ArchiveRecord)->Void)?
  var debugReadOnly=false
  func configure(store:NativeRecordLocalStore?,service:(any NativeRecordProcessService)?,scope:String,sync:NativeRecordSyncModel) async {
    disconnect();let token=generation;await pendingFlush?.value;guard token==generation else{return}
    self.store=store;self.service=service;self.scope=scope;self.sync=sync;draft.configure(service:service)
  }
  func disconnect() {
    if !debugReadOnly,record?.id==form.recordID,form.scope==scope,!scope.isEmpty,frozen==nil,let store {var saved=form;saved.revision+=1;pendingFlush=Task {try? await store.saveProcessDraft(saved)}}
    generation=UUID();route=nil;record=nil;jobs=[];devices=[];archives=[];busy=false;reading=false;failure=nil;confirmation=nil;archived=nil;resultPreview=nil;frozen=nil;service=nil;draft.configure(service:nil)
  }
  func flushPending() async {await pendingFlush?.value}
  func open(_ record:NativeRecord,history:Bool=false) async {
    self.record=record;route=history ? .history : .form;failure=nil;confirmation=nil;archived=nil;resultCategory=0
    guard !debugReadOnly else{return}
    let token=generation
    do {
      let saved=try await store?.processDraft(scope:scope,id:record.id)
      let operation=try await store?.processOperation(scope:scope,id:record.id)
      guard token==generation else{return}
      form=saved ?? .init(scope:scope,recordID:record.id);frozen=operation
      if let operation {form.preset=operation.request.preset;form.instructions=operation.request.instructions;form.deviceID=operation.request.deviceId;form.agent=operation.request.agent}
      await reload()
    } catch {if token==generation {failure="加工要求读取失败 · 原始记录已保留"}}
  }
  @discardableResult func persist() async -> Bool {
    guard !debugReadOnly,!busy,frozen==nil,record != nil else{return true}
    guard let store else {failure="加工要求未能保存到本机";return false}
    form.revision+=1;let value=form,token=generation
    do {try await store.saveProcessDraft(value);return true}catch {if token==generation {failure="加工要求未能保存到本机"};return false}
  }
  var workers:[Device] {devices.filter {$0.role=="worker"&&$0.revokedAt==nil&&$0.recordProtocol==1&&($0.capabilities?.contains("note") ?? true)}}
  var availableAgents:[String] {let values=Set(workers.filter {form.deviceID==nil||$0.id==form.deviceID}.flatMap {$0.agents ?? []});return ["codex","claude","gemini","opencode"].filter {values.contains($0)}}
  var hasOnlineWorker:Bool {workers.contains {($0.online ?? false)&&(form.deviceID==nil||$0.id==form.deviceID)&&(form.agent==nil||($0.agents?.contains(form.agent!) ?? false))}}
  var selectedDevice:String {workers.first {$0.id==form.deviceID}?.name ?? "自动选择"}
  func agentName(_ key:String?)->String {key=="codex" ? "Codex" : key=="codebuddy" ? "CodeBuddy" : "自动选择"}
  var job:LibraryTask? {
    switch route {case .task(let id),.result(let id),.archived(let id),.source(let id):return jobs.first {$0.id==id};default:return jobs.first}
  }
  var sourceVersion:Int {job?.recordVersion ?? record?.version ?? 0}
  func reload(force:Bool=false) async {
    guard !debugReadOnly,let service,let record,!reading||force else{return}
    let token=generation,request=UUID();stateRequest=request;reading=true
    defer {if token==generation,request==stateRequest {reading=false}}
    do {
      let state=try await service.state();guard token==generation,request==stateRequest else{return}
      guard state.me.role=="owner",state.me.revokedAt==nil else {throw CollectorError.http(403)}
      jobs=state.tasks.filter {$0.recordId==record.id}.sorted {$0.createdAt>$1.createdAt};devices=state.devices;archives=state.archives
      await updated?()
    }catch {if token==generation,request==stateRequest {handle(error)}}
  }
  func start(allowQueue:Bool=false,retry:Bool=false) async {
    guard !busy,let record else{return}
    if debugReadOnly {route = .history;return}
    guard let service,let store,scope != NativeRecordLocalStore.unbound else {failure="连接资料空间后再加工";return}
    let token=generation
    busy=true;failure=nil
    defer {if token==generation {busy=false}}
    do {
      if frozen==nil {
        if let entry=try await store.snapshot(scope:scope).records.first(where:{$0.record.id==record.id}),entry.record.version != record.version || entry.record.sync != .synced || entry.record.text != record.text || entry.record.document != record.document || entry.record.attachments != record.attachments {
          guard token==generation else{return};self.record=entry.record;route=entry.record.sync == .synced ? .form : .sync;return
        }
        guard record.sync == .synced else {route = .sync;return}
        let current=try await service.record(record.id);guard token==generation else{return}
        guard current.version==record.version,current.text==record.text,current.document==record.document,current.attachments==record.attachments else {self.record=current;route = .form;failure="记录版本已变化 · 请确认版本后再加工";return}
        if !hasOnlineWorker && !allowQueue {route = .queue;return}
        let payload=NativeRecordProcessRequest(requestId:UUID().uuidString.lowercased(),baseVersion:record.version,preset:form.preset,instructions:form.instructions,deviceId:form.deviceID,agent:form.agent)
        try payload.validate();form.revision+=1;try await store.saveProcessDraft(form)
        let operation=NativeRecordProcessOperation(scope:scope,recordID:record.id,request:payload,body:try payload.data())
        try await store.saveProcessOperation(operation);guard token==generation else{return};frozen=operation
      }
      guard var operation=frozen else{return}
      let task=try await service.processRecord(operation);guard token==generation else{return}
      operation.accepted=task;try await store.saveProcessOperation(operation);guard token==generation else{return}
      frozen=nil;jobs.removeAll {$0.id==task.id};jobs.insert(task,at:0);route = .task(task.id)
      await reload();sync?.start()
    }catch {
      guard token==generation else{return}
      if case NativeRecordSyncFailure.http(let status,let code,_)=error,status==400 || (status==409&&code=="record_version_missing"),var op=frozen {
        op.rejected=true
        do {try await store.saveProcessOperation(op);guard token==generation else{return};frozen=nil;route = .form;failure=code=="record_version_missing" ? "来源版本已不可用 · 请重新确认记录版本" : "加工请求未提交 · 请核对加工要求、电脑与 Agent"}catch {handle(error)}
      }else {handle(error)}
    }
  }
  func synchronize() async {
    guard !busy,let sync,let id=record?.id else{return}
    busy=true;let token=generation
    await sync.retry(id);await sync.waitUntilIdle()
    guard token==generation else{return};busy=false
    if let entry=sync.entry(id),entry.record.sync == .synced {record=entry.record;route = .form}
    else {failure="记录尚未同步 · 请先处理同步状态"}
  }
  func action(_ action:String) async {
    guard let task=job,!busy else{return}
    if action=="cancel" {confirmation="cancel";return}
    await taskAction(task.id,action:action)
  }
  func taskAction(_ id:String,action:String) async {
    guard !debugReadOnly,let service,!busy else{return}
    let token=generation;busy=true;confirmation=nil;failure=nil
    defer {if token==generation {busy=false}}
    do {
      let state=try await service.state();guard token==generation else{return}
      guard state.me.role=="owner",state.me.revokedAt==nil,let current=state.tasks.first(where:{$0.id==id&&$0.recordId==record?.id}),action=="retry" ? current.canRetry : current.canCancel else {throw CollectorError.message("任务状态已变化")}
      try await service.taskAction(id,action:action);guard token==generation else{return};await reload();sync?.start()
    }catch {if token==generation {handle(error)}}
  }
  func openJob(_ task:LibraryTask) async {
    failure=nil;resultCategory=0
    if task.state=="awaiting_review" {route = .result(task.id);if !debugReadOnly {await reloadResult(task.id)}}
    else if task.state=="completed",let digest=task.archiveId {
      route = .archived(task.id)
      guard !debugReadOnly,let service else{return};let token=generation
      do {let value=try await service.recordArchive(digest);guard token==generation else{return};archived=value}
      catch {if token==generation {handle(error)}}
    } else {route = .task(task.id)}
  }
  func reloadResult(_ id:String) async {if case .archived(let current)=route,current==id,let task=jobs.first(where:{$0.id==id}) {await openJob(task);return};let token=generation;await draft.load(id);guard token==generation else{return};if draft.phase == .ready {reviewedVersion=draft.task?.draftVersion}}
  func approve() async {
    guard !busy,!debugReadOnly else{return}
    let token=generation;await draft.approve();guard token==generation else{return}
    if draft.phase == .archived,let approved=draft.task {await reload(force:true);guard token==generation else{return};jobs.removeAll {$0.id==approved.id};jobs.insert(approved,at:0);await openJob(approved);sync?.start()}
  }
  private func handle(_ error:Error) {
    if frozen != nil {route = .submissionFailure}
    if (error as? NativeRecordSyncFailure)?.unauthorized==true || (error as? CollectorError).map({if case .http(let n)=$0 {return [401,403].contains(n)};return false})==true {
      draft.configure(service:nil,expired:true);failure="设备授权已失效 · 加工要求保留在本机";connect?()
    } else if error is ReaderFailure {failure="结果完整性校验失败 · 原始记录已保留"}
    else if case CollectorError.message(let message)=error {failure=message}
    else {failure="无法连接资料空间。原始记录与本次加工要求已保留。"}
  }
#if DEBUG
  func review(record:NativeRecord,jobs:[LibraryTask],devices:[Device],route:NativeRecordProcessRoute){self.record=record;self.jobs=jobs;self.devices=devices;self.route=route}
#endif
}
