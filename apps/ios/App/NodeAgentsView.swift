import SwiftUI

struct NodeAgentsView: View {
    @EnvironmentObject var model: AppModel
    let device: Device
    @State private var agents: [NodeAgent] = []
    @State private var catalog: [AgentCatalogEntry] = []
    @State private var operations: [AgentOperation] = []
    @State private var selected: NodeAgent?
    @State private var method = "managed"
    @State private var error: String?
    @State private var busy = false
    @State private var loadedSession: UUID?
    private let ids = ["codex", "codebuddy", "claude", "gemini", "opencode"]
    private var supported: Bool { device.agentRuntime?.schemaVersion == 1 }
    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            ForEach(ids, id: \.self) { id in
                let agent = agents.first { $0.id == id }
                let operation = operations.first { $0.agent == id }
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(agent?.name ?? ["codex":"Codex", "codebuddy":"CodeBuddy", "claude":"Claude Code", "gemini":"Gemini CLI", "opencode":"OpenCode"][id]!)
                        Text(agent?.version ?? "—").foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(!supported ? "需更新客户端" : operation?.pending == true ? operation!.label : agent?.installed == true ? "已安装" : agent?.probeState == "not_found" ? "未安装" : "未上报")
                    if operation?.pending == true {
                        Button("取消") { Task { await cancel(operation!) } }.disabled(busy || operation?.state == "cancel_requested")
                    } else {
                        Button(agent?.installed == true ? "更新" : "安装") { method = "managed"; selected = agent }
                            .disabled(!supported || busy || agent == nil || agent?.custom == true || catalog.first { $0.id == id }?.release == nil)
                    }
                }
                if operation?.state == "failed", let message = operation?.result?.error { Text(message).foregroundStyle(.red) }
            }
        }
        .navigationTitle("Agent")
        .toolbar {
            if let refresh = operations.first(where: { $0.agent == nil && $0.pending }) {
                Button("取消刷新") { Task { await cancel(refresh) } }.disabled(busy || refresh.state == "cancel_requested")
            } else {
                Button("刷新") { Task { await submit(action: "refresh") } }.disabled(!supported || busy)
            }
        }
        .task(id: model.sessionID) {
            let generation = model.sessionID
            agents = []; catalog = []; operations = []; selected = nil; loadedSession = nil
            busy = false; error = nil
            await load(initial: true)
            while !Task.isCancelled && generation == model.sessionID {
                do { try await Task.sleep(nanoseconds: 3_000_000_000) } catch { break }
                await load()
            }
        }
        .sheet(item: $selected) { agent in
            NavigationStack {
                Form {
                    LabeledContent("目标节点", value: device.name)
                    LabeledContent("Agent", value: agent.name)
                    LabeledContent("目标版本", value: catalog.first { $0.id == agent.id }?.release?.version ?? "—")
                    Picker("安装方式", selection: $method) {
                        Text("灵藏托管").tag("managed")
                        if agent.originalSupported { Text("原有安装").tag("original") }
                    }
                    if let error { Text(error).foregroundStyle(.red) }
                    Button(agent.installed ? "更新" : "安装") { Task { await submit(action: agent.installed ? "update" : "install", agent: agent) } }.disabled(busy)
                }
                .navigationTitle(agent.name)
                .toolbar { Button("取消") { selected = nil } }
            }
        }
    }
    @MainActor private func load(initial: Bool = false) async {
        let generation = model.sessionID
        do {
            let client = try model.client()
            async let environment = client.agentEnvironment(deviceID: device.id)
            async let history = client.agentOperations(deviceID: device.id)
            let values = try await (environment, history)
            var entries = catalog
            if initial || entries.isEmpty { entries = try await client.agentCatalog().agents }
            guard generation == model.sessionID, !Task.isCancelled else { return }
            agents = values.0.agents; operations = values.1.operations; catalog = entries; loadedSession = generation
        } catch { if generation == model.sessionID, !Task.isCancelled { self.error = safeMessage(error) } }
    }
    @MainActor private func submit(action: String, agent: NodeAgent? = nil) async {
        guard !busy, loadedSession == model.sessionID else { return }
        let generation = model.sessionID; busy = true; error = nil
        defer { if generation == model.sessionID { busy = false } }
        do {
            _ = try await model.client().manageAgent(deviceID: device.id, action: action, agent: agent, method: method)
            guard generation == model.sessionID else { return }
            selected = nil; await load()
        } catch { if generation == model.sessionID { self.error = safeMessage(error) } }
    }
    @MainActor private func cancel(_ operation: AgentOperation) async {
        guard !busy, loadedSession == model.sessionID else { return }
        let generation = model.sessionID; busy = true
        defer { if generation == model.sessionID { busy = false } }
        do { _ = try await model.client().cancelAgentOperation(operation.id); if generation == model.sessionID { await load() } }
        catch { if generation == model.sessionID { self.error = safeMessage(error) } }
    }
}
