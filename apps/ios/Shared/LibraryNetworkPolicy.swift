import Foundation

enum ReaderPolicy {
    static func allows(_ url: URL, origin: ServerOrigin) -> Bool {
        // URL.path drops a trailing slash on iOS/macOS, so it turns the
        // legitimate /library/ home page into /library. Preserve the URL path.
        origin.contains(url)
            && (URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath.hasPrefix("/library/") == true)
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
