#if DEBUG
import SwiftUI

@MainActor struct NativeRecordSyncReview:View {
  let configuration:NativeReviewConfiguration
  @StateObject private var records=NativeRecordListModel(snapshot:.init(records:NativeRecordListReview.examples),phase:.content,origin:"https://library.inspirai.store",now:{NativeRecordListModel.date("2026-10-16T12:00:00+08:00")!})
  @StateObject private var workbench=NativeRecordWorkbench()
  @State private var module:NativeAppModule = .records
  @State private var started=false
  @State private var ready=false
  var body:some View {
    NativeRecordWorkspace(records:records,workbench:workbench,module:$module,autoReload:false,focusEditor:false)
      .accessibilityElement(children:.contain).accessibilityIdentifier(ready ? "record.sync.ready" : "record.sync.loading")
      .task {
        guard !started else{return};started=true
        do {
          let args=ProcessInfo.processInfo.arguments
          var key=UUID().uuidString
          if let i=args.firstIndex(of:"--review-record-store"),args.indices.contains(i+1) {key=String(args[i+1].filter {$0.isASCII && ($0.isLetter || $0.isNumber || $0=="-")}.prefix(80))}
          let dir=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("RecordsSyncReview/"+key,isDirectory:true)
          let store=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Originals"))
          workbench.mediaStore=media;workbench.recordingDirectory=dir.appendingPathComponent("Recordings")
          await workbench.configure(store:store,scope:"sync-review",list:records)
          _ = try await store.begin(record:NativeRecordListReview.examples[3],scope:"sync-review")
          var examples=NativeRecordListReview.examples
          var discussion=try NativeRecordMediaReview.discussion(attachment:examples[2].attachments[0])
          examples[2]=discussion
          await records.configure(service:NativeRecordReviewService(records:examples),storage:nil,origin:"https://library.inspirai.store",deviceID:"sync-review",expired:false)
          records.selectedID=discussion.id
          if UIDevice.current.userInterfaceIdiom != .pad || configuration.narrow {records.path=[discussion.id]}
          await workbench.refresh()
          let page=configuration.page
          if page == "LIVE" {try await live(store:store,media:media);ready=true;return}
          if page == "HTTP" {try await http(store:store,media:media,id:UUID(uuidString:key)?.uuidString.lowercased() ?? UUID().uuidString.lowercased());ready=true;return}
          var entries:[NativeRecordLocalEntry]=[]
          var operations:[NativeRecordSyncOperation]=[]
          var transfers:[String:NativeRecordTransfer]=[:]
          var spaces:[NativeRecordSpaceSummary]=[]
          var route:NativeRecordSyncRoute = .queue
          if page.hasPrefix("N12") {
            let localLines=["记录入口放在底栏第一项。","拍照和录音放在输入区底部。","高级派发选项默认收起。"]
            let remoteLines=[localLines[0],"拍照和录音从添加面板进入。","高级派发选项始终展开。"]
            discussion.document=try Self.document(localLines).json();discussion.text="产品讨论纪要\n"+localLines.joined(separator:"\n");discussion.updatedAt="2026-10-16T10:41:00+08:00";discussion.sync = .conflict
            var remote=discussion;remote.document=try Self.document(remoteLines).json();remote.text="产品讨论纪要\n"+remoteLines.joined(separator:"\n");remote.version=4;remote.updatedAt="2026-10-16T10:43:00+08:00";remote.sync = .synced
            if args.contains("--review-long-conflict") {
              let extra:[NativeRecordNode]=[.paragraph("附录",type:"heading",level:2),.init(type:"orderedList",attrs:["start":.number(3)],content:["保留原件与正文排版","逐个确认同步状态","核对两个版本的内容"].map {.init(type:"listItem",content:[.paragraph($0)])}),.init(type:"blockquote",content:[.paragraph("取消不会覆盖本机内容。")]),.init(type:"paragraph",content:[.init(type:"text",text:"查看来源",marks:[.init(type:"link",attrs:["href":.string("https://example.com/source")])])])]
              var a=try NativeRecordDocument(record:discussion),b=try NativeRecordDocument(record:remote)
              a.doc.content=(a.doc.content ?? [])+extra;b.doc.content=(b.doc.content ?? [])+extra
              discussion.document=try a.json();remote.document=try b.json()
            }
            let entry=Self.entry(discussion),op=try Self.operation(entry,state:.conflict,remote:remote)
            entries=[entry];operations=[op];route = .conflict(discussion.id)
          } else {
            discussion.sync=page=="N11-F" ? .failed : .syncing
            var pending=examples[1];pending.sync = .pending
            var failed=examples[0];failed.sync = .failed
            entries=[Self.entry(discussion),Self.entry(pending),Self.entry(failed)]
            operations=[try Self.operation(entries[0],state:discussion.sync),try Self.operation(entries[2],state:.failed)]
            if page != "N11-F" {transfers[discussion.id] = .init(sent:1_407_000,total:2_100_000,attachmentID:discussion.attachments[0].id)}
            if page != "N11-Q" {route = .detail(discussion.id)}
            if page == "N11-S" {route = .space("original-space");spaces=[.init(id:"original-space",origin:"https://library.inspirai.store",count:2)]}
          }
          workbench.sync.review(entries:entries,operations:operations,route:route,transfers:transfers,spaces:spaces,origin:page=="N11-S" ? "https://work.inspirai.store" : "https://library.inspirai.store")
          workbench.sync.durations[discussion.attachments[0].sha256]="02:18"
          if page=="N12-C" {workbench.sync.confirmation=discussion.id}
          ready=true
        }catch {workbench.openError=error.localizedDescription;ready=true}
      }
  }
  static func entry(_ record:NativeRecord)->NativeRecordLocalEntry {.init(record:record,scope:"sync-review",localRevision:1,baseVersion:record.version,requestID:UUID().uuidString.lowercased())}
  static func operation(_ entry:NativeRecordLocalEntry,state:NativeRecordSync,remote:NativeRecord?=nil)throws->NativeRecordSyncOperation {
    let payload=NativeRecordSaveRequest(requestId:entry.requestID,baseVersion:entry.baseVersion,text:entry.record.text,document:entry.record.document,attachments:entry.record.attachments,createdAt:entry.record.createdAt)
    return .init(id:entry.requestID,scope:entry.scope,recordID:entry.record.id,localRevision:entry.localRevision,payload:payload,body:try payload.data(),state:state,error:state == .failed ? "连接已断开" : nil,remote:remote,origin:"https://library.inspirai.store",createdAt:"2026-10-16T10:41:00+08:00")
  }
  static func document(_ lines:[String])->NativeRecordDocument {.init(doc:.init(type:"doc",content:[.paragraph("产品讨论纪要",type:"heading",level:1)]+lines.map {.paragraph($0)}))}
  private func http(store:NativeRecordLocalStore,media:NativeRecordMediaStore,id:String) async throws {
    let acceptance=ProcessInfo.processInfo.arguments.contains("--records-final-acceptance")
    let origin=try ServerOrigin(acceptance ? "https://127.0.0.1:54130" : "https://127.0.0.1:54126")
    let api=CollectorAPI(origin:origin,token:acceptance ? "records-final-ios-acceptance" : "stage04-sync-iphone-fixture")
    let desktop=CollectorAPI(origin:origin,token:acceptance ? "records-final-ios-acceptance" : "stage04-sync-desktop-fixture")
    if !(try await store.snapshot(scope:"sync-review").records.contains {$0.record.id==id}) {
      do {let remote=try await api.record(id);try await store.mergeRemote([remote],scope:"sync-review")}
      catch NativeRecordSyncFailure.http(404,_,_) {
        let a=try await media.store(Data("HTTPS 原件 UTF-8 👩🏽‍💻".utf8),scope:"sync-review",existing:[],name:"HTTPS原件.txt",mime:"text/plain")
        let seed=NativeRecord(id:id,text:"HTTPS 跨端同步测试",version:0,createdAt:"2026-10-16T10:41:00+08:00")
        var draft=try await store.begin(record:seed,scope:"sync-review");draft.document = .plain("HTTPS 跨端同步测试\n保留完整正文",attachments:[a]);draft.attachments=[a];draft.revision=try await store.persist(draft);_ = try await store.commit(id:draft.id,revision:draft.revision)
      }
    }
    if ProcessInfo.processInfo.arguments.contains("--review-http-desktop-edit"),let current=try await store.snapshot(scope:"sync-review").records.first(where:{$0.record.id==id}) {
      let remote=try await desktop.record(id),text="HTTPS 跨端同步测试\n桌面通过 HTTPS 修改的正文"
      let payload=NativeRecordSaveRequest(requestId:UUID().uuidString.lowercased(),baseVersion:remote.version,text:text,document:try NativeRecordDocument.plain(text,attachments:remote.attachments).json(),attachments:remote.attachments,createdAt:remote.createdAt)
      _ = try await desktop.putRecord(.init(id:payload.requestId,scope:"desktop-fixture",recordID:id,localRevision:1,payload:payload,body:try payload.data(),state:.pending,createdAt:remote.createdAt))
      var draft=try await store.begin(record:current.record,scope:"sync-review");draft.document = .plain("HTTPS 跨端同步测试\n手机尚未同步的修改",attachments:current.record.attachments);draft.revision=try await store.persist(draft);_ = try await store.commit(id:draft.id,revision:draft.revision)
    }
    workbench.sync.changed={ [weak workbench] in await workbench?.refresh() }
    await workbench.sync.configure(store:store,media:media,service:api,scope:"sync-review",origin:origin.value,watchNetwork:false)
    await workbench.sync.waitUntilIdle()
    if ProcessInfo.processInfo.arguments.contains("--review-http-verify-download"),let attachment=workbench.sync.entry(id)?.record.attachments.first {
      if let local=try? await media.verifiedURL(attachment,scope:"sync-review") {try FileManager.default.removeItem(at:local)}
      try await workbench.sync.download(attachment,owner:"sync-review")
      let url=try await media.verifiedURL(attachment,scope:"sync-review")
      guard try Data(contentsOf:url)==Data("HTTPS 原件 UTF-8 👩🏽‍💻".utf8) else{throw NativeRecordSyncFailure.integrity}
    }
    records.selectedID=id;records.path=[];workbench.sync.show(id)
  }
  private func live(store:NativeRecordLocalStore,media:NativeRecordMediaStore) async throws {
    // Functional UI tests use a durable protocol fixture, never AppModel or the
    // user's Keychain. The fixture is deliberately separate from frozen frames.
    let fixture=try NativeRecordSyncFixture(directory:media.directory.deletingLastPathComponent().appendingPathComponent("Server"))
    workbench.sync.changed={ [weak workbench] in await workbench?.refresh() }
    let snapshot=try await store.snapshot(scope:"sync-review")
    if snapshot.records.isEmpty {
      let a=try await media.store(Data("原件 UTF-8 👩🏽‍💻".utf8),scope:"sync-review",existing:[],name:"同步原件.txt",mime:"text/plain")
      var draft=try await store.begin(record:nil,scope:"sync-review");draft.document = .plain("跨端同步测试\n本机完整正文",attachments:[a]);draft.attachments=[a];draft.revision=try await store.persist(draft)
      _ = try await store.commit(id:draft.id,revision:draft.revision)
    }
    let args=ProcessInfo.processInfo.arguments
    if args.contains("--review-sync-desktop-edit"),let current=try await store.snapshot(scope:"sync-review").records.first {
      var remote=try await fixture.record(current.record.id);remote.version += 1;remote.text="跨端同步测试\n桌面修改后的正文";remote.document=try NativeRecordDocument.plain(remote.text,attachments:remote.attachments).json();await fixture.edit(remote)
      var draft=try await store.begin(record:current.record,scope:"sync-review");draft.document = .plain("跨端同步测试\n手机尚未同步的修改",attachments:current.record.attachments);draft.revision=try await store.persist(draft);_ = try await store.commit(id:draft.id,revision:draft.revision)
    }
    if args.contains("--review-sync-lost-reply") {await fixture.setLostReply()}
    await workbench.sync.configure(store:store,media:media,service:fixture,scope:"sync-review",origin:"https://library.inspirai.store",watchNetwork:false)
    await workbench.sync.waitUntilIdle()
    await workbench.refresh()
    if let record=workbench.sync.entries.first?.record {records.selectedID=record.id;records.path=[];workbench.sync.show(record.id)}
  }
}

