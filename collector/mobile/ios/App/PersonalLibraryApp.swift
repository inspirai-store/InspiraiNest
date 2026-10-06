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
                .overlay { if scenePhase != .active { Color(.systemBackground).ignoresSafeArea().overlay(Text("灵藏")) } }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @State private var selectedTab = 0
    var body: some View {
        VStack(spacing: 0) {
            if let notice = model.notice {
                HStack(alignment: .top) {
                    Text(notice).font(.footnote).textSelection(.enabled)
                    Spacer()
                    Button { model.notice = nil } label: { Image(systemName: "xmark.circle") }.accessibilityLabel("关闭提示")
                }.padding().background(.thinMaterial)
            }
            TabView(selection: $selectedTab) {
                NavigationStack { TasksView() }.id(model.sessionID).tabItem { Label("任务", systemImage: "list.bullet.rectangle") }.tag(0)
                NavigationStack { OutboxView() }.tabItem { Label("发件箱", systemImage: "tray.and.arrow.up") }.tag(1)
                NavigationStack { LibraryReaderView() }.id(model.sessionID).tabItem { Label("资料库", systemImage: "books.vertical") }.tag(2)
                NavigationStack { SettingsView() }.tabItem { Label("设备", systemImage: "iphone") }.tag(3)
            }
        }
    }
}

