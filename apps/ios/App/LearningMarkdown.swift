import SwiftUI

/// Uses the native document parser so lesson headings, lists and code remain readable.
struct LearningMarkdown: View {
    private let document: NativeMarkdownDocument
    init(_ source: String) { document = NativeMarkdownDocument(source) }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            ForEach(document.blocks) { LearningMarkdownBlock(block: $0) }
        }.frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
    }
}

private struct LearningMarkdownBlock: View {
    let block: NativeMarkdownDocument.Block
    @Environment(\.colorScheme) private var scheme
    private var p: NativePalette { .init(dark: scheme == .dark) }
    var body: some View {
        content.frame(maxWidth: .infinity, alignment: .leading)
    }
    @ViewBuilder private var content: some View {
        switch block.kind {
        case .heading(let level):
            Text(block.text).font(level < 3 ? .title3.weight(.semibold) : .headline)
                .accessibilityAddTraits(.isHeader).fixedSize(horizontal: false, vertical: true)
        case .code:
            ScrollView(.horizontal) {
                Text(block.text.trimmingCharacters(in: .newlines))
                    .font(.system(.body, design: .monospaced))
                    .fixedSize(horizontal: true, vertical: true).padding(16)
            }.background(p.well, in: RoundedRectangle(cornerRadius: 10))
                .contextMenu { Button("复制代码") { UIPasteboard.general.string = block.text } }
        case .table(let rows):
            ScrollView(.horizontal) {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(rows.indices, id: \.self) { row in
                        HStack(alignment: .top, spacing: 16) {
                            ForEach(rows[row].indices, id: \.self) { col in
                                Text(rows[row][col]).frame(width: 180, alignment: .leading)
                            }
                        }
                    }
                }
            }
        case .quote:
            HStack(alignment: .top, spacing: 12) {
                Rectangle().fill(p.accent).frame(width: 3)
                children
            }.fixedSize(horizontal: false, vertical: true)
        case .list(let prefix):
            if prefix.isEmpty { children }
            else { HStack(alignment: .top, spacing: 8) { Text(prefix); children } }
        case .rule:
            Divider()
        case .paragraph, .literal:
            if !block.text.isEmpty {
                Text(block.inline ?? AttributedString(block.text)).font(.body).lineSpacing(6)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !block.children.isEmpty { children }
        }
    }
    private var children: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(block.children) { LearningMarkdownBlock(block: $0) }
        }
    }
}
