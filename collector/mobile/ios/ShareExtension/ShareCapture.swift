import Foundation
import UIKit
import UniformTypeIdentifiers

/// NSItemProvider callbacks may arrive after timeout; resume the continuation once.
private final class ProviderGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<NSSecureCoding?, Error>?
    init(_ continuation: CheckedContinuation<NSSecureCoding?, Error>) { self.continuation = continuation }
    func finish(_ result: Result<NSSecureCoding?, Error>) {
        lock.lock(); let pending = continuation; continuation = nil; lock.unlock()
        pending?.resume(with: result)
    }
}

enum ShareCapture {
    private static func load(_ provider: NSItemProvider, type: String) async throws -> NSSecureCoding? {
        try await withCheckedThrowingContinuation { continuation in
            let gate = ProviderGate(continuation)
            provider.loadItem(forTypeIdentifier: type, options: nil) { item, error in
                if error != nil { gate.finish(.failure(CollectorError.message("来源应用未能提供完整分享内容，请返回重试。"))) }
                else { gate.finish(.success(item)) }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + 12) {
                gate.finish(.failure(CollectorError.message("读取分享内容超时。尚未保存，请返回来源应用重试。")))
            }
        }
    }

    @MainActor
    static func read(_ items: [NSExtensionItem]) async throws -> [SharedPart] {
        var parts: [SharedPart] = []
        for (index, item) in items.enumerated() {
            func add(_ kind: String, _ value: String?, attachment: Int? = nil, representation: String? = nil) {
                if let value { parts.append(SharedPart(item: index, attachment: attachment, kind: kind, representation: representation, value: value)) }
            }
            add("title", item.attributedTitle?.string)
            add("text", item.attributedContentText?.string)
            for (attachment, provider) in (item.attachments ?? []).enumerated() {
                add("suggestedName", provider.suggestedName, attachment: attachment)
                var supported = false
                // Inspect all advertised text and URL representations, including
                // multiple attachments. Do not use URL-or-text else-if extraction.
                for identifier in provider.registeredTypeIdentifiers {
                    guard let type = UTType(identifier) else { continue }
                    if type.conforms(to: .propertyList) {
                        let item = try await load(provider, type: identifier)
                        if let outer = item as? NSDictionary,
                           let page = outer[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any] {
                            for key in ["title", "text", "url"] {
                                add("safari.\(key)", page[key] as? String, attachment: attachment, representation: identifier)
                            }
                            supported = true
                        }
                    } else if type.conforms(to: .url) && !type.conforms(to: .fileURL) || type.conforms(to: .text) {
                        let item = try await load(provider, type: identifier)
                        let value: String
                        if let text = item as? String { value = text }
                        else if let text = item as? NSAttributedString { value = text.string }
                        else if let url = item as? URL, !url.isFileURL { value = url.absoluteString }
                        else if let bytes = item as? Data, let text = String(data: bytes, encoding: identifier == UTType.utf16PlainText.identifier ? .utf16 : .utf8) { value = text }
                        else { throw CollectorError.message("有一份文字或链接无法完整读取。尚未保存，请从来源应用复制完整文字后再分享。") }
                        add(type.conforms(to: .url) ? "url" : "text", value, attachment: attachment, representation: identifier)
                        supported = true
                    }
                }
                guard supported else { throw CollectorError.message("这次分享含不支持的附件。当前只接收文字、标题和网页链接；尚未保存，请改为分享完整文字或链接。") }
            }
        }
        guard parts.contains(where: { !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            throw CollectorError.message("来源应用没有提供文字、标题或链接。尚未保存。")
        }
        return parts
    }
}
