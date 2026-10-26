#if DEBUG
import AVFoundation
import PDFKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor struct NativeRecordMediaReview:View {
  let configuration:NativeReviewConfiguration
  @StateObject private var records=NativeRecordListModel(snapshot:.init(records:NativeRecordListReview.examples),phase:.content,origin:"https://library.inspirai.store",now:{NativeRecordListModel.date("2026-10-16T12:00:00+08:00")!})
  @StateObject private var workbench=NativeRecordWorkbench()
  @State private var module:NativeAppModule = .records
  @State private var started=false
  @State private var ready=false
  @State private var selected:NativeRecordAttachment?
  @State private var previewModel:NativeRecordMediaPreviewModel?
  private var args:[String] {ProcessInfo.processInfo.arguments}
  var body:some View {
    GeometryReader { g in
      let tablet=UIDevice.current.userInterfaceIdiom == .pad && g.size.width >= 760
      ZStack(alignment:.topLeading) {
        NativeRecordWorkspace(records:records,workbench:workbench,module:$module,autoReload:false,focusEditor:false)
        if let previewModel {
          HStack(spacing:0) {
            if tablet {Color.clear.frame(width:workbench.detailFrame.width > 0 ? max(0,workbench.detailFrame.minX-1) : g.size.width >= 1100 ? 560 : 320)}
            NativeRecordMediaPreview(model:previewModel,tablet:tablet,back:{self.previewModel=nil})
          }
        }
      }
    }.accessibilityElement(children:.contain).accessibilityIdentifier(ready ? "record.media.ready" : "record.media.loading")
    .task {
      guard !started else{return};started=true
      do {
        var key=UUID().uuidString
        if let i=args.firstIndex(of:"--review-record-store"),args.indices.contains(i+1) {key=String(args[i+1].filter {$0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-")}.prefix(80))}
        let dir=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("RecordsMediaReview/"+key,isDirectory:true)
        let scope="media-review"
        let capturedDate=NativeRecordListModel.date("2026-10-16T10:36:00+08:00")!
        let store=try NativeRecordLocalStore(directory:dir,now:{capturedDate})
        let media=try NativeRecordMediaStore(directory:dir.appendingPathComponent("Originals"))
        workbench.mediaStore=media;workbench.recordingDirectory=dir.appendingPathComponent("Recordings")
        if args.contains("--review-synthetic-audio") {workbench.recordingInputFactory={NativeRecordSyntheticAudioInput()}}
        workbench.now={NativeRecordListModel.date("2026-10-16T10:36:00+08:00")!}
        await workbench.configure(store:store,scope:scope,list:records)
        if configuration.page == "N01" {ready=true;return}
        let assets=try await Self.assets(directory:dir,media:media,scope:scope,dark:configuration.appearance == .dark)
        var record=try Self.example(attachment:assets[0])
        if configuration.page == "N04-A" {record=try NativeRecordEditorReview.example(tablet:UIDevice.current.userInterfaceIdiom == .pad);record.attachments=[assets[0]]}
        if configuration.page.hasPrefix("N06") || ["N03","N03-M"].contains(configuration.page) {record=try Self.discussion(attachment:assets[1])}
        var examples=NativeRecordListReview.examples
        if let index=examples.firstIndex(where:{$0.id == record.id}) {examples[index]=record}
        await records.configure(service:NativeRecordReviewService(records:examples),storage:nil,origin:"https://library.inspirai.store",deviceID:"media-review",expired:false)
        records.selectedID=record.id
        if UIDevice.current.userInterfaceIdiom != .pad || configuration.narrow {records.path=[record.id]}
        if configuration.page != "RECORD-LIVE" {_ = try await store.begin(record:NativeRecordListReview.examples[3],scope:scope)}
        await workbench.refresh()
        if configuration.page == "N04-A" || configuration.page == "N02" || configuration.page.hasPrefix("N06") || ["S01","S02","S03","IMPORT","RECORD-LIVE"].contains(configuration.page) {
          if configuration.page == "IMPORT" {records.path=[]}
          await workbench.open(configuration.page == "IMPORT" ? nil : record)
          guard let editor=workbench.editor else{return}
          for _ in 0..<50 {if editor.rich.textView != nil {break};try? await Task.sleep(nanoseconds:20_000_000)}
          if configuration.page == "N04-A" {editor.showMedia(.add)}
          else if configuration.page == "S02" {editor.showMedia(.cameraPermission)}
          else if configuration.page == "S03" {
            for _ in 0..<3 {let url=try await media.export(assets[0],scope:scope);editor.pendingPhotoFiles.append(.init(url:url,name:assets[0].name,mime:assets[0].mime))}
            editor.showMedia(.photosPermission)
          }
          else if configuration.page.hasPrefix("N06") || configuration.page == "S01" {
            let state:NativeRecordRecorder.State=configuration.page == "N06" ? .recording : configuration.page == "N06-P" ? .paused : configuration.page == "N06-I" ? .interrupted : configuration.page == "S01" ? .denied : .preview
            let waveCount=Int(((UIDevice.current.userInterfaceIdiom == .pad ? 500.0 : 393.0)-64)/5)
            let wave:[CGFloat]=(0..<waveCount).map { index in
              let sine=abs(sin(Double(index)*0.29)),cosine=abs(cos(Double(index)*0.073))
              return CGFloat(0.18+0.82*sine*cosine)
            }
            editor.recorder?.review(state:state,duration:configuration.page == "N06" ? 18 : 138,bytes:configuration.page == "N06" ? 216_000 : assets[1].bytes,samples:wave)
            if let recorder=editor.recorder {
              let source=try await media.verifiedURL(assets[1],scope:scope)
              try? FileManager.default.copyItem(at:source,to:recorder.output)
              if configuration.page == "N06-C" {recorder.discardConfirmation=true}
            }
            editor.showMedia(.recording)
          } else if configuration.page == "RECORD-LIVE" {editor.showMedia(.recording)}
          if args.contains("--review-import-fixture") {
            let url=try await media.export(assets[0],scope:scope)
            await editor.importFiles([.init(url:url,name:assets[0].name,mime:assets[0].mime)])
          }
        } else if configuration.page.hasPrefix("N07") {
          let map=["N07-I":0,"N07-A":1,"N07-V":2,"N07-P":3,"N07-T":4,"N07-F":5]
          var attachment=assets[map[configuration.page] ?? 0]
          var remote=false
          if ["N07-D","N07-M"].contains(configuration.page) {
            attachment = .init(id:"absent",name:"路线草图.jpg",mime:"image/jpeg",bytes:1_200_000,sha256:String(repeating:"a",count:64));remote=configuration.page == "N07-D"
          }
          if configuration.page == "N07-C" {
            let url=try await media.verifiedURL(attachment,scope:scope);try Data("corrupt".utf8).write(to:url)
          }
          if configuration.page == "N07-U" {
            attachment=try await media.store(Data("unsupported fixture video".utf8),scope:scope,existing:[],name:"湖边步道.mov",mime:"video/quicktime")
          }
          let preview=NativeRecordMediaPreviewModel(attachment:attachment,scope:scope,store:media,remote:remote)
          preview.referencePlayback=configuration.page == "N07-A";preview.referencePDF=configuration.page == "N07-P"
          previewModel=preview
        }
        ready=true
      } catch {workbench.openError=error.localizedDescription;ready=true}
    }
  }
  static func example(attachment:NativeRecordAttachment) throws -> NativeRecord {
    var record=NativeRecordListReview.examples[0];record.attachments=[attachment]
    let document=NativeRecordDocument(doc:.init(type:"doc",content:[
      .paragraph("周末徒步路线",type:"heading",level:1),
      .paragraph("周六上午从湖边出发，沿步道走到观景台，中午在返程路上吃饭。"),
      .paragraph("行程安排",type:"heading",level:2),
      .init(type:"bulletList",content:["09:00  湖边集合","11:30  步道出口午餐","14:00  返回市区"].map {.init(type:"listItem",content:[.paragraph($0)])}),
      .init(type:"attachment",attrs:["attachmentId":.string(attachment.id)])]))
    record.document=try document.json();record.text=document.plainText;return record
  }
  static func discussion(attachment:NativeRecordAttachment) throws -> NativeRecord {
    var record=NativeRecordListReview.examples[2];record.attachments=[attachment];record.updatedAt="2026-10-16T10:30:00+08:00"
    record.tasks=[.init(id:"task-3",state:"awaiting_review",recordVersion:3,createdAt:"2026-10-16T10:32:00+08:00",title:"整理摘要")]
    let doc=NativeRecordDocument(doc:.init(type:"doc",content:[.paragraph(record.title,type:"heading",level:1),.paragraph("讨论了记录入口、媒体导入和跨端同步的操作方式。"),.paragraph("确定的调整",type:"heading",level:2),.init(type:"bulletList",content:["记录入口放在底栏第一项。","拍照和录音放在输入区底部。","高级派发选项默认收起。"].map {.init(type:"listItem",content:[.paragraph($0)])}),.init(type:"attachment",attrs:["attachmentId":.string(attachment.id)])]))
    record.document=try doc.json();record.text=doc.plainText;return record
  }
  static func assets(directory:URL,media:NativeRecordMediaStore,scope:String,dark:Bool) async throws -> [NativeRecordAttachment] {
    let renderer=ImageRenderer(content:NativeRecordRouteFixture(labelAlignment:.leading).frame(width:800,height:600).environment(\.colorScheme,dark ? .dark : .light));renderer.scale=2
    guard let image=renderer.uiImage,let jpeg=image.jpegData(compressionQuality:1) else {throw NativeRecordMediaError.unavailable}
    let imageAttachment=try await media.store(Self.paddedJPEG(jpeg,bytes:1_200_000),scope:scope,existing:[],name:"路线草图.jpg",mime:"image/jpeg",id:"route")
    let cafURL=directory.appendingPathComponent("fixture.wav")
    let format=AVAudioFormat(standardFormatWithSampleRate:44100,channels:1)!
    do {
      let wav=try AVAudioFile(forWriting:cafURL,settings:format.settings)
      for chunk in 0..<138 {
        let buffer=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:44100)!;buffer.frameLength=44100
        for i in 0..<44100 {buffer.floatChannelData![0][i]=Float(0.25*sin(Double(chunk*44100+i)*0.08))};try wav.write(from:buffer)
      }
    }
    let audioURL=directory.appendingPathComponent(UUID().uuidString+".m4a")
    do {
      let input=try AVAudioFile(forReading:cafURL)
      let output=try AVAudioFile(forWriting:audioURL,settings:[AVFormatIDKey:kAudioFormatMPEG4AAC,AVSampleRateKey:44100,AVNumberOfChannelsKey:1,AVEncoderBitRateKey:64000,AVEncoderBitRateStrategyKey:AVAudioBitRateStrategy_Constant])
      let buffer=AVAudioPCMBuffer(pcmFormat:input.processingFormat,frameCapacity:4096)!
      while input.framePosition < input.length {try input.read(into:buffer);if buffer.frameLength == 0 {break};try output.write(from:buffer)}
    }
    var audioData=try Data(contentsOf:audioURL)
    let padding=2_100_000-audioData.count
    if padding >= 8 {
      let size=UInt32(padding)
      audioData.append(contentsOf:[UInt8(size>>24),UInt8((size>>16)&255),UInt8((size>>8)&255),UInt8(size&255),0x66,0x72,0x65,0x65])
      audioData.append(Data(repeating:0,count:padding-8));try audioData.write(to:audioURL)
    }
    let sound=try await media.importFile(audioURL,scope:scope,existing:[],name:"产品讨论-10月16日.m4a",mime:"audio/mp4",id:"audio")
    let pdfURL=directory.appendingPathComponent("fixture.pdf")
    let pdf=UIGraphicsPDFRenderer(bounds:CGRect(x:0,y:0,width:352,height:473)).pdfData { context in
      for _ in 0..<8 {
        context.beginPage();UIColor.white.setFill();context.cgContext.fill(CGRect(x:0,y:0,width:352,height:473))
        ("湖边步道指南" as NSString).draw(at:CGPoint(x:30,y:30),withAttributes:[.font:UIFont.systemFont(ofSize:25,weight:.semibold),.foregroundColor:UIColor.darkGray])
        ("路线与安全信息" as NSString).draw(at:CGPoint(x:30,y:79),withAttributes:[.font:UIFont.systemFont(ofSize:15),.foregroundColor:UIColor.gray])
        image.draw(in:CGRect(x:30,y:122,width:292,height:155))
        ("步道全长 6.8 公里，沿湖向东经过林荫路与观景台。" as NSString).draw(in:CGRect(x:30,y:302,width:292,height:90),withAttributes:[.font:UIFont.systemFont(ofSize:15),.foregroundColor:UIColor.darkGray])
        ("开放时间  06:00–18:00" as NSString).draw(at:CGPoint(x:30,y:405),withAttributes:[.font:UIFont.systemFont(ofSize:14),.foregroundColor:UIColor.gray])
      }
    }
    try pdf.write(to:pdfURL)
    let document=try await media.importFile(pdfURL,scope:scope,existing:[],name:"步道指南.pdf",mime:"application/pdf",id:"pdf")
    let text=try await media.store(Data("周末徒步路线\n\n09:00  湖边集合\n09:30  沿步道步行\n11:30  步道出口午餐\n14:00  返回市区\n\n携带饮水、雨具与充电宝。".utf8),scope:scope,existing:[],name:"行程安排.txt",mime:"text/plain",id:"text")
    let file=try await media.store(Data([0x50,0x4b,0x05,0x06]+Array(repeating:0,count:18)),scope:scope,existing:[],name:"讨论材料.zip",mime:"application/zip",id:"zip")
    let video=try await videoFixture(directory:directory,image:image,media:media,scope:scope)
    return [imageAttachment,sound,video,document,text,file]
  }
  // A standards-compliant JPEG comment payload gives the byte-accurate capacity
  // fixture its approved 1.2 MB size. These bytes never contain interface pixels.
  private static func paddedJPEG(_ data:Data,bytes:Int)->Data {
    guard data.count+4 < bytes,data.suffix(2) == Data([0xff,0xd9]) else{return data}
    var result=Data(data.dropLast(2)),remaining=bytes-data.count
    while remaining >= 4 {
      var count=min(65531,remaining-4)
      if (1...3).contains(remaining-count-4) {count -= 4}
      let length=count+2
      result.append(contentsOf:[0xff,0xfe,UInt8(length>>8),UInt8(length&255)])
      result.append(Data(repeating:0,count:count));remaining -= count+4
    }
    result.append(contentsOf:[0xff,0xd9]);return result
  }
  private static func videoFixture(directory:URL,image:UIImage,media:NativeRecordMediaStore,scope:String) async throws -> NativeRecordAttachment {
    let url=directory.appendingPathComponent(UUID().uuidString+".mov")
    let writer=try AVAssetWriter(outputURL:url,fileType:.mov)
    let input=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:640,AVVideoHeightKey:360])
    let adaptor=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32ARGB,kCVPixelBufferWidthKey as String:640,kCVPixelBufferHeightKey as String:360])
    writer.add(input);writer.startWriting();writer.startSession(atSourceTime:.zero)
    for frame in 0..<2 {
      while !input.isReadyForMoreMediaData {try await Task.sleep(nanoseconds:10_000_000)}
      var pixel:CVPixelBuffer?;CVPixelBufferCreate(kCFAllocatorDefault,640,360,kCVPixelFormatType_32ARGB,nil,&pixel)
      if let pixel {
        CVPixelBufferLockBaseAddress(pixel,[])
        if let context=CGContext(data:CVPixelBufferGetBaseAddress(pixel),width:640,height:360,bitsPerComponent:8,bytesPerRow:CVPixelBufferGetBytesPerRow(pixel),space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipFirst.rawValue),let cg=image.cgImage {context.draw(cg,in:CGRect(x:0,y:0,width:640,height:360))}
        CVPixelBufferUnlockBaseAddress(pixel,[]);adaptor.append(pixel,withPresentationTime:CMTime(seconds:Double(frame)*32,preferredTimescale:600))
      }
    }
    input.markAsFinished();await withCheckedContinuation {(c:CheckedContinuation<Void,Never>) in writer.finishWriting {c.resume()}}
    guard writer.status == .completed else {throw writer.error ?? NativeRecordMediaError.unavailable}
    return try await media.importFile(url,scope:scope,existing:[],name:"湖边步道.mov",mime:"video/quicktime",id:"video")
  }
}
/// Controlled PCM input for the UI persistence pipeline only. Never used by the
/// microphone test or release app, and never reported as physical recording.
actor NativeRecordSyntheticAudioInput:NativeRecordAudioInput {
  nonisolated let requiresMicrophone=false
  private var producer:Task<Void,Never>?
  func start(sink:NativeRecordAudioSink) {
    producer=Task.detached(priority:.userInitiated) {
      guard let format=AVAudioFormat(standardFormatWithSampleRate:8000,channels:1) else{return}
      var frame=0
      while !Task.isCancelled {
        guard let buffer=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:800) else{break};buffer.frameLength=800
        for i in 0..<800 {buffer.floatChannelData![0][i]=Float(0.2*sin(Double(frame+i)*0.08))};frame += 800;sink.consume(buffer)
        do {try await Task.sleep(nanoseconds:100_000_000)} catch {break}
      }
    }
  }
  func stop() async {producer?.cancel();await producer?.value;producer=nil}
}
#endif
