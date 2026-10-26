import Foundation

enum NativeRecordPreset:String,CaseIterable,Codable,Identifiable,Sendable {
  case summary,transcribe,actions,custom
  var id:String {rawValue}
  var title:String {switch self {case .summary:return "整理摘要";case .transcribe:return "转写 / 识字";case .actions:return "提炼行动项";case .custom:return "自定义"}}
}
struct NativeRecordProcessKind:Codable,Sendable {var preset:String;var instructions:String}
struct NativeRecordProcessRequest:Codable,Equatable,Sendable {
  var requestId:String
  var baseVersion:Int
  var preset:NativeRecordPreset
  var instructions:String
  var deviceId:String?
  var agent:String?
  func data()throws->Data {let e=JSONEncoder();e.outputFormatting=[.sortedKeys];return try e.encode(self)}
  func validate()throws {
    guard UUID(uuidString:requestId) != nil,baseVersion>0,instructions.utf16.count<=10000,
      preset != .custom || !instructions.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,
      agent==nil || ["codex","codebuddy"].contains(agent!),deviceId==nil || UUID(uuidString:deviceId!) != nil else {throw CollectorError.message("请核对加工要求与派发选项")}
  }
}
struct NativeRecordProcessDraft:Codable {
  var scope:String;var recordID:String;var revision:Int=0
  var preset:NativeRecordPreset = .summary
  var instructions="整理关键结论，列出下一步行动。"
  var deviceID:String?;var agent:String?;var advanced=false
}
struct NativeRecordProcessOperation:Codable,Identifiable {
  var id:String {request.requestId}
  var scope:String;var recordID:String;var request:NativeRecordProcessRequest;var body:Data
  var accepted:LibraryTask?
  var rejected:Bool? = nil
}
