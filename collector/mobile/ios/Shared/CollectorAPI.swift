import Foundation
import CryptoKit

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Refuse even same-origin redirects: credentials never follow a Location.
        completionHandler(nil)
    }
}

// Immutable after initialization; URLSession supports concurrent requests.
final class CollectorAPI: @unchecked Sendable {
    let origin: ServerOrigin
    private let token: String?
    private let session: URLSession
    init(origin: ServerOrigin, token: String? = nil, timeout: TimeInterval = 25,
         configuration: URLSessionConfiguration = .ephemeral) {
        self.origin = origin; self.token = token
        configuration.timeoutIntervalForRequest = min(timeout, 25)
        configuration.timeoutIntervalForResource = min(timeout, 25)
        configuration.waitsForConnectivity = false
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        var req = URLRequest(url: try origin.url(path))
        req.httpMethod = method; req.httpBody = body
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        let data: Data; let response: URLResponse
        do { (data, response) = try await session.data(for: req) }
        catch { throw CollectorError.message("网络请求未确认完成。已保存的记录可在主应用重试。") }
        guard let http = response as? HTTPURLResponse, let url = http.url, origin.contains(url) else {
            throw CollectorError.message("服务端响应地址无效。")
        }
        guard (200..<300).contains(http.statusCode) else {
            if path == "/api/pair", token == nil {
                let body = data.count <= 4096 ? (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] : nil
                let code = body?["code"] as? String ?? ""
                throw CollectorError.login(["mfa_required", "mfa_invalid", "credential_invalid"].contains(code) ? code : "", http.statusCode)
            }
            throw CollectorError.http(http.statusCode)
        }
        return (data, http)
    }
    private func decoded<T: Decodable>(_ type: T.Type, path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        let (data, _) = try await request(path, method: method, body: body)
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw CollectorError.message("响应格式不匹配。未确认提交，可使用相同提交 ID 重试。") }
    }
    func devicePolicy() async throws -> DevicePolicy? {
        do { return try await decoded(DevicePolicy.self, path: "/api/device-policy") }
        catch CollectorError.http(404) { return nil }
    }
    func skillEnvironment(deviceID: String, offset: Int = 0, snapshotID: String? = nil) async throws -> SkillEnvironmentPage {
        guard UUID(uuidString: deviceID) != nil, offset >= 0 else { throw CollectorError.message("节点编号无效。") }
        var path = "/api/skills/devices/\(deviceID)/environment?offset=\(offset)"
        if let snapshotID {
            guard snapshotID.count == 64, snapshotID.allSatisfy({ $0.isHexDigit }) else { throw CollectorError.message("清单编号无效。") }
            path += "&snapshotId=\(snapshotID)"
        }
        return try await decoded(SkillEnvironmentPage.self, path: path)
    }
    func pair(key: String, name: String, installationId: String? = nil, platform: String? = nil, system: String? = nil,
              identity: ScopedDeviceIdentity? = nil, deviceInfo: DeviceInformation? = nil,
              otp: String? = nil, recoveryCode: String? = nil) async throws -> DeviceCredential {
        guard !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, key.utf16.count <= 200,
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.utf16.count <= 100 else {
            throw CollectorError.message("请输入设备配对码或个人密钥，以及设备名称。")
        }
        var fields: [String: Any] = ["key": key, "name": name, "clientType": "ios"]
        if let otp { fields["otp"] = otp }
        if let recoveryCode { fields["recoveryCode"] = recoveryCode }
        if let installationId { fields["installationId"] = installationId }
        if let platform { fields["platform"] = platform }
        if let system { fields["system"] = system }
        if let identity { fields["identity"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(identity)) }
        if let deviceInfo { fields["deviceInfo"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(deviceInfo)) }
        let body = try JSONSerialization.data(withJSONObject: fields)
        let result = try await decoded(PairResponse.self, path: "/api/pair", method: "POST", body: body)
        guard result.device.role == "owner" else { throw CollectorError.message("配对权限不匹配，服务返回 worker 权限；请在客户端生成新的设备配对码。") }
        guard UUID(uuidString: result.device.id) != nil, !result.token.isEmpty,
              result.token != key, result.token.utf8.allSatisfy({ (33...126).contains($0) }) else {
            throw CollectorError.message("配对返回的设备凭据无效。")
        }
        return DeviceCredential(origin: origin.value, deviceID: result.device.id, name: result.device.name, token: result.token)
    }
    func updateDeviceInfo(installationId: String, system: String, identity: ScopedDeviceIdentity? = nil, deviceInfo: DeviceInformation? = nil) async throws {
        var fields: [String: Any] = ["installationId": installationId, "platform": "ios", "system": system, "clientType": "ios"]
        if let identity { fields["identity"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(identity)) }
        if let deviceInfo { fields["deviceInfo"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(deviceInfo)) }
        let body = try JSONSerialization.data(withJSONObject: fields)
        _ = try await request("/api/devices/me/info", method: "POST", body: body)
    }
    func state() async throws -> ServerState { try await decoded(ServerState.self, path: "/api/state") }
    func submit(_ submission: Submission) async throws -> LibraryTask {
        try submission.validateForSending()
        let task = try await decoded(LibraryTask.self, path: "/api/tasks", method: "POST", body: JSONEncoder().encode(submission))
        guard UUID(uuidString: task.id) != nil, task.submissionId == submission.submissionId else {
            throw CollectorError.message("服务端没有确认本条提交 ID；保留原记录等待重试。")
        }
        return task
    }
    private func identifier(_ value: String) throws -> String {
        guard UUID(uuidString: value) != nil else { throw CollectorError.message("服务端记录 ID 无效。") }; return value
    }
    func taskAction(_ id: String, action: String) async throws {
        guard ["retry", "cancel", "approve"].contains(action) else { throw CollectorError.message("任务操作无效。") }
        _ = try await request("/api/tasks/\(identifier(id))/\(action)", method: "POST", body: Data("{}".utf8))
    }
    func draft(_ id: String, expectedDigest: String) async throws -> DraftBundle {
        let (data, _) = try await request("/api/tasks/\(identifier(id))/draft")
        guard SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == expectedDigest else {
            throw CollectorError.message("草稿已变化，请刷新任务并重新读取后再确认。")
        }
        return try JSONDecoder().decode(DraftBundle.self, from: data)
    }
    func archive(_ digest: String) async throws -> DraftBundle {
        guard digest.count == 64, digest.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw CollectorError.message("归档 ID 无效。")
        }
        let (data, _) = try await request("/api/archives/" + digest)
        guard SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == digest else {
            throw CollectorError.message("归档内容校验失败。")
        }
        return try JSONDecoder().decode(DraftBundle.self, from: data)
    }
    func revoke(_ id: String) async throws {
        _ = try await request("/api/devices/\(identifier(id))/revoke", method: "POST", body: Data("{}".utf8))
    }
    func libraryCookie() async throws -> HTTPCookie {
        let (_, response) = try await request("/api/library-session", method: "POST", body: Data("{}".utf8))
        guard let header = response.value(forHTTPHeaderField: "Set-Cookie") else { throw CollectorError.message("服务器没有返回阅读会话。") }
        return try Self.validatedCookie(header, origin: origin)
    }
    static func validatedCookie(_ header: String, origin: ServerOrigin) throws -> HTTPCookie {
        let attributes = header.split(separator: ";").dropFirst().map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
        guard !attributes.contains(where: { $0.hasPrefix("domain=") }),
              attributes.contains("httponly"), attributes.contains("secure"), attributes.contains("samesite=strict"),
              let cookie = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: try origin.url("/api/library-session")).first,
              cookie.name == "library_session", cookie.path == "/library/", cookie.isSecure, cookie.isHTTPOnly,
              !cookie.value.isEmpty, cookie.domain.lowercased() == (try origin.url("/")).host?.lowercased() else {
            throw CollectorError.message("阅读会话的安全属性不符合约定。")
        }
        return cookie
    }
}

enum OutboxSender {
    /// Lease protects against concurrent extension/app sends. A timeout can mean
    /// accepted remotely; never mutate the payload or generate a replacement UUID.
    static func send(id: String, outbox: Outbox, credential: DeviceCredential, timeout: TimeInterval = 25) async throws {
        guard let item = try outbox.list().first(where: { $0.id == id }) else { throw CollectorError.message("找不到本地记录。") }
        guard item.origin == credential.origin else { throw CollectorError.message("这条记录未绑定当前服务器，请在发件箱查看。") }
        guard let lease = try outbox.claim(id: id, origin: credential.origin) else { return }
        do {
            let api = CollectorAPI(origin: try credential.server, token: credential.token, timeout: timeout)
            let task = try await api.submit(item.share.submission)
            try outbox.finish(id: id, lease: lease, taskID: task.id)
        } catch {
            let blocked: Bool
            if case CollectorError.http(let status) = error { blocked = [400, 403, 409, 413, 422].contains(status) }
            else {
                do { try item.share.submission.validateForSending(); blocked = false }
                catch { blocked = true }
            }
            try outbox.finish(id: id, lease: lease, blocked: blocked, message: safeMessage(error))
            throw error
        }
    }
}
