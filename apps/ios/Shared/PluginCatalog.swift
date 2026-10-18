import Foundation
struct ProductPlugin: Codable, Identifiable { let id: String; let name: String; let enabled: Bool; let dependencies: [String]; let platforms: [String] }
struct ProductPluginSnapshot: Codable {
 let protocolVersion: Int; let revision: Int; let enabled: [String: Bool]; let plugins: [ProductPlugin]
 enum CodingKeys: String,CodingKey { case protocolVersion = "protocol", revision, enabled, plugins }
 func supports(_ id: String) -> Bool { plugins.contains { $0.id == id && $0.enabled && $0.platforms.contains("ios") } }
 static func cached(_ origin: String) -> Self? { UserDefaults.standard.data(forKey:"plugins:"+origin).flatMap { try? JSONDecoder().decode(Self.self,from:$0) } }
 func cache(_ origin: String) { if let data=try? JSONEncoder().encode(self) { UserDefaults.standard.set(data,forKey:"plugins:"+origin) } }
}

struct PluginChangeProblem: Decodable {
 let code: String
 let details: Details?
 struct Details: Decodable { let dependents: [String]?; let dependencies: [String]?; let jobs: [Job]? }
 struct Job: Decodable { let id: String }
 var message: String {
  if code == "plugin_config_changed" { return "插件配置已更新，请刷新后重试" }
  let names=["ai-assistant":"AI 助手","writing":"写作工作台","agent-lab":"Agent 实验室"]
  let dependencies=(details?.dependents ?? details?.dependencies ?? []).compactMap { names[$0] }
  let jobs=(details?.jobs ?? []).compactMap { UUID(uuidString:$0.id) == nil ? nil : String($0.id.prefix(8)) }
  let parts=[dependencies.isEmpty ? nil : "请先处理插件："+dependencies.joined(separator:"、"),jobs.isEmpty ? nil : "请先完成或取消任务："+jobs.joined(separator:"、")].compactMap {$0}
  return parts.isEmpty ? "请先处理依赖插件或未结束的任务" : parts.joined(separator:"；")
 }
}
