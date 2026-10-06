import Foundation

enum CollectorError: Error, LocalizedError, Sendable {
    case message(String)
    case http(Int)
    case login(String, Int)
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        case .login("mfa_required", _): return "请输入认证器动态码或恢复码。"
        case .login("mfa_invalid", _): return "动态码或恢复码无效，请重试。"
        case .login("credential_invalid", _), .login(_, 401): return "登录密码或配对码不正确。"
        case .login(_, 429): return "验证过于频繁，请稍后重试。"
        case .login(_, 410): return "此资料库已停止提供服务。"
        case .login(_, 409): return "设备身份冲突，请检查已有授权。"
        case .login: return "无法登录此资料库，请检查地址和服务状态。"
        case .http(401): return "设备授权已失效，请重新配对；本地原文仍已保存。"
        case .http(403): return "需要 owner 管理端权限。"
        case .http(409): return "服务端状态冲突。请刷新任务；不要更换提交 ID 重发。"
        case .http(429): return "请求过于频繁，请稍后重试。"
        case .http(let code): return "服务端返回 HTTP \(code)。本地记录仍保留。"
        }
    }
}

/// Only fixed, sanitized errors reach UI/outbox. Never reflect URLSession errors,
/// HTTP bodies, headers, credentials, or server-controlled authentication text.
func safeMessage(_ error: Error) -> String {
    (error as? CollectorError)?.errorDescription ?? "连接或本地操作未完成，请检查网络、设备解锁状态后重试。"
}

struct ServerOrigin: Codable, Equatable, Sendable {
    let value: String
    init(_ input: String) throws {
        let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.contains("\\"), !raw.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              var c = URLComponents(string: raw), c.scheme?.lowercased() == "https",
              let host = c.host, !host.isEmpty, c.user == nil, c.password == nil,
              c.query == nil, c.fragment == nil, c.path.isEmpty || c.path == "/",
              c.port == nil || (1...65535).contains(c.port!), c.url != nil else {
            throw CollectorError.message("服务器必须是有效 HTTPS 根地址，不含账号、路径、查询或片段。")
        }
        c.scheme = "https"; c.host = host.lowercased(); c.path = ""
        if c.port == 443 { c.port = nil }
        guard let normalized = c.url?.absoluteString else { throw CollectorError.message("服务器地址无效。") }
        value = normalized
    }
    func url(_ path: String) throws -> URL {
        guard path.hasPrefix("/"), !path.hasPrefix("//"),
              let url = URL(string: value + path), contains(url) else { throw CollectorError.message("请求地址无效。") }
        return url
    }
    func contains(_ url: URL) -> Bool {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let base = URLComponents(string: value) else { return false }
        return c.scheme?.lowercased() == "https" && c.host?.lowercased() == base.host?.lowercased()
            && (c.port ?? 443) == (base.port ?? 443) && c.user == nil && c.password == nil
    }
}

struct SharedPart: Codable, Equatable, Sendable {
    let item: Int
    let attachment: Int?
    let kind: String
    let representation: String?
    let value: String
}

struct Submission: Codable, Equatable, Sendable {
    let submissionId: String
    let content: String
    let type: String
    let autoArchive: Bool
    let tags: [String]
    let deviceId: String?
    let agent: String?

