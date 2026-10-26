import XCTest
@testable import PersonalLibrary

actor RecordSyncTestService:NativeRecordSyncService {
  var records:[String:NativeRecord]=[:]
  var files:[String:Data]=[:]
  var mimes:[String:String]=[:]
  var requests:[String:Data]=[:]
  var replies:[String:NativeRecord]=[:]
  var loseReply=false
  var offline=false
  var revoked=false
  var delay:UInt64=0
  var uploadCount=0
  func flags(loseReply:Bool=false,offline:Bool=false,revoked:Bool=false,delay:UInt64=0){self.loseReply=loseReply;self.offline=offline;self.revoked=revoked;self.delay=delay}
  func capabilities() async throws -> NativeRecordCapabilities {if revoked {throw NativeRecordSyncFailure.http(401,nil,"授权失效")};if offline {throw URLError(.notConnectedToInternet)};return .init(protocol:1,documentVersions:[1])}
  func recordsPage(cursor:String?,paginated:Bool,updatedSince:String?) async throws -> NativeRecordPage {try await check();return .init(records:Array(records.values))}
  func check() async throws {if delay>0 {try await Task.sleep(nanoseconds:delay)};if revoked {throw NativeRecordSyncFailure.http(401,nil,"授权失效")};if offline {throw URLError(.networkConnectionLost)}}
  func record(_ id:String) async throws -> NativeRecord {try await check();guard let value=records[id] else {throw NativeRecordSyncFailure.http(404,nil,"不存在")};return value}
  func putRecord(_ op:NativeRecordSyncOperation) async throws -> NativeRecord {
    try await check()
    if let prior=requests[op.id] {guard prior==op.body else {throw NativeRecordSyncFailure.http(409,"record_request_reused","请求变化")};return replies[op.id]!}
    guard (records[op.recordID]?.version ?? 0)==op.payload.baseVersion else {throw NativeRecordSyncFailure.http(409,"record_version_conflict","版本冲突")}
    for a in op.payload.attachments {guard files[a.sha256]?.count==a.bytes else {throw NativeRecordSyncFailure.http(409,"record_media_missing","原件缺失")}}
    let result=NativeRecord(id:op.recordID,text:op.payload.text,attachments:op.payload.attachments,version:op.payload.baseVersion+1,createdAt:op.payload.createdAt,updatedAt:"2026-10-16T10:43:00+08:00",document:op.payload.document)
    records[op.recordID]=result;requests[op.id]=op.body;replies[op.id]=result
    if loseReply {loseReply=false;throw URLError(.networkConnectionLost)}
    return result
  }
  func mediaReceipt(_ digest:String) async throws -> NativeRecordMediaReceipt? {try await check();guard let data=files[digest] else{return nil};return .init(sha256:digest,mime:mimes[digest] ?? "",bytes:data.count)}
  func upload(_ attachment:NativeRecordAttachment,url:URL,progress:@escaping @Sendable(Int64,Int64)->Void) async throws -> NativeRecordMediaReceipt {
    try await check();let data=try Data(contentsOf:url);guard NativeRecordMediaStore.digest(data)==attachment.sha256 else {throw NativeRecordSyncFailure.integrity}
    files[attachment.sha256]=data;mimes[attachment.sha256]=attachment.mime;uploadCount += 1;progress(Int64(data.count),Int64(data.count));return .init(sha256:attachment.sha256,mime:attachment.mime,bytes:data.count)
  }
  func download(_ a:NativeRecordAttachment) async throws -> Data {try await check();guard let data=files[a.sha256] else {throw NativeRecordMediaError.missing};return data}
  func desktopEdit(_ record:NativeRecord){records[record.id]=record}
  func counts()->(Int,Int){(requests.count,uploadCount)}
}

