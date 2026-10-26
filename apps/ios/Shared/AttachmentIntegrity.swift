import CryptoKit
import Foundation

enum AttachmentIntegrity {
  static func validate(_ bundle: DraftBundle) throws {
    var total = 0
    var paths = Set<String>()
    for file in bundle.files {
      guard paths.insert(file.path).inserted, let data = Data(base64Encoded: file.body),
        data.count == file.bytes, data.count <= 16 * 1024 * 1024,
        SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == file.sha256
      else {
        throw CollectorError.message("附件完整性校验失败，已停止预览。")
      }
      total += data.count
    }
    guard total <= 40 * 1024 * 1024 else { throw CollectorError.message("归档超过当前轻量附件总量限制。") }
  }
}
