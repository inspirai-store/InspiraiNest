import SwiftUI
import WebKit
import AVFoundation
import UIKit

struct CaptureView: UIViewControllerRepresentable {
    var onNavigate: (String) -> Void
    func makeUIViewController(context: Context) -> CaptureController { CaptureController(onNavigate: onNavigate) }
    func updateUIViewController(_ controller: CaptureController, context: Context) { controller.onNavigate = onNavigate }
}

private final class CaptureNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor final class CaptureController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    var onNavigate: (String) -> Void
    private var web: WKWebView!
    private var recorder: AVAudioRecorder?
    private var segment: URL?
    private var rotate: Timer?
    private var photoRequest: [String: Any]?
    private let credentialStore = CredentialStore()
    private lazy var mediaRoot: URL = {
        var url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("capture-media", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try? url.setResourceValues(values)
        return url
    }()
    init(onNavigate: @escaping (String) -> Void) { self.onNavigate = onNavigate; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unsupported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        let config = WKWebViewConfiguration(); config.allowsInlineMediaPlayback = true
        config.userContentController.add(self, name: "capture")
        web = WKWebView(frame: .zero, configuration: config); web.navigationDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(web)
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor), web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)])
        if let root = Bundle.main.url(forResource: "CaptureAssets", withExtension: nil) { web.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root) }
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
    }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); stopRecording() }
    @objc private func background() { stopRecording() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let root = Bundle.main.url(forResource: "CaptureAssets", withExtension: nil)
        decisionHandler(navigationAction.request.url?.isFileURL == true && navigationAction.request.url!.path.hasPrefix((root?.path ?? "invalid") + "/") ? .allow : .cancel)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
              message.frameInfo.request.url?.lastPathComponent == "index.html", let request = message.body as? [String: Any], let action = request["action"] as? String else { return }
        Task { do {
            var result: Any = [:]
            switch action {
            case "status": let credential = try credentialStore.load(); result = ["paired": credential != nil, "server": credential?.origin ?? UserDefaults.standard.string(forKey: "lastSuccessfulOrigin") ?? "", "nativeMedia": true,"theme": traitCollection.userInterfaceStyle == .dark ? "dark" : "light"]
            case "navigate": guard let target = request["input"] as? String, ["library","tasks","settings"].contains(target) else { throw CollectorError.message("页面无效") }; onNavigate(target)
            case "request": guard let input = request["input"] as? [String: Any] else { throw CollectorError.message("请求无效") }; result = try await network(input)
            case "recover": result = ["files": try recovered()]
            case "mediaAck": guard let id = request["input"] as? String, UUID(uuidString: id) != nil else { throw CollectorError.message("媒体编号无效") }; for url in try FileManager.default.contentsOfDirectory(at: mediaRoot, includingPropertiesForKeys: nil) where url.deletingPathExtension().lastPathComponent == id { try FileManager.default.removeItem(at: url) }
            case "recordStart": let allowed = await withCheckedContinuation { continuation in AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) } }; guard allowed else { throw CollectorError.message("未允许录音，可以继续输入文字或导入音频") }; try startRecording()
            case "recordStop": stopRecording(); result = ["files": try recovered()]
            case "photo": guard UIImagePickerController.isSourceTypeAvailable(.camera) else { throw CollectorError.message("相机不可用，请从图片中选择") }; photoRequest = request; let picker = UIImagePickerController(); picker.sourceType = .camera; picker.delegate = self; present(picker, animated: true); return
            default: throw CollectorError.message("不支持的操作")
            }
            reply(request, value: result)
        } catch { reply(request, error: error.localizedDescription) } }
    }
    private func reply(_ request: [String: Any], value: Any = NSNull(), error: String? = nil) {
        var response: [String: Any] = ["id": request["id"] ?? ""]
        if let error { response["error"] = error } else { response["value"] = value }
        guard let data = try? JSONSerialization.data(withJSONObject: response), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.captureReply(\(json))", completionHandler: nil)
    }
    private func allowed(_ route: String, _ method: String) -> Bool {
        func match(_ pattern: String) -> Bool { route.range(of: pattern, options: .regularExpression) != nil }
        return method == "GET" && (route == "/api/state" || route == "/api/records" || match("^/api/records/[a-zA-Z0-9-]+$") || match("^/api/records/media/[a-f0-9]{64}$") || match("^/api/tasks/[a-zA-Z0-9-]+/draft$"))
            || method == "PUT" && (match("^/api/records/[a-zA-Z0-9-]+$") || match("^/api/records/media/[a-f0-9]{64}$"))
            || method == "POST" && (match("^/api/records/[a-zA-Z0-9-]+/process$") || match("^/api/tasks/[a-zA-Z0-9-]+/(approve|retry|cancel)$"))
    }
    private func network(_ input: [String: Any]) async throws -> [String: Any] {
        guard let credential = try credentialStore.load() else { throw CollectorError.message("请先连接资料空间，记录已保存在本机") }
        guard let route = input["route"] as? String else { throw CollectorError.message("接口无效") }
        let method = input["method"] as? String ?? "GET"
        guard allowed(route, method), input["server"] as? String == nil || input["server"] as? String == "" || input["server"] as? String == credential.origin else { throw CollectorError.message("接口或资料空间不匹配") }
        var request = URLRequest(url: try ServerOrigin(credential.origin).url(route)); request.httpMethod = method; request.timeoutInterval = 120
        request.setValue("Bearer " + credential.token, forHTTPHeaderField: "Authorization")
        if let bytes = input["bytes"] as? String { guard let data = Data(base64Encoded: bytes), data.count <= 32 * 1024 * 1024 else { throw CollectorError.message("附件超过32 MiB") }; request.httpBody = data; request.setValue(input["mime"] as? String, forHTTPHeaderField: "Content-Type") }
        else if let json = input["json"] { request.httpBody = try JSONSerialization.data(withJSONObject: json); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil; config.urlCache = nil
        let session = URLSession(configuration: config, delegate: CaptureNoRedirects(), delegateQueue: nil); defer { session.finishTasksAndInvalidate() }
        let (data,response) = try await session.data(for: request)
        guard data.count <= 64 * 1024 * 1024, let http = response as? HTTPURLResponse, let current = try credentialStore.load(), current.token == credential.token, current.origin == credential.origin else { throw CollectorError.message("登录状态已改变或响应过大，本机内容保留") }
        if (http.mimeType ?? "").hasPrefix("application/json") { return ["status": http.statusCode, "json": try JSONSerialization.jsonObject(with: data)] }
        return ["status": http.statusCode, "bytes": data.base64EncodedString(), "mime": http.mimeType ?? "application/octet-stream"]
    }
    private func startRecording() throws {
        guard recorder == nil else { throw CollectorError.message("录音已开始") }
        try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker]); try AVAudioSession.sharedInstance().setActive(true)
        try startSegment()
        rotate = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in Task { @MainActor in guard let self else { return }; self.finishSegment(); do { try self.startSegment() } catch { self.stopRecording() } } }
    }
    private func startSegment() throws {
        let active = mediaRoot.appendingPathComponent("active", isDirectory: true)
        try FileManager.default.createDirectory(at: active, withIntermediateDirectories: true)
        segment = active.appendingPathComponent(UUID().uuidString.lowercased() + ".m4a")
        recorder = try AVAudioRecorder(url: segment!, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue])
        guard recorder!.record() else { throw CollectorError.message("无法开始录音") }
    }
    private func finishSegment() { guard let recorder, let segment else { return }; recorder.stop(); self.recorder = nil; try? FileManager.default.moveItem(at: segment, to: mediaRoot.appendingPathComponent(segment.lastPathComponent)) }
    private func stopRecording() { rotate?.invalidate(); rotate = nil; finishSegment(); try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    private func recovered() throws -> [[String: Any]] {
        try FileManager.default.contentsOfDirectory(at: mediaRoot, includingPropertiesForKeys: [.creationDateKey]).filter { ["m4a","jpg"].contains($0.pathExtension) }.sorted { ((try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast) < ((try? $1.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast) }.map { url in
            let data = try Data(contentsOf: url); return ["id": url.deletingPathExtension().lastPathComponent, "name": url.lastPathComponent, "mime": url.pathExtension == "jpg" ? "image/jpeg" : "audio/mp4", "bytes": data.base64EncodedString()]
        }
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true); if let request = photoRequest { reply(request) }; photoRequest = nil }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        guard let request = photoRequest else { return }; photoRequest = nil
        do { guard let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.95) else { throw CollectorError.message("未取得照片") }; let id = UUID().uuidString.lowercased(); let url = mediaRoot.appendingPathComponent(id + ".jpg"); try data.write(to: url, options: .atomic); reply(request, value: ["id": id,"name": url.lastPathComponent,"mime": "image/jpeg","bytes": data.base64EncodedString()]) }
        catch { reply(request, error: error.localizedDescription) }
    }
}
