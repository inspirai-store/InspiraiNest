import AVFoundation
import Foundation
import UIKit
import SwiftUI

enum NativeRecordMediaSheet: String, Identifiable {
  case add, photos, camera, files, recording, microphonePermission, cameraPermission, photosPermission
  var id: String { rawValue }
}

enum NativeRecordEditorPanel: String { case format, link, discard, attachment }
@MainActor
final class NativeRecordEditorModel: ObservableObject, Identifiable {
  let id: String
  let rich = NativeRecordRichController()
  @Published private(set) var draft: NativeRecordEditDraft
  @Published private(set) var persisting = false
  @Published private(set) var saving = false
  @Published private(set) var composing = false
  @Published private(set) var error: NativeRecordLocalError?
  @Published var panel: NativeRecordEditorPanel?
  @Published var linkText = ""
  @Published var linkURL = ""
  @Published var linkError = ""
  @Published var removalID: String?
  @Published var previewAttachment: NativeRecordAttachment?
  @Published var mediaSheet: NativeRecordMediaSheet?
  @Published var pendingPhotoFiles: [NativeRecordPickedFile] = []
  @Published var mediaError: String?
  @Published private(set) var importing = false
  @Published var localImages: [String:UIImage] = [:]
  @Published var recorder: NativeRecordRecorder?
  var mediaStore: NativeRecordMediaStore?
  private let store: any NativeRecordLocalStorage
  private let now: () -> Date
  private var editGeneration = 0
  private var durableGeneration = 0
  private var writer: Task<Void, Never>?
  var saved: ((NativeRecordLocalEntry) async -> Void)?
  var dismissed: (() async -> Void)?
  init(draft: NativeRecordEditDraft, store: any NativeRecordLocalStorage, now: @escaping () -> Date = Date.init) {
    id = draft.id; self.draft = draft; self.store = store; self.now = now
    rich.changed = { [weak self] value in self?.change(value) }
    rich.compositionChanged = { [weak self] value in if self?.composing != value { self?.composing=value } }
    rich.captions=Dictionary(uniqueKeysWithValues:draft.attachments.map { ($0.id,$0.name+" · "+ByteCountFormatter.string(fromByteCount:Int64($0.bytes),countStyle:.file)) })
    rich.previewAttachment = { [weak self] id in self?.previewAttachment=self?.draft.attachments.first(where:{$0.id == id}) }
    rich.removeAttachment = { [weak self] id in
      self?.rich.blur(); self?.removalID = id; self?.panel = .attachment
    }
  }
  var canSave: Bool {
    !saving && !importing && recorder?.session == nil && recorder?.busy != true && (draft.document.hasContent || !draft.attachments.isEmpty || (composing && rich.textView?.hasText == true))
  }
  var status: String {
    if composing { return "正在输入…" }
    if persisting { return "正在保存草稿…" }
    if durableGeneration != editGeneration { return "草稿尚未保存在本机" }
    return "草稿已保存在本机"
  }
  func change(_ document: NativeRecordDocument) {
    guard !saving, document != draft.document else { return }
    draft.document = document; draft.modifiedAt = ISO8601DateFormatter().string(from: now())
    error = nil; editGeneration += 1; startWriter()
  }
  func forcePersist() { editGeneration += 1; startWriter() }
  private func startWriter() {
    guard writer == nil else { return }
    persisting = true;error=nil
    writer = Task { [self] in
      while durableGeneration != editGeneration {
        let generation = editGeneration, value = draft
        do {
          let revision = try await store.persist(value)
          draft.revision = revision; durableGeneration = generation
        } catch {
          self.error = (error as? NativeRecordLocalError) ?? .unavailable
          break
        }
      }
      persisting = false; writer = nil
    }
  }
  @discardableResult func flush() async -> Bool {
    if writer == nil, durableGeneration != editGeneration { startWriter() }
    await writer?.value
    return durableGeneration == editGeneration
  }
  func save() async {
    guard canSave else { return }
    rich.blur(); saving = true; rich.editable = false
    defer {
      saving = false;rich.editable = true
      if error != nil && panel == nil && !rich.tablet { DispatchQueue.main.async { [weak self] in self?.rich.focus() } }
    }
    guard await flush() else { return }
    do {
      let entry = try await store.commit(id: id, revision: draft.revision)
      error = nil; await saved?(entry)
    } catch { self.error = (error as? NativeRecordLocalError) ?? .unavailable }
  }
  func close() async {
    guard !saving, !importing else { return }
    rich.blur();await recorder?.pause()
    if await flush() {
      if draft.isNew && !draft.document.hasContent && draft.attachments.isEmpty && recorder?.session == nil {
        do { try await store.discard(id:id,revision:draft.revision) }
        catch { self.error=(error as? NativeRecordLocalError) ?? .unavailable;return }
      }
      await dismissed?()
    }
  }
  func discard() async {
    guard !saving, !importing,recorder?.busy != true else { return }
    rich.blur(); saving = true
    await recorder?.pause()
    await writer?.value
    defer { saving = false }
    do { try await store.discard(id: id, revision: draft.revision); try? await recorder?.retire(); panel = nil; await dismissed?() }
    catch { self.error = (error as? NativeRecordLocalError) ?? .unavailable; panel = nil }
  }
  func presentFormat() { rich.blur(); panel = .format }
  func presentLink() {
    rich.blur(); linkText = rich.linkDisplayText; linkURL = rich.selectedURL; linkError = ""; panel = .link
  }
  func applyLink(remove: Bool = false) {
    do { try rich.link(text: remove ? "" : linkText, href: remove ? nil : linkURL); linkError = ""; panel = nil; rich.focus() }
    catch { linkError = error.localizedDescription }
  }
  func apply(_ action: RecordRichAction) {
    if action == .link { presentLink(); return }
    rich.perform(action); panel = nil; rich.focus()
  }
  func configureMedia(store: NativeRecordMediaStore, recordingDirectory: URL, input:(any NativeRecordAudioInput)?=nil) async {
    mediaStore=store
    recorder=NativeRecordRecorder(directory:recordingDirectory.appendingPathComponent(draft.id,isDirectory:true),draftID:draft.id,scope:draft.scope,driver:input ?? NativeRecordAudioDriver())
    await reloadImages()
  }
  func reloadImages() async {
    guard let mediaStore else { return }
    let images=await mediaStore.imageData(draft.attachments,scope:draft.scope)
    localImages=images.compactMapValues { NativeRecordImage.decode($0,maxPixels:1600) }
    rich.image = { [weak self] id,size in
      guard let image=self?.localImages[id] else { return nil }
      return UIGraphicsImageRenderer(size:size).image { _ in
        let factor=max(size.width/image.size.width,size.height/image.size.height)
        let target=CGSize(width:image.size.width*factor,height:image.size.height*factor)
        image.draw(in:CGRect(x:(size.width-target.width)/2,y:(size.height-target.height)/2,width:target.width,height:target.height))
      }
    }
    rich.load(draft.document)
  }
  func closeRecording() async {
    if let recorder {
      await recorder.pause()
      if !recorder.hasAudio,!recorder.busy {try? await recorder.retire()}
    }
    mediaSheet=nil
  }
  func showMedia(_ sheet:NativeRecordMediaSheet) {
    guard !saving,!importing else { return };rich.blur();panel=nil;mediaSheet=sheet
  }
  func camera() async {
    rich.blur();mediaSheet=nil
    let permitted:Bool=await withCheckedContinuation { continuation in
      switch AVCaptureDevice.authorizationStatus(for:.video) {
      case .authorized:continuation.resume(returning:true)
      case .notDetermined:AVCaptureDevice.requestAccess(for:.video) { continuation.resume(returning:$0) }
      default:continuation.resume(returning:false)
      }
    }
    if !permitted { mediaSheet = .cameraPermission }
    else if UIImagePickerController.isSourceTypeAvailable(.camera) { mediaSheet = .camera }
    else { mediaError="此设备没有可用相机" }
  }
  func importFiles(_ files:[NativeRecordPickedFile], temporary:Bool=false) async {
    guard !saving,!importing,let mediaStore else { return }
    importing=true;rich.blur();mediaError=nil
    defer { importing=false }
    var imported:[NativeRecordAttachment]=[]
    for file in files {
      do {
        var attachment=try await mediaStore.importFile(file.url,scope:draft.scope,existing:draft.attachments+imported,name:file.name,mime:file.mime)
        let original=try await mediaStore.export(attachment,scope:draft.scope)
        if let data=await NativeRecordThumbnail.make(url:original,mime:attachment.mime) {
          if let thumbnail=try? await mediaStore.store(data,scope:draft.scope,existing:[],name:"thumbnail.jpg",mime:"image/jpeg") {attachment.thumbnailSha256=thumbnail.sha256}
        }
        imported.append(attachment)
      } catch { mediaError=error.localizedDescription;break }
    }
    if !imported.isEmpty {
      draft.attachments.append(contentsOf:imported);updateCaptions()
      rich.insertAttachments(imported.map(\.id))
      if rich.textView == nil {
        var value=draft.document;value.doc.content=(value.doc.content ?? [])+imported.map { .init(type:"attachment",attrs:["attachmentId":.string($0.id)]) }
        change(value)
      }
      forcePersist();_ = await flush();await reloadImages()
    }
    // Unimported picker copies remain until the user retries or the OS clears temp storage.
    if temporary,mediaError == nil { for file in files { try? FileManager.default.removeItem(at:file.url) } }
  }
  func insertRecording() async {
    guard !saving,!importing,let recorder,recorder.state == .preview,let mediaStore else { return }
    importing=true;defer { importing=false }
    do {
      if !draft.attachments.contains(where:{$0.id == recorder.id}) {
        let attachment=try await mediaStore.importFile(recorder.output,scope:draft.scope,existing:draft.attachments,name:recorder.name,mime:"audio/mp4",id:recorder.id)
        draft.attachments.append(attachment);updateCaptions()
        if rich.textView != nil {rich.insertAttachments([attachment.id],followingText:recorder.note)}
        else {
          var document=draft.document
          let notes=recorder.note.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty ? [] : [NativeRecordNode.paragraph(recorder.note)]
          document.doc.content=(document.doc.content ?? [])+[.init(type:"attachment",attrs:["attachmentId":.string(attachment.id)])]+notes
          change(document)
        }
        forcePersist()
      }
      guard await flush() else { return }
      try await recorder.retire();mediaSheet=nil
    } catch { mediaError=error.localizedDescription }
  }
  private func updateCaptions() {
    rich.captions=Dictionary(uniqueKeysWithValues:draft.attachments.map { ($0.id,$0.name+" · "+ByteCountFormatter.string(fromByteCount:Int64($0.bytes),countStyle:.file)) })
  }
  func removeAttachment() {
    guard let removalID else { return }
    let value = NativeRecordDocument(doc: draft.document.doc.removingAttachment(removalID))
    draft.attachments.removeAll { $0.id == removalID }
    if value == draft.document { draft.modifiedAt=ISO8601DateFormatter().string(from:now());forcePersist() }
    else { change(value) }
    self.removalID = nil; panel = nil; rich.load(value)
  }
}

