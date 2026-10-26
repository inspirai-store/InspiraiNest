import SwiftUI

struct NativeRecordComparison {
  var local:NativeRecord
  var remote:NativeRecord
  static func nodes(_ record:NativeRecord)->[NativeRecordNode] {
    let nodes=((try? NativeRecordDocument(record:record)) ?? .plain(record.text)).doc.content ?? []
    return nodes.filter {$0.type != "attachment" && !($0.type == "heading" && $0.plainText==record.title)}
  }
  var count:Int {
    let a=Self.nodes(local),b=Self.nodes(remote)
    let content=(0..<max(a.count,b.count)).filter {a.indices.contains($0) && b.indices.contains($0) ? a[$0] != b[$0] : true}.count
    let files=Set(local.attachments.map(\.id)).union(remote.attachments.map(\.id)).filter {id in local.attachments.first {$0.id==id} != remote.attachments.first {$0.id==id}}.count
    return content+files
  }
}

struct NativeRecordSyncPresentation:View {
  @ObservedObject var model:NativeRecordSyncModel
  let detailFrame:CGRect
  var pair:()->Void={}
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale:CGFloat=1
  private var p:NativePalette {.init(dark:scheme == .dark)}
  var body:some View {
    GeometryReader {g in
      let tablet=UIDevice.current.userInterfaceIdiom == .pad && g.size.width>=760
      let leading:CGFloat=tablet ? (detailFrame.width>0 ? max(0,detailFrame.minX-1) : g.size.width>=1100 ? 560 : 320) : 0
      ZStack(alignment:.topLeading) {
        if let route=model.route {
          if case .conflict(let id)=route,let local=model.entry(id),let remote=model.operation(id)?.remote {
            conflict(local:local,remote:remote,tablet:tablet,size:g.size)
          } else {
            HStack(spacing:0) {
              if tablet {Color.clear.frame(width:leading).allowsHitTesting(false)}
              page(route,tablet:tablet)
            }
          }
        }
        if let id=model.confirmation,let remote=model.operation(id)?.remote {
          NativeRecordSyncConfirmation(title:"保留本机并重发？",message:"以远端版本 \(remote.version) 为基础提交本机内容，生成新版本。",action:"确认重发",cancel:{model.confirmation=nil},confirm:{Task {await model.confirmConflict(id)}})
        }
        if let id=model.binding {
          NativeRecordSyncConfirmation(title:"同步到当前资料空间？",message:"本机正文与原件将同步到 \(URL(string:model.origin)?.host ?? "当前资料空间")。",action:"确认同步",cancel:{model.binding=nil},confirm:{Task {await model.bind(id)}})
        }
        if let id=model.adoptingSpace {
          NativeRecordSyncConfirmation(title:"重新连接原资料空间？",message:"本机记录与草稿将恢复到当前授权连接。原件继续保留。",action:"确认连接",cancel:{model.adoptingSpace=nil},confirm:{Task {await model.adopt(id)}})
        }
        if let notice=model.notice,model.route != nil {
          NativeConfirmation(title:"同步未完成",bodyText:notice,actionTitle:"好",confirm:{model.notice=nil},cancel:{model.notice=nil})
        }
      }
    }.ignoresSafeArea(.container,edges:[.top,.bottom]).foregroundStyle(p.label).buttonStyle(.plain)
  }
  private func page(_ route:NativeRecordSyncRoute,tablet:Bool)->some View {
    let title:String,back:String
    switch route {case .queue:title="记录同步";back="我的";case .space:title="原资料空间";back="同步队列";default:title="同步详情";back="同步队列"}
    return VStack(spacing:0) {
      navigation(title:title,back:back,tablet:tablet) {if route == .queue {model.route=nil} else {model.route = .queue}}
      GeometryReader {g in
        ScrollView {
          Group {
            if route == .queue {queue(width:g.size.width-(tablet ? 48 : 40),tablet:tablet)}
            else if case .space(let id)=route {space(id,width:g.size.width-(tablet ? 48 : 40),tablet:tablet)}
            else if case .detail(let id)=route,let entry=model.entry(id) {detail(entry,width:g.size.width-(tablet ? 48 : 40),tablet:tablet)}
          }.padding(.leading,tablet ? 24 : 20).padding(.trailing,tablet ? 24 : 20).padding(.top,tablet ? 22 : 24).padding(.bottom,30)
        }.accessibilityIdentifier("record.sync.scroll")
      }
      if case .space=route {} else {
        Button {footerAction(route)} label:{NativeRecordActionButton(title:footerTitle(route))}
          .padding(.horizontal,tablet ? 24 : 20).padding(.top,16).padding(.bottom,tablet ? 24 : 56)
          .background(p.paper).overlay(alignment:.top){Rectangle().fill(p.separator).frame(height:0.5)}
          .accessibilityIdentifier("record.sync.footer")
      }
    }.background(p.paper).accessibilityElement(children:.contain).accessibilityIdentifier("record.sync.page")
  }
  private func navigation(title:String,back:String,tablet:Bool,action:@escaping()->Void)->some View {
    Group {
      if scale>1.4 {
        VStack(alignment:.leading,spacing:12){Button(action:action){Label {RecordText(back,16)} icon:{RecordSymbol(name:"chevron.left",size:16)}}.foregroundStyle(p.accent).accessibilityIdentifier("record.sync.back");RecordText(title,tablet ? 20 : 17,weight:.semibold)}.padding(.horizontal,24).padding(.top,tablet ? 23 : 54).padding(.bottom,16).frame(maxWidth:.infinity,alignment:.leading)
      } else {GeometryReader {g in
        ZStack(alignment:.topLeading) {
          Button(action:action){HStack(alignment:.top,spacing:tablet ? 8 : 6){RecordSymbol(name:"chevron.left",size:16).padding(.top,tablet ? 6 : 3);RecordText(back,16)}.frame(minHeight:44,alignment:.topLeading)}.foregroundStyle(p.accent).offset(x:tablet ? 22 : 15,y:tablet ? 25 : 54).accessibilityIdentifier("record.sync.back")
          RecordText(title,tablet ? 20 : 17,weight:.semibold,align:.center).frame(width:tablet ? 242 : 171).offset(x:(g.size.width-(tablet ? 242 : 171))/2+(tablet ? 20 : 0),y:tablet ? 23 : 54)
        }
      }.frame(height:tablet ? 72 : 88)}
    }.overlay(alignment:.bottom){Rectangle().fill(p.separator).frame(height:0.5)}
  }
  private func queue(width:CGFloat,tablet:Bool)->some View {
    VStack(alignment:.leading,spacing:0) {
      RecordText("个人资料空间",24,weight:.semibold)
      RecordText(model.subtitle,13).foregroundStyle(p.secondary).padding(.top,9)
      VStack(spacing:25) {
        ForEach(model.pending) {entry in
          Button {if entry.scope == NativeRecordLocalStore.unbound {model.binding=entry.record.id} else {model.show(entry.record.id)}} label:{queueCard(entry,width:width)}.accessibilityIdentifier("record.sync.row."+entry.record.id)
        }
        ForEach(model.otherSpaces) {space in
          Button {model.route = .space(space.id)} label:{VStack(alignment:.leading,spacing:12) {RecordText("原资料空间待连接",18,weight:.semibold);RecordText("\(space.count) 条记录 · 原件保留在本机",13).foregroundStyle(p.secondary);RecordText(URL(string:space.origin)?.host ?? "原资料空间",13).foregroundStyle(p.accent)}.padding(16).frame(maxWidth:.infinity,alignment:.leading).background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous))}
        }
        if model.pending.isEmpty && model.otherSpaces.isEmpty {RecordText("记录均已同步",18).foregroundStyle(p.secondary).padding(.top,50)}
      }.padding(.top,41)
      if model.expired || model.scope==NativeRecordLocalStore.unbound {Button(action:pair){NativeRecordActionButton(title:model.expired ? "重新配对" : "连接资料空间")}.padding(.top,24)}
    }.frame(width:width,alignment:.leading)
  }
  private func queueCard(_ entry:NativeRecordLocalEntry,width:CGFloat)->some View {
    let record=entry.record,transfer=entry.record.sync == .syncing ? model.aggregateTransfer(entry.record.id) : nil
    let label=entry.scope==NativeRecordLocalStore.unbound ? "待绑定" : record.sync == .pending ? "等待同步" : record.sync.title
    let subtitle:String
    if model.operation(record.id)?.step == .record && record.sync == .syncing {subtitle="正在提交记录版本"}
    else if model.operation(record.id)?.step == .previews && record.sync == .syncing {subtitle="缩略图上传中"}
    else if let transfer {subtitle="原件上传 \(transferAmount(transfer.sent,transfer.total)) · \(Int(transfer.fraction*100))%"}
    else if record.sync == .failed {subtitle=(model.operation(record.id)?.step == .record ? "记录提交未确认 · " : "原件上传失败 · ")+(model.operation(record.id)?.error ?? "连接已断开")}
    else if record.sync == .conflict {subtitle="远端版本已变化 · 本机内容已保留"}
    else {subtitle="\(time(record.updatedAt ?? record.createdAt)) · 已保存在本机"}
    return VStack(alignment:.leading,spacing:0) {
      HStack(alignment:.top) {RecordText(record.title,18,weight:.semibold,lines:1);Spacer(minLength:8);RecordText(label,12,weight:.medium,align:.center).foregroundStyle(record.sync == .failed ? Color(hex:scheme == .dark ? 0xFF6961 : 0xC83232) : p.accent).frame(minWidth:83).padding(.vertical,3).background(record.sync == .failed ? p.well : p.selection,in:RoundedRectangle(cornerRadius:7,style:.continuous)).offset(y:-2)}
      RecordText(subtitle,13,lines:scale>1.4 ? nil : 1).foregroundStyle(p.secondary).padding(.top,13)
      if let transfer {progress(transfer.fraction).padding(.top,15)}
      else {RecordText("查看详情",14).foregroundStyle(p.accent).padding(.top,11)}
    }.padding(.horizontal,16).padding(.top,14).padding(.bottom,11).frame(width:width).frame(minHeight:114,alignment:.topLeading).background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous)).overlay{RoundedRectangle(cornerRadius:12,style:.continuous).stroke(p.separator,lineWidth:0.5)}
  }
  private func detail(_ entry:NativeRecordLocalEntry,width:CGFloat,tablet:Bool)->some View {
    let op=model.operation(entry.record.id),transfer=model.aggregateTransfer(entry.record.id)
    let failed=entry.record.sync == .failed
    let localOriginals=entry.record.attachments.allSatisfy {model.localOriginals.contains($0.sha256)}
    let total=entry.record.attachments.reduce(Int64(0)) {$0+Int64($1.bytes)}
    let banner=failed ? (op?.step == .record ? "记录版本提交未确认" : op?.errorCode == "network" || op?.error == "连接已断开" ? "原件上传失败 · 连接中断" : "同步失败 · 本机内容已保留") : entry.record.sync == .synced ? "记录已同步" : op?.step == .record ? "正在提交记录版本" : op?.step == .previews ? "缩略图上传中" : transfer.map {"原件上传中 · \(Int($0.fraction*100))%"} ?? (entry.scope==NativeRecordLocalStore.unbound ? "本机记录尚未绑定资料空间" : "等待提交记录版本")
    return VStack(alignment:.leading,spacing:0) {
      RecordText(entry.record.title,24,weight:.semibold).accessibilityIdentifier("record.sync.title")
      RecordText("个人资料空间 · 本机版本 \(max(1,entry.baseVersion))",13).foregroundStyle(p.secondary).padding(.top,9)
      HStack(spacing:9){RecordSymbol(name:failed ? "exclamationmark.circle" : "arrow.up.circle",size:18);RecordText(banner,14)}.foregroundStyle(p.accent).padding(.horizontal,12).frame(maxWidth:.infinity,minHeight:48,alignment:.leading).background(p.selection,in:RoundedRectangle(cornerRadius:12,style:.continuous)).padding(.top,26).accessibilityIdentifier("record.sync.status")
      ForEach(Array(entry.record.attachments.enumerated()),id:\.element.id) {index,attachment in
        file(attachment,state:fileState(attachment,entry:entry),width:width).padding(.top,index==0 ? 25 : 14)
      }
      if let transfer,!failed {progress(transfer.fraction).padding(.horizontal,16).padding(.top,18)}
      VStack(alignment:.leading,spacing:0) {
        step(localOriginals ? "本机已保存" : "记录已缓存",subtitle:localOriginals ? "正文与原件已写入本机" : "正文已保存 · 原件按需下载",symbol:"checkmark.circle",complete:true)
        step(localOriginals || op?.uploaded.count == entry.record.attachments.count || transfer != nil ? "附件校验通过" : "等待附件校验",subtitle:"\(entry.record.attachments.count) 个原件 · SHA-256",symbol:"checkmark.shield",complete:localOriginals || op?.uploaded.count == entry.record.attachments.count || transfer != nil)
        step(entry.record.sync == .synced ? "记录版本已提交" : "等待提交记录版本",subtitle:"版本 \(max(1,entry.baseVersion)) · 附件上传完成后提交",symbol:"clock",complete:entry.record.sync == .synced)
      }.padding(.top,transfer != nil && !failed ? 27 : 48)
      if entry.scope==NativeRecordLocalStore.unbound {Button {model.binding=entry.record.id} label:{NativeRecordActionButton(title:"同步到当前资料空间")}.padding(.top,24)}
      if let error=op?.error,error != "连接已断开" {RecordText(error,13,lines:3).foregroundStyle(p.secondary).padding(.top,24)}
      if total==0 && entry.record.sync == .pending {RecordText("正文已保存在本机",13).foregroundStyle(p.secondary).padding(.top,18)}
    }.frame(width:width,alignment:.leading)
  }
  private func step(_ title:String,subtitle:String,symbol:String,complete:Bool)->some View {
    HStack(alignment:.top,spacing:16) {RecordSymbol(name:symbol,size:24).foregroundStyle(complete ? Color(hex:scheme == .dark ? 0x77BD92 : 0x2A7F51) : p.secondary).padding(.top,2);VStack(alignment:.leading,spacing:6){RecordText(title,17);RecordText(subtitle,12).foregroundStyle(p.secondary)}}.frame(maxWidth:.infinity,minHeight:85*scale,alignment:.topLeading)
  }
  private func fileState(_ attachment:NativeRecordAttachment,entry:NativeRecordLocalEntry)->String {
    let op=model.operation(entry.record.id)
    if entry.record.sync == .synced{return "原件已同步"}
    if op?.uploaded.contains(attachment.sha256)==true{return op?.state == .failed && op?.step == .previews && op?.activeAttachmentID==attachment.id ? "缩略图上传失败 · 原件已保留" : "原件已上传"}
    if entry.record.sync == .failed,(op?.activeAttachmentID==attachment.id || op?.step==nil){return "上传失败 · 原件已保留"}
    if let raw=model.transfers[entry.record.id],raw.attachmentID==attachment.id {return transferAmount(raw.sent,raw.total)+" · 上传中"}
    return "等待上传"
  }
  private func file(_ attachment:NativeRecordAttachment,state:String,width:CGFloat)->some View {
    HStack(alignment:.top,spacing:15){RecordSymbol(name:attachment.mime.hasPrefix("audio/") ? "waveform" : "doc",size:29).foregroundStyle(p.accent).padding(.top,10);VStack(alignment:.leading,spacing:4){RecordText(attachment.name,15,weight:.medium,lines:1);RecordText((model.durations[attachment.sha256].map {$0+" · "} ?? "")+amount(Int64(attachment.bytes)),12).foregroundStyle(p.secondary);RecordText(state,12).foregroundStyle(p.accent)}}.padding(.horizontal,15).padding(.top,10).padding(.bottom,6).frame(width:width,alignment:.leading).frame(minHeight:82,alignment:.topLeading).background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous)).overlay{RoundedRectangle(cornerRadius:12,style:.continuous).stroke(p.separator,lineWidth:0.5)}
  }
  private func progress(_ value:Double)->some View {GeometryReader {g in ZStack(alignment:.leading){Capsule().fill(p.well);Capsule().fill(p.accent).frame(width:g.size.width*value)}}.frame(height:3)}
  private func footerTitle(_ route:NativeRecordSyncRoute)->String {
    if route == .queue {return "重试失败项"}
    if case .detail(let id)=route,model.entry(id)?.record.sync == .failed {return "重试上传"}
    return "返回同步队列"
  }
  private func footerAction(_ route:NativeRecordSyncRoute) {
    if route == .queue {Task {await model.retry()}}
    else if case .detail(let id)=route,model.entry(id)?.record.sync == .failed {Task {await model.retry(id)}}
    else {model.route = .queue}
  }
  private func space(_ id:String,width:CGFloat,tablet:Bool)->some View {
    let other=model.otherSpaces.first {$0.id==id}
    return VStack(spacing:0) {
      RecordSymbol(name:"externaldrive.badge.exclamationmark",size:64).foregroundStyle(p.secondary).padding(.top,50)
      RecordText("记录属于另一资料空间",22,weight:.semibold,align:.center).padding(.top,41)
      RecordText("\(other?.count ?? 0) 条记录 · 原件保留在本机",14,align:.center).foregroundStyle(p.secondary).padding(.top,14)
      spaceRow("原资料空间",subtitle:other?.origin.isEmpty==false ? "个人资料空间 · \(URL(string:other?.origin ?? "")?.host ?? "")" : "原资料空间地址未知").padding(.top,36)
      spaceRow("当前连接",subtitle:"工作资料空间 · \(URL(string:model.origin)?.host ?? "未连接")").padding(.top,15)
      Button {model.connectOriginal(id,pair:pair)} label:{NativeRecordActionButton(title:"连接原资料空间")}.padding(.top,50).accessibilityIdentifier("record.sync.connect-original")
      RecordText("原空间记录不会上传到当前空间",13,align:.center).foregroundStyle(p.secondary).padding(.top,18)
    }.frame(width:width)
  }
  private func spaceRow(_ title:String,subtitle:String)->some View {VStack(alignment:.leading,spacing:5){RecordText(title,16);RecordText(subtitle,12).foregroundStyle(p.secondary)}.padding(.horizontal,16).padding(.vertical,12).frame(maxWidth:.infinity,minHeight:72,alignment:.topLeading).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))}
  @ViewBuilder private func conflict(local:NativeRecordLocalEntry,remote:NativeRecord,tablet:Bool,size:CGSize)->some View {
    let comparison=NativeRecordComparison(local:local.record,remote:remote)
    if tablet {
      Color.black.opacity(scheme == .dark ? 0.44 : 0.24).ignoresSafeArea()
      let width=min(880,size.width-48),height=min(scale>1.4 ? 760 : 610,size.height-48)
      VStack(alignment:.leading,spacing:0) {
        RecordText("版本冲突",22,weight:.semibold).padding(.top,22)
        RecordText("\(local.record.title) · \(comparison.count) 处内容不同",14).foregroundStyle(p.secondary).padding(.top,11)
        ScrollView {HStack(alignment:.top,spacing:16){comparisonCard(local.record,other:remote,remote:false,tablet:true,width:(width-64)/2);comparisonCard(remote,other:local.record,remote:true,tablet:true,width:(width-64)/2)}}.accessibilityIdentifier("record.conflict.documents").frame(height:scale>1.4 ? nil : 296).padding(.top,28)
        RecordText("本机内容已保留",13).foregroundStyle(p.secondary).padding(.top,28)
        Spacer(minLength:0)
        HStack(spacing:16){Spacer();Button {model.route=nil} label:{NativeRecordActionButton(title:"取消",primary:false)}.frame(width:105);Button {model.confirmation=local.record.id} label:{NativeRecordActionButton(title:"保留本机并重发")}.frame(width:232).accessibilityIdentifier("record.conflict.resend")}.padding(.top,24).overlay(alignment:.top){Rectangle().fill(p.separator).frame(height:0.5).padding(.horizontal,-24)}.padding(.bottom,21)
      }.padding(.horizontal,24).frame(width:width,height:height,alignment:.topLeading).background(p.surface,in:RoundedRectangle(cornerRadius:16,style:.continuous)).position(x:size.width/2,y:size.height/2).accessibilityElement(children:.contain).accessibilityIdentifier("record.conflict.page")
    } else {
      VStack(spacing:0) {
        navigation(title:"版本冲突",back:"记录",tablet:false){model.route=nil}
        ScrollView {VStack(alignment:.leading,spacing:0){RecordText(local.record.title,26,weight:.semibold);RecordText("\(comparison.count) 处内容不同 · 本机内容已保留",13).foregroundStyle(p.secondary).padding(.top,7);comparisonCard(local.record,other:remote,remote:false,tablet:false,width:size.width-40).padding(.top,24);comparisonCard(remote,other:local.record,remote:true,tablet:false,width:size.width-40).padding(.top,16)}.padding(.horizontal,20).padding(.top,22).padding(.bottom,30)}.accessibilityIdentifier("record.conflict.documents")
        Button {model.confirmation=local.record.id} label:{NativeRecordActionButton(title:"保留本机并重发")}.padding(.horizontal,20).padding(.top,19).padding(.bottom,61).overlay(alignment:.top){Rectangle().fill(p.separator).frame(height:0.5)}.accessibilityIdentifier("record.conflict.resend")
      }.background(p.paper).accessibilityElement(children:.contain).accessibilityIdentifier("record.conflict.page")
    }
  }
  private func comparisonCard(_ record:NativeRecord,other:NativeRecord,remote:Bool,tablet:Bool,width:CGFloat)->some View {
    let nodes=NativeRecordComparison.nodes(record),opposite=NativeRecordComparison.nodes(other)
    return VStack(alignment:.leading,spacing:0) {
      RecordText(remote ? "远端" : "本机",17,weight:.semibold)
      RecordText("版本 \(record.version) · \(time(record.updatedAt ?? record.createdAt))",12).foregroundStyle(p.secondary).padding(.top,5)
      VStack(alignment:.leading,spacing:tablet ? 14 : 6) {
        ForEach(Array(groups(nodes,other:opposite).enumerated()),id:\.offset) {_,group in
          VStack(alignment:.leading,spacing:tablet ? 11 : 8) {
            ForEach(Array(group.nodes.enumerated()),id:\.offset) {_,node in NativeRecordComparisonContent(node:node,width:width-(group.changed ? 44 : 32),attachments:record.attachments).accessibilityIdentifier(remote ? "record.conflict.remote.body" : "record.conflict.local.body")}
          }.padding(.leading,group.changed ? 10 : 0).padding(.trailing,group.changed ? 10 : 0).padding(.top,group.changed ? 7 : 0).padding(.bottom,group.changed ? (tablet ? 21 : 15) : 0)
            .frame(maxWidth:.infinity,alignment:.leading).background(group.changed ? (remote ? p.paper : p.selection) : Color.clear,in:RoundedRectangle(cornerRadius:8,style:.continuous)).overlay(alignment:.leading){if group.changed {RoundedRectangle(cornerRadius:1).fill(remote ? p.separator : p.accent).frame(width:2)}}.padding(.horizontal,group.changed ? -4 : 0)
        }
      }.padding(.top,18)
      if tablet {Spacer(minLength:20);ForEach(record.attachments){file in RecordText(file.name+" · "+amount(Int64(file.bytes)),12,lines:2).foregroundStyle(p.secondary)}}
    }.padding(.horizontal,16).padding(.top,15).padding(.bottom,tablet ? 23 : 30).frame(width:width).frame(minHeight:(tablet ? 296 : 228)*scale,alignment:.topLeading).background(tablet ? p.well : p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous))
  }
  private struct Difference {var changed:Bool;var nodes:[NativeRecordNode]}
  private func groups(_ nodes:[NativeRecordNode],other:[NativeRecordNode])->[Difference] {
    var result:[Difference]=[]
    for (i,node) in nodes.enumerated(){let changed = !other.indices.contains(i) || node != other[i];if result.last?.changed==changed {result[result.count-1].nodes.append(node)}else{result.append(.init(changed:changed,nodes:[node]))}}
    return result
  }
  private func time(_ value:String)->String {guard let date=NativeRecordListModel.date(value) else{return "时间未知"};let f=DateFormatter();f.timeZone=TimeZone(identifier:"Asia/Shanghai");var calendar=Calendar(identifier:.gregorian);calendar.timeZone=f.timeZone;f.dateFormat=calendar.isDateInToday(date) ? "今天 HH:mm" : "M月d日 HH:mm"
#if DEBUG
    if ProcessInfo.processInfo.arguments.contains("--review-record-sync"){f.dateFormat="今天 HH:mm"}
#endif
    return f.string(from:date)}
  private func transferAmount(_ sent:Int64,_ total:Int64)->String {
    let first=amount(sent),last=amount(total),unit=last.components(separatedBy:" ").last ?? ""
    let prefix=first.hasSuffix(" "+unit) ? String(first.dropLast(unit.count+1)) : first
    return prefix+" / "+last
  }
  private func amount(_ bytes:Int64)->String {ByteCountFormatter.string(fromByteCount:bytes,countStyle:.file)}
}