struct PairingForm: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var server = ""
    @State private var key = ""
    @State private var showingScanner = false
    @State private var scanned: PairingQRCode?
    @State private var usingCode = false
    @State private var mfa = false
    @State private var recovery = false
    @State private var factor = ""
    @State private var pendingKey = ""
    @State private var error = ""
    @State private var attempt = 0
    @State private var loginTask: Task<Void, Never>?
    @Environment(\.dismiss) private var dismiss

    private func cancel() {
        attempt += 1; loginTask?.cancel(); loginTask = nil; model.cancelLogin()
        key = ""; pendingKey = ""; factor = ""; mfa = false; recovery = false; scanned = nil
    }
    private func login(_ secret: String, address: String? = nil, otp: String? = nil, recoveryCode: String? = nil) {
        guard !model.busy else { return }
        attempt += 1; let current = attempt; let address = address ?? server
        key = ""; factor = ""; error = ""
        loginTask = Task {
            do {
                try await model.login(server: address, key: secret, name: UIDevice.current.name, otp: otp, recoveryCode: recoveryCode)
                guard attempt == current, !Task.isCancelled else { return }
                pendingKey = ""; mfa = false; scanned = nil; dismiss()
            } catch {
                guard attempt == current, !Task.isCancelled else { return }
                if case CollectorError.login(let code, _) = error, ["mfa_required", "mfa_invalid"].contains(code) {
                    pendingKey = secret; mfa = true
                    self.error = code == "mfa_invalid" ? safeMessage(error) : ""
                } else { pendingKey = ""; mfa = false; self.error = safeMessage(error) }
            }
        }
    }
    var body: some View {
        Section("登录资料库") {
            TextField("资料库地址 · https://", text: $server).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                .onChange(of: server) { _ in cancel() }
            SecureField(usingCode ? "配对码" : "登录密码", text: $key).textContentType(usingCode ? nil : .password)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button(model.busy ? "正在登录…" : "登录") { login(key) }
                .disabled(model.busy || key.isEmpty || server.isEmpty)
            if !error.isEmpty && !mfa { Text(error).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently) }
            Button(usingCode ? "使用密码登录" : "使用配对码连接") { cancel(); usingCode.toggle() }
            Button { cancel(); showingScanner = true } label: { Label("扫码连接", systemImage: "qrcode.viewfinder") }
            if let scanned {
                Text(scanned.server).textSelection(.enabled)
                Button("确认地址并连接") { login(scanned.key, address: scanned.server) }
                    .disabled(model.busy)
            }
            Button("取消") { cancel(); dismiss() }
        }
        .onAppear { if server.isEmpty { server = model.lastServer } }
        .onDisappear { cancel() }
        .onChange(of: scenePhase) { phase in if phase != .active { cancel() } }
        .sheet(isPresented: $showingScanner) { PairingScannerView { result in scanned = result; showingScanner = false } }
        .sheet(isPresented: $mfa, onDismiss: { if !pendingKey.isEmpty { cancel() } }) {
            NavigationStack {
                Form {
                    SecureField(recovery ? "恢复码" : "动态码", text: $factor)
                        .keyboardType(recovery ? .asciiCapable : .numberPad).textContentType(.oneTimeCode)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    if !error.isEmpty { Text(error).foregroundStyle(.red) }
                    Button("验证并登录") {
                        let value = factor.trimmingCharacters(in: .whitespacesAndNewlines)
                        login(pendingKey, otp: recovery ? nil : value, recoveryCode: recovery ? value : nil)
                    }.disabled(model.busy || factor.isEmpty)
                    Button(recovery ? "使用动态码" : "使用恢复码") { recovery.toggle(); factor = "" }
                }.navigationTitle("验证登录")
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { cancel() } } }
            }.interactiveDismissDisabled(model.busy)
        }
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
    @State private var changingLibrary = false
    @State private var forget = false
    var body: some View {
        List {
            if model.paired {
                Section { Button("更换资料库") { changingLibrary = true } }
                Section("当前设备") {
                    Text(model.deviceName); Text(model.serverName).font(.footnote)
                    Button("移除本机登录", role: .destructive) { forget = true }.disabled(model.busy)
                }
                ForEach(["desktop", "mobile", "browser", "integration", "unknown"], id: \.self) { category in
                    let devices = (model.snapshot?.devices ?? []).filter { $0.authorizationCategory == category }
                    if !devices.isEmpty || ["desktop", "mobile", "browser"].contains(category) {
                    Section("\(["desktop": "电脑客户端", "mobile": "移动端", "browser": "浏览器登录", "integration": "应用授权", "unknown": "待识别"][category] ?? category) · \(devices.count)") {
                    ForEach(devices) { device in
                        VStack(alignment: .leading, spacing: 6) {
                            Text((device.displayName ?? device.name) + (device.id == model.snapshot?.me.id ? " · 本机" : ""))
                            Text("\(device.name) · \(device.statusLabel)")
                                .font(.caption).foregroundStyle(.secondary)
                            if let model = device.deviceInfo?.model { Text(model).font(.caption).foregroundStyle(.secondary) }
                            if let version = device.deviceInfo?.client.version { Text("版本 \(version)").font(.caption).foregroundStyle(.secondary) }
                            if let identity = device.identity { Text("\(identity.sourceName) \(identity.shortId)").font(.caption).foregroundStyle(.secondary) }
                            if let seen = device.lastSeen { Text("最近活动：\(seen)").font(.caption).foregroundStyle(.secondary) }
                            if let expires = device.browserExpiresAt { Text("有效至：\(expires)").font(.caption).foregroundStyle(.secondary) }
                            if device.canDispatch { Text("Agent：\(device.agents?.joined(separator: " / ") ?? "无可用 Agent")").font(.caption).foregroundStyle(.secondary) }
                            if device.revokedAt == nil { Button("撤销设备", role: .destructive) { revoking = device }.disabled(model.busy) }
                        }
                    }
                    }
                    }
                }
            } else { PairingForm() }
            Section {
                Text("分享扩展仅做短时间发送尝试。离线或系统终止时，请回到发件箱重试；无需重新分享。电脑上的采集 Agent 负责分析与归档。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("帮助与隐私") {
                Link("使用帮助与联系支持", destination: URL(string: "https://library.inspirai.store/support")!)
                Link("隐私政策", destination: URL(string: "https://library.inspirai.store/privacy")!)
            }
        }.navigationTitle("设备与配对").refreshable { await model.refresh() }
        .sheet(isPresented: $changingLibrary) { NavigationStack { Form { PairingForm() }.navigationTitle("更换资料库") } }
        .confirmationDialog("撤销 \(revoking?.name ?? "") 的服务器访问？", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible) {
            if let device = revoking { Button("撤销设备", role: .destructive) { Task { await model.revoke(device) }; revoking = nil } }
        }
        .confirmationDialog("移除本机登录并关闭阅读会话？发件箱原文保留。", isPresented: $forget, titleVisibility: .visible) {
            Button("移除本机登录", role: .destructive) { model.forget() }
        }
    }
}
