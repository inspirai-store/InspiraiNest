import SwiftUI

struct NodeSkillsView: View {
    @EnvironmentObject var model: AppModel
    let device: Device
    @State private var items: [NodeSkill] = []
    @State private var agents: [SkillAgent] = []
    @State private var updated: String?
    @State private var requestID = UUID()
    @State private var loading = false
    @State private var error: String?
    var body: some View {
        List {
            if loading { ProgressView() }
            if let error { Text(error).foregroundStyle(.red) }
            Section("环境") {
                Text(updated ?? "未上报")
                ForEach(agents, id: \.name) { agent in
                    HStack { Text(["codex":"Codex", "codebuddy":"CodeBuddy", "claude":"Claude Code"][agent.name] ?? agent.name); Spacer(); Text(agent.version ?? "—"); Text(agent.installed ? "已安装" : "未安装") }
                }
            }
            ForEach(items) { skill in
                Section(skill.name) {
                    Text("\(skill.agentLabel) · \(skill.source ?? "") · \(skill.context ?? "")")
                    Text(skill.declaredVersion?.isEmpty == false ? skill.declaredVersion! : String((skill.hash ?? "未记录").prefix(12)))
                    Text(skill.loadLabel)
                    Text(skill.verification?.state == "passed" ? "提取验证通过" : "提取未验证")
                    if !skill.capabilities.isEmpty { Text(skill.capabilities.joined(separator: "、")) }
                    ForEach(skill.dependencies.missing + skill.dependencies.unknown, id: \.self) { Text($0) }
                    if let issue = skill.issue { Text(issue).foregroundStyle(.red) }
                }
            }
        }
        .navigationTitle("节点技能")
        .task(id: model.sessionID) { items = []; agents = []; updated = nil; loading = false; await load() }
        .refreshable { await load() }
    }
    private func load() async {
        guard !loading else { return }; loading = true; error = nil
        let generation = model.sessionID; let request = UUID(); requestID = request
        defer { if requestID == request { loading = false } }
        do {
            let client = try model.client(); var offset = 0; var snapshotID: String?; var next: Int?; var all: [NodeSkill] = []
            repeat {
                let page = try await client.skillEnvironment(deviceID: device.id, offset: offset, snapshotID: snapshotID)
                guard generation == model.sessionID, !Task.isCancelled else { return }
                all += page.items; snapshotID = page.snapshotId; next = page.nextOffset; offset = next ?? 0
                agents = page.agents; updated = page.scannedAt
            } while next != nil
            items = all
        } catch {
            guard generation == model.sessionID, !Task.isCancelled else { return }
            self.error = safeMessage(error)
        }
    }
}