struct NativeRecordSyncConfirmation:View {
  let title:String;let message:String;let action:String;let cancel:()->Void;let confirm:()->Void
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale:CGFloat=1
  var body:some View {GeometryReader {g in let p=NativePalette(dark:scheme == .dark),w:CGFloat=g.size.width>=760 ? 330 : 302
    ZStack {Color.black.opacity(scheme == .dark ? 0.44 : 0.24).ignoresSafeArea();VStack(spacing:0){RecordText(title,18,weight:.semibold,align:.center).padding(.top,22);RecordText(message,14,height:22,lines:nil,align:.center).padding(.horizontal,22).padding(.top,18);Spacer(minLength:20);Rectangle().fill(p.separator).frame(height:0.5);HStack(spacing:0){Button(action:cancel){RecordText("取消",16).frame(maxWidth:.infinity,minHeight:58)}.accessibilityIdentifier("record.sync.cancel");Rectangle().fill(p.separator).frame(width:0.5,height:58);Button(action:confirm){RecordText(action,16,weight:.semibold).frame(maxWidth:.infinity,minHeight:58)}.accessibilityIdentifier("record.sync.confirm")}.foregroundStyle(p.accent)}.frame(width:w,height:scale>1.4 ? min(480,g.size.height-80) : 232).background(p.surface,in:RoundedRectangle(cornerRadius:16,style:.continuous)).foregroundStyle(p.label)}
  }.ignoresSafeArea()}
}