    init(id: UUID, parts: [SharedPart], requirements: String, autoArchive: Bool = true,
         tags: [String] = [], deviceId: String? = nil, agent: String? = nil) {
        submissionId = id.uuidString.lowercased()
        // Every original value is kept verbatim, including repeated values, leading
        // whitespace, multiple URLs and query strings. No URL extraction/rewrite.
        let original = parts.map(\.value).joined(separator: "\n\n")
        content = original + (requirements.isEmpty ? "" : "\n\n【附加要求】\n" + requirements)
        type = "auto"; self.autoArchive = autoArchive; self.tags = tags
        self.deviceId = deviceId; self.agent = agent
    }
    func validateForSending() throws {
        guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CollectorError.message("没有可提交的文字或链接。")
        }
        guard content.utf16.count <= 10_000 else {
            throw CollectorError.message("完整内容超过服务端 10,000 UTF-16 单元限制。原文已保存，未截断，也未提交。")
        }
        guard tags.count <= 20, tags.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf16.count <= 60 }) else {
            throw CollectorError.message("最多 20 个标签，每个最多 60 UTF-16 单元。")
        }
        guard agent == nil || ["codex", "codebuddy"].contains(agent!) else { throw CollectorError.message("Agent 设置无效。") }
        guard try JSONEncoder().encode(self).count <= 96 * 1024 else { throw CollectorError.message("请求超过服务端 96 KiB 限制；完整内容仍在本地。") }
    }
    static func tags(from input: String) -> [String] {
        var seen = Set<String>()
        return input.components(separatedBy: CharacterSet(charactersIn: ",，\n"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}

struct SavedShare: Codable, Equatable, Sendable {
    let submission: Submission
    let originalParts: [SharedPart]
    let additionalRequirements: String
    let createdAt: Date
}

struct OutboxItem: Identifiable, Sendable {
    let id: String
    let share: SavedShare
    let origin: String?
    let state: String
    let attempts: Int
    let taskID: String?
    let message: String?
    let leaseUntil: Double?
    var leased: Bool { (leaseUntil ?? 0) > Date().timeIntervalSince1970 }
    var statusLabel: String {
        if state == "submitted" { return "已提交到服务器" }
        if leased { return "发送中（原文已保存）" }
        if origin == nil { return "已保存，待选择服务器" }
        return state == "blocked" ? "已保存，需要处理" : "已保存，尚未确认提交"
    }
}

struct Device: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let role: String
    let revokedAt: String?
    let online: Bool?
    let agents: [String]?
    var displayName: String? = nil
    var deviceInfo: DeviceInformation? = nil
    var identity: DeviceIdentitySummary? = nil
    var lastSeen: String? = nil
    var category: String? = nil
    var workerAuthorized: Bool? = nil
    var readyForDispatch: Bool? = nil
    var browserExpiresAt: String? = nil
    var loggedOutAt: String? = nil
    var capabilities: [String]? = nil
    var environment: SkillEnvironmentSummary? = nil
    var authorizationCategory: String {
        if let category { return category }
        if role == "reader" { return "integration" }
        if role == "worker" || ["worker", "desktop"].contains(deviceInfo?.client.type ?? "") { return "desktop" }
        if ["android", "ios"].contains(deviceInfo?.client.type ?? "") { return "mobile" }
        return deviceInfo?.client.type == "web" ? "browser" : "unknown"
    }
    var canDispatch: Bool { revokedAt == nil && authorizationCategory == "desktop" && (workerAuthorized ?? (role == "worker")) }
    var statusLabel: String {
        if revokedAt != nil { return "已撤销" }
        if authorizationCategory == "browser" {
            if loggedOutAt != nil { return "已退出" }
            let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let browserExpiresAt, let expires = parser.date(from: browserExpiresAt), expires <= Date() { return "已过期" }
            return "已登录"
        }
        if authorizationCategory == "integration" { return "只读授权" }
        if authorizationCategory == "mobile" { return "已登录" }
        if authorizationCategory != "desktop" { return "待识别" }
        if !canDispatch { return "未启用工作节点" }
        if online != true { return "工作节点离线" }
        if agents?.isEmpty != false { return "无可用 Agent" }
        return capabilities?.isEmpty != false ? "未启用处理能力" : "工作节点在线"
    }
}

struct SkillAgent: Codable, Sendable { let name: String; let installed: Bool; let version: String? }
struct SkillEnvironmentSummary: Codable, Sendable { let schemaVersion: Int; let scannedAt: String; let count: Int; let agents: [SkillAgent]; let verifiedCount: Int }
struct SkillDependencies: Codable, Sendable { let state: String; let missing: [String]; let unknown: [String] }
struct SkillVerification: Codable, Sendable { let state: String; let at: String? }
struct NodeSkill: Codable, Identifiable, Sendable {
    let id: String; let agent: String; let name: String; let description: String?
    let declaredVersion: String?; let hash: String?; let source: String?; let context: String?
    let enabled: Bool?; let loadState: String; let dependencies: SkillDependencies
    let capabilities: [String]; let verification: SkillVerification?; let issue: String?
    var agentLabel: String { ["codex":"Codex","codebuddy":"CodeBuddy","claude":"Claude Code"][agent] ?? agent }
    var loadLabel: String { ["loaded":"可加载","configured":"已配置","unknown":"加载未确认","disabled":"已禁用","not_loaded":"未加载","shadowed":"被覆盖","agent_unavailable":"Agent 未安装"][loadState] ?? loadState }
}
struct SkillEnvironmentPage: Codable, Sendable {
    let schemaVersion: Int; let items: [NodeSkill]; let agents: [SkillAgent]; let total: Int
    let nextOffset: Int?; let snapshotId: String?; let scannedAt: String?
}
struct DevicePolicy: Codable, Sendable { let version: Int; let namespace: String }
struct ScopedDeviceIdentity: Codable, Sendable, Equatable { let version: Int; let namespace: String; let source: String; let digest: String }
struct DeviceIdentitySummary: Codable, Sendable {
    let source: String
    let shortId: String
    var sourceName: String {
        switch source {
        case "smbios", "ioplatform": return "硬件标识"
        case "android-id": return "系统标识"
        case "keychain": return "Keychain 标识"
        case "browser-profile": return "浏览器档案"
        default: return "本地标识"
        }
    }
}
struct DeviceInformation: Codable, Sendable {
    struct OperatingSystem: Codable, Sendable { let family: String; var version: String? = nil; var build: String? = nil }
    struct Client: Codable, Sendable { let type: String; var name: String? = nil; var version: String? = nil }
    let os: OperatingSystem
    let client: Client
    var model: String? = nil
}
struct TaskEvent: Codable, Sendable { let at: String; let state: String; let message: String }
struct LibraryTask: Codable, Identifiable, Sendable {
    let id: String
    let submissionId: String?
    let content: String?
    let url: String?
    let state: String
    let events: [TaskEvent]?
    let deviceId: String?
    let archiveId: String?
    let draftId: String?
    let createdAt: String
    var title: String { content ?? url ?? id }
    var canRetry: Bool { ["waiting_action", "failed"].contains(state) }
    var canCancel: Bool { !["completed", "cancelled"].contains(state) }
    var stateLabel: String {
        ["queued": "待分配", "assigned": "已分配", "running": "处理中", "uploading": "上传中",
         "waiting_action": "待电脑操作", "awaiting_review": "待确认归档", "failed": "失败",
         "completed": "已完成", "cancelled": "已取消"][state] ?? state
    }
}
struct ArchiveRecord: Decodable, Identifiable, Sendable {
    struct Meta: Decodable, Sendable { let title: String }
    let id: String; let entryId: String; let meta: Meta; let createdAt: String
}
struct ServerState: Decodable, Sendable {
    let me: Device; let devices: [Device]; let tasks: [LibraryTask]; let archives: [ArchiveRecord]
}
struct PairResponse: Decodable, Sendable { let device: Device; let token: String }
struct DraftBundle: Decodable, Sendable {
    struct Meta: Decodable, Sendable { let title: String; let summary: String; let coverage_note: String; let status: String }
    struct File: Decodable, Identifiable, Sendable {
        let path: String; let role: String; let body: String; let bytes: Int; let sha256: String
        var id: String { path }
    }
    let meta: Meta
    let files: [File]
    let omitted: [String]?
}
