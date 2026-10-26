import SwiftUI
import UniformTypeIdentifiers
import Photos

struct NativeRecordMediaPresentation: View {
  @ObservedObject var editor: NativeRecordEditorModel
  var detailFrame=CGRect.zero
  @Environment(\.colorScheme) private var scheme
  @Environment(\.openURL) private var openURL
  @ScaledMetric private var scale:CGFloat=1
  private var p:NativePalette { .init(dark:scheme == .dark) }
  private var systemPicker:Binding<Bool> { .init(get:{editor.mediaSheet == .photos || editor.mediaSheet == .camera},set:{if !$0 { editor.mediaSheet=nil }}) }
  var body:some View {
    GeometryReader { g in
      let tablet=g.size.width >= 760
      let leading=detailFrame.width > 0 ? max(0,detailFrame.minX-1) : g.size.width >= 1100 ? 560.0 : 320.0
      if editor.mediaSheet == .add {
        let w:CGFloat=tablet ? 500 : g.size.width
        let h:CGFloat=scale > 1.4 ? min(g.size.height-88,560) : 411
        dim
        VStack(spacing:0) {
          panelHeader("添加内容",width:w,tablet:tablet)
          ScrollView {
            VStack(spacing:16*max(1,scale)) {
              addRow("照片与视频",symbol:"photo.on.rectangle",subtitle:"已选 0 项") { editor.mediaSheet = .photos }
              addRow("拍照",symbol:"camera") { Task { await editor.camera() } }
              addRow("选择文件",symbol:"folder") { editor.mediaSheet = .files }
            }.padding(.horizontal,24).padding(.top,12)
          }
        }.frame(width:w,height:h,alignment:.top).background(p.surface,in:RoundedRectangle(cornerRadius:16,style:.continuous))
          .offset(x:(g.size.width-w)/2,y:tablet ? (g.size.height-h)/2 : g.size.height-h)
          .accessibilityElement(children:.contain).accessibilityIdentifier("record.media.add.panel")
      } else if editor.mediaSheet == .recording,let recorder=editor.recorder {
        if tablet { dim }
        NativeRecordRecordingView(model:recorder,title:editor.draft.title,tablet:tablet,insert:{Task { await editor.insertRecording() }},close:{Task {await editor.closeRecording()}})
          .frame(width:tablet ? 500 : g.size.width,height:tablet ? min(700,g.size.height-48) : g.size.height)
          .background(tablet ? p.surface : p.paper,in:RoundedRectangle(cornerRadius:tablet ? 16 : 0,style:.continuous))
          .offset(x:tablet ? (g.size.width-500)/2 : 0,y:tablet ? max(24,(g.size.height-700)/2) : 0)
          .onReceive(recorder.$state) {if $0 == .denied {editor.mediaSheet = .microphonePermission}}
      } else if editor.mediaSheet == .microphonePermission || editor.mediaSheet == .cameraPermission || editor.mediaSheet == .photosPermission {
        HStack(spacing:0) {
          if tablet { Color.clear.frame(width:leading) }
          permission(photos:editor.mediaSheet == .photosPermission,mic:editor.mediaSheet == .microphonePermission,tablet:tablet,width:tablet ? g.size.width-leading : g.size.width)
        }
      }
      if let attachment=editor.previewAttachment,let store=editor.mediaStore {
        HStack(spacing:0) {
          if tablet {Color.clear.frame(width:leading)}
          NativeRecordMediaPreview(model:.init(attachment:attachment,scope:editor.draft.scope,store:store,remote:editor.draft.original?.sync == .synced),tablet:tablet,back:{editor.previewAttachment=nil}).id(attachment.id)
        }
      }
      if let recorder=editor.recorder {NativeRecordRecordingDiscard(model:recorder,close:{editor.mediaSheet=nil})}
      if editor.importing {
        ProgressView("正在保存原件…").padding(24).background(p.surface,in:RoundedRectangle(cornerRadius:16,style:.continuous))
          .frame(maxWidth:.infinity,maxHeight:.infinity).background(.black.opacity(0.16)).accessibilityIdentifier("record.media.importing")
      }
      if let error=editor.mediaError {
        NativeConfirmation(title:"附件未保存",bodyText:error,actionTitle:"好",confirm:{editor.mediaError=nil},cancel:{editor.mediaError=nil})
      }
    }.ignoresSafeArea().buttonStyle(.plain)
    .sheet(isPresented:systemPicker) {
      if editor.mediaSheet == .camera {
        NativeRecordCameraPicker { file,error in
          editor.mediaSheet=nil
          if let file { Task { await editor.importFiles([file],temporary:true) } }
          else { editor.mediaError=error }
        }.ignoresSafeArea()
      } else {
        NativeRecordPhotoPicker(limit:max(1,20-editor.draft.attachments.count)) { files,error in
          editor.mediaSheet=nil
          if !files.isEmpty,PHPhotoLibrary.authorizationStatus(for:.readWrite) == .limited {
            editor.pendingPhotoFiles=files;editor.mediaSheet = .photosPermission
          } else {Task { await editor.importFiles(files,temporary:true);if let error { editor.mediaError=error } }}
        }.ignoresSafeArea()
      }
    }
    .fileImporter(isPresented:.init(get:{editor.mediaSheet == .files},set:{if !$0 { editor.mediaSheet=nil }}),allowedContentTypes:[.item],allowsMultipleSelection:true) { result in
      editor.mediaSheet=nil
      switch result {
      case .success(let urls):Task { await editor.importFiles(urls.map { .init(url:$0,name:$0.lastPathComponent,mime:UTType(filenameExtension:$0.pathExtension)?.preferredMIMEType ?? "application/octet-stream") }) }
      case .failure(let error):editor.mediaError=error.localizedDescription
      }
    }
  }
  private var dim:some View { Color.black.opacity(scheme == .dark ? 0.44 : 0.24).ignoresSafeArea().accessibilityHidden(true) }
  private func panelHeader(_ title:String,width:CGFloat,tablet:Bool) -> some View {
    ZStack(alignment:.topLeading) {
      if !tablet { Capsule().fill(p.well).frame(width:39,height:5).offset(x:(width-39)/2,y:9) }
      Button { editor.mediaSheet=nil } label: { RecordText("取消",16).frame(minHeight:44,alignment:.top) }.foregroundStyle(p.accent).offset(x:24,y:29).accessibilityIdentifier("record.media.cancel")
      RecordText(title,20,weight:.semibold,align:.center).frame(width:width-184).offset(x:92,y:26)
    }.frame(height:75).foregroundStyle(p.label)
  }
  private func addRow(_ title:String,symbol:String,subtitle:String?=nil,action:@escaping()->Void) -> some View {
    Button(action:action) {
      HStack(alignment:.center,spacing:14) {
        RecordSymbol(name:symbol,size:24).foregroundStyle(p.accent)
        VStack(alignment:.leading,spacing:5) { RecordText(title,17,weight:.medium);if let subtitle { RecordText(subtitle,12).foregroundStyle(p.secondary) } }
        Spacer(minLength:4);RecordSymbol(name:"chevron.right",size:13).foregroundStyle(p.secondary)
      }.padding(.horizontal,16).frame(maxWidth:.infinity,minHeight:62*max(1,scale)).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))
    }.foregroundStyle(p.label).accessibilityIdentifier("record.media.choose."+symbol)
  }
  private func permission(photos:Bool,mic:Bool,tablet:Bool,width:CGFloat) -> some View {
    VStack(spacing:0) {
      GeometryReader { g in
        if scale > 1.4 {
          VStack(alignment:.leading,spacing:12) {
            Button {editor.mediaSheet=nil} label:{Label {RecordText("编辑记录",16)} icon:{RecordSymbol(name:"chevron.left",size:16)}}.foregroundStyle(p.accent)
            RecordText(photos ? "照片与视频" : mic ? "录音" : "拍照",20,weight:.semibold)
          }.padding(.horizontal,20).padding(.top,tablet ? 24 : 54)
        } else {ZStack(alignment:.topLeading) {
          Button {editor.mediaSheet=nil} label:{ZStack(alignment:.topLeading) {
            RecordSymbol(name:"chevron.left",size:16).offset(x:tablet ? 22 : 15,y:tablet ? 31 : 57)
            RecordText("编辑记录",16).offset(x:tablet ? 46 : 37,y:tablet ? 25 : 54)
          }.frame(width:150,height:tablet ? 72 : 88,alignment:.topLeading)}.foregroundStyle(p.accent)
          RecordText(photos ? "照片与视频" : mic ? "录音" : "拍照",tablet ? 20 : 17,weight:.semibold,align:.center)
            .frame(width:tablet ? 242 : 171).offset(x:(g.size.width-(tablet ? 242 : 171))/2+(tablet ? 20 : 0),y:tablet ? 23 : 54)
        }}
      }.frame(height:scale > 1.4 ? (tablet ? 24 : 54)+52*scale+28 : tablet ? 72 : 88).overlay(alignment:.bottom){Rectangle().fill(p.separator).frame(height:0.5)}
      ScrollView {
        VStack(spacing:0) {
          RecordSymbol(name:photos ? "photo.on.rectangle" : mic ? "mic.slash" : "camera",size:60).foregroundStyle(p.secondary).padding(.top,69)
          RecordText(photos ? "仅可访问部分照片" : mic ? "麦克风权限已关闭" : "相机权限已关闭",22,weight:.semibold,align:.center).padding(.top,39)
          RecordText(photos ? "已选 \(editor.pendingPhotoFiles.count) 项 · 可导入 \(editor.pendingPhotoFiles.count) 项" : mic ? "尚未开始录音" : "当前草稿已保存在本机",14,align:.center).foregroundStyle(p.secondary).padding(.top,16)
          Button { if let url=URL(string:UIApplication.openSettingsURLString) { openURL(url) } } label: { NativeRecordActionButton(title:photos ? "管理可访问照片" : "前往设置") }.padding(.top,35)
          Button { if photos {let files=editor.pendingPhotoFiles;editor.mediaSheet=nil;Task {await editor.importFiles(files,temporary:true);if editor.mediaError == nil {editor.pendingPhotoFiles=[]}}} else {editor.mediaSheet=nil} } label: { NativeRecordActionButton(title:photos ? "导入已选照片" : "返回记录",primary:false) }.padding(.top,14)
          if photos {
            HStack(spacing:4) {ForEach(editor.pendingPhotoFiles) {file in
              if let data=try? Data(contentsOf:file.url),let image=NativeRecordImage.decode(data,maxPixels:256) {Image(uiImage:image).resizable().scaledToFill().frame(width:max(1,(width-40)/3-3),height:96).clipped().clipShape(RoundedRectangle(cornerRadius:8,style:.continuous))}
            }}.frame(width:max(1,width-40),alignment:.leading).padding(.top,44)
          }
        }.frame(width:max(1,width-96)).padding(.horizontal,48).padding(.top,tablet ? 22 : 24).padding(.bottom,44)
      }
    }.frame(maxWidth:.infinity,maxHeight:.infinity).background(p.paper).foregroundStyle(p.label)
  }
}
struct NativeRecordActionButton:View {
  let title:String
  var primary=true
  var size:CGFloat=17
  var height:CGFloat=48
  @ScaledMetric private var scale:CGFloat=1
  @Environment(\.colorScheme) private var scheme
  var body:some View {
    let p=NativePalette(dark:scheme == .dark)
    RecordText(title,size,weight:.semibold,align:.center).padding(.vertical,scale > 1.4 ? 11 : 0).frame(maxWidth:.infinity,minHeight:height)
      .foregroundStyle(primary ? (scheme == .dark ? p.paper : p.surface) : p.accent)
      .background(primary ? p.accent : p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))
  }
}
struct NativeRecordWaveform:View {
  let samples:[CGFloat]
  @Environment(\.colorScheme) private var scheme
  var body:some View {
    let p=NativePalette(dark:scheme == .dark)
    Canvas { context,size in
      let count=max(1,Int(size.width/5))
      for i in 0..<count {
        let value=samples.isEmpty ? 0.04 : samples[min(samples.count-1,i*samples.count/count)]
        let height=max(4,size.height*value)
        context.fill(Path(roundedRect:CGRect(x:CGFloat(i)*5,y:(size.height-height)/2,width:2.6,height:height),cornerRadius:1.3),with:.color(p.accent))
      }
    }.accessibilityLabel("录音波形")
  }
}
struct NativeRecordDigits:View {
  let value:String
  let size:CGFloat
  var weight:Font.Weight = .regular
  @ScaledMetric private var scale:CGFloat=1
  var body:some View {
    RecordTextLayout(size:size*scale,lineHeight:ceil(size*1.42)*scale,weight:weight == .medium ? .medium : .regular) {
      Text(value).font(.system(size:size*scale,weight:weight)).monospacedDigit().fixedSize()
    }
  }
}
struct NativeRecordRecordingView:View {
  @ObservedObject var model:NativeRecordRecorder
  let title:String
  let tablet:Bool
  let insert:()->Void
  let close:()->Void
  @StateObject private var keyboard=NativeRecordKeyboard()
  @Environment(\.colorScheme) private var scheme
  @Environment(\.openURL) private var openURL
  @ScaledMetric private var scale:CGFloat=1
  private var p:NativePalette {.init(dark:scheme == .dark)}
  private var recording:Bool {model.state == .recording}
  private var preview:Bool {model.state == .preview}
  private var base:CGFloat {tablet ? (recording ? 82 : 81) : recording ? 112 : 125}
  private func time(_ value:Double)->String {NativeRecordMediaPreviewModel.time(value)}
  private var stamp:String {
    guard let raw=model.session?.createdAt,let date=NativeRecordListModel.date(raw) else{return ""}
    let formatter=DateFormatter();formatter.dateFormat=Calendar.current.isDateInToday(date) ? "今天 HH:mm" : "M月d日 HH:mm";return formatter.string(from:date)
  }
  var body:some View {
    GeometryReader { g in
      ZStack(alignment:.topLeading) {
        Button(action:close) {RecordText(preview ? "取消" : "收起",tablet || !recording ? 16 : 17).frame(minHeight:44,alignment:.topLeading)}.foregroundStyle(p.accent)
          .offset(x:tablet || !recording ? 24 : 20,y:tablet ? (recording ? 23 : 19) : recording ? 54 : 63).accessibilityIdentifier("record.recorder.close").contextMenu {
            Button("丢弃录音",role:.destructive) {model.discardConfirmation=true}
          }
        RecordText(preview ? "录音试听" : "录音",tablet || !recording ? 20 : 17,weight:.semibold,align:.center).frame(width:g.size.width-200)
          .offset(x:100,y:tablet ? (recording ? 21 : 17) : recording ? 53 : 61).accessibilityIdentifier("record.recorder.title")
        ScrollView {
          if scale > 1.4 {largeBody}
          else {standardBody(width:g.size.width).frame(width:g.size.width,height:recording ? (tablet ? 610 : 640) : preview ? (tablet ? 640 : 670) : 600,alignment:.topLeading)}
        }.frame(width:g.size.width,height:max(1,g.size.height-base-keyboard.height)).offset(y:base)
        if model.busy {ProgressView("正在保存录音…").padding(24).background(p.surface,in:RoundedRectangle(cornerRadius:12)).frame(maxWidth:.infinity,maxHeight:.infinity)}

      }
    }.foregroundStyle(p.label).buttonStyle(.plain).accessibilityElement(children:.contain).accessibilityIdentifier("record.recorder")
      .task {if model.state == .ready {await model.start()}}
  }
  private func standardBody(width:CGFloat)->some View {
    ZStack(alignment:.topLeading) {
      RecordText(title,15,align:.center).foregroundStyle(p.secondary).frame(width:width-48).offset(x:24)
      if recording {
        Circle().fill(Color(hex:scheme == .dark ? 0xFF6961 : 0xC83232)).frame(width:7,height:7).offset(x:width/2-39,y:49)
        RecordText("录音中",16).frame(width:93,alignment:.leading).offset(x:width/2-25,y:41)
      } else {RecordText(preview ? "已保存到本机" : model.state == .interrupted ? "录音已中断" : "已暂停",16,align:.center).foregroundStyle(model.state == .interrupted ? p.accent : p.secondary).frame(width:width-48).offset(x:24,y:44)}
      NativeRecordDigits(value:time(model.elapsed),size:52,weight:.medium).frame(width:width-48).offset(x:24,y:recording ? 80 : 82).accessibilityIdentifier("record.recorder.duration")
      NativeRecordWaveform(samples:model.samples).frame(width:width-64,height:recording ? 106 : 82).offset(x:32,y:recording ? 177 : 181)
      if recording {
        RecordText(stamp+" · M4A · "+model.sizeDescription,13,align:.center).foregroundStyle(p.secondary).frame(width:width-48).offset(x:24,y:309)
        RecordText("录音备注",14).foregroundStyle(p.secondary).offset(x:24,y:362)
        noteField.frame(width:width-48,height:76,alignment:.topLeading).offset(x:24,y:392)
        RecordText("已保存 "+time(model.durable),12,align:.center).foregroundStyle(p.secondary).frame(width:width-48).offset(x:24,y:487)
        roundControl("pause.fill",title:"暂停",red:false) {Task {await model.pause()}}.offset(x:width/2-76-48,y:tablet ? 510 : 540)
        roundControl("stop.fill",title:"结束",red:true) {Task {await model.finish()}}.offset(x:width/2+76-48,y:tablet ? 510 : 540)
      } else {
        RecordText(model.name,15,align:.center).frame(width:width-48).offset(x:24,y:294)
        RecordText(stamp+" · "+model.sizeDescription+" · 原件已保存",12,align:.center).foregroundStyle(p.secondary).frame(width:width-48).offset(x:24,y:325)
        if preview {
          NativeRecordTimeline(position:$model.playback,duration:model.elapsed,seek:{model.seek($0)}).frame(width:width-64,height:30).offset(x:32,y:372)
          NativeRecordDigits(value:time(model.playback),size:12).foregroundStyle(p.secondary).offset(x:32,y:401)
          NativeRecordDigits(value:time(model.elapsed),size:12).foregroundStyle(p.secondary).frame(width:90,alignment:.trailing).offset(x:width-122,y:401)
        } else if model.state == .interrupted {
          HStack(spacing:9) {RecordSymbol(name:"phone",size:18);RecordText("音频会话中断 · 已保留 "+time(model.durable),14)}.foregroundStyle(p.secondary).padding(12).frame(width:width-48).frame(minHeight:50,alignment:.leading).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous)).offset(x:24,y:382)
        } else {RecordText("录音备注 · "+model.note,13,lines:2,align:.center).foregroundStyle(p.secondary).frame(width:width-48).offset(x:24,y:383)}
        controls.frame(width:width-48).offset(x:24,y:tablet && preview ? 450 : 473)
      }
    }
  }
  private var noteField:some View {
    TextField("",text:$model.note,axis:.vertical).font(.system(size:16*scale)).lineLimit(2...4).padding(.horizontal,16).padding(.top,23.5)
      .frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.topLeading).background(tablet ? p.well : p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous)).accessibilityIdentifier("record.recorder.note")
  }
  private var largeBody:some View {
    VStack(spacing:22) {
      RecordText(title,15,align:.center).foregroundStyle(p.secondary)
      RecordText(recording ? "录音中" : preview ? "已保存到本机" : "录音已暂停",16,align:.center)
      NativeRecordDigits(value:time(model.elapsed),size:52,weight:.medium)
      NativeRecordWaveform(samples:model.samples).frame(height:82)
      RecordText(model.name,15,align:.center)
      RecordText(stamp+" · "+model.sizeDescription,12).foregroundStyle(p.secondary)
      if recording {RecordText("录音备注",14);noteField.frame(minHeight:110)}
      if recording {HStack {roundControl("pause.fill",title:"暂停",red:false) {Task {await model.pause()}};Spacer();roundControl("stop.fill",title:"结束",red:true) {Task {await model.finish()}}}}
      else {controls}
    }.padding(24)
  }
  private var controls:some View {
    VStack(spacing:0) {
      if let error=model.error {RecordText(error,13,lines:3).foregroundStyle(p.accent).padding(.bottom,12)}
      if preview {
        Button {model.play()} label:{RecordSymbol(name:model.playing ? "pause.fill" : "play.fill",size:18).frame(width:52,height:52).foregroundStyle(scheme == .dark ? p.paper : p.surface).background(p.accent,in:Circle())}.accessibilityIdentifier("record.recorder.play")
        Button(action:insert) {NativeRecordActionButton(title:"插入记录")}.padding(.top,24).accessibilityIdentifier("record.recorder.insert")
        Button {model.discardConfirmation=true} label:{RecordText("丢弃录音",14).foregroundStyle(.red)}.padding(.top,10).accessibilityIdentifier("record.recorder.discard")
      } else {
        Button {Task {await model.start()}} label:{NativeRecordActionButton(title:"继续录音")}.accessibilityIdentifier("record.recorder.resume")
        Button {Task {await model.finish()}} label:{NativeRecordActionButton(title:"结束并试听",primary:false)}.padding(.top,14).accessibilityIdentifier("record.recorder.finish")
      }
    }
  }
  private func roundControl(_ symbol:String,title:String,red:Bool,action:@escaping()->Void)->some View {
    Button(action:action) {ZStack(alignment:.top) {
      RecordSymbol(name:symbol,size:20).frame(width:58,height:58).foregroundStyle(red ? p.surface : p.label).background(red ? Color(hex:scheme == .dark ? 0xFF6961 : 0xC83232) : p.well,in:Circle())
      RecordText(title,14,align:.center).foregroundStyle(p.label).frame(width:96).offset(y:68)
    }.frame(width:96,height:90,alignment:.top)}.accessibilityIdentifier("record.recorder."+(red ? "stop" : "pause"))
  }
}

