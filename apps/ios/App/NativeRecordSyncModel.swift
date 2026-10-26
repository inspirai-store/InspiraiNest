import Foundation
import AVFoundation
import Network
import SwiftUI

enum NativeRecordSyncRoute:Equatable {case queue,detail(String),conflict(String),space(String)}
struct NativeRecordTransfer:Equatable {var sent:Int64;var total:Int64;var attachmentID:String;var fraction:Double {total>0 ? min(1,Double(sent)/Double(total)) : 0}}
@MainActor final class NativeRecordSyncModel:ObservableObject {
  @Published var route:NativeRecordSyncRoute?
  @Published var confirmation:String?
  @Published var binding:String?
  @Published var adoptingSpace:String?
  @Published var notice:String?
  @Published private(set) var entries:[NativeRecordLocalEntry]=[]
  @Published private(set) var operations:[NativeRecordSyncOperation]=[]
  @Published private(set) var otherSpaces:[NativeRecordSpaceSummary]=[]
  @Published var localOriginals:Set<String>=[]
  @Published var durations:[String:String]=[:]
  @Published var transfers:[String:NativeRecordTransfer]=[:]
  @Published private(set) var running=false
  @Published private(set) var expired=false
  @Published private(set) var offline=false
  @Published private(set) var phase:NativeRecordListPhase = .unpaired
  private(set) var scope=NativeRecordLocalStore.unbound
  private(set) var origin=""
  private var store:NativeRecordLocalStore?
  private var media:NativeRecordMediaStore?
  private var service:(any NativeRecordSyncService)?
  private var generation=UUID()
  private var worker:Task<Void,Never>?
  private var monitor:NWPathMonitor?
  private var hadNetwork=false
  var changed:(() async -> Void)?
  var prepareAdoption:((String) async -> Bool)?
  deinit {worker?.cancel();monitor?.cancel()}
  func configure(store:NativeRecordLocalStore?,media:NativeRecordMediaStore?,service:(any NativeRecordSyncService)?,scope:String,origin:String,expired:Bool=false,watchNetwork:Bool=true,autoStart:Bool=true) async {
    generation=UUID();worker?.cancel();worker=nil;monitor?.cancel();monitor=nil
    self.store=store;self.media=media;self.service=expired ? nil : service;self.scope=scope;self.origin=origin
    self.expired=expired;localOriginals=[];phase=expired ? .expired : service == nil ? .unpaired : .content;durations=[:];offline=false;running=false;route=nil;confirmation=nil;binding=nil;adoptingSpace=nil;notice=nil;transfers=[:]
    try? await store?.registerSpace(scope:scope,origin:origin)
    await reload()
    if watchNetwork,service != nil,!expired {
      let monitor=NWPathMonitor();self.monitor=monitor;let token=generation
      monitor.pathUpdateHandler={ [weak self] path in
        let available=path.status == .satisfied
        Task {@MainActor in
          guard let self,self.generation==token else{return}
          let restored=available && !self.hadNetwork;self.hadNetwork=available;self.offline = !available
          if restored {self.start(retryNetwork:true)}
        }
      };monitor.start(queue:DispatchQueue(label:"lingnest.records.connectivity"))
    }
    if autoStart {start()}
  }
  func disconnect() {
    generation=UUID();worker?.cancel();worker=nil;monitor?.cancel();monitor=nil
    service=nil;route=nil;confirmation=nil;binding=nil;adoptingSpace=nil;notice=nil;entries=[];operations=[];otherSpaces=[];transfers=[:];running=false
  }
  func reload() async {
    guard let store else{return};let token=generation
    do {
      let snapshot=try await store.snapshot(scope:scope),ops=try await store.syncOperations(scope:scope),spaces=try await store.otherSpaces(current:scope)
      guard token==generation else{return};entries=snapshot.records;operations=ops;otherSpaces=spaces
      await changed?()
      if let media {
        for attachment in entries.flatMap({$0.record.attachments}) where attachment.mime.hasPrefix("audio/") && durations[attachment.sha256]==nil {
          let owner=entries.first {$0.record.attachments.contains(attachment)}?.scope ?? scope
          if let url=try? await media.export(attachment,scope:owner),let duration=try? await AVURLAsset(url:url).load(.duration),duration.seconds.isFinite,token==generation {durations[attachment.sha256]=NativeRecordMediaPreviewModel.time(duration.seconds)}
        }
      }
    } catch {if token==generation {notice="同步队列读取失败 · 本机内容已保留"}}
  }
  func start(retryFailed:Bool=false,retryNetwork:Bool=false) {
    guard worker == nil,service != nil,store != nil,media != nil,!expired,scope != NativeRecordLocalStore.unbound else{return}
    let token=generation
    worker=Task { [weak self] in
      guard let self else{return}
      defer {if token==self.generation {self.worker=nil;self.running=false}}
      self.running=true
      if retryFailed || retryNetwork {try? await self.store?.retrySync(scope:self.scope,onlyNetwork:retryNetwork && !retryFailed)}
      await self.run(token)
    }
  }
  func waitUntilIdle() async {await worker?.value}
  private func active(_ token:UUID)->Bool {token==generation && !Task.isCancelled}
  private func run(_ token:UUID) async {
    guard let service,let store,let media else{return}
    do {
      let capabilities=try await service.capabilities();guard active(token) else{return}
      let since=capabilities.incremental==true ? try await store.watermark(scope:scope) : nil
      var cursor:String?,seen=Set<String>(),remote:[NativeRecord]=[],watermark:String?
      repeat {
        let page=try await service.recordsPage(cursor:cursor,paginated:capabilities.pagination==true,updatedSince:since)
        guard active(token) else{return}
        remote += page.records;cursor=page.nextCursor;if watermark==nil {watermark=page.serverTime}
        if let cursor {guard seen.insert(cursor).inserted,seen.count<=10000 else {throw NativeRecordSyncFailure.integrity}}
      } while cursor != nil
      try await store.mergeRemote(remote,scope:scope)
      if capabilities.incremental==true,let watermark,NativeRecordListModel.date(watermark) != nil {try await store.setWatermark(watermark,scope:scope)}
      phase = .content;await reload()
      while active(token),let operation=try await store.nextSync(scope:scope,origin:origin) {
        var op=operation;op.state = .syncing;op.error=nil;op.step = .checking
        try await store.updateSync(op);await reload()
        do {
          for attachment in op.payload.attachments {
            try Task.checkCancellation();guard active(token) else{return}
            op.step = .originals;op.activeAttachmentID=attachment.id;try await store.updateSync(op)
            try await ensure(attachment,scope:op.scope,recordID:op.recordID,service:service,media:media,capabilities:capabilities,token:token)
            guard active(token) else{return}
            if !op.uploaded.contains(attachment.sha256){op.uploaded.append(attachment.sha256);try await store.updateSync(op)}
            if let digest=attachment.thumbnailSha256 {
              op.step = .previews;try await store.updateSync(op)
              if let receipt=try await service.mediaReceipt(digest) {
                guard receipt.mime.hasPrefix("image/"),receipt.bytes<=256*1024 else {throw NativeRecordSyncFailure.integrity}
              } else {
                let thumbnail=try await media.thumbnail(digest,scope:op.scope)
                try await ensure(thumbnail,scope:op.scope,recordID:op.recordID,service:service,media:media,capabilities:capabilities,token:token)
              }
            }
          }
          guard active(token) else{return}
          op.step = .record;op.activeAttachmentID=nil;try await store.updateSync(op);await reload()
          let result=try await service.putRecord(op);guard active(token) else{return}
          try await store.finishSync(op,record:result);transfers.removeValue(forKey:op.recordID);offline=false
        } catch {
          guard active(token),!(error is CancellationError) else{return}
          if let failure=error as? NativeRecordSyncFailure,failure.conflict {
            do {let remote=try await service.record(op.recordID);guard active(token) else{return};op.remote=remote;op.state = .conflict;op.error="远端版本已变化 · 本机内容已保留";op.errorCode="conflict"}
            catch {op.state = .failed;op.error=safeError(error);op.errorCode="network";if (error as? NativeRecordSyncFailure)?.unauthorized==true {expired=true}}
          } else {
            op.state = .failed;op.error=safeError(error)
            op.errorCode=(error is URLError) ? "network" : "server"
            if let value=error as? NativeRecordSyncFailure {if case .http(let status,_,_)=value,status>=500 {op.errorCode="network"};if value.unauthorized {expired=true}}
            if error is URLError {offline=true}
          }
          guard active(token) else{return}
          try await store.updateSync(op)
          if op.state == .conflict,case .detail(let id)=route,id==op.recordID {route = .conflict(id)}
          if expired || offline {phase=expired ? .expired : .offline;await reload();return}
        }
        await reload()
      }
    } catch {
      guard active(token) else{return};notice=safeError(error)
      if let value=error as? NativeRecordSyncFailure,value.unauthorized {expired=true}
      if error is URLError {offline=true}
      if expired {phase = .expired} else if offline {phase = .offline} else if case NativeRecordSyncFailure.http(let status,_,_)=error,[404,405].contains(status){phase = .unavailable}else{phase = .failure}
    }
    await reload()
  }
  private func ensure(_ attachment:NativeRecordAttachment,scope:String,recordID:String,service:any NativeRecordSyncService,media:NativeRecordMediaStore,capabilities:NativeRecordCapabilities,token:UUID) async throws {
    if let receipt=try await service.mediaReceipt(attachment.sha256) {
      guard receipt.bytes==attachment.bytes,receipt.mime==attachment.mime else {throw NativeRecordSyncFailure.integrity};return
    }
    if let types=capabilities.mediaTypes,!types.contains(attachment.mime){throw NativeRecordSyncFailure.http(415,nil,"资料空间暂不支持此原件格式 · 原件已保留")}
    let url=try await media.verifiedURL(attachment,scope:scope)
    localOriginals.insert(attachment.sha256)
    transfers[recordID] = .init(sent:0,total:Int64(attachment.bytes),attachmentID:attachment.id)
    _ = try await service.upload(attachment,url:url) { [weak self] sent,total in
      Task {@MainActor in guard let self,self.generation==token else{return};self.transfers[recordID] = .init(sent:sent,total:total,attachmentID:attachment.id)}
    }
    guard let receipt=try await service.mediaReceipt(attachment.sha256),receipt.mime==attachment.mime,receipt.bytes==attachment.bytes else {throw NativeRecordSyncFailure.integrity}
  }
  func show(_ id:String?=nil) {
    if let id,let entry=entry(id),let media {
      let token=generation
      Task {for attachment in entry.record.attachments {if (try? await media.verifiedURL(attachment,scope:entry.scope)) != nil,token==generation {localOriginals.insert(attachment.sha256)}}}
    }
    if let id,let operation=operations.first(where:{$0.recordID==id && $0.state == .conflict}),operation.remote != nil {route = .conflict(id)}
    else {route=id.map { .detail($0) } ?? .queue}
  }
  func retry(_ id:String?=nil) async {do {try await store?.retrySync(scope:scope,id:id);start();await reload()} catch {notice=safeError(error)}}
  func confirmConflict(_ id:String) async {
    guard let store,let service,let op=operations.first(where:{$0.recordID==id}),let shown=op.remote,
      let entry=entries.first(where:{$0.record.id==id}),entry.scope==scope else {return}
    let token=generation;confirmation=nil
    do {
      let latest=try await service.record(id);guard active(token) else{return}
      guard latest.version==shown.version else {var changed=op;changed.remote=latest;try await store.updateSync(changed);throw NativeRecordSyncFailure.changed}
      try await store.resolveConflict(scope:scope,operationID:op.id,localRevision:entry.localRevision,remote:latest)
      route = .detail(id);await reload();start()
    } catch {if active(token){notice=safeError(error);await reload()}}
  }
  func bind(_ id:String) async {
    guard let store,let media,service != nil,let entry=entries.first(where:{$0.record.id==id && $0.scope==NativeRecordLocalStore.unbound}) else{return}
    let token=generation;binding=nil
    do {
      for attachment in entry.record.attachments {try await media.copyOriginal(attachment,from:entry.scope,to:scope)}
      guard active(token) else{return}
      try await store.bindLocalRecord(id:id,revision:entry.localRevision,to:scope)
      await reload();start()
    } catch {if active(token){notice=safeError(error)}}
  }
  func connectOriginal(_ id:String,pair:()->Void) {
    if let original=otherSpaces.first(where:{$0.id==id}),original.origin==origin,service != nil {adoptingSpace=id}
    else {pair()}
  }
  func adopt(_ id:String) async {
    guard let store,let media,let service,otherSpaces.contains(where:{$0.id==id && $0.origin==origin}) else{return}
    adoptingSpace=nil;let token=generation
    do {
      if let prepareAdoption,!(await prepareAdoption(id)){throw NativeRecordLocalError.unavailable}
      let snapshot=try await store.snapshot(scope:id)
      let attachments=snapshot.records.filter {$0.scope==id}.flatMap {$0.record.attachments}+snapshot.drafts.filter {$0.scope==id}.flatMap(\.attachments)
      for a in attachments {
        if (try? await media.verifiedURL(a,scope:id)) != nil {try await media.copyOriginal(a,from:id,to:scope)}
        else {guard let receipt=try await service.mediaReceipt(a.sha256),receipt.bytes==a.bytes,receipt.mime==a.mime else{throw NativeRecordMediaError.missing}}
        if let digest=a.thumbnailSha256 {
          if let thumb=try? await media.thumbnail(digest,scope:id) {try await media.copyOriginal(thumb,from:id,to:scope)}
          else {guard let receipt=try await service.mediaReceipt(digest),receipt.mime.hasPrefix("image/"),receipt.bytes<=256*1024 else{throw NativeRecordMediaError.missing}}
        }
      }
      guard active(token) else{return};try await store.adoptSpace(from:id,to:scope)
      route = .queue;await reload();start()
    }catch {if active(token){notice=safeError(error)}}
  }
  func download(_ attachment:NativeRecordAttachment,owner:String) async throws {
    guard let service,let media,owner==scope,!expired else {throw CollectorError.message("请先连接记录所属的资料空间")}
    let token=generation,data=try await service.download(attachment)
    guard active(token) else {throw CancellationError()}
    guard data.count==attachment.bytes,NativeRecordMediaStore.digest(data)==attachment.sha256 else {throw NativeRecordSyncFailure.integrity}
    _ = try await media.store(data,scope:owner,existing:[],name:attachment.name,mime:attachment.mime,id:attachment.id)
    localOriginals.insert(attachment.sha256)
  }
  func entry(_ id:String)->NativeRecordLocalEntry? {entries.first {$0.record.id==id}}
  func operation(_ id:String)->NativeRecordSyncOperation? {operations.first {$0.recordID==id}}
  func aggregateTransfer(_ id:String)->NativeRecordTransfer? {
    guard let transfer=transfers[id],let entry=entry(id) else{return nil}
    let uploaded=Set(operation(id)?.uploaded ?? [])
    let total=entry.record.attachments.reduce(Int64(0)) {$0+Int64($1.bytes)}
    let completed=entry.record.attachments.filter {uploaded.contains($0.sha256)}.reduce(Int64(0)) {$0+Int64($1.bytes)}
    let active=entry.record.attachments.first {$0.id==transfer.attachmentID}
    let current=active.map {uploaded.contains($0.sha256) ? Int64(0) : min(Int64($0.bytes),transfer.sent)} ?? 0
    return .init(sent:completed+current,total:total,attachmentID:transfer.attachmentID)
  }
  var pending:[NativeRecordLocalEntry] {entries.filter {$0.record.sync != .synced}}
  var subtitle:String {"\(pending.count) 条待同步 · \(pending.filter {$0.record.sync == .failed}.count) 条同步失败"}
  private func safeError(_ error:Error)->String {
    (error as? NativeRecordSyncFailure)?.errorDescription ?? (error as? NativeRecordMediaError)?.errorDescription ?? (error as? NativeRecordLocalError)?.errorDescription ?? (error as? CollectorError)?.errorDescription ?? "连接已中断 · 本机正文与原件已保留"
  }
#if DEBUG
  func review(entries:[NativeRecordLocalEntry],operations:[NativeRecordSyncOperation],route:NativeRecordSyncRoute,transfers:[String:NativeRecordTransfer]=[:],spaces:[NativeRecordSpaceSummary]=[],origin:String="https://library.inspirai.store") {
    self.entries=entries;self.operations=operations;self.route=route;self.transfers=transfers;self.otherSpaces=spaces;self.origin=origin;scope="sync-review";localOriginals=Set(entries.flatMap {$0.record.attachments.map(\.sha256)})
  }
#endif
}
