import XCTest
import UIKit
@testable import PersonalLibrary

private actor RecordDraftSlowStore:NativeRecordLocalStorage {
  let base:NativeRecordLocalStore
  var fail=false
  init(_ base:NativeRecordLocalStore,fail:Bool=false) { self.base=base;self.fail=fail }
  func snapshot(scope:String) async throws -> NativeRecordLocalSnapshot { try await base.snapshot(scope:scope) }
  func begin(record:NativeRecord?,scope:String) async throws -> NativeRecordEditDraft { try await base.begin(record:record,scope:scope) }
  func persist(_ draft:NativeRecordEditDraft) async throws -> Int {
    try await Task.sleep(nanoseconds:20_000_000)
    if fail { fail=false;throw NativeRecordLocalError.diskFull }
    return try await base.persist(draft)
  }
  func commit(id:String,revision:Int) async throws -> NativeRecordLocalEntry { try await base.commit(id:id,revision:revision) }
  func discard(id:String,revision:Int) async throws { try await base.discard(id:id,revision:revision) }
}
final class NativeRecordEditorTests:XCTestCase {
  private func directory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("RecordEditorTests-"+UUID().uuidString,isDirectory:true) }
  private func attachment(_ id:String="image") -> NativeRecordAttachment {
    .init(id:id,name:"原图.png",mime:"image/png",bytes:1234,sha256:String(repeating:"a",count:64))
  }
  @MainActor func testRichDocumentRoundTripPreservesNestedListsMarksLinksBreaksAndAttachmentIDs() throws {
    let marks:[NativeRecordMark]=[.init(type:"bold"),.init(type:"italic"),.init(type:"underline"),.init(type:"link",attrs:["href":.string("https://example.com/path?q=中文")])]
    let doc=NativeRecordDocument(doc:.init(type:"doc",content:[
      .paragraph("中文 English 👩🏽‍💻",type:"heading",level:1),
      .init(type:"blockquote",content:[.init(type:"paragraph",content:[.init(type:"text",text:"选择文字",marks:marks),.init(type:"hardBreak"),.init(type:"text",text:"下一行")])]),
      .init(type:"orderedList",attrs:["start":.number(3)],content:[
        .init(type:"listItem",content:[.paragraph("第一项"),.init(type:"bulletList",content:[.init(type:"listItem",content:[.paragraph("嵌套子项")])])]),
        .init(type:"listItem",content:[.paragraph("第二项")])]),
      .init(type:"attachment",attrs:["attachmentId":.string("image")])]))
    try doc.validateForSave(attachments:[attachment()])
    let rendered=NativeRecordRichCodec.render(doc,width:353,tablet:false,dark:false,scale:1,captions:["image":"原图.png · 1.2 KB"])
    let result=NativeRecordRichCodec.document(rendered)
    XCTAssertEqual(result,doc)
    XCTAssertEqual(result.doc.referencedAttachments,["image"])
    XCTAssertTrue(result.plainText.contains("<https://example.com/path?q=中文>"))
    let roundTrip=try JSONDecoder().decode(NativeRecordDocument.self,from:JSONEncoder().encode(result))
    XCTAssertEqual(roundTrip,doc)
  }
  func testLimitsUseUTF16AndInvalidLinksDoNotBecomeDocumentLinks() throws {
    let text=String(repeating:"😀",count:25_001)
    XCTAssertEqual(text.count,25_001)
    XCTAssertThrowsError(try NativeRecordDocument.plain(text).validateForSave(attachments:[])) {
      guard case .limit(let message) = $0 as? NativeRecordLocalError else { return XCTFail("Expected UTF16 limit") }
      XCTAssertTrue(message.contains("50002"))
    }
    XCTAssertNil(NativeRecordDocument.safeLink("javascript:alert(1)"))
    XCTAssertNil(NativeRecordDocument.safeLink("https://name:password@example.com"))
    XCTAssertNotNil(NativeRecordDocument.safeLink("https://example.com/中文?q=1"))
    let invalid=NativeRecordDocument(doc:.init(type:"doc",content:[.init(type:"attachment",attrs:["attachmentId":.string("missing")])]))
    XCTAssertThrowsError(try invalid.validateForSave(attachments:[]))
  }
  func testDraftReopenAndAtomicPromotionAreIdempotentAndRemainPending() async throws {
    let dir=directory();defer { try? FileManager.default.removeItem(at:dir) }
    let first=try NativeRecordLocalStore(directory:dir)
    var draft=try await first.begin(record:nil,scope:"library-a")
    draft.document = .plain("随手记录\n中英文 original 👩🏽‍💻")
    draft.revision=try await first.persist(draft)
    let reopened=try NativeRecordLocalStore(directory:dir)
    let restored=try await reopened.snapshot(scope:"library-a")
    XCTAssertEqual(restored.drafts.first?.document,draft.document)
    let saved=try await reopened.commit(id:draft.id,revision:draft.revision)
    let repeated=try await reopened.commit(id:draft.id,revision:draft.revision)
    XCTAssertEqual(saved.requestID,repeated.requestID)
    XCTAssertEqual(saved.record.id,draft.recordID)
    XCTAssertEqual(saved.record.sync,.pending)
    XCTAssertEqual(saved.baseVersion,0)
    let final=try await first.snapshot(scope:"library-a")
    XCTAssertTrue(final.drafts.isEmpty);XCTAssertEqual(final.records.count,1)
    do { _ = try await first.persist(draft);XCTFail("Retired draft was resurrected") } catch {}
  }
  func testConcurrentDraftRevisionAndDiscardTombstoneProtectLaterData() async throws {
    let dir=directory();defer { try? FileManager.default.removeItem(at:dir) }
    let a=try NativeRecordLocalStore(directory:dir),b=try NativeRecordLocalStore(directory:dir)
    var draft=try await a.begin(record:nil,scope:"a")
    var old=draft
    draft.document = .plain("新的正文");draft.revision=try await a.persist(draft)
    old.document = .plain("旧窗口正文")
    do { _ = try await b.persist(old);XCTFail("Stale writer overwrote current draft") } catch { XCTAssertEqual(error as? NativeRecordLocalError,.stale) }
    let snapshot=try await b.snapshot(scope:"a");XCTAssertEqual(snapshot.drafts.first?.document.plainText,"新的正文")
    try await a.discard(id:draft.id,revision:draft.revision)
    do { _ = try await b.persist(draft);XCTFail("Discarded draft resurrected") } catch {}
    let after=try await b.snapshot(scope:"a");XCTAssertTrue(after.drafts.isEmpty);XCTAssertTrue(after.records.isEmpty)
  }
  func testIdentityIsolationDoesNotRebindUnpairedDraftsOrOtherLibraryRecords() async throws {
    let dir=directory();defer { try? FileManager.default.removeItem(at:dir) }
    let store=try NativeRecordLocalStore(directory:dir)
    for scope in ["a",NativeRecordLocalStore.unbound] {
      var draft=try await store.begin(record:nil,scope:scope)
      draft.document = .plain("内容 "+scope);draft.revision=try await store.persist(draft)
      _ = try await store.commit(id:draft.id,revision:draft.revision)
    }
    let other=try await store.snapshot(scope:"b")
    XCTAssertEqual(other.records.count,1);XCTAssertEqual(other.records[0].scope,NativeRecordLocalStore.unbound)
    let original=try await store.snapshot(scope:"a");XCTAssertEqual(original.records.count,2)
    let unbound=other.records[0]
    let edit=try await store.begin(record:unbound.record,scope:"b")
    XCTAssertEqual(edit.scope,NativeRecordLocalStore.unbound)
  }
  @MainActor func testExistingRecordEditPreservesOriginalVersionTasksAndAttachmentMetadata() async throws {
    let dir=directory();defer { try? FileManager.default.removeItem(at:dir) }
    let store=try NativeRecordLocalStore(directory:dir)
    var source=try NativeRecordEditorReview.example(tablet:true)
    source.version=7;source.tasks=[.init(id:"task-old",state:"awaiting_review",recordVersion:6)]
    var draft=try await store.begin(record:source,scope:"a")
    draft.document.doc.content?.insert(.paragraph("追加的正文"),at:1)
    draft.revision=try await store.persist(draft)
    let saved=try await store.commit(id:draft.id,revision:draft.revision)
    XCTAssertEqual(saved.baseVersion,7);XCTAssertEqual(saved.record.version,7)
    XCTAssertEqual(saved.record.attachments,source.attachments);XCTAssertEqual(saved.record.tasks,source.tasks)
    XCTAssertEqual(saved.record.createdAt,source.createdAt)
    var second=try await store.begin(record:saved.record,scope:"a")
    second.document.doc.content?.append(.paragraph("第二次修改"));second.revision=try await store.persist(second)
    let updated=try await store.commit(id:second.id,revision:second.revision)
    XCTAssertEqual(updated.localRevision,2);XCTAssertEqual(updated.baseVersion,7)
    XCTAssertNotEqual(updated.requestID,saved.requestID)
  }
  func testOversizedDraftPersistsButCannotBePromotedOrSilentlyTruncated() async throws {
    let dir=directory();defer { try? FileManager.default.removeItem(at:dir) }
    let store=try NativeRecordLocalStore(directory:dir)
    var draft=try await store.begin(record:nil,scope:"a")
    let text=String(repeating:"原",count:50_001)
    draft.document = .plain(text);draft.revision=try await store.persist(draft)
    do { _ = try await store.commit(id:draft.id,revision:draft.revision);XCTFail("Oversized record committed") } catch {}
    let result=try await store.snapshot(scope:"a")
    XCTAssertEqual(result.drafts[0].document.plainText,text);XCTAssertTrue(result.records.isEmpty)
  }
  @MainActor func testSerializedAutosaveKeepsLatestRapidEditsAndFailureIsNotReportedSaved() async throws {
    let dir=directory();defer { try? FileManager.default.removeItem(at:dir) }
    let base=try NativeRecordLocalStore(directory:dir),slow=RecordDraftSlowStore(base,fail:true)
    let draft=try await slow.begin(record:nil,scope:"a")
    let model=NativeRecordEditorModel(draft:draft,store:slow)
    model.change(.plain("第一版"))
    let persisted=await model.flush();XCTAssertFalse(persisted)
    XCTAssertEqual(model.error,.diskFull);XCTAssertNotEqual(model.status,"草稿已保存在本机")
    for i in 0..<30 { model.change(.plain("最终正文 \(i) 👩🏽‍💻")) }
    let retry=await model.flush();XCTAssertTrue(retry)
    let data=try await base.snapshot(scope:"a")
    XCTAssertEqual(data.drafts.first?.document.plainText,"最终正文 29 👩🏽‍💻")
    XCTAssertEqual(model.status,"草稿已保存在本机")
  }
  @MainActor func testNativeRichFormattingAndReturnDoNotTurnNewParagraphIntoHeading() throws {
    let controller=NativeRecordRichController();let view=UITextView(usingTextLayoutManager:false)
    view.delegate=controller;controller.textView=view
    controller.load(.init(doc:.init(type:"doc",content:[.paragraph("标题",type:"heading",level:1)])))
    view.selectedRange = .init(location:0,length:2);controller.textViewDidChangeSelection(view)
    controller.perform(.bold)
    XCTAssertTrue(controller.lastDocument.doc.content![0].content![0].marks!.contains(where:{$0.type == "bold"}))
    view.selectedRange = .init(location:view.attributedText.length,length:0);controller.textViewDidChangeSelection(view)
    XCTAssertFalse(controller.textView(view,shouldChangeTextIn:view.selectedRange,replacementText:"\n"))
    XCTAssertEqual(controller.lastDocument.doc.content?.last?.type,"paragraph")
    XCTAssertEqual(controller.lastDocument.doc.content?.first?.type,"heading")
    let linkController=NativeRecordRichController();let text=UITextView(usingTextLayoutManager:false);text.delegate=linkController;linkController.textView=text
    linkController.load(.plain("湖边步道"));text.selectedRange = .init(location:0,length:4);linkController.textViewDidChangeSelection(text)
    try linkController.link(text:"湖边步道",href:"https://example.com/lake")
    XCTAssertTrue(linkController.lastDocument.plainText.contains("<https://example.com/lake>"))
    text.selectedRange = .init(location:1,length:0);linkController.textViewDidChangeSelection(text)
    try linkController.link(text:"",href:nil)
    XCTAssertEqual(linkController.lastDocument.plainText,"湖边步道")
  }
  @MainActor func testListFormattingKeepsSelectedTextAndCaretExcludesParagraphSpacing() {
    let controller=NativeRecordRichController(),view=NativeRecordTextView(usingTextLayoutManager:false)
    controller.textView=view;view.delegate=controller;controller.load(.plain("Format words"))
    view.selectedRange = .init(location:0,length:6);controller.textViewDidChangeSelection(view)
    controller.perform(.bullet)
    XCTAssertEqual(controller.selectedText,"Format")
    controller.perform(.ordered)
    XCTAssertEqual(controller.selectedText,"Format")
    controller.perform(.ordered)
    XCTAssertEqual(controller.selectedText,"Format")
    let bodyFont=view.typingAttributes[.font] as? UIFont
    XCTAssertEqual(bodyFont?.pointSize,17)
    let caret=view.caretRect(for:view.beginningOfDocument)
    XCTAssertLessThanOrEqual(caret.height,23)
  }
  @MainActor func testChineseCompositionIsCommittedBeforeSaving() {
    let controller=NativeRecordRichController(),view=NativeRecordTextView(usingTextLayoutManager:false)
    controller.textView=view;view.delegate=controller;controller.load(.plain("原文"))
    view.selectedRange = .init(location:2,length:0)
    view.setMarkedText("中文输入",selectedRange:.init(location:4,length:0))
    controller.textViewDidChange(view)
    if view.markedTextRange != nil { XCTAssertEqual(controller.lastDocument.plainText,"原文") }
    controller.blur()
    XCTAssertEqual(controller.lastDocument.plainText,"原文中文输入")
  }
  @MainActor func testBoldAcrossMixedRunsPreservesItalicAndLinkDestinations() {
    let controller=NativeRecordRichController(),view=NativeRecordTextView(usingTextLayoutManager:false)
    controller.textView=view;view.delegate=controller
    let doc=NativeRecordDocument(doc:.init(type:"doc",content:[.init(type:"paragraph",content:[
      .init(type:"text",text:"斜体",marks:[.init(type:"italic")]),
      .init(type:"text",text:"链接",marks:[.init(type:"link",attrs:["href":.string("https://example.com/path")])])])]))
    controller.load(doc);view.selectedRange = .init(location:0,length:4);controller.textViewDidChangeSelection(view)
    controller.perform(.bold)
    let runs=controller.lastDocument.doc.content![0].content!
    XCTAssertTrue(runs[0].marks!.contains { $0.type == "italic" })
    XCTAssertTrue(runs[1].marks!.contains { $0.type == "link" })
    XCTAssertTrue(runs.allSatisfy { $0.marks!.contains { $0.type == "bold" } })
    controller.perform(.bold)
    XCTAssertEqual(controller.lastDocument,doc)
  }
  @MainActor func testListReturnAndPrefixBackspaceDoNotLeavePhantomBullets() {
    let controller=NativeRecordRichController(),view=NativeRecordTextView(usingTextLayoutManager:false)
    controller.textView=view;view.delegate=controller;controller.load(.plain("item"))
    view.selectedRange = .init(location:0,length:0);controller.textViewDidChangeSelection(view);controller.perform(.bullet)
    view.selectedRange = .init(location:2,length:0);controller.textViewDidChangeSelection(view)
    XCTAssertFalse(controller.textView(view,shouldChangeTextIn:.init(location:1,length:1),replacementText:""))
    XCTAssertEqual(controller.lastDocument,.plain("item"));XCTAssertEqual(view.text,"item")
    controller.load(.plain(""));view.selectedRange = .init(location:0,length:0);controller.textViewDidChangeSelection(view);controller.perform(.bullet)
    view.selectedRange = .init(location:view.attributedText.length,length:0);controller.textViewDidChangeSelection(view)
    XCTAssertFalse(controller.textView(view,shouldChangeTextIn:view.selectedRange,replacementText:"\n"))
    XCTAssertEqual(controller.lastDocument,.plain(""));XCTAssertEqual(view.text,"")
  }
  @MainActor func testSessionRefreshCanFinishLocalSaveButAnOldScopeCannotReplaceNewEditor() async throws {
    let dir=directory();defer { try? FileManager.default.removeItem(at:dir) }
    let store=try NativeRecordLocalStore(directory:dir),list=NativeRecordListModel(),workbench=NativeRecordWorkbench()
    await workbench.configure(store:store,scope:"a",list:list);await workbench.open()
    let first=try XCTUnwrap(workbench.editor);first.change(.plain("保留的正文"));_ = await first.flush()
    await workbench.configure(store:store,scope:"a",list:list);await first.save()
    XCTAssertNil(workbench.editor);XCTAssertEqual(list.snapshot.records.first?.text,"保留的正文")
    await workbench.open();let old=try XCTUnwrap(workbench.editor);old.change(.plain("资料空间 A"));_ = await old.flush()
    await workbench.configure(store:store,scope:"b",list:list);await workbench.open()
    let current=try XCTUnwrap(workbench.editor);current.change(.plain("资料空间 B"));_ = await current.flush()
    await old.save()
    XCTAssertEqual(workbench.editor?.id,current.id)
    XCTAssertFalse(list.snapshot.records.contains { $0.text == "资料空间 A" })
  }
  @MainActor func testSaveCommitsFirstChineseCompositionInAnOtherwiseEmptyDraft() async throws {
    let dir=directory();defer { try? FileManager.default.removeItem(at:dir) }
    let store=try NativeRecordLocalStore(directory:dir),draft=try await store.begin(record:nil,scope:"a")
    let model=NativeRecordEditorModel(draft:draft,store:store),view=NativeRecordTextView(usingTextLayoutManager:false)
    model.rich.textView=view;view.delegate=model.rich;model.rich.load(draft.document)
    view.setMarkedText("第一段中文",selectedRange:.init(location:5,length:0));model.rich.textViewDidChange(view)
    XCTAssertTrue(model.canSave)
    await model.save()
    let snapshot=try await store.snapshot(scope:"a")
    XCTAssertEqual(snapshot.records.first?.record.text,"第一段中文");XCTAssertTrue(snapshot.drafts.isEmpty)
  }
}
