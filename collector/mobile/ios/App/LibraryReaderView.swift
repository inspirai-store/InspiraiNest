import SwiftUI
import WebKit

enum ReaderPolicy {
    // Read-only adaptation of the existing bootstrap: never install a JS token.
    static let lockManagement = """
    Object.defineProperty(window, 'LIBRARY_DELETE', {
      configurable: false, get: function() { return undefined; }, set: function() {}
    });
    """
    static let removeManagement = """
    (function() {
      function clean() {
        var button = document.getElementById('open-trash');
        if (button) button.remove();
        var dialog = document.getElementById('trash-dialog');
        if (dialog) dialog.remove();
      }
      clean();
      new MutationObserver(clean).observe(document.documentElement, {childList:true, subtree:true});
    })();
    """
    static func allows(_ url: URL, origin: ServerOrigin) -> Bool {
        origin.contains(url) && url.path.hasPrefix("/library/")
    }
    static func rules(origin: ServerOrigin) throws -> String {
        let prefix = NSRegularExpression.escapedPattern(for: origin.value)
        // The first rule blocks all network resources, including subframes, XHR,
        // images and redirects. Only this origin's /library/ path is exempted.
        // Local data/blob resources carry no bearer or cookie network request.
        let rules: [[String: Any]] = [
            ["trigger": ["url-filter": ".*"], "action": ["type": "block"]],
            ["trigger": ["url-filter": "^" + prefix + "/library/", "url-filter-is-case-sensitive": true], "action": ["type": "ignore-previous-rules"]],
            ["trigger": ["url-filter": "^data:"], "action": ["type": "ignore-previous-rules"]],
            ["trigger": ["url-filter": "^blob:" + prefix + "/"], "action": ["type": "ignore-previous-rules"]]
        ]
        return String(decoding: try JSONSerialization.data(withJSONObject: rules), as: UTF8.self)
    }
}

@MainActor
final class ReaderModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published private(set) var webView: WKWebView?
    @Published private(set) var message: String?
    @Published private(set) var loading = false
    private var origin: ServerOrigin?
    private var generation = UUID()

    func start() async {
        guard !loading else { return }
        stop(); let current = generation; loading = true; message = nil
        defer { if current == generation { loading = false } }
        do {
            guard let credential = try CredentialStore().load() else { throw CollectorError.message("请先在设备页配对。") }
            let server = try credential.server
            let api = CollectorAPI(origin: server, token: credential.token)
            let cookie = try await api.libraryCookie()
            let encoded = try ReaderPolicy.rules(origin: server)
            let rule: WKContentRuleList = try await withCheckedThrowingContinuation { continuation in
                WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "CollectorSameOrigin", encodedContentRuleList: encoded) { list, _ in
                    if let list { continuation.resume(returning: list) }
                    else { continuation.resume(throwing: CollectorError.message("无法启用阅读器网络隔离，已停止加载。")) }
                }
            }
            guard current == generation, !Task.isCancelled else { return }
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .nonPersistent()
            configuration.userContentController.add(rule)
            configuration.userContentController.addUserScript(WKUserScript(source: ReaderPolicy.lockManagement,
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
            configuration.userContentController.addUserScript(WKUserScript(source: ReaderPolicy.removeManagement,
                injectionTime: .atDocumentEnd, forMainFrameOnly: true))
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
            configuration.allowsInlineMediaPlayback = false
            // No script receives a token. The existing bootstrap sees no token in
            // sessionStorage and reads /library/data using only the HttpOnly cookie.
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { continuation.resume() }
            }
            guard current == generation, !Task.isCancelled else {
                configuration.websiteDataStore.httpCookieStore.delete(cookie); return
            }
            let view = WKWebView(frame: .zero, configuration: configuration)
            view.navigationDelegate = self; view.uiDelegate = self
            view.allowsBackForwardNavigationGestures = true
            if #available(iOS 16.4, *) { view.isInspectable = false }
            origin = server; webView = view
            view.load(URLRequest(url: try server.url("/library/"))) // No Authorization.
        } catch { if current == generation { message = safeMessage(error) } }
    }
    func stop() {
        generation = UUID(); loading = false
        if let view = webView {
            view.stopLoading(); view.navigationDelegate = nil; view.uiDelegate = nil
            let store = view.configuration.websiteDataStore
            store.httpCookieStore.getAllCookies { cookies in
                for cookie in cookies { store.httpCookieStore.delete(cookie) }
            }
            store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast, completionHandler: {})
        }
        webView = nil; origin = nil
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let origin,
              ReaderPolicy.allows(url, origin: origin) else {
            message = "外部链接已阻止；可通过“附件”阅读当前服务器的原件。"
            decisionHandler(.cancel); return
        }
        if navigationAction.shouldPerformDownload {
            message = "请打开上方“附件”，在原生阅读器查看该归档的全部文件。"
            decisionHandler(.cancel); return
        }
        if navigationAction.targetFrame == nil {
            // Build a fresh same-origin request; never forward arbitrary headers.
            webView.load(URLRequest(url: url)); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard let url = navigationResponse.response.url, let origin, ReaderPolicy.allows(url, origin: origin),
              navigationResponse.canShowMIMEType else {
            message = "请在上方“附件”使用原生 PDF、图片或文本阅读器打开文件。"
            decisionHandler(.cancel); return
        }
        if let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
            message = response.statusCode == 401 ? "阅读授权已失效，请重新配对。" : "资料暂时不可读取。"
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, let origin, ReaderPolicy.allows(url, origin: origin), !navigationAction.shouldPerformDownload {
            webView.load(URLRequest(url: url))
        } else { message = "此链接未打开。当前服务器的文件可从“附件”读取。" }
        return nil
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { message = "无法载入资料，请检查连接后重试。" }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { message = "阅读连接中断，请重试。" }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { message = "系统已结束阅读进程，请重新载入。" }
}

struct LibraryReaderView: View {
    @EnvironmentObject var model: AppModel
    @StateObject private var reader = ReaderModel()
    var body: some View {
        VStack(spacing: 0) {
            if !model.paired { Text("请先在设备页完成配对。").padding() }
            if reader.loading { ProgressView("正在建立安全阅读会话…").padding() }
            if let message = reader.message { Text(message).font(.footnote).padding() }
            if let view = reader.webView { ReaderWebView(view: view) }
            Text("只读资料浏览；删除、回收站操作需在管理页面完成。").font(.caption).foregroundStyle(.secondary).padding(6)
        }.navigationTitle("资料库").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            NavigationLink("附件") { ArchiveListView().id(model.sessionID) }.disabled(!model.paired)
            Button("重新载入") { Task { await reader.start() } }.disabled(!model.paired || reader.loading)
        }
        .task { if model.paired { await reader.start() } }
        .onDisappear { reader.stop() }
    }
}

private struct ReaderWebView: UIViewRepresentable {
    let view: WKWebView
    func makeUIView(context: Context) -> WKWebView { view }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
