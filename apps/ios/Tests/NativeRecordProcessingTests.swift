import XCTest
@testable import PersonalLibrary

@MainActor final class NativeRecordProcessingTests:XCTestCase {
  private var directory:URL!
  override func setUpWithError()throws {directory=FileManager.default.temporaryDirectory.appendingPathComponent("RecordProcessTests-"+UUID().uuidString,isDirectory:true);try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)}
  override func tearDownWithError()throws {try? FileManager.default.removeItem(at:directory)}
  private func record()->NativeRecord {NativeRecord(id:"3b315c42-d5a0-4c12-902e-306bfc168d6e",text:"原始记录\n保留完整排版",version:3,createdAt:"2026-10-16T10:41:00+08:00",document:try! NativeRecordDocument.plain("原始记录\n保留完整排版").json())}
  private func configured(_ service:any NativeRecordProcessService,scope:String="owner-one") async throws -> (NativeRecordProcessingModel,NativeRecordLocalStore) {
    let store=try NativeRecordLocalStore(directory:directory),media=try NativeRecordMediaStore(directory:directory.appendingPathComponent("Originals"));try await store.mergeRemote([record()],scope:scope)
    let sync=NativeRecordSyncModel();await sync.configure(store:store,media:media,service:nil,scope:scope,origin:"https://example.com",watchNetwork:false,autoStart:false)
    let model=NativeRecordProcessingModel();await model.configure(store:store,service:service,scope:scope,sync:sync);await model.open(record());return (model,store)
  }
  func testRequestLimitsUseUTF16AndPreserveCustomContent()throws {
    var request=NativeRecordProcessRequest(requestId:UUID().uuidString.lowercased(),baseVersion:3,preset:.custom,instructions:String(repeating:"😀",count:5000));XCTAssertNoThrow(try request.validate())
    request.instructions+="😀";XCTAssertThrowsError(try request.validate());request.instructions="  \n";XCTAssertThrowsError(try request.validate())
  }
  func testFormRevisionCannotRollBackAndOtherIdentityCannotReadIt()async throws {
    let store=try NativeRecordLocalStore(directory:directory);var value=NativeRecordProcessDraft(scope:"one",recordID:record().id,revision:2,instructions:"完整自定义要求 👩🏽‍💻\n第二行")
    try await store.saveProcessDraft(value);value.revision=1;value.instructions="过期窗口";try await store.saveProcessDraft(value)
    let found=try await store.processDraft(scope:"one",id:value.recordID),other=try await store.processDraft(scope:"two",id:value.recordID)
    XCTAssertEqual(found?.instructions,"完整自定义要求 👩🏽‍💻\n第二行");XCTAssertNil(other)
  }
  func testLostReplyReopenReusesFrozenPayloadAndCreatesOnlyOneTask()async throws {
    let service=try NativeRecordProcessingFixture(record:record(),directory:directory,seed:false,lostReply:true)
    let (first,store)=try await configured(service);await first.start();let before=first.frozen;XCTAssertNotNil(before);XCTAssertNotNil(first.failure)
    let reopenedService=try NativeRecordProcessingFixture(record:record(),directory:directory,seed:false)
    let (reopened,_)=try await configured(reopenedService);XCTAssertEqual(reopened.frozen?.body,before?.body);XCTAssertEqual(reopened.frozen?.id,before?.id)
    await reopened.start();XCTAssertNil(reopened.frozen);XCTAssertEqual(reopened.jobs.count,1)
    let pending=try await store.processOperation(scope:"owner-one",id:record().id);XCTAssertNil(pending)
    let snapshot=try await store.snapshot(scope:"owner-one");XCTAssertEqual(snapshot.records.first?.record.text,record().text)
  }
  func testUnsentLocalEditStopsProcessingAndKeepsTheSelectedSource()async throws {
    let service=try NativeRecordProcessingFixture(record:record(),directory:directory,seed:false), (model,store)=try await configured(service)
    var edit=try await store.begin(record:record(),scope:"owner-one");edit.document = .plain("尚未同步的修改");edit.revision=try await store.persist(edit);_ = try await store.commit(id:edit.id,revision:edit.revision)
    await model.start();XCTAssertEqual(model.route,.sync);XCTAssertEqual(model.record?.text,"尚未同步的修改")
    let pending=try await store.processOperation(scope:"owner-one",id:record().id);XCTAssertNil(pending);let state=await service.stateValue();XCTAssertTrue(state.tasks.isEmpty)
  }
  func testDefinitiveRejectionKeepsFormEditableAndArchivesTheRejectedRequest()async throws {
    let fixture=try NativeRecordProcessingFixture(record:record(),directory:directory,seed:false),service=RejectedProcessService(base:fixture)
    let (model,store)=try await configured(service);model.form.instructions="保留加工要求";await model.start()
    XCTAssertNil(model.frozen);XCTAssertEqual(model.route,.form);XCTAssertEqual(model.form.instructions,"保留加工要求")
    let pending=try await store.processOperation(scope:"owner-one",id:record().id);XCTAssertNil(pending)
  }
  func testChangedDraftRequiresReloadAndExplicitApprovalThenReadsArchive()async throws {
    let service=try NativeRecordProcessingFixture(record:record(),directory:directory,seed:true), (model,store)=try await configured(service)
    let job=try XCTUnwrap(model.jobs.first);await model.openJob(job);let reviewed=model.draft.reviewedDigest
    XCTAssertTrue(model.draft.canApprove);XCTAssertEqual(model.reviewedVersion,2)
    await service.replaceDraft();await model.draft.checkVersion();XCTAssertEqual(model.draft.phase,.changed);XCTAssertFalse(model.draft.canApprove)
    model.draft.requestApproval();await model.approve();let unapproved=await service.stateValue();XCTAssertEqual(unapproved.tasks.first?.state,"awaiting_review")
    await model.reloadResult(job.id);XCTAssertTrue(model.draft.canApprove);XCTAssertNotEqual(model.draft.reviewedDigest,reviewed);XCTAssertEqual(model.reviewedVersion,3)
    model.draft.requestApproval();await model.approve();XCTAssertEqual(model.route,.archived(job.id));XCTAssertNotNil(model.archived)
    model.archived=nil;await model.reloadResult(job.id);XCTAssertNotNil(model.archived);XCTAssertEqual(model.route,.archived(job.id))
    let final=try await store.snapshot(scope:"owner-one");XCTAssertEqual(final.records.first?.record.text,record().text)
  }
  func testApprovalSupersedesAnOlderInFlightPollingSnapshot()async throws {
    let fixture=try NativeRecordProcessingFixture(record:record(),directory:directory,seed:true),service=DelayedPollingProcessService(base:fixture)
    let (model,_)=try await configured(service);let job=try XCTUnwrap(model.jobs.first);await model.openJob(job)
    await service.holdNextRead();let poll=Task {await model.reload()}
    for _ in 0..<100 {if await service.entered {break};try await Task.sleep(nanoseconds:10_000_000)}
    let entered=await service.entered;XCTAssertTrue(entered)
    model.draft.requestApproval();await model.approve();XCTAssertEqual(model.route,.archived(job.id));XCTAssertNotNil(model.archived)
    await service.release();await poll.value;XCTAssertEqual(model.job?.state,"completed");XCTAssertEqual(model.route,.archived(job.id))
  }
  func testSessionChangeDuringProcessingDoesNotPublishIntoTheNextIdentity()async throws {
    let fixture=try NativeRecordProcessingFixture(record:record(),directory:directory,seed:false),delayed=DelayedProcessService(base:fixture)
    let (model,store)=try await configured(delayed)
    let work=Task {await model.start()}
    for _ in 0..<100 {if await delayed.entered {break};try await Task.sleep(nanoseconds:10_000_000)}
    let entered=await delayed.entered;XCTAssertTrue(entered);model.disconnect();await delayed.release();await work.value
    XCTAssertNil(model.route);XCTAssertTrue(model.jobs.isEmpty)
    let original=try await store.processOperation(scope:"owner-one",id:record().id),other=try await store.processOperation(scope:"owner-two",id:record().id);XCTAssertNotNil(original);XCTAssertNil(other)
  }
  func testExplicitSameOriginReauthorizationKeepsUnknownProcessingIDAndForm()async throws {
    let store=try NativeRecordLocalStore(directory:directory);try await store.registerSpace(scope:"old",origin:"https://example.com");try await store.registerSpace(scope:"new",origin:"https://example.com");try await store.mergeRemote([record()],scope:"old")
    let request=NativeRecordProcessRequest(requestId:UUID().uuidString.lowercased(),baseVersion:3,preset:.custom,instructions:"保留本轮要求")
    let op=NativeRecordProcessOperation(scope:"old",recordID:record().id,request:request,body:try request.data());try await store.saveProcessOperation(op)
    let form=NativeRecordProcessDraft(scope:"old",recordID:record().id,revision:1,preset:.custom,instructions:request.instructions);try await store.saveProcessDraft(form)
    let spaces=try await store.otherSpaces(current:"new");XCTAssertEqual(spaces.first?.count,1)
    try await store.adoptSpace(from:"old",to:"new")
    let adopted=try await store.processOperation(scope:"new",id:record().id),adoptedForm=try await store.processDraft(scope:"new",id:record().id),old=try await store.processOperation(scope:"old",id:record().id)
    XCTAssertEqual(adopted?.id,op.id);XCTAssertEqual(adopted?.body,op.body);XCTAssertEqual(adoptedForm?.instructions,form.instructions);XCTAssertNil(old)
  }
  func testDifferentOriginCannotAdoptProcessingIntent()async throws {
    let store=try NativeRecordLocalStore(directory:directory);try await store.registerSpace(scope:"old",origin:"https://one.example");try await store.registerSpace(scope:"new",origin:"https://two.example")
    let request=NativeRecordProcessRequest(requestId:UUID().uuidString.lowercased(),baseVersion:3,preset:.summary,instructions:"保留原要求"),op=NativeRecordProcessOperation(scope:"old",recordID:record().id,request:request,body:try request.data());try await store.saveProcessOperation(op)
    do {try await store.adoptSpace(from:"old",to:"new");XCTFail("must reject different space")}catch {}
    let old=try await store.processOperation(scope:"old",id:record().id),new=try await store.processOperation(scope:"new",id:record().id);XCTAssertEqual(old?.body,op.body);XCTAssertNil(new)
  }
  func testExplicitBindingKeepsTheUnpairedRecordProcessingForm()async throws {
    let store=try NativeRecordLocalStore(directory:directory);var draft=try await store.begin(record:nil,scope:NativeRecordLocalStore.unbound);draft.document = .plain("未配对记录");draft.revision=try await store.persist(draft);let entry=try await store.commit(id:draft.id,revision:draft.revision)
    let form=NativeRecordProcessDraft(scope:NativeRecordLocalStore.unbound,recordID:entry.record.id,revision:1,preset:.custom,instructions:"配对后保留这份加工要求");try await store.saveProcessDraft(form)
    try await store.bindLocalRecord(id:entry.record.id,revision:entry.localRevision,to:"owner-one")
    let moved=try await store.processDraft(scope:"owner-one",id:entry.record.id),old=try await store.processDraft(scope:NativeRecordLocalStore.unbound,id:entry.record.id)
    XCTAssertEqual(moved?.instructions,form.instructions);XCTAssertEqual(moved?.preset,.custom);XCTAssertNil(old)
  }
}
private actor DelayedPollingProcessService:NativeRecordProcessService {
  let base:NativeRecordProcessingFixture;var hold=false;var entered=false;var continuation:CheckedContinuation<Void,Never>?
  init(base:NativeRecordProcessingFixture){self.base=base}
  func holdNextRead(){hold=true}
  func release(){continuation?.resume();continuation=nil}
  func state()async throws->ServerState {let snapshot=try await base.state();if hold {hold=false;entered=true;await withCheckedContinuation {continuation=$0}};return snapshot}
  func processRecord(_ op:NativeRecordProcessOperation)async throws->LibraryTask {try await base.processRecord(op)}
  func record(_ id:String)async throws->NativeRecord {try await base.record(id)}
  func draft(_ id:String,expectedDigest:String)async throws->DraftBundle {try await base.draft(id,expectedDigest:expectedDigest)}
  func approveDraft(_ id:String,expectedDigest:String)async throws {try await base.approveDraft(id,expectedDigest:expectedDigest)}
  func taskAction(_ id:String,action:String)async throws {try await base.taskAction(id,action:action)}
  func recordArchive(_ digest:String)async throws->DraftBundle {try await base.recordArchive(digest)}
}
private struct RejectedProcessService:NativeRecordProcessService {
  let base:NativeRecordProcessingFixture
  func processRecord(_ op:NativeRecordProcessOperation)async throws->LibraryTask {throw NativeRecordSyncFailure.http(400,nil,"invalid dispatch")}
  func state()async throws->ServerState {try await base.state()}
  func record(_ id:String)async throws->NativeRecord {try await base.record(id)}
  func draft(_ id:String,expectedDigest:String)async throws->DraftBundle {try await base.draft(id,expectedDigest:expectedDigest)}
  func approveDraft(_ id:String,expectedDigest:String)async throws {try await base.approveDraft(id,expectedDigest:expectedDigest)}
  func taskAction(_ id:String,action:String)async throws {try await base.taskAction(id,action:action)}
  func recordArchive(_ digest:String)async throws->DraftBundle {try await base.recordArchive(digest)}
}
private actor DelayedProcessService:NativeRecordProcessService {
  let base:NativeRecordProcessingFixture;var entered=false;var continuation:CheckedContinuation<Void,Never>?
  init(base:NativeRecordProcessingFixture){self.base=base}
  func processRecord(_ op:NativeRecordProcessOperation)async throws->LibraryTask {entered=true;await withCheckedContinuation {continuation=$0};return try await base.processRecord(op)}
  func release(){continuation?.resume();continuation=nil}
  func state()async throws->ServerState {try await base.state()}
  func record(_ id:String)async throws->NativeRecord {try await base.record(id)}
  func draft(_ id:String,expectedDigest:String)async throws->DraftBundle {try await base.draft(id,expectedDigest:expectedDigest)}
  func approveDraft(_ id:String,expectedDigest:String)async throws {try await base.approveDraft(id,expectedDigest:expectedDigest)}
  func taskAction(_ id:String,action:String)async throws {try await base.taskAction(id,action:action)}
  func recordArchive(_ digest:String)async throws->DraftBundle {try await base.recordArchive(digest)}
}
