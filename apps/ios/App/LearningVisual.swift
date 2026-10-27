import SwiftUI
import WebKit

private final class LearningVisualWebView:WKWebView {
    private var previousHeight:CGFloat=0
    override func layoutSubviews(){super.layoutSubviews();if bounds.height>0 && bounds.height != previousHeight{previousHeight=bounds.height;updateViewport()}}
    func updateViewport(){guard bounds.height>0 else{return};evaluateJavaScript("document.documentElement.style.setProperty('--viewport-height','\(Int(bounds.height))px')",completionHandler:nil)}
}

enum LearningVisualDocument {
    static let template: String? = {
        guard let url=Bundle.main.url(forResource:"index",withExtension:"html",subdirectory:"LearningVisuals") else{return nil}
        return try? String(contentsOf:url,encoding:.utf8)
    }()
    static func supports(_ id:String)->Bool {
        id.range(of:"^[a-z0-9-]+$",options:.regularExpression) != nil && template?.contains("\"id\":\""+id+"\"") == true
    }
    static func html(_ id:String,dark:Bool)->String? {
        guard supports(id),let template else{return nil}
        return template.replacingOccurrences(of:"data-lesson=\"overview\"",with:"data-lesson=\""+id+"\"")
            .replacingOccurrences(of:"data-embedded=\"false\"",with:"data-embedded=\"true\"")
            .replacingOccurrences(of:"data-theme=\"light\"",with:dark ? "data-theme=\"dark\"":"data-theme=\"light\"")
    }
}

struct LearningVisual: UIViewRepresentable {
    let lessonID:String
    @Environment(\.colorScheme) private var scheme
    final class Coordinator:NSObject,WKNavigationDelegate {
        var key=""
        func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){(webView as? LearningVisualWebView)?.updateViewport()}
        func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
            decisionHandler(action.request.url?.absoluteString=="about:blank" ? .allow:.cancel)
        }
    }
    func makeCoordinator()->Coordinator{Coordinator()}
    func makeUIView(context:Context)->WKWebView {
        let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent()
        let view=LearningVisualWebView(frame:.zero,configuration:config);view.navigationDelegate=context.coordinator
        view.isOpaque=false;view.backgroundColor = .clear;view.scrollView.bounces=false
        view.accessibilityIdentifier="learning.visual"
        return view
    }
    func updateUIView(_ view:WKWebView,context:Context){
        let key=lessonID+(scheme == .dark ? ":dark":":light")
        guard context.coordinator.key != key,let html=LearningVisualDocument.html(lessonID,dark:scheme == .dark) else{return}
        context.coordinator.key=key;view.loadHTMLString(html,baseURL:nil)
    }
}

struct LearningOverviewView:View {
    var body:some View{LearningVisual(lessonID:"overview").navigationTitle("全景图").navigationBarTitleDisplayMode(.inline)}
}
