import AVFoundation
import ImageIO
import XCTest
import UIKit
@testable import PersonalLibrary

final class NativeRecordMediaTests:XCTestCase {
  private func directory()->URL {FileManager.default.temporaryDirectory.appendingPathComponent("RecordMediaTest-"+UUID().uuidString,isDirectory:true)}
  func testOriginalDurableHashReopenAndScopeIsolation() async throws {
    let dir=directory();defer {try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordMediaStore(directory:dir)
    let data=Data("原件 original 👩🏽‍💻".utf8)
    let attachment=try await store.store(data,scope:"a",existing:[],name:"notes.txt",mime:"text/plain")
    XCTAssertEqual(attachment.bytes,data.count);XCTAssertEqual(attachment.sha256,NativeRecordMediaStore.digest(data))
    let reopened=try NativeRecordMediaStore(directory:dir)
    let url=try await reopened.verifiedURL(attachment,scope:"a")
    XCTAssertEqual(try Data(contentsOf:url),data)
    do {_ = try await reopened.verifiedURL(attachment,scope:"b");XCTFail("Cross scope file read")} catch {XCTAssertEqual(error as? NativeRecordMediaError,.missing)}
    let copy=try await reopened.export(attachment,scope:"a");XCTAssertEqual(copy.lastPathComponent,"notes.txt");XCTAssertEqual(try Data(contentsOf:copy),data)
  }
  func testCorruptionAndSizeMismatchCannotPreviewOrExport() async throws {
    let dir=directory();defer {try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordMediaStore(directory:dir)
    let attachment=try await store.store(Data("abc".utf8),scope:"a",existing:[],name:"a.txt",mime:"text/plain")
    let url=try await store.verifiedURL(attachment,scope:"a");try Data("bad".utf8).write(to:url)
    do {_ = try await store.export(attachment,scope:"a");XCTFail()} catch {XCTAssertEqual(error as? NativeRecordMediaError,.corrupt)}
    try Data().write(to:url)
    do {_ = try await store.verifiedURL(attachment,scope:"a");XCTFail()} catch {XCTAssertEqual(error as? NativeRecordMediaError,.corrupt)}
    _ = try await store.store(Data("abc".utf8),scope:"a",existing:[],name:"a.txt",mime:"text/plain")
    let healed=try await store.verifiedURL(attachment,scope:"a");XCTAssertEqual(try Data(contentsOf:healed),Data("abc".utf8))
  }
  func testCapacityUsesActualBytesCountAndTotalBeforeCopy() async throws {
    let dir=directory();defer {try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordMediaStore(directory:dir)
    let entry=NativeRecordAttachment(id:"one",name:"file",mime:"x",bytes:32*1024*1024,sha256:String(repeating:"a",count:64))
    XCTAssertThrowsError(try NativeRecordMediaStore.validate(size:32*1024*1024+1,existing:[]))
    XCTAssertThrowsError(try NativeRecordMediaStore.validate(size:1,existing:Array(repeating:entry,count:20)))
    XCTAssertThrowsError(try NativeRecordMediaStore.validate(size:1,existing:Array(repeating:entry,count:4)))
    XCTAssertThrowsError(try NativeRecordMediaStore.validate(size:0,existing:[]))
    do {_ = try await store.store(Data(),scope:"a",existing:[],name:"empty",mime:"x");XCTFail()} catch {}
  }
  @MainActor func testImportInsertDraftKillReopenCommitAndDiscardPreserveOriginal() async throws {
    let dir=directory();defer {try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Media"))
    let draft=try await store.begin(record:nil,scope:"a")
    let model=NativeRecordEditorModel(draft:draft,store:store)
    await model.configureMedia(store:media,recordingDirectory:dir.appendingPathComponent("Recordings"))
    let view=UITextView(usingTextLayoutManager:false);view.delegate=model.rich;model.rich.textView=view
    model.rich.load(.plain("Before\nAfter"));view.selectedRange=NSRange(location:6,length:0);model.rich.textViewDidChangeSelection(view)
    let source=dir.appendingPathComponent("original.txt");try Data("attachment contents".utf8).write(to:source)
    await model.importFiles([.init(url:source,name:"original.txt",mime:"text/plain")])
    XCTAssertNil(model.mediaError);XCTAssertEqual(model.draft.attachments.count,1)
    let attachment=try XCTUnwrap(model.draft.attachments.first)
    XCTAssertEqual(model.draft.document.doc.referencedAttachments,[attachment.id])
    XCTAssertTrue(model.draft.document.plainText.contains("Before"));XCTAssertTrue(model.draft.document.plainText.contains("After"))
    let reopened=try NativeRecordLocalStore(directory:dir)
    let snapshot=try await reopened.snapshot(scope:"a");let restored=try XCTUnwrap(snapshot.drafts.first)
    XCTAssertEqual(restored.attachments,[attachment]);XCTAssertEqual(restored.document,model.draft.document)
    _ = try await reopened.commit(id:restored.id,revision:restored.revision)
    let originalURL=try await media.verifiedURL(attachment,scope:"a");XCTAssertEqual(try Data(contentsOf:originalURL),Data("attachment contents".utf8))
    var next=try await reopened.begin(record:(try await reopened.snapshot(scope:"a")).records.first!.record,scope:"a")
    next.attachments=[];next.document = .plain("removed locally");next.revision=try await reopened.persist(next)
    try await reopened.discard(id:next.id,revision:next.revision)
    _ = try await media.verifiedURL(attachment,scope:"a")
  }
  @MainActor func testImportFailureLeavesEarlierDocumentAndOriginalsUntouched() async throws {
    let dir=directory();defer {try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Media"))
    let model=NativeRecordEditorModel(draft:try await store.begin(record:nil,scope:"a"),store:store)
    await model.configureMedia(store:media,recordingDirectory:dir.appendingPathComponent("Recordings"));model.change(.plain("Keep this"))
    await model.importFiles([.init(url:dir.appendingPathComponent("absent"),name:"absent",mime:"x")])
    XCTAssertNotNil(model.mediaError);XCTAssertEqual(model.draft.document.plainText,"Keep this");XCTAssertTrue(model.draft.attachments.isEmpty)
    let flushed=await model.flush();XCTAssertTrue(flushed)
  }
  private func wave(_ url:URL,seconds:Int=1) throws {
    let format=AVAudioFormat(standardFormatWithSampleRate:8000,channels:1)!
    let writer=try AVAudioFile(forWriting:url,settings:format.settings)
    let buffer=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:UInt32(8000*seconds))!;buffer.frameLength=buffer.frameCapacity
    for i in 0..<Int(buffer.frameLength) {buffer.floatChannelData![0][i]=Float(0.2*sin(Double(i)*0.1))};try writer.write(from:buffer)
  }
  @MainActor func testRecordingRecoverySealedAndActiveSegmentsExportAndNote() async throws {
    let dir=directory();defer {try? FileManager.default.removeItem(at:dir)};try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
    try wave(dir.appendingPathComponent("a.caf"));try wave(dir.appendingPathComponent("active.caf"))
    let session=NativeRecordRecordingSession(id:"recording-id",draftID:"draft",scope:"a",createdAt:"2026-10-16T10:42:00+08:00",name:"讨论.m4a",note:"保留的备注",segments:["a.caf"],active:"active.caf",duration:1,state:"recording")
    try JSONEncoder().encode(session).write(to:dir.appendingPathComponent("session.json"))
    let recovered=NativeRecordRecorder(directory:dir,draftID:"draft",scope:"a")
    XCTAssertEqual(recovered.state,.interrupted);XCTAssertEqual(recovered.note,"保留的备注");XCTAssertEqual(recovered.durable,2,accuracy:0.05)
    await recovered.finish();XCTAssertEqual(recovered.state,.preview);XCTAssertTrue(FileManager.default.fileExists(atPath:recovered.output.path))
    let asset=AVURLAsset(url:recovered.output);let duration=try await asset.load(.duration);XCTAssertEqual(duration.seconds,2,accuracy:0.1)
    let reopened=NativeRecordRecorder(directory:dir,draftID:"draft",scope:"a");XCTAssertEqual(reopened.state,.preview);XCTAssertEqual(reopened.note,"保留的备注")
    try await reopened.retire();XCTAssertNil(reopened.session);XCTAssertFalse(FileManager.default.fileExists(atPath:dir.appendingPathComponent("a.caf").path))
  }
  @MainActor func testCorruptActiveRecordingRetainsSealedSegmentsAndWrongOwnerCannotRestore() async throws {
    let dir=directory();defer {try? FileManager.default.removeItem(at:dir)};try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
    try wave(dir.appendingPathComponent("sealed.caf"));try Data("incomplete".utf8).write(to:dir.appendingPathComponent("active.m4a"))
    let session=NativeRecordRecordingSession(id:"r",draftID:"draft",scope:"a",createdAt:"",name:"r.m4a",segments:["sealed.caf"],active:"active.m4a",duration:1,state:"recording")
    try JSONEncoder().encode(session).write(to:dir.appendingPathComponent("session.json"))
    let wrong=NativeRecordRecorder(directory:dir,draftID:"other",scope:"b");XCTAssertEqual(wrong.state,.failure)
    let recovered=NativeRecordRecorder(directory:dir,draftID:"draft",scope:"a");XCTAssertEqual(recovered.durable,1,accuracy:0.01);XCTAssertEqual(recovered.session?.segments,["sealed.caf"])
    await recovered.finish();XCTAssertEqual(recovered.state,.preview)
  }
  @MainActor func testPreviewRejectsCorruptImageAndPreservesExportableOriginal() async throws {
    let dir=directory();defer {try? FileManager.default.removeItem(at:dir)}
    let store=try NativeRecordMediaStore(directory:dir)
    let attachment=try await store.store(Data("invalid image".utf8),scope:"a",existing:[],name:"photo.heic",mime:"image/heic")
    let model=NativeRecordMediaPreviewModel(attachment:attachment,scope:"a",store:store,remote:false)
    await model.load();XCTAssertEqual(model.phase,.unsupported)
    await model.export();XCTAssertNotNil(model.shareURL)
  }
  func testContinuousAudioSinkRotatesWithoutLosingFramesAndPersistsCheckpoints() throws {
    let dir=directory();defer{try? FileManager.default.removeItem(at:dir)}
    try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
    let session=NativeRecordRecordingSession(id:"continuous",draftID:"draft",scope:"a",createdAt:"",name:"audio.m4a",state:"recording")
    let sink=NativeRecordAudioSink(directory:dir,session:session)
    let format=AVAudioFormat(standardFormatWithSampleRate:8000,channels:1)!
    for chunk in 0..<3 {
      let buffer=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:8000)!;buffer.frameLength=8000
      for index in 0..<8000 {buffer.floatChannelData![0][index]=Float(chunk*8000+index)/24000}
      sink.consume(buffer)
    }
    XCTAssertEqual(sink.snapshot().0.duration,2,accuracy:0.01)
    XCTAssertEqual(sink.snapshot().1,3,accuracy:0.01)
    try sink.updateNote("已更新备注")
    let value=try sink.seal(state:"paused")
    XCTAssertEqual(value.duration,3,accuracy:0.01);XCTAssertEqual(value.note,"已更新备注")
    var samples:[Float]=[]
    for name in value.segments {
      let file=try AVAudioFile(forReading:dir.appendingPathComponent(name))
      XCTAssertEqual(file.length,name == value.segments.first ? 16000 : 8000)
      let buffer=AVAudioPCMBuffer(pcmFormat:file.processingFormat,frameCapacity:4096)!
      while file.framePosition < file.length {
        try file.read(into:buffer)
        guard buffer.frameLength > 0 else {break}
        samples += Array(UnsafeBufferPointer(start:buffer.floatChannelData![0],count:Int(buffer.frameLength)))
      }
    }
    XCTAssertEqual(samples.count,24000)
    XCTAssertEqual(samples[15999],Float(15999)/24000,accuracy:0.00001)
    XCTAssertEqual(samples[16000],Float(16000)/24000,accuracy:0.00001)
    let persisted=try JSONDecoder().decode(NativeRecordRecordingSession.self,from:Data(contentsOf:dir.appendingPathComponent("session.json")))
    XCTAssertNil(persisted.active);XCTAssertEqual(persisted.state,"paused");XCTAssertEqual(persisted.segments.count,2)
  }
  @MainActor func testReadMarksPreserveLinkDisplayBoldItalicAndStrike() throws {
    let node=NativeRecordNode(type:"paragraph",content:[.init(type:"text",text:"链接",marks:[.init(type:"bold"),.init(type:"italic"),.init(type:"strike"),.init(type:"link",attrs:["href":.string("https://example.com/path")])])])
    let value=NativeRecordReadText.attributed(node,size:17,heading:false,dark:false)
    XCTAssertEqual(value.string,"链接")
    XCTAssertEqual(value.attribute(.link,at:0,effectiveRange:nil) as? URL,URL(string:"https://example.com/path"))
    let font=try XCTUnwrap(value.attribute(.font,at:0,effectiveRange:nil) as? UIFont)
    XCTAssertTrue(font.fontDescriptor.symbolicTraits.contains(.traitItalic));XCTAssertTrue(font.fontDescriptor.symbolicTraits.contains(.traitBold))
    XCTAssertEqual(value.attribute(.strikethroughStyle,at:0,effectiveRange:nil) as? Int,NSUnderlineStyle.single.rawValue)
  }

  @MainActor func testAudioPreviewUsesVerifiedTypedCopyFromHashStore() async throws {
    let dir=directory();defer{try? FileManager.default.removeItem(at:dir)}
    try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
    let source=dir.appendingPathComponent("recording.wav");try wave(source,seconds:2)
    let store=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Media"))
    let attachment=try await store.importFile(source,scope:"a",existing:[],name:"recording.wav",mime:"audio/wav")
    let model=NativeRecordMediaPreviewModel(attachment:attachment,scope:"a",store:store,remote:false)
    await model.load();XCTAssertEqual(model.phase,.ready);XCTAssertEqual(model.duration,2,accuracy:0.05)
    XCTAssertEqual(model.url?.pathExtension,"wav");XCTAssertNotNil(model.player.currentItem)
    model.seek(0.5);XCTAssertEqual(model.position,0.5,accuracy:0.01);model.toggle();XCTAssertTrue(model.playing);model.close();XCTAssertFalse(model.playing)
  }

  @MainActor func testRecordingInsertKeepsNoteAndRetainsSessionUntilDraftIsDurable() async throws {
    let dir=directory();defer{try? FileManager.default.removeItem(at:dir)}
    let base=try NativeRecordLocalStore(directory:dir),media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Media"))
    let draft=try await base.begin(record:nil,scope:"a")
    let failing=NativeRecordEditorFaultStore(base:base,kind:"N02-D")
    let model=NativeRecordEditorModel(draft:draft,store:failing)
    await model.configureMedia(store:media,recordingDirectory:dir.appendingPathComponent("Recordings"))
    let recordingDirectory=try XCTUnwrap(model.recorder?.directory)
    try wave(recordingDirectory.appendingPathComponent("sealed.caf"))
    let session=NativeRecordRecordingSession(id:"recording-note",draftID:draft.id,scope:"a",createdAt:"2026-10-16T10:42:00+08:00",name:"讨论.m4a",note:"不要丢失录音备注",segments:["sealed.caf"],duration:1,state:"interrupted")
    try JSONEncoder().encode(session).write(to:recordingDirectory.appendingPathComponent("session.json"))
    let recorder=NativeRecordRecorder(directory:recordingDirectory,draftID:draft.id,scope:"a");await recorder.finish()
    XCTAssertEqual(recorder.state,.preview);model.recorder=recorder
    let view=UITextView(usingTextLayoutManager:false);view.delegate=model.rich;model.rich.textView=view;model.rich.load(.plain(""))
    XCTAssertFalse(model.canSave)
    await model.insertRecording()
    XCTAssertNotNil(recorder.session);XCTAssertTrue(FileManager.default.fileExists(atPath:recorder.output.path))
    XCTAssertEqual(model.error,.diskFull);XCTAssertEqual(model.draft.attachments.count,1)
    await model.insertRecording()
    XCTAssertNil(recorder.session);XCTAssertEqual(model.draft.attachments.count,1)
    let restored=try await base.snapshot(scope:"a")
    XCTAssertTrue(restored.drafts[0].document.plainText.contains("不要丢失录音备注"))
    XCTAssertEqual(restored.drafts[0].document.doc.referencedAttachments,["recording-note"])
    _ = try await media.verifiedURL(restored.drafts[0].attachments[0],scope:"a")
  }

  @MainActor func testCameraJPEGKeepsProvidedExifAndOriginalPixelDimensions() throws {
    let image=UIGraphicsImageRenderer(size:CGSize(width:160,height:120)).image {context in UIColor.orange.setFill();context.fill(CGRect(x:0,y:0,width:160,height:120))}
    let stamp="2026:10:16 10:42:00"
    let data=try XCTUnwrap(NativeRecordImage.cameraJPEG(image,metadata:[kCGImagePropertyExifDictionary as String:[kCGImagePropertyExifDateTimeOriginal as String:stamp]]))
    XCTAssertEqual(NativeRecordImage.dimensions(data)?.0,Int(image.size.width*image.scale))
    let source=try XCTUnwrap(CGImageSourceCreateWithData(data as CFData,nil))
    let properties=try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source,0,nil) as? [CFString:Any])
    XCTAssertEqual((properties[kCGImagePropertyExifDictionary] as? [String:Any])?[kCGImagePropertyExifDateTimeOriginal as String] as? String,stamp)
  }

  @MainActor func testNativeReaderLineBreaksMatchCoreTextWithoutChangingStoredText() {
    let node=NativeRecordNode.paragraph("讨论了记录入口、媒体导入和跨端同步的操作方式。")
    let value=NativeRecordReadText.attributed(node,size:17,heading:false,dark:false)
    let lines=NativeRecordReadText.lines(value,width:353)
    XCTAssertEqual(lines.count,2);XCTAssertEqual(lines[0].string,"讨论了记录入口、媒体导入和跨端同步的操作")
    XCTAssertEqual(lines.map(\.string).joined(),node.plainText)
    XCTAssertEqual(NativeRecordReadText.lines(value,width:586).map(\.string).joined(),node.plainText)
    let emoji=NativeRecordReadText.attributed(.paragraph("👩🏽‍💻中文"),size:40,heading:false,dark:false)
    XCTAssertEqual(NativeRecordReadText.lines(emoji,width:1).map(\.string).joined(),"👩🏽‍💻中文")
  }

}
