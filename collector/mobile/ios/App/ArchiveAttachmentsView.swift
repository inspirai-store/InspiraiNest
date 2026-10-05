import SwiftUI
import CryptoKit

enum AttachmentIntegrity {
    static func validate(_ bundle: DraftBundle) throws {
        var total = 0
        var paths = Set<String>()
        for file in bundle.files {
            guard paths.insert(file.path).inserted, let data = Data(base64Encoded: file.body),
                  data.count == file.bytes, data.count <= 16 * 1024 * 1024,
                  SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == file.sha256 else {
                throw CollectorError.message("附件完整性校验失败，已停止预览。")
            }
            total += data.count
        }
        guard total <= 40 * 1024 * 1024 else { throw CollectorError.message("归档超过当前轻量附件总量限制。") }
    }
}

struct ArchiveListView: View {
    @EnvironmentObject var model: AppModel
    private var latest: [ArchiveRecord] {
        var seen = Set<String>()
        return (model.snapshot?.archives ?? []).filter { seen.insert($0.entryId).inserted }
    }
    var body: some View {
        List {
            ForEach(latest) { archive in
                NavigationLink { ArchiveAttachmentsView(archive: archive).id(model.sessionID) } label: {
                    VStack(alignment: .leading) {
                        Text(verbatim: archive.meta.title)
                        Text(archive.createdAt).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if latest.isEmpty { Text("没有可读取的归档，请刷新或检查连接。") }
        }.navigationTitle("归档附件").task { await model.refresh() }.refreshable { await model.refresh() }
    }
}

struct ArchiveAttachmentsView: View {
    @EnvironmentObject var model: AppModel
    let archive: ArchiveRecord
    @State private var bundle: DraftBundle?
    @State private var error: String?
    @State private var loading = false
    var body: some View {
        List {
            if loading { ProgressView("读取并校验附件…") }
            if let error { Text(error); Button("重试") { Task { await load() } } }
            if let bundle {
                Section(bundle.meta.title) {
                    Text(verbatim: bundle.meta.summary).textSelection(.enabled)
                    Text(verbatim: bundle.meta.coverage_note).font(.footnote)
                }
                Section("可阅读附件") {
                    ForEach(bundle.files) { file in
                        NavigationLink {
                            ScrollView {
                                if let data = Data(base64Encoded: file.body) { DraftFileView(path: file.path, data: data).padding() }
                            }.navigationTitle((file.path as NSString).lastPathComponent).navigationBarTitleDisplayMode(.inline)
                        } label: {
                            VStack(alignment: .leading) {
                                Text(verbatim: file.path)
                                Text("\(file.role) · \(ByteCountFormatter.string(fromByteCount: Int64(file.bytes), countStyle: .file))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if let omitted = bundle.omitted, !omitted.isEmpty {
                    Section("未上传，仍在采集电脑") { ForEach(omitted, id: \.self) { Text(verbatim: $0) } }
                }
            }
        }.navigationTitle("附件与原文").task { await load() }
    }
    @MainActor private func load() async {
        guard !loading else { return }; loading = true; error = nil; bundle = nil
        let session = model.sessionID
        defer { loading = false }
        do {
            let result = try await model.client().archive(archive.id)
            try AttachmentIntegrity.validate(result)
            guard session == model.sessionID, !Task.isCancelled else { return }
            bundle = result
        } catch { self.error = safeMessage(error) }
    }
}
