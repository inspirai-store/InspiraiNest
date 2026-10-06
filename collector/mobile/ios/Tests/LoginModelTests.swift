import XCTest
@testable import PersonalLibrary

private final class LoginProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (code, data) = try Self.handler!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class LoginModelTests: XCTestCase {
    @MainActor private func model(saveCredential: @escaping (DeviceCredential) throws -> Void = { try CredentialStore().save($0) }) -> AppModel {
        AppModel(saveCredential: saveCredential) { origin, token in
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [LoginProtocol.self]
            return CollectorAPI(origin: origin, token: token, configuration: configuration)
        }
    }
    private let a = DeviceCredential(origin: "https://personal.invalid", deviceID: "11111111-1111-4111-8111-111111111111", name: "Fixture", token: "fixture-personal-token")
    private func reply(_ request: URLRequest, delay: Bool = false) throws -> (Int, Data) {
        if request.url?.path == "/api/device-policy" { return (404, Data()) }
        if request.url?.path != "/api/pair" { return (503, Data()) }
        if delay { Thread.sleep(forTimeInterval: 0.3) }
        return (201, try JSONSerialization.data(withJSONObject: ["token": "fixture-review-token", "device": ["id": "22222222-2222-4222-8222-222222222222", "name": "Review fixture", "role": "owner"]]))
    }
    @MainActor func testFailedAndCancelledSwitchPreserveOriginalCredential() async throws {
        let store = CredentialStore(); let previous = try store.load()
        let remembered = UserDefaults.standard.string(forKey: "lastSuccessfulOrigin")
        defer {
            LoginProtocol.handler = nil
            if let previous { try? store.save(previous) } else { try? store.clear() }
            UserDefaults.standard.set(remembered, forKey: "lastSuccessfulOrigin")
        }
        try store.save(a); let model = model()
        LoginProtocol.handler = { request in
            if request.url?.path == "/api/device-policy" { return (404, Data()) }
            return (401, Data("{\"code\":\"credential_invalid\"}".utf8))
        }
        do { try await model.login(server: "https://review.invalid", key: "wrong", name: "Fixture"); XCTFail("wrong password accepted") } catch {}
        XCTAssertEqual(try store.load()?.token, a.token); XCTAssertEqual(model.serverName, a.origin)
        LoginProtocol.handler = { try self.reply($0, delay: true) }
        let task = Task { try await model.login(server: "https://review.invalid", key: "fixture password", name: "Fixture") }
        try await Task.sleep(nanoseconds: 100_000_000); model.cancelLogin()
        do { try await task.value; XCTFail("late response committed") } catch {}
        XCTAssertEqual(try store.load()?.token, a.token); XCTAssertEqual(model.serverName, a.origin); XCTAssertFalse(model.busy)
    }
    @MainActor func testSuccessfulSwitchCommitsOneOriginAndRemembersOnlyAddress() async throws {
        let store = CredentialStore(); let previous = try store.load()
        let remembered = UserDefaults.standard.string(forKey: "lastSuccessfulOrigin")
        defer {
            LoginProtocol.handler = nil
            if let previous { try? store.save(previous) } else { try? store.clear() }
            UserDefaults.standard.set(remembered, forKey: "lastSuccessfulOrigin")
        }
        try store.save(a); let model = model(); let session = model.sessionID
        LoginProtocol.handler = { request in
            XCTAssertEqual(request.url?.host, "review.invalid")
            return try self.reply(request)
        }
        try await model.login(server: " HTTPS://REVIEW.INVALID:443/ ", key: "  fixture password  ", name: "Fixture")
        XCTAssertEqual(try store.load()?.origin, "https://review.invalid")
        XCTAssertEqual(model.lastServer, "https://review.invalid"); XCTAssertEqual(model.serverName, "https://review.invalid")
        XCTAssertNotEqual(model.sessionID, session); XCTAssertNil(model.snapshot); XCTAssertTrue(model.paired)
        XCTAssertFalse(model.busy)
    }

    @MainActor func testCredentialSaveFailureKeepsOldConnectionAndRememberedAddress() async throws {
        let store = CredentialStore(); let previous = try store.load()
        let remembered = UserDefaults.standard.string(forKey: "lastSuccessfulOrigin")
        defer {
            LoginProtocol.handler = nil
            if let previous { try? store.save(previous) } else { try? store.clear() }
            UserDefaults.standard.set(remembered, forKey: "lastSuccessfulOrigin")
        }
        try store.save(a); UserDefaults.standard.set(a.origin, forKey: "lastSuccessfulOrigin")
        let model = model(saveCredential: { _ in throw CollectorError.message("Fixture storage unavailable") })
        let session = model.sessionID; LoginProtocol.handler = { try self.reply($0) }
        do { try await model.login(server: "https://review.invalid", key: "fixture password", name: "Fixture"); XCTFail("Save failure accepted") } catch {}
        XCTAssertEqual(try store.load()?.token, a.token); XCTAssertEqual(model.serverName, a.origin)
        XCTAssertEqual(model.lastServer, a.origin); XCTAssertEqual(model.sessionID, session)
        XCTAssertTrue(model.paired); XCTAssertFalse(model.busy)
    }
}
