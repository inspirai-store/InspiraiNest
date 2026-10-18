import Foundation
struct ProductPlugin: Codable, Identifiable { let id: String; let name: String; let enabled: Bool; let dependencies: [String]; let platforms: [String] }
struct ProductPluginSnapshot: Codable {
 let protocolVersion: Int; let revision: Int; let enabled: [String: Bool]; let plugins: [ProductPlugin]
 enum CodingKeys: String,CodingKey { case protocolVersion = "protocol", revision, enabled, plugins }
 func supports(_ id: String) -> Bool { plugins.contains { $0.id == id && $0.enabled && $0.platforms.contains("ios") } }
 static func cached(_ origin: String) -> Self? { UserDefaults.standard.data(forKey:"plugins:"+origin).flatMap { try? JSONDecoder().decode(Self.self,from:$0) } }
 func cache(_ origin: String) { if let data=try? JSONEncoder().encode(self) { UserDefaults.standard.set(data,forKey:"plugins:"+origin) } }
}