actor NativeRecordSyncFixture:NativeRecordSyncService {
  private struct State:Codable {var records:[String:NativeRecord]=[:];var replies:[String:NativeRecord]=[:];var requests:[String:Data]=[:];var media:[String:Data]=[:];var mimes:[String:String]=[:]}
  private let directory:URL
  private var state:State
  private var lostReply=false
  init(directory:URL)throws {self.directory=directory;try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true);state=(try? JSONDecoder().decode(State.self,from:Data(contentsOf:directory.appendingPathComponent("state.json")))) ?? .init()}
  private func persist() throws {try JSONEncoder().encode(state).write(to:directory.appendingPathComponent("state.json"),options:.atomic)}
  func setLostReply(){lostReply=true}
  func edit(_ record:NativeRecord){state.records[record.id]=record;try? persist()}
  func capabilities() async throws -> NativeRecordCapabilities {.init(protocol:1,documentVersions:[1])}
  func recordsPage(cursor:String?,paginated:Bool,updatedSince:String?) async throws -> NativeRecordPage {.init(records:Array(state.records.values))}
  func record(_ id:String) async throws -> NativeRecord {guard let value=state.records[id] else{throw NativeRecordSyncFailure.http(404,nil,"不存在")};return value}
  func putRecord(_ op:NativeRecordSyncOperation) async throws -> NativeRecord {
    if let request=state.requests[op.id] {guard request==op.body else{throw NativeRecordSyncFailure.http(409,"record_request_reused","请求变化")};return state.replies[op.id]!}
    guard (state.records[op.recordID]?.version ?? 0)==op.payload.baseVersion else {throw NativeRecordSyncFailure.http(409,"record_version_conflict","远端版本变化")}
    for attachment in op.payload.attachments {guard state.media[attachment.sha256]?.count==attachment.bytes else{throw NativeRecordMediaError.missing}}
    let r=NativeRecord(id:op.recordID,text:op.payload.text,attachments:op.payload.attachments,version:op.payload.baseVersion+1,createdAt:op.payload.createdAt,updatedAt:"2026-10-16T10:43:00+08:00",document:op.payload.document)
    state.records[r.id]=r;state.requests[op.id]=op.body;state.replies[op.id]=r;try persist()
    if lostReply {lostReply=false;throw URLError(.networkConnectionLost)};return r
  }
  func mediaReceipt(_ digest:String) async throws -> NativeRecordMediaReceipt? {guard let data=state.media[digest] else{return nil};return .init(sha256:digest,mime:state.mimes[digest] ?? "",bytes:data.count)}
  func upload(_ a:NativeRecordAttachment,url:URL,progress:@escaping @Sendable(Int64,Int64)->Void) async throws -> NativeRecordMediaReceipt {let data=try Data(contentsOf:url);guard NativeRecordMediaStore.digest(data)==a.sha256 else{throw NativeRecordSyncFailure.integrity};state.media[a.sha256]=data;state.mimes[a.sha256]=a.mime;try persist();progress(Int64(data.count),Int64(data.count));return .init(sha256:a.sha256,mime:a.mime,bytes:data.count)}
  func download(_ a:NativeRecordAttachment) async throws -> Data {guard let data=state.media[a.sha256] else{throw NativeRecordMediaError.missing};return data}
}
#endif
