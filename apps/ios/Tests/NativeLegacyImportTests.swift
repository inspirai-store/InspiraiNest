import CryptoKit
import WebKit
import XCTest
@testable import PersonalLibrary

@MainActor final class NativeLegacyImportTests: XCTestCase {
  func testOldIndexedDBIsReadWithoutOldUIAndImportIsIdempotent() async throws {
    let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer {try? FileManager.default.removeItem(at:directory)}
    let store=try NativeRecordLocalStore(directory:directory.appendingPathComponent("records"))
    let media=try NativeRecordMediaStore(directory:directory.appendingPathComponent("media"))
    let database="native-import-test-"+UUID().uuidString
    let importer=NativeLegacyRecordImport(database:database)
    let oldPage=directory.appendingPathComponent("CaptureAssets/index.html")
    try FileManager.default.createDirectory(at:oldPage.deletingLastPathComponent(),withIntermediateDirectories:true)
    try Data("<html><body>fixture</body></html>".utf8).write(to:oldPage)
    let navigation=LegacyFixtureNavigation(),web=WKWebView()
    web.navigationDelegate=navigation
    try await navigation.load(web,file:oldPage)
    let id=UUID().uuidString.lowercased(),synced=UUID().uuidString.lowercased(),deleted=UUID().uuidString.lowercased()
    let text="  原有记录 😀\n保留  空格与换行。  "
    let result=try await web.callAsyncJavaScript("""
      const r=indexedDB.open(database,1);const db=await new Promise((resolve,reject)=>{r.onupgradeneeded=()=>r.result.createObjectStore('items',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      await new Promise((resolve,reject)=>{const tx=db.transaction('items','readwrite');const s=tx.objectStore('items');s.put({id,text,attachments:[],createdAt:'2026-10-20T02:00:00Z',sync:'pending',deletedAt:null});s.put({id:'draft',text:'尚未提交的草稿',attachments:[]});s.put({id:synced,text:'服务器已有',attachments:[],createdAt:'2026-10-20T02:00:00Z',sync:'synced'});s.put({id:deleted,text:'已删除',attachments:[],deletedAt:'2026-10-21T00:00:00Z'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();return true;
      """,arguments:["database":database, "id":id,"text":text,"synced":synced,"deleted":deleted],in:nil,contentWorld:.page)
    XCTAssertEqual(result as? Bool,true)
    web.stopLoading();web.navigationDelegate=nil
    try await importer.run(store:store,media:media,directory:directory.appendingPathComponent("archive"),force:true)
    var snapshot=try await store.snapshot(scope:NativeRecordLocalStore.unbound)
    XCTAssertEqual(snapshot.records.count,2)
    XCTAssertEqual(snapshot.records.first{$0.record.id==id}?.record.text,text)
    XCTAssertEqual(snapshot.records.first{$0.record.id==id}?.record.sync,.pending)
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath:directory.appendingPathComponent("archive").path).count,4)
    let original=try XCTUnwrap(snapshot.records.first{$0.record.id==id})
    var draft=try await store.begin(record:original.record,scope:original.scope);draft.document = .plain("新版编辑内容")
    draft.revision=try await store.persist(draft);_ = try await store.commit(id:draft.id,revision:draft.revision)
    try await importer.run(store:store,media:media,directory:directory.appendingPathComponent("archive"),force:true)
    snapshot=try await store.snapshot(scope:NativeRecordLocalStore.unbound)
    XCTAssertEqual(snapshot.records.count,2)
    XCTAssertEqual(snapshot.records.first{$0.record.id==id}?.record.text,"新版编辑内容")
    try await importer.open();let keys=try await importer.keys();XCTAssertEqual(keys.count,4);importer.close()
  }
}

@MainActor private final class LegacyFixtureNavigation:NSObject,WKNavigationDelegate {
  private var continuation:CheckedContinuation<Void,Error>?
  func load(_ web:WKWebView,file:URL) async throws {
    try await withCheckedThrowingContinuation { continuation in self.continuation=continuation;web.loadFileURL(file,allowingReadAccessTo:file.deletingLastPathComponent()) }
  }
  func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {continuation?.resume();continuation=nil}
  func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error) {continuation?.resume(throwing:error);continuation=nil}
}
