import Foundation

struct PairingQRCode: Equatable {
    let server: String
    let key: String
    let expiresAt: Date?
    init(server: String, key: String, expiresAt: Date? = nil) { self.server=server; self.key=key; self.expiresAt=expiresAt }

    private struct Payload: Decodable {
        let `protocol`: String
        let version: Int
        let server: String
        let key: String
        let role: String
        let expiresAt: String
    }

    static func parse(_ raw: String, now: Date = Date()) throws -> Self {
        guard raw.utf8.count <= 4096,
              let payload = try? JSONDecoder().decode(Payload.self, from: Data(raw.utf8)),
              payload.protocol == "personal-library-pairing", payload.version == 1 else {
            throw QRPairingError.invalid
        }
        guard payload.role == "owner" else { throw QRPairingError.worker }
        guard (32...200).contains(payload.key.utf8.count),
              payload.key.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }),
              let origin = try? ServerOrigin(payload.server) else { throw QRPairingError.invalid }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expiry = formatter.date(from: payload.expiresAt)
            ?? ISO8601DateFormatter().date(from: payload.expiresAt)
        guard let expiry else { throw QRPairingError.invalid }
        guard expiry > now else { throw QRPairingError.expired }
        return Self(server: origin.value, key: payload.key, expiresAt: expiry)
    }
}

enum QRPairingError: LocalizedError {
    case invalid, worker, expired

    var errorDescription: String? {
        switch self {
        case .invalid: return "这不是有效的资料库设备配对二维码。"
        case .worker: return "请在网页生成新的设备配对二维码。"
        case .expired: return "配对二维码已过期，请在网页重新生成。"
        }
    }
}

