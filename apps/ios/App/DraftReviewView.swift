import SwiftUI
import CryptoKit
import PDFKit

struct DraftReviewView: View {
    @EnvironmentObject var model: AppModel
    let taskID: String
    @State private var draft: DraftBundle?
    @State private var selected = ""
    @State private var error: String?
    @State private var loading = false
    @State private var approve = false
    @State private var reviewedDigest: String?
    var body: some View {
        VStack {
            if loading { ProgressView("读取并校验草稿…") }
            if let error { Text(error).padding(); Button("重试读取") { Task { await load() } } }
            if let draft {
                List {
                    Section(draft.meta.title) {
                        Text(verbatim: draft.meta.summary).textSelection(.enabled)
                        Text(verbatim: draft.meta.coverage_note).font(.footnote)
                        Text("来源完整度：\(draft.meta.status)").font(.caption)
                    }
                    Section("完整草稿附件") {
                        Picker("阅读文件", selection: $selected) {
                            ForEach(draft.files) { file in Text(file.path).tag(file.path) }
                        }
                        if let file = draft.files.first(where: { $0.path == selected }), let data = Data(base64Encoded: file.body) {
                            DraftFileView(path: file.path, data: data)
                        }
                    }
                    if let omitted = draft.omitted, !omitted.isEmpty {
                        Section("仅留在采集电脑的文件") { ForEach(omitted, id: \.self) { Text(verbatim: $0) } }
                    }
                    if let task = model.snapshot?.tasks.first(where: { $0.id == taskID }) {
                        if task.state == "awaiting_review" {
                            Button("确认将这份草稿归档") { approve = true }.disabled(model.busy || task.draftId != reviewedDigest)
                            if task.draftId != reviewedDigest {
                                Text("草稿已经变化，请重新读取。")
                                Button("读取当前草稿") { Task { await load() } }
                            }
                        } else { Text("任务已更新：\(task.stateLabel)") }
                    }
                }
            }
        }.navigationTitle("草稿审核").task { await load() }
        .confirmationDialog("已查看草稿，确认归档到资料库？", isPresented: $approve, titleVisibility: .visible) {
            if let task = model.snapshot?.tasks.first(where: { $0.id == taskID }), task.state == "awaiting_review" {
                Button("确认归档") {
                    Task {
                        await model.refresh()
                        guard let current = model.snapshot?.tasks.first(where: { $0.id == taskID }),
                              current.state == "awaiting_review", current.draftId == reviewedDigest else {
                            error = "草稿或任务状态已变化，请重新读取后再确认。"; return
                        }
                        await model.action(current, "approve")
                    }
                }
            }
        }
    }
    @MainActor private func load() async {
        guard !loading else { return }; loading = true; error = nil; draft = nil
        let session = model.sessionID
        defer { loading = false }
        do {
            guard let digest = model.snapshot?.tasks.first(where: { $0.id == taskID })?.draftId else {
                throw CollectorError.message("找不到待审核草稿，请刷新任务。")
            }
            let result = try await model.client().draft(taskID, expectedDigest: digest)
            try AttachmentIntegrity.validate(result)
            guard session == model.sessionID, !Task.isCancelled else { return }
            selected = result.files.first(where: { ["summary", "analysis"].contains($0.role) })?.path ?? result.files.first?.path ?? ""
            reviewedDigest = digest; draft = result
        } catch { self.error = safeMessage(error) }
    }
}

struct DraftFileView: View {
    let path: String
    let data: Data
    var body: some View {
        let ext = (path as NSString).pathExtension.lowercased()
        if ["md", "markdown", "txt", "srt", "vtt"].contains(ext) {
            // Source text is inert: no HTML, remote images, automatic link opening,
            // JavaScript, interpolation or execution of embedded instructions.
            if let text = String(data: data, encoding: .utf8) { Text(verbatim: text).textSelection(.enabled) }
            else { Text("文件不是有效 UTF-8 文本，无法预览。") }
        } else if ext == "pdf" {
            DraftPDF(data: data).frame(minHeight: 480)
        } else if let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFit().accessibilityLabel(path)
        } else { Text("此附件无法在本机预览：\(path)") }
    }
}

struct DraftPDF: UIViewRepresentable {
    let data: Data
    func makeUIView(context: Context) -> PDFView { let view = PDFView(); view.autoScales = true; return view }
    func updateUIView(_ view: PDFView, context: Context) { view.document = PDFDocument(data: data) }
}
