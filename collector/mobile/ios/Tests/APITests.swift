import XCTest
@testable import PersonalLibrary

private final class StubProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (code, body) = try Self.handler!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class APITests: XCTestCase {
    func testNodeSkillsPageUsesAuthenticatedOriginAndKeepsUnknownLoadingDistinct() async throws {
        let deviceID = "00000000-0000-4000-8000-000000000001"
        let snapshot = String(repeating: "a", count: 64)
        StubProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/skills/devices/\(deviceID)/environment")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-owner")
            XCTAssertTrue(request.url!.query!.contains("offset=40"))
            XCTAssertTrue(request.url!.query!.contains("snapshotId=\(snapshot)"))
            return (200, Data("""
            {"schemaVersion":1,"agents":[],"items":[{"id":"fixture","agent":"codex","name":"wechat-fixture","loadState":"unknown","dependencies":{"state":"missing","missing":["Python 模块：requests"],"unknown":[]},"capabilities":[],"verification":null}],"total":41,"nextOffset":null,"snapshotId":"\(snapshot)","scannedAt":"2026-10-07T00:00:00Z"}
            """.utf8))
        }
        let page = try await api(token: "fixture-owner").skillEnvironment(deviceID: deviceID, offset: 40, snapshotID: snapshot)
        XCTAssertEqual(page.total, 41); XCTAssertNil(page.nextOffset)
        XCTAssertEqual(page.items.first?.loadLabel, "加载未确认")
        XCTAssertNil(page.items.first?.verification)
        XCTAssertEqual(page.items.first?.dependencies.missing, ["Python 模块：requests"])
    }
    override func tearDown() { StubProtocol.handler = nil }
    private func api(token: String? = nil) throws -> CollectorAPI {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        return CollectorAPI(origin: try ServerOrigin("https://fixture.invalid"), token: token, configuration: config)
    }
    private func requestBody(_ request: URLRequest) -> Data {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var result = Data(); var bytes = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&bytes, maxLength: bytes.count)
            if count <= 0 { break }; result.append(contentsOf: bytes.prefix(count))
        }
        return result
    }
    func testIdentityPolicyIsPublicAndOldServerRemainsCompatible() async throws {
        StubProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/device-policy")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            return (200, Data("{\"version\":2,\"namespace\":\"11111111-1111-4111-8111-111111111111\"}".utf8))
        }
        let policy = try await api().devicePolicy()
        XCTAssertEqual(policy?.version, 2)
        let first = try DeviceIdentity.scoped(policy)
        XCTAssertEqual(first, try DeviceIdentity.scoped(policy))
        XCTAssertEqual(first?.source, "keychain")
        XCTAssertEqual(first?.digest.count, 64)
        XCTAssertNotEqual(first?.digest, try DeviceIdentity.scoped(DevicePolicy(version: 2, namespace: "22222222-2222-4222-8222-222222222222"))?.digest)
        StubProtocol.handler = { _ in (404, Data("{\"error\":\"Not found\"}".utf8)) }
        let missing = try await api().devicePolicy()
        XCTAssertNil(missing)
    }
    func testPairUsesKeyAndNameAndRejectsWorker() async throws {
        StubProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/pair"); XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            let body = try JSONSerialization.jsonObject(with: self.requestBody(request)) as! [String: String]
            XCTAssertEqual(body, ["key": "fixture-once", "name": "Test phone", "clientType": "ios"])
            return (201, Data("{\"device\":{\"id\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"Test phone\",\"role\":\"worker\"},\"token\":\"fixture-device\"}".utf8))
        }
        do { _ = try await api().pair(key: "fixture-once", name: "Test phone"); XCTFail("worker accepted") }
        catch { XCTAssertTrue(safeMessage(error).contains("worker")) }
    }
    func testPasswordIsPreservedAndFactorFieldsUseExistingPairAPI() async throws {
        StubProtocol.handler = { request in
            let body = try JSONSerialization.jsonObject(with: self.requestBody(request)) as! [String: String]
            XCTAssertEqual(body["key"], "  fixture password  ")
            XCTAssertEqual(body["otp"], "123456")
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            return (201, Data("{\"device\":{\"id\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"Phone\",\"role\":\"owner\"},\"token\":\"independent-token\"}".utf8))
        }
        let credential = try await api().pair(key: "  fixture password  ", name: "Phone", otp: "123456")
        XCTAssertEqual(credential.token, "independent-token")
        XCTAssertEqual(credential.origin, "https://fixture.invalid")
    }
    func testLoginCodesAreDistinctFromExpiredAuthorizationAndNeverReflectBodies() async throws {
        for code in ["mfa_required", "mfa_invalid", "credential_invalid", "untrusted-secret"] {
            StubProtocol.handler = { _ in (401, Data("{\"code\":\"\(code)\",\"error\":\"must-not-be-reflected\"}".utf8)) }
            do { _ = try await api().pair(key: "fixture password", name: "Phone"); XCTFail("login accepted") }
            catch CollectorError.login(let actual, let status) {
                XCTAssertEqual(status, 401)
                XCTAssertEqual(actual, code == "untrusted-secret" ? "" : code)
                XCTAssertFalse(safeMessage(CollectorError.login(actual, status)).contains("授权已失效"))
                XCTAssertFalse(safeMessage(CollectorError.login(actual, status)).contains("must-not"))
            }
        }
    }
    func testRetryKeepsIdenticalSubmissionBodyAndBearerIsOnlyAHeader() async throws {
        let parts = [SharedPart(item: 0, attachment: nil, kind: "text", representation: nil, value: "  title\ntext https://example.com/?a=1&a=2")]
        let input = Submission(id: UUID(), parts: parts, requirements: "additional")
        let client = try api(token: "fixture-scoped-device")
        var calls = 0
        StubProtocol.handler = { request in
            calls += 1
            XCTAssertEqual(request.url?.absoluteString, "https://fixture.invalid/api/tasks")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-scoped-device")
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            XCTAssertEqual(try JSONDecoder().decode(Submission.self, from: self.requestBody(request)), input)
            if calls == 1 { return (503, Data("{\"error\":\"must not be echoed\"}".utf8)) }
            return (200, try JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "submissionId": input.submissionId, "content": input.content, "state": "queued", "createdAt": "2026-01-01T00:00:00Z"]))
        }
        do { _ = try await client.submit(input); XCTFail("503 accepted") }
        catch { XCTAssertFalse(safeMessage(error).contains("must not be echoed")) }
        let result = try await client.submit(input)
        XCTAssertEqual(result.submissionId, input.submissionId); XCTAssertEqual(calls, 2)
    }
    func testMismatchedSubmissionAcknowledgementIsNotAccepted() async throws {
        StubProtocol.handler = { _ in (200, Data("{\"id\":\"00000000-0000-0000-0000-000000000001\",\"submissionId\":\"wrong\",\"state\":\"queued\",\"createdAt\":\"2026-01-01\"}".utf8)) }
        let input = Submission(id: UUID(), parts: [SharedPart(item: 0, attachment: nil, kind: "text", representation: nil, value: "text")], requirements: "")
        do { _ = try await api(token: "fixture-device").submit(input); XCTFail("wrong acknowledgement accepted") }
        catch { XCTAssertTrue(safeMessage(error).contains("提交 ID")) }
    }
}
