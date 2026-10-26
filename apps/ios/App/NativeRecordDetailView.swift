import AVFoundation
import SwiftUI
import UIKit

struct NativeRecordDetailView:View {
  let record:NativeRecord
  @ObservedObject var list:NativeRecordListModel
  var back:(()->Void)?
  var edit:(()->Void)?
  var mediaStore:NativeRecordMediaStore?
  var mediaScope:String=NativeRecordLocalStore.unbound
  var illustration:((NativeRecordAttachment)->AnyView?)?
  var syncModel:NativeRecordSyncModel?
  var processingModel:NativeRecordProcessingModel?
  var readOnly=false
  @State private var attachmentMetadata:[String:String]=[:]
  @State private var images:[String:UIImage]=[:]
  @State private var preview:NativeRecordAttachment?
  @State private var store:NativeRecordMediaStore?
  @State private var more=false
  @State private var shareURL:URL?
  @State private var shareText=false
  @State private var error:String?
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale:CGFloat=1
  private var p:NativePalette {.init(dark:scheme == .dark)}
  private var tablet:Bool {back == nil}
  var body:some View {
    GeometryReader { g in
      ZStack(alignment:.topLeading) {
        VStack(spacing:0) {
          if !tablet {phoneNavigation}
          ScrollView {
            VStack(alignment:.leading,spacing:0) {
              title
              if tablet && !readOnly {actions.padding(.top,16);Rectangle().fill(p.separator).frame(height:0.5).padding(.top,22).padding(.bottom,25.5)}
              else {Color.clear.frame(height:29)}
              document(width:max(1,g.size.width-(tablet ? 47 : 40)))
            }.padding(.leading,tablet ? 23 : 20).padding(.trailing,tablet ? 24 : 20).padding(.top,tablet ? 24 : 20).padding(.bottom,32)
          }.accessibilityIdentifier("record.detail.scroll")
          if !tablet && !readOnly {actions.padding(.horizontal,20).padding(.top,14).padding(.bottom,52).background(p.paper).overlay(alignment:.top){Rectangle().fill(p.separator).frame(height:0.5)}}
        }.background(p.paper)
        if let preview,let store {
          NativeRecordMediaPreview(model:.init(attachment:preview,scope:mediaScope,store:store,remote:record.sync == .synced,downloadOriginal:syncModel.map {sync in {attachment in try await sync.download(attachment,owner:mediaScope)}}),tablet:tablet,back:{self.preview=nil}).id(preview.id)
        }
        if more {
          let w:CGFloat=tablet ? 500 : g.size.width,h:CGFloat=scale > 1.4 ? min(580,g.size.height-88) : 391
          Color.black.opacity(scheme == .dark ? 0.44 : 0.24).ignoresSafeArea()
          VStack(spacing:14) {
            HStack {Button {more=false} label:{RecordText("取消",16)}.foregroundStyle(p.accent);Spacer();RecordText("更多操作",20,weight:.semibold);Spacer();Color.clear.frame(width:34)}.padding(.top,26).padding(.bottom,12)
            ScrollView {VStack(spacing:17) {
              menu("复制正文",symbol:"doc.on.doc") {UIPasteboard.general.string=record.text;more=false}
        menu("分享记录",symbol:"square.and.arrow.up") {more=false;shareText=true}
              menu("保存附件原件",symbol:"square.and.arrow.down") {more=false;if let first=record.attachments.first {preview=first} }
            }}
          }.padding(.horizontal,24).frame(width:w,height:h,alignment:.top).background(p.surface,in:RoundedRectangle(cornerRadius:16,style:.continuous))
            .offset(x:(g.size.width-w)/2,y:tablet ? (g.size.height-h)/2 : g.size.height-h).accessibilityIdentifier("record.detail.more.panel")
        }
      }.foregroundStyle(p.label).buttonStyle(.plain)
      .sheet(isPresented:$shareText) {NativeRecordActivity(items:[record.text])}
      .overlay {if let error {NativeConfirmation(title:"无法读取附件",bodyText:error,actionTitle:"好",confirm:{self.error=nil},cancel:{self.error=nil})}}
    }.ignoresSafeArea(.container,edges:[.top,.bottom]).task(id:record.id+mediaScope) {
#if DEBUG
      if ProcessInfo.processInfo.arguments.contains("--review-record-media"),NativeReviewConfiguration.current?.page == "N03-M" {more=true}
#endif
      do {
        let value=try mediaStore ?? NativeRecordMediaStore.live();store=value
        images=await value.imageData(record.attachments,scope:mediaScope).compactMapValues {NativeRecordImage.decode($0,maxPixels:1600)}
        for attachment in record.attachments where attachment.mime.hasPrefix("audio/") || attachment.mime.hasPrefix("video/") {
          if let url=try? await value.export(attachment,scope:mediaScope),let duration=try? await AVURLAsset(url:url).load(.duration),duration.seconds.isFinite {
            attachmentMetadata[attachment.id]=NativeRecordMediaPreviewModel.time(duration.seconds)+" · "+ByteCountFormatter.string(fromByteCount:Int64(attachment.bytes),countStyle:.file)
          }
        }
      } catch {self.error=error.localizedDescription}
    }
  }
  @ViewBuilder private var phoneNavigation:some View {
    if scale > 1.4 {
      VStack(alignment:.leading,spacing:12) {
        HStack {
          Button {back?()} label:{Label {RecordText("记录",16)} icon:{RecordSymbol(name:"chevron.left",size:16)}}.foregroundStyle(p.accent).accessibilityIdentifier("records.back")
          Spacer();Button {more=true} label:{RecordSymbol(name:"ellipsis",size:24).frame(width:44,height:44)}.foregroundStyle(p.accent).accessibilityIdentifier("record.detail.more")
        }
        RecordText("记录详情",17,weight:.semibold)
      }.padding(.horizontal,20).padding(.top,54).padding(.bottom,16)
    } else {GeometryReader { g in
      ZStack(alignment:.topLeading) {
        Button {back?()} label:{ZStack(alignment:.topLeading) {
          RecordSymbol(name:"chevron.left",size:16).offset(x:15,y:57)
          RecordText("记录",16).offset(x:37,y:54)
        }.frame(width:105,height:88,alignment:.topLeading)}.foregroundStyle(p.accent).accessibilityIdentifier("records.back")
        RecordText("记录详情",17,weight:.semibold,align:.center).frame(width:171).offset(x:(g.size.width-171)/2,y:54)
        Button {more=true} label:{RecordSymbol(name:"ellipsis",size:24).frame(width:44,height:44,alignment:.topLeading)}.foregroundStyle(p.accent).offset(x:g.size.width-44,y:55).accessibilityIdentifier("record.detail.more")
      }
    }.frame(height:88).overlay(alignment:.bottom){Rectangle().fill(p.separator).frame(height:0.5)}}
  }
  private var title:some View {
    VStack(alignment:.leading,spacing:0) {
      HStack(alignment:.top) {
        RecordText(record.title,tablet ? 24 : 26,weight:.semibold).accessibilityIdentifier("records.selection.title")
        if tablet {Spacer();Button {more=true} label:{RecordSymbol(name:"ellipsis",size:24)}.foregroundStyle(p.accent).padding(.top,5).accessibilityIdentifier("record.detail.more")}
      }
      HStack(alignment:.top) {
        RecordText("\(record.updatedAt == nil ? "" : "更新 ")\(dateLabel) \(list.time(record.updatedAt ?? record.createdAt)) · \(record.sync.title) · 版本 \(record.version)",tablet ? 13 : 12).foregroundStyle(p.secondary)
        if tablet {Spacer(minLength:6);badge.offset(y:-1)}
      }.padding(.top,tablet ? 7 : 8).contentShape(Rectangle()).onTapGesture {if !readOnly {syncModel?.show(record.id)}}.accessibilityIdentifier("record.detail.sync")
      if !tablet {badge.padding(.top,14)}
    }
  }
  private var dateLabel:String {
    guard let date=NativeRecordListModel.date(record.updatedAt ?? record.createdAt) else{return ""}
    if list.calendar.isDate(date,inSameDayAs:list.now()) {return "今天"}
    if let previous=list.calendar.date(byAdding:.day,value:-1,to:list.now()),list.calendar.isDate(date,inSameDayAs:previous) {return "昨天"}
    let formatter=DateFormatter();formatter.dateFormat="M月d日";formatter.timeZone=list.calendar.timeZone;return formatter.string(from:date)
  }
  private var badge:some View {RecordText(record.processingTitle,12,weight:.medium,align:.center).frame(width:78*scale).padding(.vertical,3*scale).foregroundStyle(p.accent).background(p.selection,in:RoundedRectangle(cornerRadius:7,style:.continuous))}
  private var actions:some View {
    HStack(spacing:12) {
      if let edit {Button(action:edit){NativeRecordActionButton(title:"编辑",primary:false,size:tablet ? 16 : 17,height:tablet ? 44 : 48)}.frame(width:tablet ? 100 : 105).accessibilityIdentifier("records.edit")}
      Button {Task {await processingModel?.open(record)}} label:{NativeRecordActionButton(title:"加工",size:tablet ? 16 : 17,height:tablet ? 44 : 48)}.frame(width:tablet ? 100 : nil).accessibilityIdentifier("record.process.open")
      if tablet {Spacer()}
    }
  }
  @ViewBuilder private func document(width:CGFloat)->some View {
    let doc=(try? NativeRecordDocument(record:record)) ?? .plain(record.text)
    let nodes=doc.doc.content ?? []
    let skipTitle=nodes.first?.plainText == record.title
    VStack(alignment:.leading,spacing:0) {
      ForEach(Array(nodes.enumerated()),id:\.offset) {index,node in
        if !(index == 0 && skipTitle) {nodeView(node,width:width).frame(minHeight:tablet && node.type == "paragraph" && index == (skipTitle ? 1 : 0) ? (discussion ? 66 : 56)*scale : nil,alignment:.topLeading)
            .padding(.bottom,node.type == "attachment" ? 0 : node.type == "heading" ? 10 : node.type == "bulletList" || node.type == "orderedList" ? (discussion ? 29 : 25) : tablet ? 16 : discussion ? 26 : 29)}
      }
      ForEach(record.attachments.filter {!doc.doc.referencedAttachments.contains($0.id)}) {attachment in attachmentView(attachment).padding(.bottom,16)}
      if !readOnly,let task=record.tasks.first {
        RecordText("最近加工",14).foregroundStyle(p.secondary).padding(.top,26).padding(.bottom,11)
        HStack(alignment:.top) {
          VStack(alignment:.leading,spacing:7) {
            RecordText(task.title ?? "关联任务",17,weight:.medium)
            RecordText("版本 \(task.recordVersion ?? record.version)"+(task.createdAt.map {" · 今天 \(list.time($0))"} ?? ""),12).foregroundStyle(p.secondary)
          }
          Spacer(minLength:8)
          RecordText(task.state == "awaiting_review" ? "查看草稿" : record.processingTitle,14).foregroundStyle(p.accent).padding(.top,3)
        }.padding(.horizontal,16).padding(.vertical,12).frame(maxWidth:.infinity,minHeight:81,alignment:.topLeading)
          .background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous)).overlay{RoundedRectangle(cornerRadius:12,style:.continuous).stroke(p.separator,lineWidth:0.5)}
          .contentShape(Rectangle()).onTapGesture {Task {await processingModel?.open(record,history:true)}}.accessibilityAddTraits(.isButton).accessibilityIdentifier("record.process.history")
      }
    }.frame(maxWidth:.infinity,alignment:.leading)
  }
  private var discussion:Bool {record.attachments.contains(where:{$0.mime.hasPrefix("audio/")})}
  private func nodeView(_ node:NativeRecordNode,width:CGFloat) -> AnyView {
    if node.type == "attachment",let id=node.attachmentID,let attachment=record.attachments.first(where:{$0.id == id}) {return AnyView(attachmentView(attachment))}
    if node.type == "bulletList" || node.type == "orderedList" {
      let start:Int
      if case .number(let value)=node.attrs?["start"] {start=Int(value)} else {start=1}
      return AnyView(VStack(alignment:.leading,spacing:discussion ? 9 : 8) {ForEach(Array((node.content ?? []).enumerated()),id:\.offset) {index,item in
        HStack(alignment:.top,spacing:14) {
          if node.type == "bulletList" {Circle().fill(p.secondary).frame(width:4,height:4).padding(.top,9)}
          else {RecordText("\(index+start).",17).foregroundStyle(p.secondary).frame(width:16,alignment:.trailing)}
          VStack(alignment:.leading,spacing:9) {
            ForEach(Array((item.content ?? []).enumerated()),id:\.offset) { _,child in
              if ["bulletList","orderedList","attachment","blockquote"].contains(child.type) {nodeView(child,width:max(1,width-18))}
              else {NativeRecordReadText(node:child,size:discussion ? 16 : 17,lineHeight:25,width:max(1,width-(node.type == "orderedList" ? 30 : 18)))}
            }
          }
        }
      }})
    }
    if node.type == "blockquote" {return AnyView(HStack(alignment:.top,spacing:12){Rectangle().fill(p.accent).frame(width:3);NativeRecordReadText(node:node,width:max(1,width-15))}.fixedSize(horizontal:false,vertical:true))}
    let heading=node.type == "heading"
    return AnyView(NativeRecordReadText(node:node,size:heading ? (node.attrs?["level"] == .number(1) ? 26 : 20) : 17,heading:heading,lineHeight:heading ? (node.attrs?["level"] == .number(1) ? 37 : 29) : 28,width:width))
  }
  private func attachmentView(_ attachment:NativeRecordAttachment)->some View {
    Button {preview=attachment} label:{VStack(alignment:.leading,spacing:0) {
      if let image=images[attachment.id] {Image(uiImage:image).resizable().scaledToFill().frame(height:tablet ? 194 : 154).clipped().clipShape(RoundedRectangle(cornerRadius:12,style:.continuous))}
      else if let custom=illustration?(attachment) {custom.frame(height:tablet ? 194 : 154).clipShape(RoundedRectangle(cornerRadius:12,style:.continuous))}
      else {
        if scale > 1.4 {
          HStack(alignment:.top,spacing:14) {
            RecordSymbol(name:attachment.mime.hasPrefix("audio/") ? "waveform" : "doc.richtext",size:30).foregroundStyle(p.accent)
            VStack(alignment:.leading,spacing:8) {RecordText(attachment.name,15,lines:2);RecordText(attachmentMetadata[attachment.id] ?? ByteCountFormatter.string(fromByteCount:Int64(attachment.bytes),countStyle:.file),12,lines:2).foregroundStyle(p.secondary)}
          }.padding(16).frame(maxWidth:.infinity,alignment:.leading).background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous))
        } else {GeometryReader {g in
          ZStack(alignment:.topLeading) {
            if attachment.mime.hasPrefix("audio/") {RecordSymbol(name:"play.fill",size:12).frame(width:30,height:30).foregroundStyle(scheme == .dark ? p.paper : p.surface).background(p.accent,in:Circle()).offset(x:14,y:18)}
            else {RecordSymbol(name:"doc.richtext",size:30).foregroundStyle(p.accent).offset(x:14,y:18)}
            RecordText(attachment.name,15,weight:.medium,lines:1).frame(width:max(1,g.size.width-104),alignment:.leading).offset(x:58,y:10)
            RecordText(attachmentMetadata[attachment.id] ?? ByteCountFormatter.string(fromByteCount:Int64(attachment.bytes),countStyle:.file)+" · 原件",12).foregroundStyle(p.secondary).frame(width:max(1,g.size.width-86),alignment:.leading).offset(x:58,y:37)
            RecordSymbol(name:"ellipsis",size:19).foregroundStyle(p.secondary).offset(x:g.size.width-31,y:24)
          }
        }.frame(height:68).background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous)).overlay{RoundedRectangle(cornerRadius:12,style:.continuous).stroke(p.separator,lineWidth:0.5)}}
      }
      if attachment.mime.hasPrefix("image/") {RecordText(attachment.name+" · "+ByteCountFormatter.string(fromByteCount:Int64(attachment.bytes),countStyle:.file),12).foregroundStyle(p.secondary).padding(.top,10)}
    }}.foregroundStyle(p.label).accessibilityIdentifier("record.detail.attachment."+attachment.id)
  }
  private func menu(_ title:String,symbol:String,action:@escaping()->Void)->some View {
    Button(action:action){HStack(spacing:14){RecordSymbol(name:symbol,size:24).foregroundStyle(p.accent);RecordText(title,17,weight:.medium);Spacer();RecordSymbol(name:"chevron.right",size:13).foregroundStyle(p.secondary)}.padding(16).frame(maxWidth:.infinity,minHeight:53).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))}.accessibilityIdentifier("record.detail.action."+symbol)
  }
}
