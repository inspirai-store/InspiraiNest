import Foundation
import UIKit

/// UI and review fixtures share the same state machine. Only the live adapter touches storage or credentials.
@MainActor
struct ShareDependencies {
  var capture: () async throws -> ShareCaptureResult
  var credential: () throws -> DeviceCredential?
  var cachedDevices: (String) throws -> [Device]
  var refreshDevices: (DeviceCredential) async throws -> [Device]
  var persist: (SavedShare, String?) throws -> Void
  var send: (String, DeviceCredential) async throws -> Bool
  var complete: () -> Void
  var cancel: () -> Void
  var openMainApp: (String) async -> Bool
  var saveComposition: ((LocalComposition) throws -> LocalComposition)? = nil

  static func live(context: NSExtensionContext?) -> Self {
    Self(
      capture: {
        guard let items = context?.inputItems as? [NSExtensionItem] else {
          throw CollectorError.message("无法读取分享内容。尚未保存。")
        }
        return try await ShareCapture.read(items)
      }, credential: { try CredentialStore().load() },
      cachedDevices: {
        try Outbox.shared().cachedDevices(origin: $0)
      },
      refreshDevices: { credential in
        let state = try await CollectorAPI(
          origin: credential.server, token: credential.token, timeout: 5
        ).state()
        guard state.me.role == "owner", state.me.id == credential.deviceID else {
          throw CollectorError.http(403)
        }
        try Outbox.shared().cacheDevices(state.devices, origin: credential.origin)
        return state.devices
      }, persist: { try Outbox.shared().insert($0, origin: $1) },
      send: { id, credential in
        let box = try Outbox.shared()
        try await OutboxSender.send(id: id, outbox: box, credential: credential, timeout: 10)
        return try box.list().first { $0.id == id }?.state == "submitted"
      }, complete: { context?.completeRequest(returningItems: nil, completionHandler: nil) },
      cancel: {
        context?.cancelRequest(
          withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
      },
      openMainApp: { destination in
        guard let context, let url = URL(string: "lingnest://" + destination) else { return false }
        return await withCheckedContinuation { continuation in
          context.open(url) { continuation.resume(returning: $0) }
        }
      }, saveComposition: { try Outbox.shared().saveComposition($0) })
  }
}
