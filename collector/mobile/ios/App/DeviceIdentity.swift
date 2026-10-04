import Foundation
import Security
import UIKit
import CryptoKit

enum DeviceIdentity {
    private static let service = "store.inspirai.library.installation"

    static func id() throws -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: "device",
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data,
           let value = String(data: data, encoding: .utf8), UUID(uuidString: value) != nil { return value }
        guard status == errSecItemNotFound else { throw CollectorError.message("无法读取本机设备标识。") }
        let value = UUID().uuidString.lowercased()
        var item = query
        item.removeValue(forKey: kSecReturnData as String)
        item.removeValue(forKey: kSecMatchLimit as String)
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw CollectorError.message("无法保存本机设备标识。") }
        return value
    }

    static var system: String { "\(UIDevice.current.model) · iOS \(UIDevice.current.systemVersion)" }
    static var information: DeviceInformation {
        DeviceInformation(os: .init(family: "iOS", version: UIDevice.current.systemVersion),
            client: .init(type: "ios", name: "InspiraiNest", version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String),
            model: UIDevice.current.model)
    }
    static func scoped(_ policy: DevicePolicy?) throws -> ScopedDeviceIdentity? {
        guard let policy else { return nil }
        return try scoped(policy, installationID: id())
    }

    static func scoped(_ policy: DevicePolicy, installationID: String) throws -> ScopedDeviceIdentity {
        guard policy.version == 2, UUID(uuidString: policy.namespace) != nil else { throw CollectorError.message("设备身份策略无效。") }
        let input = "\(policy.namespace)\nkeychain\n\(installationID)"
        let digest = SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
        return ScopedDeviceIdentity(version: 2, namespace: policy.namespace, source: "keychain", digest: digest)
    }
}
