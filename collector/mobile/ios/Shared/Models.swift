import Foundation

enum CollectorError: Error, LocalizedError, Sendable {
    case message(String)
    case http(Int)
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
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
