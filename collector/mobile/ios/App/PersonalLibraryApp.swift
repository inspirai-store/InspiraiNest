import SwiftUI

@main
struct PersonalLibraryApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model)
                .task(id: scenePhase) {
                    guard scenePhase == .active else { return }
                    while !Task.isCancelled {
                        await model.refresh()
                        do { try await Task.sleep(nanoseconds: 5_000_000_000) } catch { break }
                    }
                }
                // Cover native previews and the web view in the app-switcher.
                .overlay { if scenePhase != .active { Color(.systemBackground).ignoresSafeArea().overlay(Text("个人资料库")) } }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        VStack(spacing: 0) {
            if let notice = model.notice {
                HStack(alignment: .top) {
                    Text(notice).font(.footnote).textSelection(.enabled)
                    Spacer()
                    Button { model.notice = nil } label: { Image(systemName: "xmark.circle") }.accessibilityLabel("关闭提示")
                }.padding().background(.thinMaterial)
            }
            TabView {
                NavigationStack { TasksView() }.id(model.sessionID).tabItem { Label("任务", systemImage: "list.bullet.rectangle") }
                NavigationStack { OutboxView() }.tabItem { Label("发件箱", systemImage: "tray.and.arrow.up") }
                NavigationStack { LibraryReaderView() }.id(model.sessionID).tabItem { Label("资料库", systemImage: "books.vertical") }
                NavigationStack { SettingsView() }.tabItem { Label("设备", systemImage: "iphone") }
            }
        }
    }
}

struct PairingForm: View {
    @EnvironmentObject var model: AppModel
    @State private var server = ""
    @State private var key = ""
    @State private var name = "我的 iPhone"
    var body: some View {
        Section("配对管理端") {
            TextField("https://你的服务器", text: $server).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("设备名称", text: $name)
            SecureField("管理端配对码或个人密钥", text: $key).textInputAutocapitalization(.never).autocorrectionDisabled()
            Text("推荐使用一次性 owner 管理端配对码。个人密钥仅用于交换设备 token；两者均不保存。worker 采集端配对码不能用于此应用。")
                .font(.footnote).foregroundStyle(.secondary)
            Button(model.busy ? "正在配对…" : "安全配对") {
                let pairingKey = key; key = ""
                Task { await model.pair(server: server, key: pairingKey, name: name) }
            }.disabled(model.busy || key.isEmpty || server.isEmpty || name.isEmpty)
        }.onDisappear { key = "" }
    }
}

struct TasksView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        List {
            if !model.paired { PairingForm() }
            if let last = model.lastRefresh { Text("最近更新 \(last.formatted(date: .omitted, time: .standard))").font(.caption).foregroundStyle(.secondary) }
            ForEach(model.snapshot?.tasks ?? []) { task in
                NavigationLink { TaskDetailView(taskID: task.id).id(model.sessionID) } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(verbatim: task.title).lineLimit(3)
                        Text(task.stateLabel).font(.caption).foregroundStyle(.secondary)
                        if let event = task.events?.last { Text(verbatim: event.message).font(.caption).lineLimit(2) }
                    }
                }
            }
            if model.paired && model.snapshot?.tasks.isEmpty == true { Text("暂无任务。通过其他应用的分享菜单收集资料。") }
        }.navigationTitle("采集任务").refreshable { await model.refresh() }
    }
}

struct TaskDetailView: View {
    @EnvironmentObject var model: AppModel
    let taskID: String
    @State private var cancel = false
    var body: some View {
        Group {
            if let task = model.snapshot?.tasks.first(where: { $0.id == taskID }) {
                List {
                    Section(task.stateLabel) { Text(verbatim: task.title).textSelection(.enabled) }
                    Section("处理进度") {
                        ForEach(Array((task.events ?? []).enumerated()), id: \.offset) { _, event in
                            VStack(alignment: .leading) {
                                Text(verbatim: event.message).textSelection(.enabled)
                                Text(event.at).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    if task.state == "awaiting_review" { NavigationLink("查看草稿并确认归档") { DraftReviewView(taskID: taskID) } }
                    if task.canRetry { Button("继续 / 重试任务") { Task { await model.action(task, "retry") } }.disabled(model.busy) }
                    if task.canCancel { Button("取消任务", role: .destructive) { cancel = true }.disabled(model.busy) }
                }
                .confirmationDialog("取消这个服务器任务？本地发件箱原文仍会保留。", isPresented: $cancel, titleVisibility: .visible) {
                    Button("取消任务", role: .destructive) { Task { await model.action(task, "cancel") } }
                }
            } else { Text("请返回任务列表刷新。") }
        }.navigationTitle("任务详情").refreshable { await model.refresh() }
    }
}

struct OutboxView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        List {
            Section {
                Text("“已保存”表示原文在本机；只有收到服务器确认后才显示“已提交”。重试始终沿用原提交 ID。")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("重试当前服务器的待发送记录") { Task { await model.retryQueued() } }
                    .disabled(model.busy || !model.paired)
            }
            ForEach(model.items) { item in
                NavigationLink { OutboxDetailView(itemID: item.id) } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(verbatim: item.share.submission.content).lineLimit(3)
                        Text(item.statusLabel).font(.caption).foregroundStyle(item.state == "submitted" ? Color.green : Color.secondary)
                        Text(item.share.createdAt.formatted()).font(.caption2)
                    }
                }
            }
            if model.items.isEmpty { Text("发件箱为空") }
        }.navigationTitle("本机发件箱").refreshable { model.reloadLocal() }
    }
}

