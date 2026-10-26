import AVKit
import PDFKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor final class NativeRecordMediaPreviewModel: ObservableObject {
  enum Phase:String { case loading, ready, remote, missing, corrupt, unsupported }
  let attachment:NativeRecordAttachment
  let scope:String
  let store:NativeRecordMediaStore
  let remote:Bool
  let downloadOriginal:((NativeRecordAttachment) async throws -> Void)?
  @Published var phase:Phase = .loading
  @Published var url:URL?
  @Published var shareURL:URL?
  @Published var image:UIImage?
  @Published var text=""
  @Published var metadata=""
  @Published var error:String?
  @Published var duration:Double=0
  @Published var position:Double=0
  @Published var playing=false
  @Published var rate:Float=1
  @Published var zoom:CGFloat=1
  @Published var pdfPage=1
  @Published var pdfCount=0
  @Published var samples:[CGFloat]=[]
#if DEBUG
  var referencePlayback=false
  var referencePDF=false
#endif
  let player=AVPlayer()
  private var observer:Any?
  private var endObserver:NSObjectProtocol?
  init(attachment:NativeRecordAttachment,scope:String,store:NativeRecordMediaStore,remote:Bool,downloadOriginal:((NativeRecordAttachment) async throws -> Void)?=nil) {
    self.attachment=attachment;self.scope=scope;self.store=store;self.remote=remote;self.downloadOriginal=downloadOriginal
    observer=player.addPeriodicTimeObserver(forInterval:CMTime(seconds:0.2,preferredTimescale:600),queue:.main) { [weak self] time in
      Task { @MainActor in
#if DEBUG
        if self?.referencePlayback == true {return}
#endif
        self?.position=max(0,time.seconds.isFinite ? time.seconds : 0)
      }
    }
    endObserver=NotificationCenter.default.addObserver(forName:.AVPlayerItemDidPlayToEndTime,object:nil,queue:.main) { [weak self] note in
      guard let item=note.object as? AVPlayerItem else { return }
      Task { @MainActor in if self?.player.currentItem === item { self?.playing=false } }
    }
  }
  deinit { if let observer {player.removeTimeObserver(observer)};if let endObserver {NotificationCenter.default.removeObserver(endObserver)} }
  var size:String { ByteCountFormatter.string(fromByteCount:Int64(attachment.bytes),countStyle:.file) }
  func load() async {
    phase = .loading;error=nil
    do {
      let verified=try await store.verifiedURL(attachment,scope:scope);url=verified
      let mime=attachment.mime
      var prefix=""
      if mime.hasPrefix("image/") {
        guard let data=try? Data(contentsOf:verified),let decoded=NativeRecordImage.decode(data,maxPixels:4096) else {phase = .unsupported;return}
        image=decoded;let dimensions=NativeRecordImage.dimensions(data) ?? (Int(decoded.size.width),Int(decoded.size.height));prefix="\(dimensions.0.formatted()) × \(dimensions.1.formatted()) · "
      } else if mime == "application/pdf" {
        guard let document=PDFDocument(url:verified),document.pageCount > 0 else {phase = .unsupported;return}
        pdfCount=document.pageCount;prefix="\(pdfCount) 页 · "
      } else if mime.hasPrefix("audio/") || mime.hasPrefix("video/") {
        let typed=try await store.export(attachment,scope:scope)
        url=typed
        let asset=AVURLAsset(url:typed)
        guard (try? await asset.load(.isPlayable)) == true else {phase = .unsupported;return}
        let value=try await asset.load(.duration);duration=value.seconds.isFinite ? value.seconds : 0
        prefix=Self.time(duration)+" · ";player.replaceCurrentItem(with:AVPlayerItem(asset:asset))
        if mime.hasPrefix("audio/") { samples=await Self.waveform(typed) }
      } else if mime.hasPrefix("text/") || ["application/json","application/xml"].contains(mime) {
        let data=try Data(contentsOf:verified)
        guard let decoded=String(data:data,encoding:.utf8) else {phase = .unsupported;return}
        text=decoded;prefix="UTF-8 · "
      }
#if DEBUG
      if referencePlayback {position=min(52,duration);playing=true;await player.seek(to:CMTime(seconds:position,preferredTimescale:600))}
      if referencePDF,pdfCount >= 2 {pdfPage=2}
#endif
      metadata=prefix+size+" · 本机原件";phase = .ready
    } catch let issue as NativeRecordMediaError {
      phase=issue == .corrupt ? .corrupt : issue == .missing ? (remote ? .remote : .missing) : .unsupported
    } catch { phase = .missing;self.error=error.localizedDescription }
  }
  static func time(_ value:Double) -> String { String(format:"%02d:%02d",max(0,Int(value))/60,max(0,Int(value))%60) }
  nonisolated static func waveform(_ url:URL) async -> [CGFloat] {
    await Task.detached(priority:.utility) {
      guard let file=try? AVAudioFile(forReading:url),let buffer=AVAudioPCMBuffer(pcmFormat:file.processingFormat,frameCapacity:4096) else {return []}
      var values:[CGFloat]=[]
      while file.framePosition < file.length {
        do {try file.read(into:buffer)} catch {break}
        guard let channel=buffer.floatChannelData?[0],buffer.frameLength > 0 else {break}
        var peak:Float=0
        for i in 0..<Int(buffer.frameLength) {peak=max(peak,abs(channel[i]))}
        values.append(CGFloat(max(0.04,min(1,sqrt(peak)))))
      }
      guard values.count > 140 else {return values}
      return (0..<140).map {values[$0*values.count/140]}
    }.value
  }
  func toggle() {
#if DEBUG
    if referencePlayback {referencePlayback=false;player.pause();playing=false;return}
#endif
    if playing {player.pause();playing=false}
    else { if position >= duration {seek(0)};do {try AVAudioSession.sharedInstance().setCategory(.playback);try AVAudioSession.sharedInstance().setActive(true)} catch {self.error=error.localizedDescription;return};player.playImmediately(atRate:rate);playing=true }
  }
  func seek(_ value:Double) {position=max(0,min(duration,value));player.seek(to:CMTime(seconds:position,preferredTimescale:600))}
  func export() async {do {shareURL=try await store.export(attachment,scope:scope)} catch {self.error=error.localizedDescription}}
  func recoverOriginal() async {
    guard let downloadOriginal else {error="尚未连接原资料空间，当前无法下载原件。";return}
    phase = .loading
    do {try await downloadOriginal(attachment);await load()} catch {self.error=(error as? NativeRecordSyncFailure)?.errorDescription ?? (error as? CollectorError)?.errorDescription ?? "原件下载失败 · 请重试";phase = .remote}
  }
  func close() {player.pause();playing=false}
}

