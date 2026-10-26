import CryptoKit
import Foundation
import UIKit

extension CollectorAPI:NativeRecordSyncService {
  func capabilities() async throws -> NativeRecordCapabilities {
    let (data,response)=try await recordData(recordURLRequest("/api/records/capabilities"),allowMissing:true)
    if response.statusCode==404 {return .init(protocol:1,documentVersions:[1])}
    let value=try JSONDecoder().decode(NativeRecordCapabilities.self,from:data)
    guard value.protocol==1,value.documentVersions.contains(1) else {throw NativeRecordSyncFailure.unavailable};return value
  }
  func recordsPage(cursor:String?,paginated:Bool,updatedSince:String?) async throws -> NativeRecordPage {
    var path="/api/records"
    var fields:[URLQueryItem]=[]
    if paginated {fields += [.init(name:"limit",value:"100")];if let cursor {fields.append(.init(name:"cursor",value:cursor))}}
    if let updatedSince {fields.append(.init(name:"updatedSince",value:updatedSince))}
    if !fields.isEmpty {var c=URLComponents();c.queryItems=fields;path += "?"+(c.percentEncodedQuery ?? "")}
    let (data,_)=try await recordData(recordURLRequest(path));return try JSONDecoder().decode(NativeRecordPage.self,from:data)
  }
  func record(_ id:String) async throws -> NativeRecord {
    guard UUID(uuidString:id) != nil else {throw NativeRecordSyncFailure.integrity}
    let (data,_)=try await recordData(recordURLRequest("/api/records/"+id));let value=try JSONDecoder().decode(NativeRecord.self,from:data)
    guard value.id==id,value.version>0 else {throw NativeRecordSyncFailure.integrity};return value
  }
  func putRecord(_ op:NativeRecordSyncOperation) async throws -> NativeRecord {
    guard UUID(uuidString:op.recordID) != nil,op.body == (try op.payload.data()),op.payload.requestId==op.id else {throw NativeRecordSyncFailure.integrity}
    let (data,_)=try await recordData(recordURLRequest("/api/records/"+op.recordID,method:"PUT",mime:"application/json",body:op.body))
    return try JSONDecoder().decode(NativeRecord.self,from:data)
  }
  func mediaReceipt(_ digest:String) async throws -> NativeRecordMediaReceipt? {
    guard ReadFile.validDigest(digest) else {throw NativeRecordSyncFailure.integrity}
    let (_,response)=try await recordData(recordURLRequest("/api/records/media/"+digest,method:"HEAD"),allowMissing:true)
    if response.statusCode==404 {return nil}
    let value=NativeRecordMediaReceipt(sha256:response.value(forHTTPHeaderField:"X-Content-SHA256") ?? "",mime:(response.value(forHTTPHeaderField:"Content-Type") ?? "").components(separatedBy:";")[0],bytes:Int(response.value(forHTTPHeaderField:"Content-Length") ?? "") ?? -1)
    guard value.sha256==digest,value.bytes>0,value.bytes<=NativeRecordMediaStore.maximumFile else {throw NativeRecordSyncFailure.integrity};return value
  }
  func upload(_ attachment:NativeRecordAttachment,url:URL,progress:@escaping @Sendable (Int64,Int64)->Void) async throws -> NativeRecordMediaReceipt {
    guard ReadFile.validDigest(attachment.sha256) else {throw NativeRecordSyncFailure.integrity}
    let request=try recordURLRequest("/api/records/media/"+attachment.sha256,method:"PUT",mime:attachment.mime)
    let (data,response)=try await NativeRecordBackgroundUploads.shared.upload(request,file:url,progress:progress)
    guard let responseURL=response.url,origin.contains(responseURL) else {throw NativeRecordSyncFailure.integrity}
    guard (200..<300).contains(response.statusCode) else {throw Self.recordFailure(status:response.statusCode,data:data)}
    let value=try JSONDecoder().decode(NativeRecordMediaReceipt.self,from:data)
    guard value.sha256==attachment.sha256,value.bytes==attachment.bytes,value.mime==attachment.mime else {throw NativeRecordSyncFailure.integrity};return value
  }
  func download(_ attachment:NativeRecordAttachment) async throws -> Data {
    guard ReadFile.validDigest(attachment.sha256),attachment.bytes>0,attachment.bytes<=NativeRecordMediaStore.maximumFile else {throw NativeRecordSyncFailure.integrity}
    let (data,response)=try await recordData(recordURLRequest("/api/records/media/"+attachment.sha256))
    guard data.count==attachment.bytes,NativeRecordMediaStore.digest(data)==attachment.sha256,response.value(forHTTPHeaderField:"X-Content-SHA256")==attachment.sha256 else {throw NativeRecordSyncFailure.integrity};return data
  }
}

