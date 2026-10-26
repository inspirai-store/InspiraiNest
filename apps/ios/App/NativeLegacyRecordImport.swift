import CryptoKit
import Foundation
import WebKit

/// Reads the previous file-origin IndexedDB without loading its UI or providing a native bridge.
/// The original database is never changed. Every row is archived before native import.
@MainActor final class NativeLegacyRecordImport: NSObject, WKNavigationDelegate {
  private(set) var web: WKWebView!
  private var navigation: CheckedContinuation<Void, Error>?
  private let database: String
  init(database: String = "inspirainest-capture-v1") { self.database=database }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { self.navigation?.resume();self.navigation=nil }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { self.navigation?.resume(throwing:error);self.navigation=nil }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { self.navigation?.resume(throwing:error);self.navigation=nil }
  func open() async throws {
    let config=WKWebViewConfiguration();config.websiteDataStore = .default()
    web=WKWebView(frame:.zero,configuration:config);web.navigationDelegate=self
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void,Error>) in
      navigation=continuation
      web.loadHTMLString("<html><head><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'\"></head><body></body></html>",baseURL:Bundle.main.bundleURL.appendingPathComponent("native-data-import.html"))
    }
  }
  func keys() async throws -> [String] {
    let result=try await web.callAsyncJavaScript("""
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(database);r.onupgradeneeded=()=>{r.transaction.abort();resolve(null)};r.onsuccess=()=>resolve(r.result);r.onerror=()=>r.error?.name==='AbortError'?resolve(null):reject(r.error)});
      if(!db)return [];window.__nativeLegacyDB=db;
      if(!db.objectStoreNames.contains('items'))return [];
      return await new Promise((resolve,reject)=>{const r=db.transaction('items','readonly').objectStore('items').getAllKeys();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      """,arguments:["database":database],in:nil,contentWorld:.page)
    guard let keys=result as? [String] else {throw NativeRecordLocalError.unavailable};return keys
  }
  func row(_ key:String) async throws -> Data {
    let result=try await web.callAsyncJavaScript("""
      const row=await new Promise((resolve,reject)=>{const r=window.__nativeLegacyDB.transaction('items','readonly').objectStore('items').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      async function encode(value){if(value instanceof Blob){const bytes=new Uint8Array(await value.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {__blob:btoa(binary),mime:value.type,bytes:value.size}};if(Array.isArray(value))return await Promise.all(value.map(encode));if(value&&typeof value==='object'){const out={};for(const [k,v]of Object.entries(value))out[k]=await encode(v);return out}return value}
      return JSON.stringify(await encode(row));
      """,arguments:["key":key],in:nil,contentWorld:.page)
    guard let value=result as? String,let data=value.data(using:.utf8) else {throw NativeRecordLocalError.unavailable};return data
  }
  func close() {web?.stopLoading();web?.navigationDelegate=nil;web=nil}
  static func digest(_ data:Data)->String {SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()}
  func run(store:NativeRecordLocalStore,media:NativeRecordMediaStore,directory:URL,force:Bool=false) async throws {
    let marker="native.legacy-record-import.v1"
    if !force && UserDefaults.standard.bool(forKey:marker) {return}
    try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])
    try await open();defer{close()}
    for key in try await keys() {
      let data=try await row(key),hash=Self.digest(data)
      try data.write(to:directory.appendingPathComponent(hash+".json"),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
      guard let raw=try JSONSerialization.jsonObject(with:data) as? [String:Any] else {throw NativeRecordLocalError.unavailable}
      try await importRow(raw,key:key,fingerprint:hash,store:store,media:media)
    }
    if !force {UserDefaults.standard.set(true,forKey:marker)}
  }
  private func importRow(_ raw:[String:Any],key:String,fingerprint:String,store:NativeRecordLocalStore,media:NativeRecordMediaStore) async throws {
    guard key=="draft" || UUID(uuidString:key) != nil else{return}
    guard raw["deletedAt"] as? String == nil,raw["sync"] as? String != "synced" else{return}
    let text=raw["text"] as? String ?? "",assets=raw["attachments"] as? [[String:Any]] ?? []
    guard !text.isEmpty || !assets.isEmpty else{return}
    let origin=(raw["server"] as? String).flatMap{try? ServerOrigin($0).value}
    let scope=origin.map{"legacy-"+Self.digest(Data($0.utf8))} ?? NativeRecordLocalStore.unbound
    let id=key=="draft" ? Self.identifier(fingerprint) : (raw["recordId"] as? String).flatMap{UUID(uuidString:$0)?.uuidString.lowercased()} ?? UUID(uuidString:key)?.uuidString.lowercased() ?? Self.identifier(fingerprint)
    var attachments:[NativeRecordAttachment]=[]
    for asset in assets {
      guard let id=asset["id"] as? String,UUID(uuidString:id) != nil,let name=asset["name"] as? String,let mime=asset["mime"] as? String,let sha=asset["sha256"] as? String,let bytes=asset["bytes"] as? Int else {throw NativeRecordLocalError.unavailable}
      var attachment=NativeRecordAttachment(id:id,name:name,mime:mime,bytes:bytes,sha256:sha)
      if let blob=asset["blob"] as? [String:Any],let encoded=blob["__blob"] as? String,let data=Data(base64Encoded:encoded) {
        guard data.count==bytes,Self.digest(data)==sha else{throw NativeRecordSyncFailure.integrity}
        attachment=try await media.store(data,scope:scope,existing:attachments,name:name,mime:mime,id:id)
      }
      if let thumb=asset["thumbnail"] as? [String:Any],let blob=thumb["blob"] as? [String:Any],let encoded=blob["__blob"] as? String,let data=Data(base64Encoded:encoded),let digest=thumb["sha256"] as? String {
        guard Self.digest(data)==digest else{throw NativeRecordSyncFailure.integrity}
        let preview=try await media.store(data,scope:scope,existing:[],name:"preview.jpg",mime:"image/jpeg",id:UUID().uuidString.lowercased());attachment.thumbnailSha256=preview.sha256
      }
      attachments.append(attachment)
    }
    let document=try raw["document"].flatMap { $0 is NSNull ? nil:$0 }.map{try JSONDecoder().decode(NativeRecordJSON.self,from:JSONSerialization.data(withJSONObject:$0))}
    let payload=raw["payload"] as? [String:Any],baseVersion=payload?["baseVersion"] as? Int ?? raw["remoteVersion"] as? Int ?? 0
    let record=NativeRecord(id:id,text:text,attachments:attachments,version:max(1,baseVersion),createdAt:raw["createdAt"] as? String ?? ISO8601DateFormatter().string(from:Date()),document:document,sync:.pending)
    let entry=NativeRecordLocalEntry(record:record,scope:scope,localRevision:1,baseVersion:baseVersion,requestID:payload?["requestId"] as? String ?? UUID().uuidString.lowercased())
    try await store.importLegacy(entry,origin:origin,fingerprint:fingerprint)
  }
  private static func identifier(_ digest:String)->String {
    let hex=Array(digest.prefix(32));return String(hex[0..<8])+"-"+String(hex[8..<12])+"-"+String(hex[12..<16])+"-"+String(hex[16..<20])+"-"+String(hex[20..<32])
  }
}