struct NativeRecordRecordingDiscard:View {
  @ObservedObject var model:NativeRecordRecorder
  let close:()->Void
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale:CGFloat=1
  var body:some View {
    GeometryReader { g in
      if model.discardConfirmation {
        let p=NativePalette(dark:scheme == .dark)
        let width:CGFloat=g.size.width >= 760 ? 330 : min(302,g.size.width-40)
        let height:CGFloat=scale > 1.4 ? min(460,g.size.height-60) : 232
        Color.black.opacity(scheme == .dark ? 0.44 : 0.24).ignoresSafeArea()
        VStack(spacing:0) {
          RecordText("丢弃这段录音？",18,weight:.semibold,height:25,align:.center).frame(maxWidth:.infinity).padding(.top,22)
          RecordText(model.name+"\n"+NativeRecordMediaPreviewModel.time(model.elapsed)+" · "+model.sizeDescription,14,height:22,lines:3,align:.center)
            .frame(maxWidth:.infinity).foregroundStyle(p.secondary).padding(.horizontal,22).padding(.top,18)
          Spacer(minLength:10)
          Rectangle().fill(p.separator).frame(height:0.5)
          HStack(spacing:0) {
            Button {model.discardConfirmation=false} label:{RecordText("取消",16,align:.center).frame(maxWidth:.infinity,minHeight:57)}.foregroundStyle(p.accent).accessibilityIdentifier("component.confirm.cancel")
            Rectangle().fill(p.separator).frame(width:0.5)
            Button {Task {do {try await model.retire();model.discardConfirmation=false;close()} catch {}}} label:{RecordText("丢弃录音",16,weight:.semibold,align:.center).frame(maxWidth:.infinity,minHeight:57)}.foregroundStyle(Color(hex:scheme == .dark ? 0xFF6961 : 0xC83232)).accessibilityIdentifier("component.confirm.accept")
          }.frame(height:scale > 1.4 ? 120 : 58)
        }.frame(width:width,height:height).background(p.surface,in:RoundedRectangle(cornerRadius:16,style:.continuous))
          .position(x:g.size.width/2,y:g.size.height/2).foregroundStyle(p.label).accessibilityElement(children:.contain).accessibilityAddTraits(.isModal)
      }
    }.ignoresSafeArea().buttonStyle(.plain)
  }
}

