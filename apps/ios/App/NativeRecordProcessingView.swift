import SwiftUI
import UIKit
import PDFKit
import CoreText

struct NativeRecordProcessingPresentation:View {
  @ObservedObject var model:NativeRecordProcessingModel
  @ObservedObject private var draft:NativeDraftModel
  let detailFrame:CGRect
  let list:NativeRecordListModel
  let media:NativeRecordMediaStore?
  let scope:String
  @Environment(\.colorScheme) private var scheme
  @Environment(\.scenePhase) private var scene
  @ScaledMetric private var scale:CGFloat=1
  @State private var resultFile:ReadFile?
  @StateObject private var keyboard=NativeRecordKeyboard()
  private var p:NativePalette {.init(dark:scheme == .dark)}
  init(model:NativeRecordProcessingModel,detailFrame:CGRect,list:NativeRecordListModel,media:NativeRecordMediaStore?,scope:String) {
    self.model=model;self.detailFrame=detailFrame;self.list=list;self.media=media;self.scope=scope;_draft=ObservedObject(wrappedValue:model.draft)
  }
  var body:some View {
    GeometryReader {g in
      if let route=model.route {
        let tablet=UIDevice.current.userInterfaceIdiom == .pad && g.size.width>=760
        ZStack(alignment:.topLeading) {
          if route == .submissionFailure {Color.clear.allowsHitTesting(false)}
          else if [.form,.device,.agent,.queue,.sync].contains(route) {sheet(route,size:g.size,tablet:tablet)}
          else {
            HStack(spacing:0) {
              if tablet {Color.clear.frame(width:detailFrame.width>0 ? max(0,detailFrame.minX-1) : 560).allowsHitTesting(false)}
              if case .source=model.route,let source=model.job?.recordSnapshot ?? model.record {
                NativeRecordDetailView(record:source,list:list,back:{model.route=model.sourceReturn},mediaStore:media,mediaScope:scope,syncModel:model.sync,processingModel:model,readOnly:true)
              }else {page(route,tablet:tablet)}
            }
          }
          if let confirmation=model.confirmation {
            NativeRecordProcessConfirmation(title:confirmation=="cancel" ? "取消这个任务？" : "确认归档？",message:confirmation=="cancel" ? "将请求服务器停止本次加工。原始记录与附件会保留。" : "将草稿版本 \(revisionLabel) 保存到资料库。原始记录版本 \(model.sourceVersion) 保留。",action:confirmation=="cancel" ? "取消任务" : "确认归档",destructive:confirmation=="cancel",cancelTitle:confirmation=="cancel" ? "继续执行" : "取消",cancel:{model.confirmation=nil},confirm:{
              if confirmation=="cancel",let id=model.job?.id {Task {await model.taskAction(id,action:"cancel")}}
              else {model.confirmation=nil;draft.requestApproval();Task {await model.approve()}}
            })
          }else if draft.phase == .changed,case .result=model.route {
            NativeRecordProcessConfirmation(title:"草稿版本已变化",message:"当前查看版本 \(model.reviewedVersion.map {String($0)} ?? "")，最新版本 \(draft.task?.draftVersion.map {String($0)} ?? "")。归档前需重新查看最新内容。",action:"查看最新",cancelTitle:"返回",cancel:{model.route = .history},confirm:{if let id=model.job?.id {Task {await model.reloadResult(id)}}})
          }else if let failure=model.failure {
            NativeRecordProcessConfirmation(title:model.frozen != nil ? "加工提交失败" : "暂时无法完成",message:failure,action:model.frozen != nil ? "重试" : "好",cancelTitle:"稍后",cancel:{model.failure=nil;model.route=nil},confirm:{model.failure=nil;if model.frozen != nil {Task {await model.start(allowQueue:true,retry:true)}}})
          }
          if let file=resultFile {NativeRecordResultFile(file:file,bytes:resultData(file),close:{resultFile=nil})}
          if let attachment=model.resultPreview,let media {NativeRecordMediaPreview(model:.init(attachment:attachment,scope:scope,store:media,remote:true,downloadOriginal:model.sync.map {sync in {a in try await sync.download(a,owner:scope)}}),tablet:tablet,back:{model.resultPreview=nil})}
        }.foregroundStyle(p.label).tint(p.accent).buttonStyle(.plain)
          .accessibilityElement(children:.contain).accessibilityIdentifier(model.route.map {if case .source=$0 {return "record.process.source.detail"};return "record.process.ready"} ?? "record.process.ready")
          .task(id:scene) {guard scene == .active else{return};while !Task.isCancelled {if !isArchived(model.route) {await model.reload()};if case .result=model.route {await draft.checkVersion()};do {try await Task.sleep(nanoseconds:5_000_000_000)}catch{return}}}
          .onChange(of:model.form.preset) {_ in Task {await model.persist()}}
          .onChange(of:model.form.instructions) {_ in Task {await model.persist()}}
          .onChange(of:model.form.deviceID) {_ in Task {await model.persist()}}
          .onChange(of:model.form.agent) {_ in Task {await model.persist()}}
          .onChange(of:model.form.advanced) {_ in Task {await model.persist()}}
      }
    }.ignoresSafeArea(.container,edges:[.top,.bottom]).environment(\.openURL,OpenURLAction {url in
      if url.scheme=="lingnest-file",let source=URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="source"})?.value,let file=draft.localFile(source) {resultFile=file;return .handled}
      guard ["http","https"].contains(url.scheme?.lowercased() ?? ""),url.host != nil,url.user==nil,url.password==nil else{return .discarded};return .systemAction(url)
    })
  }
  private func sheet(_ route:NativeRecordProcessRoute,size:CGSize,tablet:Bool)->some View {
    let expanded=model.form.advanced,formHeight:CGFloat=expanded ? (tablet ? 670 : 722) : 612
    let desired:CGFloat=route == .device || route == .agent ? 518 : route == .queue || route == .sync ? 532 : formHeight
    let w:CGFloat=tablet ? min(500,size.width-48) : size.width
    let h=max(120,min(desired,size.height-keyboard.height-(tablet ? 48 : 44)))
    return ZStack(alignment:.topLeading) {
      Color.black.opacity(scheme == .dark ? 0.44 : 0.24).ignoresSafeArea()
      VStack(spacing:0) {
        if scale>1.4 {
          ScrollView {VStack(alignment:.leading,spacing:24) {sheetHeader(route,width:w);largeForm(route,width:w-48)}.padding(.horizontal,24).padding(.bottom,34)}
        } else {
          ScrollView {ZStack(alignment:.topLeading) {
            if !tablet {Capsule().fill(p.well).frame(width:40,height:5).offset(x:(w-40)/2,y:9)}
            sheetHeader(route,width:w).offset(y:route == .form && expanded ? 26 : 25)
            if route == .device || route == .agent {picker(route,width:w,height:desired)}
            else if route == .queue || route == .sync {gate(route,width:w)}
            else {form(width:w,height:desired,expanded:expanded)}
          }.frame(width:w,height:desired)}.scrollDisabled(keyboard.height==0).scrollDismissesKeyboard(.interactively).frame(width:w,height:h)
        }
      }.frame(width:w,height:h,alignment:.top).background(p.surface,in:RoundedRectangle(cornerRadius:16,style:.continuous))
        .offset(x:(size.width-w)/2,y:tablet ? max(24,(size.height-keyboard.height-h)/2) : size.height-keyboard.height-h)
    }
  }
  private func sheetHeader(_ route:NativeRecordProcessRoute,width:CGFloat)->some View {
    let title=route == .device ? "执行电脑" : route == .agent ? "选择 Agent" : route == .queue ? "等待执行电脑" : route == .sync ? "同步后加工" : "加工记录"
    return Group {
      if scale>1.4 {
        VStack(alignment:.leading,spacing:16) {
          Button {if route == .form {UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil);Task {if await model.persist(){model.route=nil}}}else{model.route = .form}} label:{RecordText("取消",16)}.foregroundStyle(p.accent).accessibilityIdentifier("record.process.close")
          RecordText(title,20,weight:.semibold)
        }.frame(maxWidth:.infinity,alignment:.leading)
      }else {
      ZStack(alignment:.topLeading) {
      Button {if route == .form {UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil);Task {if await model.persist(){model.route=nil}}} else {model.route = .form}} label:{RecordText("取消",16).frame(minHeight:44,alignment:.topLeading)}.foregroundStyle(p.accent).offset(x:24,y:route == .form && model.form.advanced ? 3 : 2).accessibilityIdentifier("record.process.close")
      RecordText(title,20,weight:.semibold,align:.center).frame(width:width-192).foregroundStyle(p.label).offset(x:96)
    }.frame(width:width,height:44,alignment:.topLeading)
      }
    }
  }

  private func form(width w:CGFloat,height h:CGFloat,expanded:Bool)->some View {
    let cw=(w-58)/2
    return ZStack(alignment:.topLeading) {
      text(sourceLabel,x:24,y:expanded ? 77 : 78,w:w-48,size:13,muted:true)
      text("加工方式",x:24,y:expanded ? 117 : 119,w:w-48,size:15,weight:.medium)
      ForEach(Array(NativeRecordPreset.allCases.enumerated()),id:\.element) {i,preset in
        Button {guard model.frozen==nil else{return};model.form.preset=preset} label:{
          ZStack(alignment:.topLeading) {RoundedRectangle(cornerRadius:12,style:.continuous).fill(model.form.preset==preset ? p.selection : p.well);RecordText(preset.title,15,weight:.medium,align:.center).frame(width:cw-12).offset(x:6,y:10)}.foregroundStyle(model.form.preset==preset ? p.accent : p.label).frame(width:cw,height:42)
        }.offset(x:24+CGFloat(i%2)*(cw+10),y:(expanded ? 150 : 151)+CGFloat(i/2)*52).accessibilityIdentifier("record.process.preset."+preset.rawValue)
      }
      text("加工要求",x:24,y:expanded ? 268 : 270,w:w-48,size:15,weight:.medium)
      NativeRecordProcessInput(value:$model.form.instructions,editable:!model.busy&&model.frozen==nil,foreground:scheme == .dark ? UIColor(red:244/255,green:242/255,blue:236/255,alpha:1) : UIColor(red:28/255,green:28/255,blue:30/255,alpha:1))
        .frame(width:w-48,height:expanded ? 89 : 102).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous)).offset(x:24,y:expanded ? 300 : 301).accessibilityIdentifier("record.process.instructions")
      Button {model.form.advanced.toggle()} label:{HStack {RecordText("高级派发选项",expanded ? 14 : 15);Spacer();RecordSymbol(name:expanded ? "chevron.up" : "chevron.down",size:12)}}.foregroundStyle(p.secondary).frame(width:w-48,height:28,alignment:.top).offset(x:24,y:expanded ? 417 : 433).accessibilityIdentifier("record.process.advanced")
      if expanded {
        VStack(spacing:0) {dispatchRow("执行电脑",value:model.selectedDevice,width:w-48){model.route = .device};Rectangle().fill(p.separator).frame(height:0.5).padding(.leading,16);dispatchRow("Agent",value:model.agentName(model.form.agent),width:w-48){model.route = .agent}}
          .frame(width:w-48,height:104).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous)).offset(x:24,y:449)
      }else {text("电脑与 Agent · "+(model.form.deviceID==nil&&model.form.agent==nil ? "自动选择" : model.selectedDevice+" · "+model.agentName(model.form.agent)),x:24,y:465,w:w-48,size:12,muted:true)}
      Button {submit()} label:{NativeRecordActionButton(title:model.busy ? "正在提交" : "开始加工")}.disabled(model.busy).frame(width:w-48).offset(x:24,y:h-(expanded ? (UIDevice.current.userInterfaceIdiom == .pad ? 78 : 80) : 80)).accessibilityIdentifier("record.process.start")
    }.frame(width:w,height:h,alignment:.topLeading)
  }
  private var sourceLabel:String {(model.record?.title ?? "记录")+" · 版本 \(model.record?.version ?? 0)"}
  private func dispatchRow(_ title:String,value:String,width:CGFloat,action:@escaping()->Void)->some View {
    Button(action:action){HStack {RecordText(title,16);Spacer();RecordText(value,15).foregroundStyle(p.secondary);RecordSymbol(name:"chevron.down",size:12).foregroundStyle(p.secondary)}.padding(.horizontal,16).frame(width:width,height:52)}.disabled(model.frozen != nil).accessibilityIdentifier(title=="Agent" ? "record.process.agent" : "record.process.device")
  }
  private func picker(_ route:NativeRecordProcessRoute,width w:CGFloat,height h:CGFloat)->some View {
    let agent=route == .agent
    return ZStack(alignment:.topLeading) {
      ScrollView {VStack(spacing:21) {
        pickerRow("自动选择",subtitle:agent ? "按可用状态分配" : "\(model.workers.count) 台电脑 · \(model.workers.filter {$0.online==true}.count) 台在线",selected:agent ? model.form.agent==nil : model.form.deviceID==nil,width:w-48) {if agent {model.form.agent=nil}else {model.form.deviceID=nil}}
        if agent {ForEach(model.availableAgents,id:\.self) {key in pickerRow(model.agentName(key),subtitle:"可用 · "+(model.workers.first {$0.online==true&&($0.agents?.contains(key) ?? false)}?.name ?? model.selectedDevice),selected:model.form.agent==key,width:w-48){model.form.agent=key}}}
        else {ForEach(model.workers) {worker in pickerRow(worker.name,subtitle:worker.online==true ? "在线 · "+(worker.agents ?? []).map {model.agentName($0)}.joined(separator:"、") : "离线",selected:model.form.deviceID==worker.id,width:w-48) {model.form.deviceID=worker.id;if let selected=model.form.agent,!(worker.agents?.contains(selected) ?? false){model.form.agent=nil}}}}
      }}.frame(width:w-48,height:max(50,h-190)).offset(x:24,y:86)
      Button {model.route = .form;Task {await model.persist()}} label:{NativeRecordActionButton(title:"完成")}.frame(width:w-48).offset(x:24,y:h-80).accessibilityIdentifier("record.process.picker.done")
    }.frame(width:w,height:h,alignment:.topLeading)
  }
  private func pickerRow(_ title:String,subtitle:String,selected:Bool,width:CGFloat,action:@escaping()->Void)->some View {
    Button(action:action){ZStack(alignment:.topLeading) {
      RoundedRectangle(cornerRadius:12,style:.continuous).fill(p.well)
      RecordText(title,16,weight:selected ? .medium : .regular).frame(width:width-61,alignment:.leading).offset(x:16,y:12)
      RecordText(subtitle,12,lines:1).foregroundStyle(p.secondary).frame(width:width-61,alignment:.leading).offset(x:16,y:40)
      if selected {RecordSymbol(name:"checkmark",size:18).foregroundStyle(p.accent).offset(x:width-34,y:17)}
    }.frame(width:width,height:72)}
  }
  private func gate(_ route:NativeRecordProcessRoute,width w:CGFloat)->some View {
    let queue=route == .queue
    return ZStack(alignment:.topLeading) {
      RecordSymbol(name:queue ? "desktopcomputer" : "arrow.triangle.2.circlepath",size:56).foregroundStyle(p.secondary).offset(x:w/2-28,y:94)
      text(queue ? "没有在线的执行电脑" : "本机修改尚未同步",x:24,y:180,w:w-48,size:22,weight:.semibold,center:true)
      text(queue ? sourceLabel : "本机版本 \((model.record?.version ?? 0)+1) · 资料空间版本 \(model.record?.version ?? 0)",x:24,y:230,w:w-48,size:14,muted:true,center:true)
      HStack {RecordText(queue ? "执行电脑" : "同步状态",16);Spacer();RecordText(queue ? model.selectedDevice : "\(model.record?.attachments.count ?? 0) 个原件待上传",14).foregroundStyle(p.secondary)}.padding(.horizontal,16).frame(width:w-48,height:53).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous)).offset(x:24,y:279)
      Button {Task {if queue {await model.start(allowQueue:true)} else {await model.synchronize()}}} label:{NativeRecordActionButton(title:model.busy ? "正在处理" : queue ? "加入等待队列" : "先同步版本 \((model.record?.version ?? 0)+1)")}.disabled(model.busy).frame(width:w-48).offset(x:24,y:376).accessibilityIdentifier("record.process.gate")
      text(queue ? "等待电脑上线" : "同步完成后确认版本再加工",x:24,y:445,w:w-48,size:13,muted:true,center:true)
    }.frame(width:w,height:532,alignment:.topLeading)
  }
  @ViewBuilder private func largeForm(_ route:NativeRecordProcessRoute,width:CGFloat)->some View {
    RecordText(sourceLabel,14).foregroundStyle(p.secondary)
    if route == .form {
      ForEach(NativeRecordPreset.allCases){preset in Button {model.form.preset=preset} label:{RecordText(preset.title,18).padding(16).frame(maxWidth:.infinity).background(model.form.preset==preset ? p.selection : p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))}}
      TextEditor(text:$model.form.instructions).font(.body).frame(minHeight:170).disabled(model.frozen != nil)
      Button("执行电脑 · "+model.selectedDevice){model.route = .device};Button("Agent · "+model.agentName(model.form.agent)){model.route = .agent}
      Button {submit()} label:{NativeRecordActionButton(title:"开始加工")}.disabled(model.busy).accessibilityIdentifier("record.process.start")
    }else if route == .device || route == .agent {
      Button("自动选择"){if route == .agent {model.form.agent=nil}else{model.form.deviceID=nil};model.route = .form}
      if route == .agent {ForEach(model.availableAgents,id:\.self){key in Button(model.agentName(key)){model.form.agent=key;model.route = .form}}}
      else {ForEach(model.workers){worker in Button(worker.name){model.form.deviceID=worker.id;model.route = .form}}}
    }else {RecordText(route == .sync ? "本机修改尚未同步" : "没有在线的执行电脑",22,weight:.semibold);Button {Task {if route == .sync {await model.synchronize()}else{await model.start(allowQueue:true)}}} label:{NativeRecordActionButton(title:route == .sync ? "先同步" : "加入等待队列")}.disabled(model.busy).accessibilityIdentifier("record.process.gate")}
  }
  private func page(_ route:NativeRecordProcessRoute,tablet:Bool)->some View {
    GeometryReader {g in
      let title:String=route == .history ? "关联任务" : isResult(route) ? (isArchived(route) ? "归档资料" : "草稿审核") : "任务详情"
      VStack(spacing:0) {
        navigation(title,back:route == .history ? "记录详情" : isResult(route) ? "原始记录" : "关联任务",tablet:tablet,width:g.size.width)
        ScrollView {VStack(alignment:.leading,spacing:0) {
          if route == .history {history(width:g.size.width-(tablet ? 48 : 40))}
          else if isResult(route) {result(width:g.size.width-(tablet ? 48 : 40),archived:isArchived(route))}
          else {task(width:g.size.width-(tablet ? 48 : 40))}
        }.padding(.horizontal,tablet ? 24 : 20).padding(.top,tablet ? 22 : 24).padding(.bottom,30)}.accessibilityIdentifier("record.process.page.scroll")
        if route != .history {footer(route,tablet:tablet)}
      }.background(p.paper)
    }
  }
  private func navigation(_ title:String,back:String,tablet:Bool,width:CGFloat)->some View {
    Group {
      if scale>1.4 {
        VStack(alignment:.leading,spacing:12) {
          HStack(alignment:.top) {
            Button {if model.route == .history || isResult(model.route){model.route=nil}else{model.route = .history}} label:{Label {RecordText(back,16)} icon:{RecordSymbol(name:"chevron.left",size:16)}}.foregroundStyle(p.accent).accessibilityIdentifier("record.process.back")
            Spacer(minLength:12)
            if isArchived(model.route) {Menu {if let archive=model.archives.first(where:{$0.id==model.job?.archiveId}){Button("在资料库打开"){model.openLibrary?(archive)}};Button("关联任务"){model.route = .history}}label:{RecordText("更多",16)}.foregroundStyle(p.accent).accessibilityIdentifier("record.process.archive.more")}
          }
          RecordText(title,20,weight:.semibold).accessibilityIdentifier("record.process.navigation.title")
        }.padding(.horizontal,tablet ? 24 : 20).padding(.top,tablet ? 23 : 54).padding(.bottom,16).frame(width:width,alignment:.leading).overlay(alignment:.bottom){Rectangle().fill(p.separator).frame(height:0.5)}
      }else {
      ZStack(alignment:.topLeading) {
      Button {if model.route == .history || isResult(model.route) {model.route=nil}else{model.route = .history}} label:{HStack(alignment:.top,spacing:tablet ? 8 : 6){RecordSymbol(name:"chevron.left",size:16).padding(.top,3);RecordText(back,16)}}.foregroundStyle(p.accent).offset(x:tablet ? 22 : 15,y:tablet ? 25 : 54).accessibilityIdentifier("record.process.back")
      RecordText(title,tablet ? 20 : 17,weight:.semibold,align:.center).frame(width:tablet ? 242 : 171).offset(x:tablet ? 216 : (width-171)/2,y:tablet ? 23 : 54)
      if isArchived(model.route) {Menu {
        if let archive=model.archives.first(where:{$0.id==model.job?.archiveId}) {Button("在资料库打开"){model.openLibrary?(archive)}}
        Button("关联任务"){model.route = .history}
      }label:{RecordText("更多",16).foregroundStyle(p.accent).frame(minWidth:44,minHeight:44,alignment:.topTrailing)}.offset(x:width-68,y:tablet ? 27 : 54).accessibilityIdentifier("record.process.archive.more")}
    }.frame(width:width,height:tablet ? 72 : 88,alignment:.topLeading).overlay(alignment:.bottom){Rectangle().fill(p.separator).frame(height:0.5)}
      }
    }
  }

  private func history(width:CGFloat)->some View {
    VStack(alignment:.leading,spacing:0) {
      RecordText(model.record?.title ?? "记录",24,weight:.semibold)
      RecordText("当前记录 · 版本 \(model.record?.version ?? 0)",13).foregroundStyle(p.secondary).padding(.top,8)
      VStack(spacing:26) {ForEach(model.jobs) {job in
        Button {Task {await model.openJob(job)}} label:{Group {if scale>1.4 {
          VStack(alignment:.leading,spacing:12) {
            RecordText(preset(job),18,weight:.semibold)
            badge(job.state=="awaiting_review" ? "待确认" : job.state=="completed" ? "已归档" : job.stateLabel,width:76,muted:["completed","cancelled"].contains(job.state))
            RecordText(date(job.createdAt)+" · 版本 \(job.recordVersion ?? 0)",13).foregroundStyle(p.secondary)
            RecordText(job.state=="awaiting_review" ? "查看草稿" : job.state=="completed" ? "查看归档" : "查看任务",15).foregroundStyle(p.accent)
          }.padding(16).frame(width:width,alignment:.leading).background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous))
        }else {ZStack(alignment:.topLeading) {
          RoundedRectangle(cornerRadius:12,style:.continuous).fill(p.surface)
          text(preset(job),x:16,y:15,w:width-120,size:18,weight:.semibold)
          text(date(job.createdAt)+" · 版本 \(job.recordVersion ?? 0)",x:16,y:51,w:width-32,size:13,muted:true)
          text(job.state=="awaiting_review" ? "查看草稿" : job.state=="completed" ? "查看归档" : "查看任务",x:16,y:80,w:width-48,size:15,accent:true)
          badge(job.state=="awaiting_review" ? "待确认" : job.state=="completed" ? "已归档" : job.stateLabel,width:76,muted:["completed","cancelled"].contains(job.state)).offset(x:width-92,y:13)
          RecordSymbol(name:"chevron.right",size:13).foregroundStyle(p.secondary).offset(x:width-29,y:83)
        }.frame(width:width,height:111)}}}.accessibilityIdentifier("record.process.job."+job.id)
      }}.padding(.top,42)
      if model.jobs.isEmpty {RecordText("暂无加工任务",18).foregroundStyle(p.secondary).padding(.top,80)}
    }
  }
  private func task(width:CGFloat)->some View {
    let job=model.job,failed=job?.state=="failed" || job?.state=="waiting_action"
    let complete=job?.state=="completed",review=job?.state=="awaiting_review"
    return VStack(alignment:.leading,spacing:0) {
      RecordText(job.map(preset) ?? "加工任务",26,weight:.semibold)
      RecordText((sourceRecord?.title ?? "记录")+" · 来源版本 \(job?.recordVersion ?? 0)",13).foregroundStyle(p.secondary).padding(.top,10)
      badge(failed ? "执行失败" : review ? "待确认" : complete ? "已归档" : job?.state=="queued" ? "等待电脑" : job?.state=="cancelled" ? "已取消" : "加工中",width:80).padding(.top,16)
      VStack(spacing:0) {keyValue("执行电脑",value:model.devices.first {$0.id==job?.deviceId}?.name ?? "等待分配",width:width,inset:0);keyValue("Agent",value:model.agentName(job?.agent ?? job?.preferredAgent),width:width,inset:0);keyValue("创建时间",value:job.map {date($0.createdAt)} ?? "",width:width,inset:0)}.padding(.top,13).padding(.bottom,10).frame(minHeight:155).background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous)).padding(.top,30)
      VStack(alignment:.leading,spacing:42) {
        step("记录版本已固定",subtitle:"版本 \(job?.recordVersion ?? 0) · \(job?.recordSnapshot?.attachments.count ?? model.record?.attachments.count ?? 0) 个原件校验通过",symbol:"checkmark.circle",complete:true)
        step(failed ? (job?.events?.last?.message.contains("未生成审核草稿")==true ? "执行连接中断" : "加工未完成") : review ? "结果待确认" : complete ? "结果已归档" : job?.state=="queued" ? "等待可用电脑" : job?.state=="cancelled" ? "任务已取消" : "正在整理内容",subtitle:job?.events?.last.map {date($0.at)+" · "+($0.message)} ?? "",symbol:failed ? "exclamationmark.circle" : "arrow.triangle.2.circlepath",complete:false)
      }.padding(.top,34)
      RecordText("原始记录",14).foregroundStyle(p.secondary).padding(.top,53)
      Button {openSource()} label:{HStack(spacing:14){RecordSymbol(name:"note.text",size:22).foregroundStyle(p.accent);RecordText(model.record?.title ?? "记录",16);Spacer();RecordSymbol(name:"chevron.right",size:12).foregroundStyle(p.secondary)}.padding(.horizontal,16).frame(minHeight:53).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))}.padding(.top,11).accessibilityIdentifier("record.process.source")
    }
  }
  private func result(width:CGFloat,archived:Bool)->some View {
    let bundle=archived ? model.archived : draft.bundle
    let when=model.job.map {date($0.events?.last?.at ?? $0.createdAt)} ?? ""
    let caption=archived ? "资料库 · "+when : "草稿版本 "+revisionLabel+" · "+when+" · 待确认"
    return VStack(alignment:.leading,spacing:0) {
      RecordText(bundle?.meta.title ?? (draft.loading ? "正在读取结果" : "结果暂不可读"),24,weight:.semibold)
      RecordText(caption,12).foregroundStyle(p.secondary).padding(.top,9)
      Group {
        if scale>1.4 {
          VStack(spacing:8){ForEach(0..<3){index in Button {model.resultCategory=index}label:{RecordText(index==0 ? "正文" : index==1 ? "附件 \(sourceAttachments.count)" : "归档信息",16).padding(12).frame(maxWidth:.infinity,alignment:.leading).foregroundStyle(index==model.resultCategory ? p.label : p.secondary).background(index==model.resultCategory ? p.surface : .clear,in:RoundedRectangle(cornerRadius:10,style:.continuous))}.accessibilityIdentifier("record.process.result.category.\(index)")}}.padding(4).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))
        }else {
          HStack(spacing:0){ForEach(0..<3){index in Button {model.resultCategory=index} label:{ZStack(alignment:.topLeading){if index==model.resultCategory {RoundedRectangle(cornerRadius:7,style:.continuous).fill(p.surface).frame(width:width/3-4,height:30).offset(x:2,y:2)};RecordText(index==0 ? "正文" : index==1 ? "附件 \(sourceAttachments.count)" : "归档信息",13,align:.center).frame(width:width/3).offset(y:7)}.foregroundStyle(index==model.resultCategory ? p.label : p.secondary).frame(width:width/3,height:34,alignment:.topLeading)}.accessibilityIdentifier("record.process.result.category.\(index)")}}.frame(height:34).background(p.well,in:RoundedRectangle(cornerRadius:9,style:.continuous))
        }
      }.padding(.top,20)
      if let bundle {
        if model.resultCategory==2 {
          VStack(spacing:8){ForEach(Array(resultMetadata.enumerated()),id:\.offset){_,row in keyValue(row.0,value:row.1,width:width,inset:14).frame(minHeight:53,alignment:.top).background(p.surface,in:RoundedRectangle(cornerRadius:10,style:.continuous))}}
            .padding(.top,28)
          RecordText("附件 \(sourceAttachments.count) 个 · "+ByteCountFormatter.string(fromByteCount:Int64(sourceAttachments.reduce(0){$0+$1.bytes}),countStyle:.file)+" · 校验通过",13).foregroundStyle(p.secondary).padding(.top,33)
        }else if model.resultCategory==1 {
          VStack(spacing:16) {
            ForEach(sourceAttachments){a in
              if a.mime.hasPrefix("audio/"),scale<=1.4,let media {NativeRecordProcessingAudio(attachment:a,width:width,scope:scope,store:media,sync:model.sync,reference:model.debugReadOnly)}
              else {Button {model.resultPreview=a} label:{fileRow(a,width:width)}}
            }
            ForEach(bundle.files.filter {!["summary","original","source"].contains($0.role)},id:\.path){file in Button {resultFile=ReadFile(path:file.path,role:file.role,bytes:file.bytes,sha256:file.sha256)} label:{HStack{RecordText(file.path,16);Spacer();RecordSymbol(name:"chevron.right",size:13)}}}
          }.padding(.top,26)
        }else {
          let markdown=bundle.files.first {$0.role=="summary"}.flatMap {Data(base64Encoded:$0.body)}.flatMap {String(data:$0,encoding:.utf8)} ?? bundle.meta.summary
          NativeRecordResultMarkdown(source:markdown,width:width,draft:draft).padding(.top,29)
          Button {openSource()} label:{VStack(alignment:.leading,spacing:10){RecordText("原始记录 · "+(sourceRecord?.title ?? ""),15,weight:.medium);RecordText("来源版本 \(model.sourceVersion) · 查看原文",12).foregroundStyle(p.accent)}.padding(.horizontal,16).padding(.vertical,12).frame(maxWidth:.infinity,minHeight:80,alignment:.topLeading).background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous))}.padding(.top,9).accessibilityIdentifier("record.process.source")
        }
      }else {
        RecordText(draft.notice ?? (draft.loading ? "正在校验结果" : "结果尚未通过完整性校验"),16).foregroundStyle(p.secondary).padding(.top,50)
        Button("重新读取"){if let id=model.job?.id {Task {await model.reloadResult(id)}}}.padding(.top,24)
      }
    }
  }
  private var sourceRecord:NativeRecord? {model.job?.recordSnapshot ?? model.record}
  private var sourceAttachments:[NativeRecordAttachment] {model.job?.recordSnapshot?.attachments ?? model.record?.attachments ?? []}
  private var revisionLabel:String {if let version=isArchived(model.route) ? model.job?.draftVersion : model.reviewedVersion {return String(version)};return String(draft.reviewedDigest?.prefix(8) ?? "")}
  private var resultMetadata:[(String,String)] {[("归档方式","新增资料"),("资料类型","笔记"),("来源记录",sourceRecord?.title ?? ""),("来源版本",String(model.sourceVersion)),("加工方式",model.job.map(preset) ?? ""),("草稿版本",revisionLabel)]}
  private func fileRow(_ attachment:NativeRecordAttachment,width:CGFloat)->some View {
    HStack(spacing:15){RecordSymbol(name:attachment.mime.hasPrefix("audio/") ? "waveform" : "doc",size:29).foregroundStyle(p.accent);VStack(alignment:.leading,spacing:4){RecordText(attachment.name,15,weight:.medium);RecordText(ByteCountFormatter.string(fromByteCount:Int64(attachment.bytes),countStyle:.file)+" · 原件",12).foregroundStyle(p.secondary)};Spacer()}.padding(15).frame(width:width).frame(minHeight:68).background(p.surface,in:RoundedRectangle(cornerRadius:12,style:.continuous))
  }
  private func footer(_ route:NativeRecordProcessRoute,tablet:Bool)->some View {
    let archived=isArchived(route),result=isResult(route),task=model.job
    let primary=result ? (archived ? "返回原始记录" : "确认归档") : task?.state=="awaiting_review" ? "查看草稿" : task?.state=="completed" ? "查看归档" : task?.canRetry==true ? "重试任务" : "取消任务"
    return HStack(spacing:tablet ? 16 : 12) {
      if !archived {Button {if result {model.route=nil}else {model.route=nil}} label:{NativeRecordActionButton(title:result ? "稍后审核" : "返回记录",primary:false)}.frame(width:tablet ? 132 : 105).accessibilityIdentifier("record.process.later")}
      Button {
        if result {if archived {model.route=nil}else if draft.canApprove {model.confirmation="approve"}}
        else if let task {if ["awaiting_review","completed"].contains(task.state) {Task {await model.openJob(task)}}else {Task {await model.action(task.canRetry ? "retry" : "cancel")}}}
      } label:{NativeRecordActionButton(title:primary)}.disabled(model.busy || (result && !archived && !draft.canApprove) || (!result && task?.canCancel==false && task?.state != "completed"))
        .accessibilityIdentifier("record.process.primary")
    }.padding(.horizontal,tablet ? 24 : 20).padding(.top,16).padding(.bottom,tablet ? 24 : 56).background(p.paper).overlay(alignment:.top){Rectangle().fill(p.separator).frame(height:0.5)}
  }
  private func openSource(){guard let job=model.job else {model.route=nil;return};model.sourceReturn=model.route;model.route = .source(job.id)}
  private func submit(){UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil);Task {await model.start()}}
  private func resultData(_ file:ReadFile)->Data? {(model.archived ?? draft.bundle)?.files.first {$0.path==file.path}.flatMap {Data(base64Encoded:$0.body)}}
  private func isResult(_ route:NativeRecordProcessRoute?)->Bool {if case .result=route{return true};if case .archived=route{return true};return false}
  private func isArchived(_ route:NativeRecordProcessRoute?)->Bool {if case .archived=route{return true};return false}
  private func preset(_ job:LibraryTask)->String {if job.processing?.preset=="transcribe",let attachments=job.recordSnapshot?.attachments,!attachments.isEmpty,attachments.allSatisfy({$0.mime.hasPrefix("audio/")}) {return "转写录音"};return NativeRecordPreset(rawValue:job.processing?.preset ?? "")?.title ?? "加工任务"}
  private func date(_ raw:String)->String {
    guard let value=NativeRecordListModel.date(raw) else{return ""}
    var calendar=Calendar(identifier:.gregorian);calendar.timeZone=TimeZone(identifier:"Asia/Shanghai")!
    if calendar.isDateInToday(value){return "今天 "+NativeTaskDate.display(raw,timeOnly:true)}
    if calendar.isDateInYesterday(value){return "昨天 "+NativeTaskDate.display(raw,timeOnly:true)}
    return NativeTaskDate.display(raw)+" "+NativeTaskDate.display(raw,timeOnly:true)
  }
  private func keyValue(_ title:String,value:String,width:CGFloat,inset:CGFloat=11)->some View {HStack(alignment:.top){RecordText(title,14).foregroundStyle(p.secondary);Spacer(minLength:12);RecordText(value,14,align:.trailing)}.padding(.leading,16).padding(.trailing,inset==0 ? 17 : 16).padding(.vertical,inset).frame(minHeight:44,alignment:.top)}
  private func step(_ title:String,subtitle:String,symbol:String,complete:Bool)->some View {HStack(alignment:.top,spacing:16){RecordSymbol(name:symbol,size:24).foregroundStyle(complete ? Color(hex:scheme == .dark ? 0x77BD92 : 0x2A7F51) : symbol=="exclamationmark.circle" ? Color(hex:scheme == .dark ? 0xFF6961 : 0xC83232) : p.accent).padding(.top,5);VStack(alignment:.leading,spacing:6){RecordText(title,17,weight:.medium);RecordText(subtitle,12,lines:nil).foregroundStyle(p.secondary)}}}
  private func badge(_ value:String,width:CGFloat,muted:Bool=false)->some View {RecordText(value,12,weight:.medium,align:.center).frame(width:width*(scale>1.4 ? scale : 1)).frame(minHeight:24).foregroundStyle(muted ? p.secondary : p.accent).background(muted ? p.well : p.selection,in:RoundedRectangle(cornerRadius:7,style:.continuous))}
  private func text(_ value:String,x:CGFloat,y:CGFloat,w:CGFloat,size:CGFloat=17,weight:Font.Weight = .regular,muted:Bool=false,accent:Bool=false,center:Bool=false)->some View {RecordText(value,size,weight:weight,align:center ? .center : .leading).foregroundStyle(accent ? p.accent : muted ? p.secondary : p.label).frame(width:w,alignment:center ? .center : .leading).offset(x:x,y:y)}
}