@MainActor
final class NativeRecordWorkbench: ObservableObject {
  let sync=NativeRecordSyncModel()
  let processing=NativeRecordProcessingModel()
  @Published var detailFrame=CGRect.zero
  @Published var editor: NativeRecordEditorModel?
  @Published var openError: String?
  private var store: (any NativeRecordLocalStorage)?
  private(set) var scope = NativeRecordLocalStore.unbound
  private weak var list: NativeRecordListModel?
  @Published private(set) var recordScopes: [String:String] = [:]
  private var token = UUID()
  private var suspended: [String: NativeRecordEditorModel] = [:]
  var now: () -> Date = Date.init
  var mediaStore: NativeRecordMediaStore?
  var recordingDirectory: URL?
  var recordingInputFactory:(() -> any NativeRecordAudioInput)?
  func prepareAdoption(_ scope:String) async -> Bool {
    await processing.flushPending()
    guard let buffer=suspended[scope] else{return true}
    guard await buffer.flush() else{return false}
    suspended.removeValue(forKey:scope);return true
  }
  func suspendForSessionChange() {
    processing.disconnect()
    token=UUID()
    if let editor {editor.rich.blur();suspended[editor.draft.scope]=editor;Task {await editor.flush()}}
    editor=nil;recordScopes=[:];openError=nil
  }
  func configure(store: (any NativeRecordLocalStorage)?, scope: String, list: NativeRecordListModel) async {
    let current = UUID(); token = current
    if let editor, self.scope != scope {
      editor.rich.blur()
      if !(await editor.flush()) { suspended[self.scope] = editor }
      guard current == token else { return }
      self.editor = nil
    }
    self.store = store; self.scope = scope; self.list = list
    await refresh()
  }
  func refresh() async {
    guard let store, let list else { return }
    let current = token
    do {
      let snapshot = try await store.snapshot(scope: scope)
      guard current == token else { return }
      let candidates = snapshot.drafts.filter { $0.id != editor?.id }
      let active = candidates.first ?? snapshot.drafts.first
      recordScopes=Dictionary(uniqueKeysWithValues:snapshot.records.map {($0.record.id,$0.scope)})
      list.installLocal(snapshot.records.map(\.record), draft: active.map {
        .init(id: $0.id, title: $0.title, modifiedAt: $0.modifiedAt)
      })
    } catch { openError = error.localizedDescription }
  }
  func open(_ record: NativeRecord? = nil, draftID: String? = nil) async {
    guard let store else { openError = "本机记录存储暂不可用"; return }
    if let editor { editor.rich.blur();guard await editor.flush() else { return } }
    let current = token
    do {
      let draft: NativeRecordEditDraft
      if let draftID, let found = try await store.snapshot(scope: scope).drafts.first(where: { $0.id == draftID }) { draft = found }
      else { draft = try await store.begin(record: record, scope: scope) }
      guard current == token else { return }
      let value: NativeRecordEditorModel
      if let buffered = suspended[draft.scope], buffered.id == draft.id { value = buffered; suspended.removeValue(forKey: draft.scope) }
      else { value = .init(draft: draft, store: store, now: now) }
      let activeID=draft.id,workspaceScope=self.scope
      value.saved = { [weak self] entry in
        guard let self,self.scope == workspaceScope,self.editor?.id == activeID else { return }
        self.editor = nil; await self.refresh()
        await self.sync.reload();self.sync.start()
        self.list?.selectedID = entry.record.id
      }
      value.dismissed = { [weak self] in
        guard let self,self.scope == workspaceScope,self.editor?.id == activeID else { return }
        self.editor = nil; await self.refresh()
      }
      if let mediaStore,let recordingDirectory { await value.configureMedia(store:mediaStore,recordingDirectory:recordingDirectory,input:recordingInputFactory?()) }
      else {
        do {
          let media=try NativeRecordMediaStore.live()
          let recording=try SharedConfiguration.container().appendingPathComponent("Records/Recordings",isDirectory:true)
          await value.configureMedia(store:media,recordingDirectory:recording)
        } catch { value.mediaError=error.localizedDescription }
      }
      editor = value; await refresh()
    } catch { openError = error.localizedDescription }
  }
}