private struct NativeRecordComparisonContent:View {
  let node:NativeRecordNode
  let width:CGFloat
  let attachments:[NativeRecordAttachment]
  @Environment(\.colorScheme) private var scheme
  var body:some View {content(node,width:width)}
  private func content(_ node:NativeRecordNode,width:CGFloat)->AnyView {
    let p=NativePalette(dark:scheme == .dark)
    if node.type=="bulletList" || node.type=="orderedList" {
      var start=1
      if case .number(let number)=node.attrs?["start"],number.isFinite,abs(number)<=Double(Int32.max){start=Int(number)}
      return AnyView(VStack(alignment:.leading,spacing:8) {
        ForEach(Array((node.content ?? []).enumerated()),id:\.offset) {index,item in
          HStack(alignment:.top,spacing:8) {
            RecordText(node.type=="orderedList" ? String(start+index)+"." : "•",16).foregroundStyle(p.secondary).frame(width:24,alignment:.trailing)
            VStack(alignment:.leading,spacing:6) {ForEach(Array((item.content ?? []).enumerated()),id:\.offset) {_,child in content(child,width:max(1,width-32))}}
          }
        }
      })
    }
    if node.type=="blockquote" || node.type=="listItem" {
      return AnyView(HStack(alignment:.top,spacing:10){if node.type=="blockquote" {Rectangle().fill(p.accent).frame(width:2)};VStack(alignment:.leading,spacing:6){ForEach(Array((node.content ?? []).enumerated()),id:\.offset) {_,child in content(child,width:max(1,width-(node.type=="blockquote" ? 12 : 0)))}}}.fixedSize(horizontal:false,vertical:true))
    }
    if let id=node.attachmentID,let file=attachments.first(where:{$0.id==id}) {
      return AnyView(RecordText(file.name+" · "+ByteCountFormatter.string(fromByteCount:Int64(file.bytes),countStyle:.file),12,lines:nil).foregroundStyle(p.secondary))
    }
    return AnyView(NativeRecordReadText(node:node,size:node.type=="heading" ? 18 : 16,heading:node.type=="heading",lineHeight:node.type=="heading" ? 28 : 26,width:width))
  }
}