struct OutboxDetailView: View {
    @EnvironmentObject var model: AppModel
    let itemID: String
    @State private var binding = false
    var body: some View {
        List {
            if let item = model.items.first(where: { $0.id == itemID }) {
                Section(item.statusLabel) {
                    Text(item.origin ?? "尚未选择服务器")
                    Text("提交 ID：\(item.id)").font(.caption).textSelection(.enabled)
                    Text("已尝试 \(item.attempts) 次")
                    Text("Agent：\(item.share.submission.agent ?? "自动")")
                    Text("派发电脑：\(item.share.submission.deviceId ?? "自动")").font(.caption).textSelection(.enabled)
                    Text(item.share.submission.autoArchive ? "自动归档" : "确认草稿后归档")
                    if !item.share.submission.tags.isEmpty { Text("标签：" + item.share.submission.tags.joined(separator: "、")) }
                    if let message = item.message { Text(message) }
                    if let task = item.taskID { Text("任务 ID：\(task)").font(.caption).textSelection(.enabled) }
                }
                Section("完整原始内容") {
                    ForEach(Array(item.share.originalParts.enumerated()), id: \.offset) { _, part in
                        VStack(alignment: .leading) {
                            Text("\(part.kind) · 来源项 \(part.item + 1)").font(.caption).foregroundStyle(.secondary)
                            Text(verbatim: part.value).textSelection(.enabled)
                        }
                    }
                }
                Section("附加要求") { Text(verbatim: item.share.additionalRequirements).textSelection(.enabled) }
                Section("提交内容预览") { Text(verbatim: item.share.submission.content).textSelection(.enabled) }
                if item.state != "submitted" {
                    if item.origin == nil {
                        Button("绑定到当前服务器并提交") { binding = true }.disabled(!model.paired || model.busy || item.leased)
                    } else {
                        Button("使用原提交 ID 重试") { Task { await model.send(item) } }
                            .disabled(!model.paired || model.busy || item.leased || item.origin != model.serverName)
                        if item.origin != model.serverName { Text("记录属于另一台服务器。请配对到原服务器后再重试。") }
                    }
                }
                Text("为避免超时后重复创建任务，已保存内容不可就地改写。超过服务端限制的内容完整保留在此，可选择复制。")
                    .font(.footnote).foregroundStyle(.secondary)
                .confirmationDialog("将完整分享内容发送到 \(model.serverName)？绑定后不会自动迁移到其他服务器。", isPresented: $binding, titleVisibility: .visible) {
                    Button("绑定并提交") { Task { await model.send(item, bindUnassigned: true) } }
                }
            }
        }.navigationTitle("已保存的分享")
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @State private var revoking: Device?
    @State private var forget = false
    var body: some View {
        List {
            if model.paired {
                Section("当前设备") {
                    Text(model.deviceName); Text(model.serverName).font(.footnote)
                    Button("移除本机登录", role: .destructive) { forget = true }.disabled(model.busy)
                }
                Section("已授权设备") {
                    ForEach(model.snapshot?.devices ?? []) { device in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(device.name + (device.id == model.snapshot?.me.id ? " · 本机" : ""))
                            Text("\(device.role) · \(device.revokedAt != nil ? "已撤销" : device.role == "owner" ? "已授权" : device.online == true ? "在线" : "离线")")
                                .font(.caption).foregroundStyle(.secondary)
                            if device.revokedAt == nil { Button("撤销设备", role: .destructive) { revoking = device }.disabled(model.busy) }
                        }
                    }
                }
            } else { PairingForm() }
            Section {
                Text("分享扩展仅做短时间发送尝试。离线或系统终止时，请回到发件箱重试；无需重新分享。电脑上的采集 Agent 负责分析与归档。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("设备与配对").refreshable { await model.refresh() }
        .confirmationDialog("撤销 \(revoking?.name ?? "") 的服务器访问？", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible) {
            if let device = revoking { Button("撤销设备", role: .destructive) { Task { await model.revoke(device) }; revoking = nil } }
        }
        .confirmationDialog("移除本机登录并关闭阅读会话？发件箱原文保留。", isPresented: $forget, titleVisibility: .visible) {
            Button("移除本机登录", role: .destructive) { model.forget() }
        }
    }
}
