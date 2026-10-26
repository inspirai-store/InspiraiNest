import CryptoKit
import Foundation
import UniformTypeIdentifiers

enum NativeRecordMediaError: Error, LocalizedError, Equatable {
  case missing, corrupt, unavailable, limit(String), unsupported
  var errorDescription: String? {
    switch self {
    case .missing: return "附件原件缺失"
    case .corrupt: return "附件校验失败"
    case .unavailable: return "原件保存失败 · 请重试"
    case .unsupported: return "暂不支持此文件格式"
    case .limit(let value): return value
    }
  }
}
/// Original bytes are durable before an attachment is added to a document.
/// No original is deleted when an editing draft drops a reference.
actor NativeRecordMediaStore {
  let directory: URL
  static let maximumFile = 32 * 1024 * 1024
  static let maximumTotal = 128 * 1024 * 1024
  init(directory: URL) throws {
    self.directory = directory
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
  }
  static func live() throws -> NativeRecordMediaStore {
    try .init(directory: SharedConfiguration.container().appendingPathComponent("Records/Originals", isDirectory: true))
  }
  static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format:"%02x",$0) }.joined() }
  static func validate(size: Int, existing: [NativeRecordAttachment]) throws {
    guard existing.count < 20 else { throw NativeRecordMediaError.limit("附件已达 20 个") }
    guard size > 0, size <= maximumFile else { throw NativeRecordMediaError.limit("单个附件不能超过 32 MiB，且不能为空") }
    guard existing.reduce(Int64(0), { $0 + Int64($1.bytes) }) + Int64(size) <= maximumTotal else {
      throw NativeRecordMediaError.limit("附件合计不能超过 128 MiB")
    }
  }
  private func folder(_ scope: String) -> URL {
    directory.appendingPathComponent(Self.digest(Data(scope.utf8)), isDirectory: true)
  }
  private func destination(_ attachment: NativeRecordAttachment, scope: String) throws -> URL {
    guard attachment.sha256.count == 64, attachment.sha256.allSatisfy({ $0.isASCII && ($0.isNumber || ("a"..."f").contains(String($0))) }) else { throw NativeRecordMediaError.corrupt }
    return folder(scope).appendingPathComponent(attachment.sha256)
  }
  func importFile(_ source: URL, scope: String, existing: [NativeRecordAttachment], name: String? = nil, mime: String? = nil, id: String = UUID().uuidString.lowercased()) throws -> NativeRecordAttachment {
    let access = source.startAccessingSecurityScopedResource()
    defer { if access { source.stopAccessingSecurityScopedResource() } }
    var coordinationError: NSError?
    var result: Result<NativeRecordAttachment, Error>?
    NSFileCoordinator().coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinationError) { url in
      result = Result {
        let attributes = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard attributes.isRegularFile == true, attributes.isSymbolicLink != true else { throw NativeRecordMediaError.unavailable }
        try Self.validate(size: attributes.fileSize ?? 0, existing: existing)
        let data = try Data(contentsOf: url)
        return try store(data, scope: scope, existing: existing, name: name ?? url.lastPathComponent,
          mime: mime ?? UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream", id: id)
      }
    }
    if let result { return try result.get() }
    throw coordinationError ?? NSError(domain:"RecordMedia",code:1)
  }
  func store(_ data: Data, scope: String, existing: [NativeRecordAttachment], name: String, mime: String, id: String = UUID().uuidString.lowercased()) throws -> NativeRecordAttachment {
    try Self.validate(size: data.count, existing: existing)
    let cleanName = URL(fileURLWithPath: name).lastPathComponent
    let attachment = NativeRecordAttachment(id: id, name: cleanName.isEmpty ? "附件" : cleanName, mime: mime, bytes: data.count, sha256: Self.digest(data))
    let folder = folder(scope)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    let url = try destination(attachment, scope: scope)
    // Replacing an existing corrupt copy is atomic; identical content is reused.
    if (try? verifiedURL(attachment, scope: scope)) == nil {
      do { try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
      catch let error as NSError {
        if error.code == NSFileWriteOutOfSpaceError { throw NativeRecordLocalError.diskFull }
        throw NativeRecordMediaError.unavailable
      }
    }
    _ = try verifiedURL(attachment, scope: scope)
    return attachment
  }
  func verifiedURL(_ attachment: NativeRecordAttachment, scope: String) throws -> URL {
    let url = try destination(attachment, scope: scope)
    guard FileManager.default.fileExists(atPath: url.path) else { throw NativeRecordMediaError.missing }
    let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true,
      values.fileSize == attachment.bytes, attachment.bytes <= Self.maximumFile,
      Self.digest(try Data(contentsOf: url)) == attachment.sha256 else { throw NativeRecordMediaError.corrupt }
    return url
  }
  func imageData(_ attachments: [NativeRecordAttachment], scope: String) -> [String: Data] {
    var result: [String:Data] = [:]
    for item in attachments where item.mime.hasPrefix("image/") {
      if let url = try? verifiedURL(item, scope: scope), let data = try? Data(contentsOf: url) { result[item.id] = data }
    }
    return result
  }
  func export(_ attachment: NativeRecordAttachment, scope: String) throws -> URL {
    let source = try verifiedURL(attachment, scope: scope)
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("RecordExport/" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appendingPathComponent(URL(fileURLWithPath: attachment.name).lastPathComponent)
    try FileManager.default.copyItem(at: source, to: url)
    return url
  }

  func thumbnail(_ digest:String,scope:String) throws -> NativeRecordAttachment {
    guard ReadFile.validDigest(digest) else {throw NativeRecordMediaError.corrupt}
    let url=folder(scope).appendingPathComponent(digest)
    let data=try Data(contentsOf:url)
    guard data.count>0,data.count<=256*1024,Self.digest(data)==digest,data.starts(with:[0xff,0xd8,0xff]) else {throw NativeRecordMediaError.corrupt}
    return .init(id:digest,name:"thumbnail.jpg",mime:"image/jpeg",bytes:data.count,sha256:digest)
  }
  func copyOriginal(_ attachment:NativeRecordAttachment,from:String,to:String) throws {
    let url=try verifiedURL(attachment,scope:from)
    _ = try store(Data(contentsOf:url),scope:to,existing:[],name:attachment.name,mime:attachment.mime,id:attachment.id)
    if let digest=attachment.thumbnailSha256,let thumb=try? thumbnail(digest,scope:from) {
      let thumbURL=try verifiedURL(thumb,scope:from)
      _ = try store(Data(contentsOf:thumbURL),scope:to,existing:[],name:thumb.name,mime:thumb.mime,id:thumb.id)
    }
  }
}
