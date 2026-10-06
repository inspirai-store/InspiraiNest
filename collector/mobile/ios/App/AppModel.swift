import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var paired = false
    @Published private(set) var serverName = ""
    @Published private(set) var deviceName = ""
    @Published private(set) var snapshot: ServerState?
    @Published private(set) var items: [OutboxItem] = []
    @Published private(set) var sessionID = UUID()
    @Published private(set) var busy = false
    @Published private(set) var lastRefresh: Date?
    @Published var notice: String?
    private var refreshing = false
    private var reportedDeviceID: String?
    private let credentials = CredentialStore()
    private let saveCredential: (DeviceCredential) throws -> Void
    private let makeAPI: (ServerOrigin, String?) -> CollectorAPI
    private var loginGeneration = 0
    private var loginActive = false
    var lastServer: String { UserDefaults.standard.string(forKey: "lastSuccessfulOrigin") ?? serverName }
    func cancelLogin() { loginGeneration += 1; if loginActive { loginActive = false; busy = false } }

    init(saveCredential: @escaping (DeviceCredential) throws -> Void = { try CredentialStore().save($0) }, makeAPI: @escaping (ServerOrigin, String?) -> CollectorAPI = { CollectorAPI(origin: $0, token: $1) }) { self.makeAPI = makeAPI; self.saveCredential = saveCredential; reloadLocal() }
    func reloadLocal() {
        do {
            let credential = try credentials.load()
            paired = credential != nil
            serverName = credential?.origin ?? ""; deviceName = credential?.name ?? ""
            items = try Outbox.shared().list()
        } catch { notice = safeMessage(error) }
    }
    func client() throws -> CollectorAPI {
        guard let credential = try credentials.load() else { throw CollectorError.message("请先使用 owner 配对码配对。") }
        return makeAPI(try credential.server, credential.token)
    }
    func pair(server: String, key: String, name: String) async {
        do { try await login(server: server, key: key, name: name) }
        catch { notice = safeMessage(error) }
    }
    func login(server: String, key: String, name: String, otp: String? = nil, recoveryCode: String? = nil) async throws {
        guard !busy else { throw CollectorError.message("登录正在进行。") }
        busy = true; loginActive = true; notice = nil; loginGeneration += 1; let attempt = loginGeneration
        defer { if loginGeneration == attempt { busy = false; loginActive = false } }
        let api = makeAPI(try ServerOrigin(server), nil)
        let scoped = try DeviceIdentity.scoped(await api.devicePolicy())
        guard attempt == loginGeneration, !Task.isCancelled else { throw CancellationError() }
        let credential = try await api.pair(key: key, name: name, installationId: try DeviceIdentity.id(), platform: "ios", system: DeviceIdentity.system,
            identity: scoped, deviceInfo: DeviceIdentity.information, otp: otp, recoveryCode: recoveryCode)
        guard attempt == loginGeneration, !Task.isCancelled else { throw CancellationError() }
        try saveCredential(credential)
        UserDefaults.standard.set(credential.origin, forKey: "lastSuccessfulOrigin")
        sessionID = UUID(); snapshot = nil; lastRefresh = nil
        reloadLocal()
        await refresh()
    }
    func refresh() async {
        reloadLocal()
        guard paired, !refreshing else { return }
        refreshing = true; let generation = sessionID
        defer { refreshing = false }
        do {
            var identityNotice: String?
            if let credential = try credentials.load(), reportedDeviceID != credential.deviceID {
                do {
                    let api = try client()
                    let scoped = try DeviceIdentity.scoped(await api.devicePolicy())
                    try await api.updateDeviceInfo(installationId: DeviceIdentity.id(), system: DeviceIdentity.system, identity: scoped, deviceInfo: DeviceIdentity.information)
                    reportedDeviceID = credential.deviceID
                } catch {
                    identityNotice = "设备标识暂未补齐；若身份冲突，请检查授权后重新配对。"
                }
            }
            let result = try await client().state()
            guard generation == sessionID, !Task.isCancelled else { return }
            guard result.me.role == "owner", result.me.revokedAt == nil else { throw CollectorError.http(403) }
            snapshot = result; lastRefresh = Date()
            notice = identityNotice
            try Outbox.shared().cacheDevices(result.devices, origin: serverName)
        } catch {
            guard generation == sessionID, !Task.isCancelled else { return }
            if case CollectorError.http(401) = error {
                invalidateViews()
                try? credentials.clear()
                paired = false; serverName = ""; deviceName = ""
            }
            notice = safeMessage(error)
        }
    }
    private func invalidateViews() {
        sessionID = UUID(); snapshot = nil; lastRefresh = nil
    }
    func forget() {
        guard !busy else { return }
        do {
            try credentials.clear(); invalidateViews(); reloadLocal()
            notice = "已移除本机登录。发件箱原文保留；此操作不撤销服务器上的设备。"
        } catch { notice = safeMessage(error) }
    }
    func send(_ item: OutboxItem, bindUnassigned: Bool = false) async {
        guard !busy else { return }; busy = true; notice = nil
        defer { busy = false; reloadLocal() }
        do {
            guard let credential = try credentials.load() else { throw CollectorError.message("请先配对。原文仍在发件箱。") }
            let box = try Outbox.shared()
            if bindUnassigned { try box.bindUnassigned(id: item.id, origin: credential.origin) }
            try await OutboxSender.send(id: item.id, outbox: box, credential: credential)
            let result = try box.list().first { $0.id == item.id }
            notice = result?.state == "submitted" ? "服务器已确认提交。" : "记录仍在发件箱，可能由分享扩展发送中。"
            await refresh()
        } catch { notice = safeMessage(error) }
    }
    func retryQueued() async {
        // Explicit user action; no periodic retry storm on validation/auth errors.
        let candidates = items.filter { $0.origin == serverName && $0.state == "queued" && !$0.leased }
        for item in candidates {
            if Task.isCancelled { break }
            await send(item)
            if items.first(where: { $0.id == item.id })?.state != "submitted" { break }
        }
    }
    func action(_ task: LibraryTask, _ action: String) async {
        guard !busy else { return }; busy = true; notice = nil
        defer { busy = false }
        do { try await client().taskAction(task.id, action: action); await refresh() }
        catch { notice = safeMessage(error) }
    }
    func revoke(_ device: Device) async {
        guard !busy else { return }; busy = true; notice = nil
        defer { busy = false }
        do {
            let ownID = try credentials.load()?.deviceID
            try await client().revoke(device.id)
            if device.id == ownID {
                // Tear down reader even if a Keychain removal subsequently fails.
                invalidateViews(); try credentials.clear(); reloadLocal()
            } else { await refresh() }
        } catch { notice = safeMessage(error) }
    }
}
