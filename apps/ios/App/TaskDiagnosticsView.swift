import SwiftUI

struct TaskDiagnosticsView: View {
    @EnvironmentObject var model: AppModel
    let taskID: String
    @State private var report: TaskDiagnosticReport?
    @State private var selected = ""
    @State private var evidence: TaskDiagnosticReport.Event?
    @State private var error = ""
    private var events: [TaskDiagnosticReport.Event] { report?.events.filter { selected.isEmpty || $0.attemptId == selected } ?? [] }
    private func load() async {
        let generation = model.sessionID
        do { let value = try await model.client().taskDiagnostics(taskID: taskID); guard generation == model.sessionID else { return }; report = value; error = "" }
        catch { guard generation == model.sessionID else { return }; self.error = safeMessage(error) }
    }
    var body: some View {
        List {
            if !error.isEmpty { Section { Text(error).foregroundStyle(.red); Button("重试") { Task { await load() } } } }
            if let report {
                if let reason = report.diagnosis.reason { Section("当前阻塞") { Text(reason); if let code = report.diagnosis.code { Text(code) }; ForEach(report.diagnosis.recovery_conditions ?? [], id: \.code) { Text($0.action) } } }
                Section("执行历史") {
                    Picker("执行次数", selection: $selected) {
                        Text("全部执行").tag("")
                        ForEach(Array(report.attempts.enumerated()), id: \.element.id) { index, attempt in Text("第 \(index + 1) 次 · \(attempt.deviceName)").tag(attempt.id) }
                    }
                    if report.completeness.legacy { Text("旧版历史不完整") }
                    if report.completeness.local_evidence_may_be_pending { Text("部分证据待同步") }
                    if report.completeness.truncated { Text("执行历史存在缺口") }
                }
                Section("执行记录") {
                    ForEach(events) { event in
                        Button { evidence = event } label: {
                            VStack(alignment: .leading, spacing: 8) { Text(event.message).foregroundStyle(.primary); Text(event.at).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
            } else if error.isEmpty { ProgressView("正在读取执行记录") }
        }.navigationTitle("执行记录").task(id: model.sessionID) { await load() }.refreshable { await load() }
            .sheet(item: $evidence) { event in
                NavigationStack { List {
                    Section("证据") { Text(event.message).textSelection(.enabled); Text(event.code).textSelection(.enabled); Text(event.at) }
                    if let artifacts = event.artifacts { Section("已保存文件") { ForEach(artifacts, id: \.path) { file in VStack(alignment: .leading) { Text(file.path); Text(file.sha256 ?? "大文件未附哈希").font(.caption).textSelection(.enabled) } } } }
                    Section("定位") { Text(event.reportedBy); Text(event.attemptId ?? "旧版未记录执行编号").textSelection(.enabled); Text(event.id).textSelection(.enabled) }
                }.navigationTitle("执行证据").toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { evidence = nil } } } }
            }
    }
}

struct NodeCapabilitiesView: View {
    @EnvironmentObject var model: AppModel
    let device: Device
    @State private var report: NodeCapabilityReport?
    @State private var error = ""
    private func load() async {
        let generation = model.sessionID
        do { let value = try await model.client().nodeCapabilities(deviceID: device.id); guard generation == model.sessionID else { return }; report = value; error = "" }
        catch { guard generation == model.sessionID else { return }; self.error = safeMessage(error) }
    }
    var body: some View {
        List {
            Section { Text("由 \(device.name) 执行") }
            if !error.isEmpty { Text(error).foregroundStyle(.red); Button("重试") { Task { await load() } } }
            ForEach(["capture", "writing"], id: \.self) { group in
                Section(group == "capture" ? "采集" : "写作") {
                    ForEach(report?.capabilities.filter { $0.id.hasPrefix(group + ".") } ?? []) { capability in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(capability.label)
                            Text(["ready":"可执行","queued":"排队","configuration":"待配置","authorization":"待授权","connection":"待连接页面","offline":"等待节点","unknown":"待检测","disabled":"未启用"][capability.state] ?? capability.state)
                            Text(["passed":"已验证","untested":"未实测","changed":"待复测"][capability.verification] ?? capability.verification).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }.navigationTitle("采集与写作能力").task(id: model.sessionID) { await load() }.refreshable { await load() }
    }
}