@MainActor final class NativeRecordSyncTests:XCTestCase {
  private func folder()->URL {FileManager.default.temporaryDirectory.appendingPathComponent("RecordSyncTests-"+UUID().uuidString)}
  private func saved(_ store:NativeRecordLocalStore,scope:String="a",text:String="本机原文",attachments:[NativeRecordAttachment]=[],record:NativeRecord?=nil) async throws -> NativeRecordLocalEntry {
    var draft=try await store.begin(record:record,scope:scope);draft.document = .plain(text,attachments:attachments);draft.attachments=attachments;draft.revision=try await store.persist(draft);return try await store.commit(id:draft.id,revision:draft.revision)
  }
  func testFrozenRequestSurvivesReopenAndNewEditsDoNotMutateIt() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)};let store=try NativeRecordLocalStore(directory:dir)
    let first=try await saved(store),op=try unwrap(try await store.nextSync(scope:"a",origin:"https://a.example"))
    _ = try await saved(store,text:"上传期间的修改",record:first.record)
    let reopened=try NativeRecordLocalStore(directory:dir),retry=try unwrap(try await reopened.nextSync(scope:"a",origin:"https://a.example"))
    expectEqual(op.body,retry.body);expectEqual(op.id,retry.id);expectEqual(retry.payload.text,"本机原文")
    var reply=first.record;reply.version=1;reply.sync = .synced
    try await reopened.finishSync(op,record:reply)
    let latest=try unwrap(try await reopened.snapshot(scope:"a").records.first);expectEqual(latest.record.text,"上传期间的修改");expectEqual(latest.baseVersion,1);expectEqual(latest.record.sync,.pending)
    let next=try unwrap(try await reopened.nextSync(scope:"a",origin:"https://a.example"));XCTAssertNotEqual(op.id,next.id);expectEqual(next.payload.baseVersion,1);expectEqual(next.payload.text,latest.record.text)
  }
  func testLostReplyRetryCreatesOneVersionAndOneMediaObject() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Originals")),service=RecordSyncTestService()
    let original=Data("未转换的原件".utf8),a=try await media.store(original,scope:"a",existing:[],name:"原件.txt",mime:"text/plain")
    let entry=try await saved(store,attachments:[a]);let sync=NativeRecordSyncModel();await service.flags(loseReply:true)
    await sync.configure(store:store,media:media,service:service,scope:"a",origin:"https://a.example",watchNetwork:false);await sync.waitUntilIdle()
    expectEqual(sync.entry(entry.record.id)?.record.sync,.failed)
    let frozen=try unwrap(try await store.syncOperations(scope:"a").first)
    expectEqual(frozen.step,.record)
    let recovered=NativeRecordSyncModel();await recovered.configure(store:try NativeRecordLocalStore(directory:dir),media:media,service:service,scope:"a",origin:"https://a.example",watchNetwork:false,autoStart:false)
    await recovered.retry(entry.record.id);await recovered.waitUntilIdle()
    expectEqual(recovered.entry(entry.record.id)?.record.sync,.synced);expectEqual(recovered.entry(entry.record.id)?.record.version,1)
    let counts=await service.counts();expectEqual(counts.0,1);expectEqual(counts.1,1)
    expectEqual(await service.requests[frozen.id],frozen.body)
    let copy=try await service.download(a);expectEqual(copy,original)
  }
  func testConflictCancelPreservesLocalAndExplicitConfirmationUsesLatestRemoteVersion() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Originals")),service=RecordSyncTestService()
    var remote=NativeRecord(id:UUID().uuidString.lowercased(),text:"基础",version:3,createdAt:"2026-10-16T10:00:00+08:00",document:try NativeRecordDocument.plain("基础").json())
    try await store.mergeRemote([remote],scope:"a");let local=try await saved(store,text:"手机完整修改",record:remote)
    remote.text="桌面修改";remote.version=4;remote.document=try NativeRecordDocument.plain(remote.text).json();await service.desktopEdit(remote)
    let sync=NativeRecordSyncModel();await sync.configure(store:store,media:media,service:service,scope:"a",origin:"https://a.example",watchNetwork:false);await sync.waitUntilIdle()
    expectEqual(sync.entry(local.record.id)?.record.sync,.conflict);expectEqual(sync.entry(local.record.id)?.record.text,"手机完整修改")
    sync.show(local.record.id);sync.route=nil
    expectEqual(try await store.snapshot(scope:"a").records.first?.record.text,"手机完整修改")
    remote.version=5;remote.text="桌面再次修改";remote.document=try NativeRecordDocument.plain(remote.text).json();await service.desktopEdit(remote)
    await sync.confirmConflict(local.record.id);expectEqual(sync.operation(local.record.id)?.remote?.version,5);XCTAssertNotNil(sync.notice)
    expectEqual(try await service.record(local.record.id).text,"桌面再次修改")
    sync.notice=nil;await sync.confirmConflict(local.record.id);await sync.waitUntilIdle()
    expectEqual(try await service.record(local.record.id).version,6);expectEqual(try await service.record(local.record.id).text,"手机完整修改")
  }
  func testUnpairedRecordNeedsExplicitBindingAndOriginalCopiesBeforeMetadataMoves() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Originals")),service=RecordSyncTestService()
    let a=try await media.store(Data("original".utf8),scope:NativeRecordLocalStore.unbound,existing:[],name:"原件.txt",mime:"text/plain")
    let local=try await saved(store,scope:NativeRecordLocalStore.unbound,attachments:[a]);let sync=NativeRecordSyncModel()
    await sync.configure(store:store,media:media,service:service,scope:"a",origin:"https://a.example",watchNetwork:false);await sync.waitUntilIdle()
    expectEqual((await service.counts()).0,0)
    await sync.bind(local.record.id);await sync.waitUntilIdle()
    expectEqual(sync.entry(local.record.id)?.scope,"a");expectEqual(sync.entry(local.record.id)?.record.sync,.synced)
    _ = try await media.verifiedURL(a,scope:NativeRecordLocalStore.unbound);_ = try await media.verifiedURL(a,scope:"a")
  }
  func testSpaceSwitchDoesNotPublishOldSpaceOrApplyLateReplies() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Originals")),a=RecordSyncTestService(),b=RecordSyncTestService()
    let record=try await saved(store,scope:"a",text:"空间 A 私有正文");await a.flags(delay:200_000_000)
    let sync=NativeRecordSyncModel();await sync.configure(store:store,media:media,service:a,scope:"a",origin:"https://a.example",watchNetwork:false)
    sync.disconnect();await sync.configure(store:store,media:media,service:b,scope:"b",origin:"https://b.example",watchNetwork:false);await sync.waitUntilIdle()
    XCTAssertFalse(sync.entries.contains {$0.record.id==record.record.id});expectEqual((await b.counts()).0,0)
    expectEqual(try await store.snapshot(scope:"a").records.first?.record.text,"空间 A 私有正文")
  }
  func testRemoteDownloadReverifiesOriginalAndCannotCrossScope() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Originals")),service=RecordSyncTestService(),data=Data("remote original".utf8)
    let a=try await media.store(data,scope:"source",existing:[],name:"remote.txt",mime:"text/plain"),url=try await media.verifiedURL(a,scope:"source")
    _ = try await service.upload(a,url:url,progress:{_,_ in});let sync=NativeRecordSyncModel();await sync.configure(store:store,media:media,service:service,scope:"a",origin:"https://a.example",watchNetwork:false,autoStart:false)
    do {try await sync.download(a,owner:"b");XCTFail()}catch{}
    try await sync.download(a,owner:"a");let saved=try await media.verifiedURL(a,scope:"a");expectEqual(try Data(contentsOf:saved),data)
  }
  func testRemoteEditDuringOpenDraftBecomesExplicitConflictOnSave() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)};let store=try NativeRecordLocalStore(directory:dir)
    var r=NativeRecord(id:UUID().uuidString.lowercased(),text:"remote",version:1,createdAt:"2026-10-16T10:00:00Z")
    try await store.mergeRemote([r],scope:"a");var draft=try await store.begin(record:r,scope:"a");draft.document = .plain("未保存的输入");draft.revision=try await store.persist(draft)
    r.version=2;r.text="desktop";try await store.mergeRemote([r],scope:"a")
    let saved=try await store.commit(id:draft.id,revision:draft.revision)
    expectEqual(saved.baseVersion,1);expectEqual(saved.record.text,"未保存的输入");expectEqual(saved.record.sync,.pending)
    let op=try unwrap(try await store.nextSync(scope:"a",origin:"https://a.example"));expectEqual(op.payload.baseVersion,1)
  }
  func testOwnUploadAcknowledgementDoesNotCreateAnUnnecessaryConflictForOpenDraft() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)};let store=try NativeRecordLocalStore(directory:dir)
    let first=try await saved(store),op=try unwrap(try await store.nextSync(scope:"a",origin:"https://a.example"))
    var draft=try await store.begin(record:first.record,scope:"a");draft.document = .plain("继续编辑");draft.revision=try await store.persist(draft)
    var reply=first.record;reply.version=1;try await store.finishSync(op,record:reply)
    let next=try await store.commit(id:draft.id,revision:draft.revision);expectEqual(next.baseVersion,1)
  }
  func testLateIdempotentReplyCannotHideANewerRemoteVersionObservedDuringPull() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)};let store=try NativeRecordLocalStore(directory:dir)
    let first=try await saved(store),op=try unwrap(try await store.nextSync(scope:"a",origin:"https://a.example"))
    var desktop=first.record;desktop.version=2;desktop.text="最新桌面原文";desktop.document=try NativeRecordDocument.plain(desktop.text).json()
    try await store.mergeRemote([desktop],scope:"a")
    var oldReply=first.record;oldReply.version=1;try await store.finishSync(op,record:oldReply)
    let current=try unwrap(try await store.snapshot(scope:"a").records.first)
    expectEqual(current.record.text,desktop.text);expectEqual(current.baseVersion,2);expectEqual(current.record.sync,.synced)
  }
  func testExplicitSameSpaceReauthorizationMovesDraftAndFrozenOperationWithoutChangingWirePayload() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Originals")),service=RecordSyncTestService()
    try await store.registerSpace(scope:"a",origin:"https://same.example")
    let a=try await media.store(Data("original".utf8),scope:"a",existing:[],name:"original.txt",mime:"text/plain"),first=try await saved(store,attachments:[a])
    let op=try unwrap(try await store.nextSync(scope:"a",origin:"https://same.example"))
    var draft=try await store.begin(record:first.record,scope:"a");draft.document = .plain("尚未保存的完整草稿",attachments:[a]);draft.revision=try await store.persist(draft)
    let sync=NativeRecordSyncModel();await sync.configure(store:store,media:media,service:service,scope:"b",origin:"https://same.example",watchNetwork:false,autoStart:false)
    sync.connectOriginal("a",pair:{});expectEqual(sync.adoptingSpace,"a");expectEqual((await service.counts()).0,0)
    await sync.adopt("a");await sync.waitUntilIdle()
    expectEqual(await service.requests[op.id],op.body)
    let restored=try unwrap(try await store.snapshot(scope:"b").drafts.first);expectEqual(restored.scope,"b");expectEqual(restored.document,draft.document)
    _ = try await media.verifiedURL(a,scope:"a");_ = try await media.verifiedURL(a,scope:"b")
    let next=try await store.commit(id:restored.id,revision:restored.revision);expectEqual(next.baseVersion,1)
  }
  func testDifferentSpaceCannotAdoptOrSendOldRecords() async throws {
    let dir=folder();defer{try? FileManager.default.removeItem(at:dir)};let store=try NativeRecordLocalStore(directory:dir)
    _ = try await saved(store);try await store.registerSpace(scope:"a",origin:"https://a.example");try await store.registerSpace(scope:"b",origin:"https://b.example")
    do {try await store.adoptSpace(from:"a",to:"b");XCTFail()}catch{}
    expectEqual(try await store.snapshot(scope:"a").records.count,1);expectEqual(try await store.snapshot(scope:"b").records.count,0)
  }

  func testQueueProgressCountsCompletedOriginalsAndTheCurrentFileOnce() throws {
    let a=NativeRecordAttachment(id:UUID().uuidString.lowercased(),name:"a",mime:"text/plain",bytes:100,sha256:String(repeating:"a",count:64))
    let b=NativeRecordAttachment(id:UUID().uuidString.lowercased(),name:"b",mime:"text/plain",bytes:200,sha256:String(repeating:"b",count:64))
    let record=NativeRecord(id:UUID().uuidString.lowercased(),text:"two originals",attachments:[a,b],createdAt:"2026-10-16T10:00:00Z",sync:.syncing),entry=NativeRecordSyncReview.entry(record)
    var op=try NativeRecordSyncReview.operation(entry,state:.syncing);op.uploaded=[a.sha256]
    let model=NativeRecordSyncModel();model.review(entries:[entry],operations:[op],route:.queue,transfers:[record.id:.init(sent:50,total:200,attachmentID:b.id)])
    expectEqual(model.aggregateTransfer(record.id)?.sent,150);expectEqual(model.aggregateTransfer(record.id)?.total,300)
    model.review(entries:[entry],operations:[op],route:.queue,transfers:[record.id:.init(sent:100,total:100,attachmentID:a.id)])
    expectEqual(model.aggregateTransfer(record.id)?.sent,100)
  }

}

@MainActor private func expectEqual<T:Equatable>(_ a:T,_ b:T,file:StaticString=#filePath,line:UInt=#line){XCTAssertEqual(a,b,file:file,line:line)}
@MainActor private func unwrap<T>(_ value:T?,file:StaticString=#filePath,line:UInt=#line)throws->T {try XCTUnwrap(value,file:file,line:line)}