/// System-owned file uploads may finish while the app is suspended. An operation
/// is acknowledged only by verified HEAD/PUT replies after the app resumes.
final class NativeRecordBackgroundUploads:NSObject,URLSessionDataDelegate,@unchecked Sendable {
  static let shared=NativeRecordBackgroundUploads()
  private struct Pending {var continuation:CheckedContinuation<(Data,HTTPURLResponse),Error>;var data=Data();var progress:@Sendable(Int64,Int64)->Void}
  private let lock=NSLock()
  private var sessions:[String:URLSession]=[:]
  private var pending:[String:Pending]=[:]
  private var completions:[String:()->Void]=[:]
  private func key(_ session:URLSession,_ id:Int)->String {(session.configuration.identifier ?? "foreground")+":"+String(id)}
  private func session(_ id:String)->URLSession {
    lock.lock();defer {lock.unlock()}
    if let value=sessions[id]{return value}
    let config=URLSessionConfiguration.background(withIdentifier:id)
    config.sessionSendsLaunchEvents=true;config.isDiscretionary=false;config.waitsForConnectivity=false
    config.httpCookieStorage=nil;config.urlCache=nil;config.timeoutIntervalForResource=900
    let value=URLSession(configuration:config,delegate:self,delegateQueue:nil);sessions[id]=value
    var identifiers=UserDefaults.standard.stringArray(forKey:"records.backgroundUploadSessions") ?? []
    if !identifiers.contains(id){identifiers.append(id);UserDefaults.standard.set(identifiers,forKey:"records.backgroundUploadSessions")}
    return value
  }
  func cancelAll() {
    let identifiers=UserDefaults.standard.stringArray(forKey:"records.backgroundUploadSessions") ?? []
    for id in identifiers where id.hasPrefix((Bundle.main.bundleIdentifier ?? "")+".records.upload.") {session(id).getAllTasks {tasks in tasks.forEach {$0.cancel()}}}
  }
  func wake(_ identifier:String,completion:@escaping()->Void) {
    guard identifier.hasPrefix((Bundle.main.bundleIdentifier ?? "")+".records.upload.") else {completion();return}
    lock.lock();completions[identifier]=completion;lock.unlock();_ = session(identifier)
  }
  func upload(_ request:URLRequest,file:URL,progress:@escaping @Sendable(Int64,Int64)->Void) async throws -> (Data,HTTPURLResponse) {
    let hash=NativeRecordMediaStore.digest(Data(((request.url?.host ?? "")+"\n"+(request.value(forHTTPHeaderField:"Authorization") ?? "")).utf8))
    let session=session((Bundle.main.bundleIdentifier ?? "lingnest")+".records.upload."+hash)
    let task=session.uploadTask(with:request,fromFile:file)
    return try await withTaskCancellationHandler(operation:{
      try await withCheckedThrowingContinuation { continuation in
        lock.lock();pending[key(session,task.taskIdentifier)] = .init(continuation:continuation,progress:progress);lock.unlock()
        if Task.isCancelled {task.cancel()} else {task.resume()}
      }
    },onCancel:{task.cancel()})
  }
  func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
  func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive data:Data) {
    lock.lock();let k=key(session,dataTask.taskIdentifier)
    if pending[k] != nil {pending[k]?.data.append(data);if (pending[k]?.data.count ?? 0)>1_048_576 {dataTask.cancel()}}
    lock.unlock()
  }
  func urlSession(_ session:URLSession,task:URLSessionTask,didSendBodyData bytesSent:Int64,totalBytesSent:Int64,totalBytesExpectedToSend:Int64){
    lock.lock();let callback=pending[key(session,task.taskIdentifier)]?.progress;lock.unlock();callback?(totalBytesSent,totalBytesExpectedToSend)
  }
  func urlSession(_ session:URLSession,task:URLSessionTask,didCompleteWithError error:Error?) {
    lock.lock();let value=pending.removeValue(forKey:key(session,task.taskIdentifier));lock.unlock()
    guard let value else {return}
    if let error {value.continuation.resume(throwing:error)}
    else if let response=task.response as? HTTPURLResponse {value.continuation.resume(returning:(value.data,response))}
    else {value.continuation.resume(throwing:NativeRecordSyncFailure.integrity)}
  }
  func urlSessionDidFinishEvents(forBackgroundURLSession session:URLSession){
    lock.lock();let completion=completions.removeValue(forKey:session.configuration.identifier ?? "");lock.unlock()
    DispatchQueue.main.async {completion?()}
  }
}
final class NativeRecordAppDelegate:NSObject,UIApplicationDelegate {
  func application(_ application:UIApplication,handleEventsForBackgroundURLSession identifier:String,completionHandler:@escaping()->Void) {
    NativeRecordBackgroundUploads.shared.wake(identifier,completion:completionHandler)
  }
}
