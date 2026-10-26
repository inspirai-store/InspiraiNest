#if DEBUG
import SwiftUI
import UIKit

actor NativeRecordEditorFaultStore: NativeRecordLocalStorage {
  let base: NativeRecordLocalStore
  let kind: String
  private var failed = false
  init(base: NativeRecordLocalStore, kind: String) { self.base=base;self.kind=kind }
  func snapshot(scope: String) async throws -> NativeRecordLocalSnapshot { try await base.snapshot(scope:scope) }
  func begin(record: NativeRecord?,scope: String) async throws -> NativeRecordEditDraft { try await base.begin(record:record,scope:scope) }
  func persist(_ draft: NativeRecordEditDraft) async throws -> Int {
    if kind == "N02-D" && !failed { failed=true;throw NativeRecordLocalError.diskFull }
    return try await base.persist(draft)
  }
  func commit(id: String,revision: Int) async throws -> NativeRecordLocalEntry {
    if kind == "N02-S" && !failed { failed=true;throw NativeRecordLocalError.unavailable }
    return try await base.commit(id:id,revision:revision)
  }
  func discard(id: String,revision: Int) async throws { try await base.discard(id:id,revision:revision) }
}

@MainActor struct NativeRecordEditorReview: View {
  let configuration: NativeReviewConfiguration
  @StateObject private var records=NativeRecordListModel(snapshot:.init(records:ProcessInfo.processInfo.arguments.contains("--review-empty-records") ? [] : NativeRecordListReview.examples),phase:.content,
    origin:"https://library.inspirai.store",now:{ NativeRecordListModel.date("2026-10-16T12:00:00+08:00")! })
  @StateObject private var workbench=NativeRecordWorkbench()
  @State private var module:NativeAppModule = .records
  @State private var started=false
  var body:some View {
    NativeRecordWorkspace(records:records,workbench:workbench,module:$module,
      illustration:{ $0.mime == "image/jpeg" ? AnyView(NativeRecordRouteFixture()) : nil },autoReload:false,
      focusEditor:!["N02-C","N05-A","N05-L"].contains(configuration.page))
      .task {
        guard !started else { return };started=true
        do {
          let arguments=ProcessInfo.processInfo.arguments
          var key=UUID().uuidString
          if let i=arguments.firstIndex(of:"--review-record-store"),arguments.indices.contains(i+1) {
            key=String(arguments[i+1].filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }.prefix(80))
            if key.isEmpty { key=UUID().uuidString }
          }
          let directory=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
            .appendingPathComponent("RecordsEditorReview",isDirectory:true).appendingPathComponent(key,isDirectory:true)
          let fixedDate=NativeRecordListModel.date("2026-10-16T10:36:00+08:00")!
          let clock: @Sendable () -> Date = { fixedDate }
          let base=try NativeRecordLocalStore(directory:directory,now:clock)
          let scope="editor-review"
          if configuration.page != "N01" {
            _ = try await base.begin(record:NativeRecordListReview.examples[3],scope:scope)
          }
          let store=NativeRecordEditorFaultStore(base:base,kind:configuration.page)
          workbench.now={ NativeRecordListModel.date("2026-10-16T10:36:00+08:00")! }
          await workbench.configure(store:store,scope:scope,list:records)
          if configuration.page == "N01" { return }
          if configuration.page == "N02-A" { await workbench.open() }
          else { await workbench.open(try Self.example(tablet:UIDevice.current.userInterfaceIdiom == .pad,limit:configuration.page == "N02-L")) }
          guard let editor=workbench.editor else { return }
          editor.rich.image = { id,size in
            guard id == "route" else { return nil }
            let renderer=ImageRenderer(content:NativeRecordRouteFixture(labelAlignment:.leading).frame(width:size.width,height:size.height)
              .clipShape(RoundedRectangle(cornerRadius:12,style:.continuous))
              .environment(\.colorScheme,configuration.appearance ?? .light))
            renderer.scale=UIScreen.main.scale
            return renderer.uiImage
          }
          for _ in 0..<25 { if editor.rich.textView != nil { break };try? await Task.sleep(nanoseconds:20_000_000) }
          editor.rich.load(editor.draft.document)
          if let view=editor.rich.textView {
            let needle=UIDevice.current.userInterfaceIdiom == .pad ? "14:00  返回市区" : "11:30  步道出口午餐"
            let range=(view.text as NSString).range(of:needle)
            if range.location != NSNotFound { view.selectedRange = .init(location:NSMaxRange(range),length:0);editor.rich.textViewDidChangeSelection(view) }
          }
          switch configuration.page {
          case "N02-C":editor.rich.blur();editor.panel = .discard
          case "N05-A":editor.presentFormat()
          case "N05-L":editor.presentLink();editor.linkText="湖边步道";editor.linkURL="https://example.com/lake-trail"
          case "N02-S","N02-L":await editor.save()
          case "N02-D":editor.forcePersist();_ = await editor.flush()
          default:break
          }
        } catch { workbench.openError=error.localizedDescription }
      }
  }
  static func example(tablet:Bool,limit:Bool=false) throws -> NativeRecord {
    var record=NativeRecordListReview.examples[0]
    let items=tablet ? ["09:00  湖边集合","11:30  步道出口午餐","14:00  返回市区"] : ["09:00  湖边集合","11:30  步道出口午餐"]
    var document=NativeRecordDocument(doc:.init(type:"doc",content:[
      .paragraph("周末徒步路线",type:"heading",level:1),
      .paragraph("周六上午从湖边出发，沿步道走到观景台。"),
      .paragraph("行程安排",type:"heading",level:2),
      .init(type:"bulletList",content:items.map { .init(type:"listItem",content:[.paragraph($0)]) }),
      .init(type:"attachment",attrs:["attachmentId":.string("route")])
    ]))
    if limit {
      let remaining=(Int(37.4*1_048_576)-record.attachments[0].bytes)/20
      for index in 1...20 {
        let id="limit-\(index)"
        record.attachments.append(.init(id:id,name:"行程资料-\(index).pdf",mime:"application/pdf",bytes:remaining,sha256:String(repeating:"c",count:64)))
        document.doc.content?.append(.init(type:"attachment",attrs:["attachmentId":.string(id)]))
      }
      let length=max(0,1284-document.plainText.utf16.count-1)
      document.doc.content?.append(.paragraph(String(repeating:"记",count:length)))
    }
    record.document=try document.json();record.text=document.plainText
    return record
  }
}
#endif
