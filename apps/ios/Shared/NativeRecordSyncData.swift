import Foundation

struct NativeRecordSaveRequest: Codable, Equatable {
  var requestId:String
  var baseVersion:Int
  var text:String
  var document:NativeRecordJSON?
  var attachments:[NativeRecordAttachment]
  var createdAt:String
  func data() throws -> Data {let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys];return try encoder.encode(self)}
}
enum NativeRecordSyncStep:String,Codable {case checking,originals,previews,record}
struct NativeRecordSyncOperation:Codable,Equatable,Identifiable {
  var id:String
  var scope:String
  var recordID:String
  var localRevision:Int
  var payload:NativeRecordSaveRequest
  var body:Data
  var state:NativeRecordSync
  var uploaded:[String]=[]
  var step:NativeRecordSyncStep?
  var activeAttachmentID:String?
  var error:String?
  var errorCode:String?
  var remote:NativeRecord?
  var origin:String?
  var createdAt:String
}
struct NativeRecordMediaReceipt:Codable,Equatable {
  var sha256:String
  var mime:String
  var bytes:Int
}
struct NativeRecordCapabilities:Decodable {
  var `protocol`:Int
  var documentVersions:[Int]
  var mediaTypes:[String]?
  var pagination:Bool?
  var incremental:Bool?
}
struct NativeRecordPage:Decodable {
  var records:[NativeRecord]
  var nextCursor:String?
  var serverTime:String?
}
enum NativeRecordSyncFailure:Error,LocalizedError,Equatable {
  case http(Int,String?,String)
  case integrity
  case changed
  case unavailable
  var errorDescription:String? {
    switch self {
    case .http(_,_,let message):return message
    case .integrity:return "原件或记录校验失败 · 本机内容已保留"
    case .changed:return "版本已变化 · 请重新比较"
    case .unavailable:return "记录服务暂不可用"
    }
  }
  var unauthorized:Bool {if case .http(let status,_,_)=self {return [401,403].contains(status)};return false}
  var conflict:Bool {if case .http(let status,let code,_)=self {return status==409 && (code == nil || code == "record_version_conflict")};return false}
}
protocol NativeRecordSyncService:Sendable {
  func capabilities() async throws -> NativeRecordCapabilities
  func recordsPage(cursor:String?,paginated:Bool,updatedSince:String?) async throws -> NativeRecordPage
  func record(_ id:String) async throws -> NativeRecord
  func putRecord(_ operation:NativeRecordSyncOperation) async throws -> NativeRecord
  func mediaReceipt(_ digest:String) async throws -> NativeRecordMediaReceipt?
  func upload(_ attachment:NativeRecordAttachment,url:URL,progress:@escaping @Sendable (Int64,Int64)->Void) async throws -> NativeRecordMediaReceipt
  func download(_ attachment:NativeRecordAttachment) async throws -> Data
}

struct NativeRecordSpaceSummary:Equatable,Identifiable {
  var id:String
  var origin:String
  var count:Int
}