struct NativeRecordMediaPreview:View {
  @StateObject var model:NativeRecordMediaPreviewModel
  let tablet:Bool
  let back:()->Void
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale:CGFloat=1
  @State private var pages=false
  private var p:NativePalette {.init(dark:scheme == .dark)}
  var body:some View {
    GeometryReader { g in
      VStack(alignment:.leading,spacing:0) {
        header.padding(.horizontal,tablet ? 24 : 20).padding(.top,tablet ? 23 : 54).frame(height:scale > 1.4 ? (tablet ? 23 : 54)+70 : tablet ? 72 : 88,alignment:.top).overlay(alignment:.bottom){Rectangle().fill(p.separator).frame(height:0.5)}
        ScrollView {
          VStack(alignment:.leading,spacing:0) {
            RecordText(model.attachment.name,19,weight:.semibold,lines:1).accessibilityIdentifier("record.preview.name")
            RecordText(model.metadata.isEmpty ? model.size+" · 原件" : model.metadata,12).foregroundStyle(p.secondary).padding(.top,10)
            if model.phase == .loading {ProgressView().frame(maxWidth:.infinity,minHeight:200)}
            else if model.phase == .ready {content(width:max(1,g.size.width-(tablet ? 48 : 40))).padding(.top,29)}
            else {failure(width:max(1,g.size.width-(tablet ? 48 : 40))).padding(.top,29)}
          }.padding(.horizontal,tablet ? 24 : 20).padding(.top,tablet ? 22 : 24).padding(.bottom,30)
        }
        if model.phase == .ready && !generic {
          Button {Task {await model.export()}} label: {NativeRecordActionButton(title:"保存原件")}.padding(.horizontal,tablet ? 24 : 20).padding(.vertical,14)
            .background(p.paper).overlay(alignment:.top){Rectangle().fill(p.separator).frame(height:0.5)}.accessibilityIdentifier("record.preview.export")
        }
        if !tablet {Color.clear.frame(height:34)}
      }.background(p.paper).foregroundStyle(p.label)
      .sheet(isPresented:.init(get:{model.shareURL != nil},set:{if !$0 {model.shareURL=nil}})) {if let url=model.shareURL {NativeRecordActivity(items:[url])}}
      .sheet(isPresented:$pages) {
        if let url=model.url,let pdf=PDFDocument(url:url) {
          NavigationStack {ScrollView {LazyVGrid(columns:[GridItem(.adaptive(minimum:130))],spacing:16) {
            ForEach(0..<pdf.pageCount,id:\.self) { index in
              if let page=pdf.page(at:index) {
                Button {model.pdfPage=index+1;pages=false} label:{VStack {Image(uiImage:page.thumbnail(of:CGSize(width:240,height:300),for:.mediaBox)).resizable().scaledToFit();Text("\(index+1)")}}
              }
            }
          }.padding()}.navigationTitle("页面").toolbar {Button("完成"){pages=false}}}
        }
      }
      .overlay {if let error=model.error {NativeConfirmation(title:"无法完成操作",bodyText:error,actionTitle:"好",confirm:{model.error=nil},cancel:{model.error=nil})}}
    }.ignoresSafeArea().buttonStyle(.plain).task {await model.load()}.onDisappear {model.close()}
      .accessibilityElement(children:.contain).accessibilityIdentifier("record.preview")
  }
  private var generic:Bool {let mime=model.attachment.mime;return !mime.hasPrefix("image/") && !mime.hasPrefix("audio/") && !mime.hasPrefix("video/") && !mime.hasPrefix("text/") && !["application/pdf","application/json","application/xml"].contains(mime)}
  private var header:some View {
    GeometryReader { geometry in
      let width=geometry.size.width
      if scale > 1.4 {
        HStack(alignment:.top) {
          Button(action:back) {Label("记录详情",systemImage:"chevron.left")}.accessibilityIdentifier("record.preview.back")
          Spacer();RecordText("附件预览",tablet ? 20 : 17,weight:.semibold);Spacer()
          Button {Task {await model.export()}} label:{RecordText("分享",16)}.accessibilityIdentifier("record.preview.share")
        }.foregroundStyle(p.accent)
      } else {
        ZStack(alignment:.topLeading) {
          Button(action:back) {ZStack(alignment:.topLeading) {
            RecordSymbol(name:"chevron.left",size:16).offset(x:tablet ? -2 : -5,y:tablet ? 8 : 3)
            RecordText("记录详情",16).offset(x:tablet ? 22 : 17,y:tablet ? 2 : 0)
          }.frame(width:135,height:44,alignment:.topLeading)}.foregroundStyle(p.accent).accessibilityIdentifier("record.preview.back")
          RecordText("附件预览",tablet ? 20 : 17,weight:.semibold,align:.center).frame(width:tablet ? 242 : 171)
            .offset(x:(width-(tablet ? 242 : 171))/2+(tablet ? 20 : 0))
          Button {Task {await model.export()}} label:{RecordText("分享",16,align:.trailing).frame(width:tablet ? 110 : 54,alignment:.trailing).frame(minHeight:44,alignment:.topTrailing)}.foregroundStyle(p.accent)
            .offset(x:width-(tablet ? 110 : 54),y:tablet ? 4 : 0).accessibilityIdentifier("record.preview.share")
        }
      }
    }.frame(height:scale > 1.4 ? 70 : 44)
  }
  @ViewBuilder private func content(width:CGFloat) -> some View {
    if let image=model.image {
      let h=min(width*0.75,390)
      VStack(spacing:0) {
        NativeRecordZoomImage(image:image,zoom:$model.zoom).frame(width:min(width,h*4/3),height:h).clipShape(RoundedRectangle(cornerRadius:12,style:.continuous)).padding(.top,54)
        RecordText("1 / 1",13,align:.center).foregroundStyle(p.secondary).padding(.top,32)
        HStack(spacing:51) {
          Button {model.zoom=max(1,model.zoom/1.25)} label:{RecordSymbol(name:"minus.magnifyingglass",size:25).frame(width:44,height:44)}.accessibilityIdentifier("record.preview.zoom.out")
          Button {model.zoom=min(8,model.zoom*1.25)} label:{RecordSymbol(name:"plus.magnifyingglass",size:25).frame(width:44,height:44)}.accessibilityIdentifier("record.preview.zoom.in")
        }.foregroundStyle(p.secondary).padding(.top,20.5)
      }.frame(maxWidth:.infinity)
    } else if model.attachment.mime.hasPrefix("audio/") {
      VStack(spacing:0) {
        RecordSymbol(name:"waveform",size:70).foregroundStyle(p.accent).padding(.top,47)
        NativeRecordWaveform(samples:model.samples).frame(height:91).padding(.horizontal,18).padding(.top,52)
        audioControls.padding(.top,52)
      }.frame(maxWidth:.infinity)
    } else if model.attachment.mime.hasPrefix("video/"),model.url != nil {
      VideoPlayer(player:model.player).frame(height:width*9/16).padding(.top,42).accessibilityIdentifier("record.preview.video")
    } else if model.attachment.mime == "application/pdf",let url=model.url {
      VStack(spacing:14) {
        NativeRecordPDFCanvas(url:url,page:$model.pdfPage).frame(width:(tablet ? 473 : 469)*0.75,height:tablet ? 473 : 469).frame(maxWidth:.infinity).accessibilityIdentifier("record.preview.pdf")
        HStack {Button {pages=true} label:{RecordSymbol(name:"list.bullet",size:20)};Spacer();RecordText("\(model.pdfPage) / \(model.pdfCount)",14,align:.center);Spacer();Color.clear.frame(width:20,height:20)}.foregroundStyle(p.secondary)
      }
    } else if !generic {
      NativeRecordTextFileContent(text:model.text).padding(.horizontal,18).padding(.vertical,22).frame(maxWidth:.infinity,minHeight:445,alignment:.topLeading)
        .background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous)).textSelection(.enabled).accessibilityIdentifier("record.preview.text")
    } else {
      VStack(spacing:0) {
        RecordSymbol(name:"doc.zipper",size:74).foregroundStyle(p.secondary).padding(.top,58)
        RecordText(model.attachment.name,22,weight:.semibold,align:.center).padding(.top,42)
        RecordText("\(model.attachment.mime == "application/zip" ? "ZIP 压缩文件" : UTType(mimeType:model.attachment.mime)?.localizedDescription ?? "文件") · \(model.size)",14,align:.center).foregroundStyle(p.secondary).padding(.top,11)
        Button {Task {await model.export()}} label:{NativeRecordActionButton(title:"保存到文件")}.padding(.horizontal,24).padding(.top,49).accessibilityIdentifier("record.preview.export")
      }.frame(maxWidth:.infinity)
    }
  }
  private var audioControls:some View {
    VStack(spacing:0) {
      NativeRecordTimeline(position:$model.position,duration:model.duration,seek:{model.seek($0)})
      HStack {NativeRecordDigits(value:NativeRecordMediaPreviewModel.time(model.position),size:12);Spacer();NativeRecordDigits(value:NativeRecordMediaPreviewModel.time(model.duration),size:12)}.font(.system(size:12,design:.monospaced)).foregroundStyle(p.secondary)
      HStack(spacing:27) {
        Button {model.seek(model.position-15)} label:{RecordSymbol(name:"gobackward.15",size:27).frame(width:44,height:44)}
        Button {model.toggle()} label:{RecordSymbol(name:model.playing ? "pause.fill" : "play.fill",size:20).frame(width:56,height:56).foregroundStyle(scheme == .dark ? p.paper : p.surface).background(p.accent,in:Circle())}.accessibilityIdentifier("record.preview.play")
        Button {model.seek(model.position+15)} label:{RecordSymbol(name:"goforward.15",size:27).frame(width:44,height:44)}
      }.padding(.top,21)
      Button {model.rate=model.rate == 1 ? 1.5 : model.rate == 1.5 ? 2 : 1;if model.playing {model.player.rate=model.rate}} label:{RecordText("\(model.rate.formatted())×",16).foregroundStyle(p.accent)}.padding(.top,52)
    }.padding(.horizontal,8)
  }
  private func failure(width:CGFloat) -> some View {
    let info:(String,String,String,String)
    switch model.phase {
    case .remote:info=("icloud.and.arrow.down","原件尚未下载","原件 \(model.size) · 等待连接原资料空间","下载原件")
    case .corrupt:info=("exclamationmark.shield","附件校验失败","文件与原件校验值不一致","重新下载")
    case .unsupported:info=("video.slash","暂不支持此文件格式",(model.remote ? "原件已同步 · 可保存原件" : "原件保留在本机 · 尚未上传"),"保存原件")
    default:info=("doc.badge.ellipsis","附件原件缺失","本机未找到原件","返回记录")
    }
    return VStack(spacing:0) {
      RecordSymbol(name:info.0,size:62).foregroundStyle(p.secondary).padding(.top,46)
      RecordText(info.1,22,weight:.semibold,align:.center).padding(.top,41)
      RecordText(info.2,14,lines:2,align:.center).foregroundStyle(p.secondary).padding(.top,17)
      Button {
        if model.phase == .unsupported {Task {await model.export()}}
        else if model.phase == .missing {back()}
        else {Task {await model.recoverOriginal()}}
      } label:{NativeRecordActionButton(title:info.3)}.padding(.top,47).accessibilityIdentifier("record.preview.recovery")
      if model.phase != .missing {Button(action:back){NativeRecordActionButton(title:"返回记录",primary:false)}.padding(.top,14)}
    }.padding(.horizontal,26).frame(maxWidth:.infinity)
  }
}
struct NativeRecordPDFCanvas:UIViewRepresentable {
  let url:URL
  @Binding var page:Int
  func makeCoordinator()->Coordinator {Coordinator($page)}
  func makeUIView(context:Context)->PDFView {
    let view=PDFView();view.autoScales=true;view.displayMode = .singlePage;view.displayDirection = .horizontal
    view.backgroundColor = .white;view.document=PDFDocument(url:url);view.usePageViewController(true)
    NotificationCenter.default.addObserver(context.coordinator,selector:#selector(Coordinator.changed(_:)),name:.PDFViewPageChanged,object:view)
    return view
  }
  func updateUIView(_ view:PDFView,context:Context) {
    context.coordinator.page=$page
    if let target=view.document?.page(at:max(0,page-1)),view.currentPage != target {view.go(to:target)}
  }
  static func dismantleUIView(_ view:PDFView,coordinator:Coordinator) {NotificationCenter.default.removeObserver(coordinator)}
  final class Coordinator:NSObject {
    var page:Binding<Int>
    init(_ page:Binding<Int>) {self.page=page}
    @objc func changed(_ note:Notification) {guard let view=note.object as? PDFView,let current=view.currentPage,let pdf=view.document else{return};let index=pdf.index(for:current)+1;DispatchQueue.main.async {if self.page.wrappedValue != index {self.page.wrappedValue=index}}}
  }
}
struct NativeRecordZoomImage:UIViewRepresentable {
  let image:UIImage
  @Binding var zoom:CGFloat
  func makeCoordinator()->Coordinator {Coordinator($zoom)}
  func makeUIView(context:Context)->UIScrollView {
    let view=Canvas();view.minimumZoomScale=1;view.maximumZoomScale=8;view.delegate=context.coordinator
    view.imageView.contentMode = .scaleAspectFit;view.imageView.image=image;view.addSubview(view.imageView);return view
  }
  func updateUIView(_ view:UIScrollView,context:Context) {
    context.coordinator.zoom=$zoom
    (view as? Canvas)?.imageView.image=image
    if abs(view.zoomScale-zoom)>0.01 {view.setZoomScale(zoom,animated:false)}
  }
  final class Canvas:UIScrollView {
    let imageView=UIImageView();var previous=CGSize.zero
    override func layoutSubviews() {super.layoutSubviews();if bounds.size != previous {previous=bounds.size;setZoomScale(1,animated:false);imageView.frame=CGRect(origin:.zero,size:bounds.size);contentSize=bounds.size}}
  }
  final class Coordinator:NSObject,UIScrollViewDelegate {
    var zoom:Binding<CGFloat>
    init(_ zoom:Binding<CGFloat>) {self.zoom=zoom}
    func viewForZooming(in scrollView:UIScrollView)->UIView? {(scrollView as? Canvas)?.imageView}
    func scrollViewDidZoom(_ scrollView:UIScrollView) {let value=scrollView.zoomScale;DispatchQueue.main.async {if abs(self.zoom.wrappedValue-value)>0.01 {self.zoom.wrappedValue=value}}}
  }
}
