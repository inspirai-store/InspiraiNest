import SwiftUI
import UIKit

@MainActor
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareView(model: model))
        addChild(host); view.addSubview(host.view); host.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor), host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        host.didMove(toParent: self)
    }
}

@MainActor
final class ShareModel: ObservableObject {
    @Published var parts: [SharedPart] = []
    @Published var requirements = ""
    @Published var autoArchive = true
    @Published var tags = ""
    @Published var loading = true
    @Published var saving = false
    @Published var saved = false
    @Published var message: String?
    @Published var captureNotice: String?
    @Published var captureFailed = false
    @Published var agent = ""
    @Published var deviceID = ""
    @Published var devices: [Device] = []
    @Published var dispatchNotice = "电脑与 Agent 默认自动选择。"
    @Published var loadingDevices = false
    private let context: NSExtensionContext?
    private let submissionID = UUID()
    private var finished = false
    private var dispatchOrigin: String?
    init(context: NSExtensionContext?) { self.context = context }
    func capture() async {
        loading = true; captureFailed = false; message = nil; captureNotice = nil
        defer { loading = false }
        do {
            guard let items = context?.inputItems as? [NSExtensionItem] else { throw CollectorError.message("无法读取分享内容。尚未保存。") }
            let captured = try await ShareCapture.read(items)
            parts = captured.parts
            if captured.omittedAttachments > 0 {
                captureNotice = "已读取下方文字与链接；另有 \(captured.omittedAttachments) 份图片、视频或其他附件未收录。请核对原文后保存。"
            }
        } catch { captureFailed = true; message = safeMessage(error) }
    }
    func save() async {
        guard !saving, !saved, !loading, !captureFailed else { return }
        saving = true
        defer { saving = false }
        do {
            let outbox = try Outbox.shared()
            // A locked/unavailable Keychain does not prevent durable capture.
            // Unbound items require explicit binding in the main application.
            let credential = try? CredentialStore().load()
            // A credential disappearing mid-sheet must never discard a chosen
            // device or the original share. Pin to the origin whose options were
            // displayed, then leave it queued if the current credential differs.
            let savedOrigin = dispatchOrigin ?? credential?.origin
            let submission = Submission(id: submissionID, parts: parts, requirements: requirements,
                                        autoArchive: autoArchive, tags: Submission.tags(from: tags),
                                        deviceId: deviceID.isEmpty ? nil : deviceID, agent: agent.isEmpty ? nil : agent)
            try outbox.insert(SavedShare(submission: submission, originalParts: parts,
                                        additionalRequirements: requirements, createdAt: Date()), origin: savedOrigin)
            saved = true // Only after SQLite COMMIT succeeds.
            message = "完整原文已保存到本机发件箱，尚未确认提交。"
            if let credential, credential.origin == savedOrigin {
                do {
                    try await OutboxSender.send(id: submission.submissionId, outbox: outbox, credential: credential, timeout: 10)
                    let record = try outbox.list().first { $0.id == submission.submissionId }
                    message = record?.state == "submitted" ? "已提交到服务器，可在主应用查看任务进度。" : "已保存到本机，打开主应用重试提交。"
                } catch { message = "已保存到本机发件箱。" + safeMessage(error) }
            } else { message = "已保存到本机，尚未提交。请打开主应用配对，在发件箱查看绑定服务器并重试。" }
        } catch { message = safeMessage(error) }
    }
    func loadDevices() async {
        guard !loadingDevices else { return }; loadingDevices = true
        defer { loadingDevices = false }
        do {
            guard let credential = try CredentialStore().load() else {
                dispatchNotice = "尚未配对。完整分享仍可保存；配对后在主应用确认服务器并提交。"; return
            }
            let box = try Outbox.shared()
            let cached = try box.cachedDevices(origin: credential.origin)
            devices = cached.filter { $0.role == "worker" && $0.revokedAt == nil }
            dispatchOrigin = credential.origin
            dispatchNotice = "显示缓存电脑列表；正在刷新。离线仍保留你的选择。"
            let state = try await CollectorAPI(origin: credential.server, token: credential.token, timeout: 5).state()
            guard state.me.role == "owner", state.me.id == credential.deviceID else { throw CollectorError.http(403) }
            try box.cacheDevices(state.devices, origin: credential.origin)
            devices = state.devices.filter { $0.role == "worker" && $0.revokedAt == nil }
            dispatchNotice = "电脑在线状态来自最近一次刷新。指定电脑离线时任务会等待，不会自动换机。"
        } catch { dispatchNotice = "电脑列表未能刷新，保留缓存与当前选择。自动派发仍可用。" }
    }
    func close() {
        guard saved, !saving, !finished else { return }; finished = true
        context?.completeRequest(returningItems: nil, completionHandler: nil)
    }
    func cancel() {
        guard !saved, !saving, !finished else { return }; finished = true
        context?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }
}

struct ShareView: View {
    @ObservedObject var model: ShareModel
    var body: some View {
        NavigationStack {
            Form {
                if model.loading { ProgressView("正在读取全部分享内容…") }
                if let message = model.message { Section { Text(message).accessibilityIdentifier("share.status") } }
                if let notice = model.captureNotice { Section { Text(notice).accessibilityIdentifier("share.captureNotice") } }
                if model.captureFailed { Button("重新读取完整分享内容") { Task { await model.capture() } } }
                Section("分享原文 · 不可改写") {
                    ForEach(Array(model.parts.enumerated()), id: \.offset) { _, part in
                        VStack(alignment: .leading) {
                            Text(part.kind).font(.caption).foregroundStyle(.secondary)
                            Text(verbatim: part.value).textSelection(.enabled)
                        }
                    }
                }
                if !model.saved {
                    Section("附加要求 · 追加在原文之后") {
                        TextEditor(text: $model.requirements).frame(minHeight: 90).accessibilityLabel("附加要求")
                        Toggle("自动归档", isOn: $model.autoArchive)
                        TextField("标签（逗号分隔，可留空）", text: $model.tags)
                        Text("原文与附加要求分别保存在本机；资料类型自动识别。")
                            .font(.footnote).foregroundStyle(.secondary)
                        DisclosureGroup("高级派发选项") {
                            Picker("采集电脑", selection: $model.deviceID) {
                                Text("自动").tag("")
                                ForEach(model.devices) { device in
                                    Text(device.name + (device.online == true ? "" : "（离线 / 缓存）")).tag(device.id)
                                }
                                if !model.deviceID.isEmpty && !model.devices.contains(where: { $0.id == model.deviceID }) {
                                    Text("已选择的电脑（当前列表不可用）").tag(model.deviceID)
                                }
                            }
                            Picker("Agent", selection: $model.agent) {
                                Text("自动").tag("")
                                Text("Codex").tag("codex")
                                Text("CodeBuddy").tag("codebuddy")
                            }
                            Text(model.dispatchNotice).font(.caption).foregroundStyle(.secondary)
                            Button(model.loadingDevices ? "刷新中…" : "刷新电脑列表") { Task { await model.loadDevices() } }
                                .disabled(model.loadingDevices)
                        }
                    }.disabled(model.saving)
                    Button(model.saving ? "已保存后尝试发送…" : "保存并尝试提交") { Task { await model.save() } }
                        .disabled(model.loading || model.saving || model.captureFailed)
                }
            }
            .navigationTitle("收集到资料库")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if !model.saved { Button("取消") { model.cancel() }.disabled(model.saving) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.saved { Button("完成") { model.close() }.disabled(model.saving) }
                }
            }
        }.task { await model.capture() }
            .task { await model.loadDevices() }
    }
}
