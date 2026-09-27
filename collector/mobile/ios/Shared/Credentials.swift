import Foundation
import Security

enum SharedConfiguration {
    static func value(_ name: String) throws -> String {
        guard let value = Bundle.main.object(forInfoDictionaryKey: name) as? String,
              !value.isEmpty, !value.contains("$(") else { throw CollectorError.message("App Group / Keychain 签名配置缺失。") }
        return value
    }
    static func container() throws -> URL {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: try value("CollectorAppGroup")) else {
            throw CollectorError.message("无法打开共享容器。请检查主应用和分享扩展的 App Group 签名。")
        }
        return url
    }
}

/// The single atomic Keychain item contains only the enrolled device credential.
/// Pairing/master keys are never persisted. No UserDefaults / cloud sync / logs.
struct DeviceCredential: Codable, Sendable {
    let origin: String
    let deviceID: String
    let name: String
    let token: String
    var server: ServerOrigin { get throws { try ServerOrigin(origin) } }
}

struct CredentialStore: Sendable {
    private func query() throws -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "PersonalLibrary.device-owner.v1",
         kSecAttrAccount as String: "active-owner",
         kSecAttrAccessGroup as String: try SharedConfiguration.value("CollectorKeychainGroup"),
         kSecAttrSynchronizable as String: false]
    }
    func load() throws -> DeviceCredential? {
        var q = try query(); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw CollectorError.message("无法读取共享 Keychain，请解锁设备并检查签名。") }
        let credential = try JSONDecoder().decode(DeviceCredential.self, from: data)
        _ = try credential.server
        guard !credential.token.isEmpty, !credential.token.contains(where: { $0.isWhitespace || $0.isNewline }),
              UUID(uuidString: credential.deviceID) != nil else { throw CollectorError.message("设备凭据损坏，请重新配对。") }
        return credential
    }
    func save(_ credential: DeviceCredential) throws {
        let data = try JSONEncoder().encode(credential)
        let q = try query()
        let attrs: [String: Any] = [kSecValueData as String: data,
                                   kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(q as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            let add = q.merging(attrs) { _, new in new }
            guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw CollectorError.message("无法保存共享 Keychain 凭据，请检查签名。配对码可能已经消耗。") }
        } else if status != errSecSuccess { throw CollectorError.message("无法更新共享 Keychain 凭据。") }
    }
    func clear() throws {
        let status = SecItemDelete(try query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CollectorError.message("无法移除设备凭据。") }
    }
}
