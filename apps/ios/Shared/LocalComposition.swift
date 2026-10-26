import Foundation

/// A mutable, unconfirmed composition. Promotion freezes it into the immutable outbox.
struct LocalComposition: Codable, Equatable, Identifiable, Sendable {
  let id: String
  var revision = 0
  var manual: Bool
  var parts: [SharedPart]
  var requirements: String
  var tags: String
  var autoArchive: Bool
  var deviceID: String
  var agent: String
  var origin: String?
  var omittedAttachments: Int?
  let createdAt: Date
  var modifiedAt: Date

  init(id: UUID = UUID(), manual: Bool = true, parts: [SharedPart] = [],
    requirements: String = "", tags: String = "", autoArchive: Bool = true,
    deviceID: String = "", agent: String = "", origin: String? = nil, date: Date = Date()) {
    self.id = id.uuidString.lowercased()
    self.manual = manual
    self.parts = parts
    self.requirements = requirements
    self.tags = tags
    self.autoArchive = autoArchive
    self.deviceID = deviceID
    self.agent = agent
    self.origin = origin
    createdAt = date
    modifiedAt = date
  }
  var original: String { SharedPart.uniqueValues(in: parts).map(\.value).joined(separator: "\n\n") }
  var title: String {
    original.components(separatedBy: .newlines).first {
      !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    } ?? "未命名采集"
  }
  var hasContent: Bool {
    !original.isEmpty || !requirements.isEmpty || !tags.isEmpty
      || !autoArchive || !deviceID.isEmpty || !agent.isEmpty
  }
}