private struct NativeRecordProcessInput:UIViewRepresentable {
  @Binding var value:String;let editable:Bool;let foreground:UIColor
  func makeUIView(context:Context)->UITextView {let v=UITextView();v.backgroundColor = .clear;v.font = .systemFont(ofSize:16);v.textContainerInset = .init(top:22.5,left:11,bottom:12,right:11);v.delegate=context.coordinator;v.accessibilityIdentifier="record.process.instructions";return v}
  func updateUIView(_ v:UITextView,context:Context){context.coordinator.parent=self;v.isEditable=editable;v.textColor=foreground;let paragraph=NSMutableParagraphStyle();paragraph.lineSpacing=6;let attrs:[NSAttributedString.Key:Any]=[.font:UIFont.systemFont(ofSize:16),.foregroundColor:foreground,.paragraphStyle:paragraph];if v.text != value && v.markedTextRange==nil {v.attributedText=NSAttributedString(string:value,attributes:attrs)};v.typingAttributes=attrs}
  func makeCoordinator()->Coordinator {Coordinator(self)}
  final class Coordinator:NSObject,UITextViewDelegate {var parent:NativeRecordProcessInput;init(_ p:NativeRecordProcessInput){parent=p};func textViewDidChange(_ v:UITextView){if v.markedTextRange==nil {parent.value=v.text}};func textViewDidEndEditing(_ v:UITextView){parent.value=v.text}}
}
struct NativeRecordProcessConfirmation:View {
  let title:String;let message:String;let action:String;var destructive=false;var cancelTitle="取消";let cancel:()->Void;let confirm:()->Void
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale:CGFloat=1
  var body:some View {GeometryReader {g in let p=NativePalette(dark:scheme == .dark),w:CGFloat=g.size.width>=760 ? 330 : 302
    ZStack {Color.black.opacity(scheme == .dark ? 0.44 : 0.24).ignoresSafeArea();VStack(spacing:0){RecordText(title,18,weight:.semibold,height:25,align:.center).padding(.top,22);messageText(width:w-44).padding(.horizontal,22).padding(.top,18);Spacer(minLength:20);Rectangle().fill(p.separator).frame(height:0.5);HStack(spacing:0){Button(action:cancel){RecordText(cancelTitle,16,align:.center).frame(maxWidth:.infinity,minHeight:58)}.accessibilityIdentifier("record.process.confirm.cancel");Rectangle().fill(p.separator).frame(width:0.5,height:58);Button(action:confirm){RecordText(action,16,weight:.semibold,align:.center).frame(maxWidth:.infinity,minHeight:58)}.foregroundStyle(destructive ? Color(hex:scheme == .dark ? 0xFF6961 : 0xC83232) : p.accent).accessibilityIdentifier("record.process.confirm.accept")}.foregroundStyle(p.accent)}.frame(width:w,height:scale>1.4 ? min(500,g.size.height-80) : 232).background(p.surface,in:RoundedRectangle(cornerRadius:16,style:.continuous)).foregroundStyle(p.label)}.accessibilityElement(children:.contain)
  }.ignoresSafeArea()}
  private func messageText(width:CGFloat)->some View {
    let value=NativeRecordReadText.attributed(.paragraph(message),size:14*scale,heading:false,dark:scheme == .dark)
    let lines=NativeRecordReadText.lines(value,width:width)
    return VStack(spacing:0) {ForEach(lines.indices,id:\.self) {index in
      let text=(try? AttributedString(lines[index],including:\.uiKit)) ?? AttributedString(lines[index].string)
      let origin=CGFloat(CTLineGetPenOffsetForFlush(CTLineCreateWithAttributedString(lines[index] as CFAttributedString),0.5,Double(width)))
      RecordTextLayout(size:14*scale,lineHeight:22*scale,weight:.regular) {
        Text(text).lineLimit(1).fixedSize(horizontal:true,vertical:true)
      }.frame(width:width,alignment:.leading).offset(x:origin)
    }}.offset(y:scale).accessibilityElement(children:.ignore).accessibilityLabel(message)
  }

}
private struct NativeRecordResultMarkdown:View {
  let source:String;let width:CGFloat;let draft:NativeDraftModel
  @Environment(\.colorScheme) private var scheme
  var body:some View {VStack(alignment:.leading,spacing:0){ForEach(Array(NativeMarkdownDocument(source).blocks.enumerated()),id:\.element.id){index,block in item(block,first:index==0)}}.frame(width:width,alignment:.leading).textSelection(.enabled)}
  private func item(_ block:NativeMarkdownDocument.Block,first:Bool=false,compact:Bool=false,available:CGFloat?=nil)->AnyView {
    let p=NativePalette(dark:scheme == .dark)
    let current=available ?? width
    switch block.kind {
    case .heading:
      return AnyView(RecordText(block.text,21,weight:.semibold).padding(.bottom,first ? 15 : 16))
    case .list(let marker):
      if marker.isEmpty {return AnyView(VStack(alignment:.leading,spacing:11){ForEach(block.children){child in item(child,compact:true,available:current)}}.padding(.bottom,compact ? 0 : 26))}
      return AnyView(HStack(alignment:.top,spacing:14){Group {if marker=="•" {Circle().fill(p.secondary).frame(width:4,height:4).padding(.top,11)}else {RecordText(marker,16).foregroundStyle(p.secondary).frame(width:24)}};VStack(alignment:.leading,spacing:8){ForEach(block.children){child in item(child,compact:true,available:max(1,current-(marker=="•" ? 18 : 38)))}}})
    case .quote:return AnyView(HStack(alignment:.top){Rectangle().fill(p.accent).frame(width:3);VStack(alignment:.leading){ForEach(block.children){child in item(child,available:max(1,current-15))}}})
    case .code:return AnyView(Text(block.text).font(.system(.body,design:.monospaced)).padding(16).background(p.well,in:RoundedRectangle(cornerRadius:12)).padding(.bottom,24))
    case .table(let rows):return AnyView(VStack(alignment:.leading,spacing:12){ForEach(Array(rows.enumerated()),id:\.offset){_,row in HStack(alignment:.top){ForEach(Array(row.enumerated()),id:\.offset){_,value in RecordText(value,15).frame(maxWidth:.infinity,alignment:.leading)}}}}.padding(.bottom,24))
    case .rule:return AnyView(Rectangle().fill(p.separator).frame(height:0.5).padding(.vertical,16))
    default:return AnyView(attributed(block,size:compact ? 16 : 17,height:compact ? 26 : 28,available:current).frame(minHeight:!compact&&block.children.isEmpty ? 84 : nil,alignment:.topLeading).padding(.bottom,compact ? 0 : 26))
    }
  }
  private func attributed(_ block:NativeMarkdownDocument.Block,size:CGFloat,height:CGFloat,available:CGFloat)->some View {VStack(alignment:.leading,spacing:12) {
    if !block.text.isEmpty {
      if let inline=block.inline,inline.runs.contains(where:{$0.link?.scheme=="lingnest-file"}) {Text(inline).font(.system(size:size)).lineSpacing(max(0,height-UIFont.systemFont(ofSize:size).lineHeight)).fixedSize(horizontal:false,vertical:true)}
      else {NativeRecordReadText(node:node(block),size:size,lineHeight:height,width:available)}
    }
    ForEach(Array(block.images.enumerated()),id:\.offset){_,image in if let file=draft.localFile(image.0),let data=draft.data(file.path),let img=NativeRecordImage.decode(data,maxPixels:1800) {Image(uiImage:img).resizable().scaledToFit().frame(maxWidth:width)}else {RecordText(image.1,13)}}
    ForEach(block.children){child in item(child)}
  }}
  private func node(_ block:NativeMarkdownDocument.Block)->NativeRecordNode {
    guard let value=block.inline else{return .paragraph(block.text)}
    let children=value.runs.map {run->NativeRecordNode in
      var marks:[NativeRecordMark]=[];let intent=run.inlinePresentationIntent ?? []
      if intent.contains(.stronglyEmphasized){marks.append(.init(type:"bold"))};if intent.contains(.emphasized){marks.append(.init(type:"italic"))};if intent.contains(.strikethrough){marks.append(.init(type:"strike"))};if intent.contains(.code){marks.append(.init(type:"code"))};if let url=run.link {marks.append(.init(type:"link",attrs:["href":.string(url.absoluteString)]))}
      return .init(type:"text",text:String(value[run.range].characters),marks:marks)
    }
    return .init(type:"paragraph",content:children)
  }
}
private struct NativeRecordResultFile:View {
  let file:ReadFile;let bytes:Data?;let close:()->Void
  @State private var export:URL?
  @State private var sharing=false
  var body:some View {VStack {Button("返回结果",action:close).frame(maxWidth:.infinity,alignment:.leading).padding();if let bytes {if file.isText,let text=String(data:bytes,encoding:.utf8){ScrollView{Text(text).font(.body).textSelection(.enabled).padding()}}else if file.suffix=="pdf" {NativeRecordResultPDF(data:bytes)}else if let image=NativeRecordImage.decode(bytes,maxPixels:2000) {Image(uiImage:image).resizable().scaledToFit()};Spacer();Button("保存原件"){sharing=true}.disabled(export==nil)}}.background(Color(uiColor:.systemBackground)).ignoresSafeArea(edges:.bottom)
    .task {guard let bytes,(try? file.verify(bytes)) != nil else{return};let folder=FileManager.default.temporaryDirectory.appendingPathComponent("RecordResult-"+UUID().uuidString,isDirectory:true);try? FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true);let url=folder.appendingPathComponent((file.path as NSString).lastPathComponent);do {try bytes.write(to:url,options:.atomic);export=url}catch {}}
    .sheet(isPresented:$sharing){if let export {NativeRecordActivity(items:[export])}}
    .onDisappear {if let export {try? FileManager.default.removeItem(at:export.deletingLastPathComponent())}}
  }
}
private struct NativeRecordResultPDF:UIViewRepresentable {let data:Data;func makeUIView(context:Context)->PDFView {let v=PDFView();v.autoScales=true;v.document=PDFDocument(data:data);return v};func updateUIView(_ v:PDFView,context:Context){}}
private struct NativeRecordProcessingAudio:View {
  let attachment:NativeRecordAttachment;let width:CGFloat;let reference:Bool
  @StateObject private var player:NativeRecordMediaPreviewModel
  @Environment(\.colorScheme) private var scheme
  init(attachment:NativeRecordAttachment,width:CGFloat,scope:String,store:NativeRecordMediaStore,sync:NativeRecordSyncModel?,reference:Bool){self.attachment=attachment;self.width=width;self.reference=reference;_player=StateObject(wrappedValue:.init(attachment:attachment,scope:scope,store:store,remote:true,downloadOriginal:sync.map {s in {a in try await s.download(a,owner:scope)}}))}
  private var positionFraction:Double {
#if DEBUG
    if reference {return 0.37}
#endif
    return player.duration>0 ? player.position/player.duration : 0
  }
  var body:some View {let p=NativePalette(dark:scheme == .dark)
    ZStack(alignment:.topLeading) {
      ZStack(alignment:.topLeading){RoundedRectangle(cornerRadius:12,style:.continuous).fill(p.surface);RecordSymbol(name:"waveform",size:29).foregroundStyle(p.accent).offset(x:15,y:20);RecordText(attachment.name,15,weight:.medium).frame(width:width-80,alignment:.leading).offset(x:59,y:10);RecordText(NativeRecordMediaPreviewModel.time(player.duration)+" · "+player.size,12).foregroundStyle(p.secondary).offset(x:59,y:36)}.frame(width:width,height:68)
      RecordSymbol(name:"waveform",size:68.5).foregroundStyle(p.accent).offset(x:width/2-34.25,y:109)
      if player.phase == .ready {
        GeometryReader {g in ZStack(alignment:.leading){Capsule().fill(p.separator).frame(height:3);Capsule().fill(p.accent).frame(width:g.size.width*positionFraction,height:3);Circle().fill(p.accent).frame(width:10,height:10).offset(x:max(0,g.size.width*positionFraction-5))}.frame(width:g.size.width,height:3).contentShape(Rectangle()).gesture(DragGesture(minimumDistance:0).onChanged {v in player.seek(v.location.x/g.size.width*player.duration)})}.frame(width:width-20,height:3).offset(x:10,y:238.5).accessibilityLabel("播放进度").accessibilityAdjustableAction {direction in player.seek(player.position+(direction == .increment ? 15 : -15))}
        RecordText(NativeRecordMediaPreviewModel.time(player.position),12).monospacedDigit().foregroundStyle(p.secondary).offset(x:10,y:254)
        RecordText(NativeRecordMediaPreviewModel.time(player.duration),12,align:.trailing).monospacedDigit().foregroundStyle(p.secondary).frame(width:75,alignment:.trailing).offset(x:width-85,y:254)
        Button {player.seek(player.position-15)} label:{RecordSymbol(name:"gobackward.15",size:27)}.offset(x:width/2-90,y:309)
        Button {player.seek(player.position+15)} label:{RecordSymbol(name:"goforward.15",size:27)}.offset(x:width/2+64,y:309)
        Button {player.toggle()} label:{Circle().fill(p.accent).overlay {RecordSymbol(name:player.playing ? "pause.fill" : "play.fill",size:20).foregroundStyle(scheme == .dark ? p.paper : p.surface)}.frame(width:56,height:56)}.offset(x:width/2-28,y:294).accessibilityIdentifier("record.process.audio.play")
      }else {Button(player.phase == .loading ? "正在读取原件" : "下载原件"){Task {await player.recoverOriginal()}}.offset(x:10,y:240).disabled(player.phase == .loading)}
    }.frame(width:width,height:370,alignment:.topLeading).task {
#if DEBUG
      player.referencePlayback=reference
#endif
      await player.load()
    }.onDisappear {player.close()}
  }
}