struct NativeRecordTimeline:View {
  @Binding var position:Double
  let duration:Double
  let seek:(Double)->Void
  @State private var dragging:Double?
  @Environment(\.colorScheme) private var scheme
  var body:some View {
    let p=NativePalette(dark:scheme == .dark),end=max(1,duration)
    GeometryReader {g in
      let progress=CGFloat(max(0,min(1,(dragging ?? position)/end)))
      ZStack(alignment:.leading) {
        Capsule().fill(p.separator).frame(height:3)
        Capsule().fill(p.accent).frame(width:g.size.width*progress,height:3)
        Circle().fill(p.accent).frame(width:10,height:10).offset(x:g.size.width*progress-5)
      }.frame(maxHeight:.infinity).contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance:0).onChanged {dragging=max(0,min(end,Double($0.location.x/max(1,g.size.width))*end))}.onEnded {_ in if let value=dragging {position=value;seek(value)};dragging=nil})
    }.frame(height:30).accessibilityElement().accessibilityLabel("播放进度")
      .accessibilityValue(NativeRecordMediaPreviewModel.time(position)+" / "+NativeRecordMediaPreviewModel.time(duration))
      .accessibilityAdjustableAction {direction in
        let next=max(0,min(end,position+(direction == .increment ? 10 : -10)));position=next;seek(next)
      }
  }
}
