import SwiftUI
import UIKit

private struct NativeRecordEditorButtonStyle:ButtonStyle {
  func makeBody(configuration:Configuration) -> some View { configuration.label.opacity(configuration.isPressed ? 0.65 : 1) }
}

@MainActor final class NativeRecordKeyboard: ObservableObject {
  @Published var height: CGFloat = 0
  private var observers: [NSObjectProtocol] = []
  init() {
    for name in [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardWillHideNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
        let rect = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
        let hidden=note.name == UIResponder.keyboardWillHideNotification
        Task { @MainActor in self?.height = hidden ? 0 : max(0,UIScreen.main.bounds.height-rect.minY) }
      })
    }
  }
  deinit { observers.forEach(NotificationCenter.default.removeObserver) }
}

struct NativeRecordEditorPane: View {
  @ObservedObject var model: NativeRecordEditorModel
  let tablet: Bool
  var initialFocus = true
  @StateObject private var keyboard = NativeRecordKeyboard()
  @Environment(\.colorScheme) private var scheme
  @Environment(\.scenePhase) private var scene
  @ScaledMetric private var scale: CGFloat = 1
  @ScaledMetric(relativeTo:.largeTitle) private var titleScale:CGFloat=1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { geometry in
      VStack(spacing: 0) {
        header.frame(height:headerHeight)
        if tablet {
          if model.error != nil { errorBanner.padding(.horizontal, 24).frame(height: 44) }
          else { NativeRecordFormatBar(model: model).frame(height: formatHeight) }
          Color.clear.frame(height: 24)
        }
        ZStack(alignment: .top) {
          NativeRecordRichInput(controller: model.rich, document: model.draft.document,
            width: max(1, geometry.size.width - (tablet ? 48 : 40)), tablet: tablet,
            dark: scheme == .dark, scale: scale, editable: !model.saving)
            .padding(.horizontal, tablet ? 24 : 20)
          if case .limit = model.error {
            GeometryReader { area in
              let panelY=min(tablet ? 262 : 189,max(0,area.size.height-151))
              let clearY=max(0,panelY-(tablet ? 30 : 0))
              p.paper.frame(width:area.size.width,height:max(0,area.size.height-clearY))
                .offset(y:clearY).allowsHitTesting(false)
              limitPanel.padding(.horizontal,tablet ? 24 : 20)
                .offset(y:panelY)
            }
          }
        }
        Group { if scale > 1.4 { largeMediaBar } else { mediaBar } }.frame(height:mediaHeight)
        if !tablet {
          NativeRecordFormatBar(model: model).frame(height: formatHeight)
        }
        Color.clear.frame(height: keyboard.height > 0 ? keyboard.height : tablet ? 0 : 34)
      }.background(p.paper).foregroundStyle(p.label).buttonStyle(NativeRecordEditorButtonStyle())
      .task(id: model.id) {
        model.rich.changed = { [weak model] in model?.change($0) }
        if initialFocus && !tablet {
          try? await Task.sleep(nanoseconds: 250_000_000)
          if model.panel == nil { model.rich.focus() }
        }
      }
      .onChange(of: scene) { phase in
        if phase != .active { model.rich.blur(); Task { await model.flush() } }
      }
    }.ignoresSafeArea(.container, edges: [.top, .bottom]).ignoresSafeArea(.keyboard)
  }
  private var formatHeight:CGFloat { scale > 1.4 ? max(44,20*scale+20) : 44 }
  private var mediaHeight:CGFloat { scale > 1.4 ? max(tablet ? 68 : 44,22*scale+20) : tablet ? 68 : 44 }
  private var headerHeight:CGFloat {
    guard scale > 1.4 else { return tablet ? 100 : model.draft.isNew ? 156 : 149 }
    let row=tablet ? max(35*titleScale,25*scale) : 25*scale
    let status=model.error == nil ? 18*scale : max(44,38*scale+20)
    return (tablet ? 23 : 54)+row+12+(tablet ? 0 : 29*titleScale+12)+status+16
  }
  private var header: some View {
    Group {
      if scale > 1.4 { largeHeader }
      else { GeometryReader { g in
      ZStack(alignment: .topLeading) {
        if !tablet {
          Button { Task { await model.close() } } label: {
            HStack(alignment: .top, spacing: 7) {
              RecordSymbol(name: "chevron.left", size: 16).padding(.top, 3)
              RecordText("记录", 17)
            }.frame(minHeight: 44, alignment: .topLeading)
          }.foregroundStyle(p.accent).offset(x: 15, y: 54)
            .accessibilityIdentifier("record.editor.back").contextMenu { discardButton }
          Rectangle().fill(p.separator).frame(height: 0.5).offset(y: 88)
        }
        RecordText(model.draft.isNew ? "新建记录" : "编辑记录", tablet ? 24 : 17, weight: .semibold,
          align: tablet ? .leading : .center)
          .frame(width: tablet ? max(100, g.size.width - 124) : 209, alignment: tablet ? .leading : .center)
          .offset(x: tablet ? 24 : (g.size.width - 209) / 2, y: tablet ? 23 : 53)
          .accessibilityIdentifier("record.editor.title").contextMenu { discardButton }
        Button { Task { await model.save() } } label: {
          RecordText(model.saving ? "保存中…" : "保存", 17, align: .trailing)
            .frame(width: tablet ? 52 : 48, alignment: .trailing).frame(minHeight: 44, alignment: .topTrailing)
        }.foregroundStyle(model.canSave ? p.accent : p.secondary).disabled(!model.canSave)
          .offset(x: g.size.width - (tablet ? 76 : 68), y: tablet ? 26 : 54)
          .accessibilityIdentifier("record.editor.save").contextMenu { discardButton }
        if !tablet, model.error != nil {
          errorBanner.frame(width: g.size.width - 40, height: 44).offset(x: 20, y: 100)
        } else {
          HStack(alignment: .top, spacing: 7) {
            if !tablet && !model.draft.isNew {
              RecordSymbol(name: "checkmark.circle", size: 16).padding(.top, 2)
            }
            RecordText(model.status, 12)
          }.foregroundStyle(p.secondary).offset(x: tablet ? 24 : 20, y: tablet ? 65 : 108).accessibilityElement(children:.combine)
            .accessibilityIdentifier("record.editor.persistence")
        }
      }
    } }
    }
  }
  private var largeHeader:some View {
    VStack(alignment:.leading,spacing:12) {
      HStack(alignment:.top,spacing:12) {
        if tablet {
          RecordText(model.draft.isNew ? "新建记录" : "编辑记录",24,weight:.semibold,relativeTo:.largeTitle)
            .accessibilityIdentifier("record.editor.title")
        } else {
          Button { Task { await model.close() } } label: { Label { RecordText("记录",17) } icon: { RecordSymbol(name:"chevron.left",size:16) } }
            .foregroundStyle(p.accent).accessibilityIdentifier("record.editor.back").contextMenu { discardButton }
        }
        Spacer(minLength:4)
        Button { Task { await model.save() } } label: { RecordText(model.saving ? "保存中…" : "保存",17,lines:1) }
          .foregroundStyle(model.canSave ? p.accent : p.secondary).disabled(!model.canSave).accessibilityIdentifier("record.editor.save")
      }.frame(height:tablet ? max(35*titleScale,25*scale) : 25*scale,alignment:.top)
      if !tablet {
        RecordText(model.draft.isNew ? "新建记录" : "编辑记录",20,weight:.semibold,relativeTo:.largeTitle)
          .accessibilityIdentifier("record.editor.title")
      }
      if model.error != nil { errorBanner }
      else { RecordText(model.status,12).foregroundStyle(p.secondary).accessibilityIdentifier("record.editor.persistence") }
    }.padding(.horizontal,tablet ? 24 : 20).padding(.top,tablet ? 23 : 54)
      .frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.topLeading)
  }
  private var largeMediaBar:some View {
    ScrollView(.horizontal,showsIndicators:false) {
      HStack(spacing:24) {
        ForEach(Array(zip(["添加","录音","拍照"],["paperclip","mic","camera"]).enumerated()),id:\.offset) { _,pair in
          Button { mediaAction(pair.0) } label: { HStack(spacing:9) { RecordSymbol(name:pair.1,size:21);RecordText(pair.0,15) } }.foregroundStyle(p.accent).accessibilityIdentifier("record.media."+pair.1)
        }
        if tablet {
          Button { model.rich.undo() } label: { RecordSymbol(name:"arrow.uturn.backward",size:21).frame(width:44,height:44) }.accessibilityIdentifier("record.editor.undo")
          Button { model.rich.redo() } label: { RecordSymbol(name:"arrow.uturn.forward",size:21).frame(width:44,height:44) }.accessibilityIdentifier("record.editor.redo")
        } else { Button { model.rich.blur() } label: { RecordSymbol(name:"keyboard.chevron.compact.down",size:24).frame(width:44,height:44) }.accessibilityIdentifier("record.editor.keyboard.hide") }
      }.padding(.horizontal,16).frame(minHeight:mediaHeight)
    }.background(p.surface).overlay(alignment:.top) { Rectangle().fill(p.separator).frame(height:0.5) }
  }
  private var discardButton: some View {
    Button("放弃草稿", role: .destructive) { model.rich.blur(); model.panel = .discard }
      .accessibilityIdentifier("record.editor.discard")
  }
  private var errorBanner: some View {
    Button { Task { if model.error == .diskFull { _ = await model.flush() } else { await model.save() } } } label: {
      HStack(spacing: 7) {
        RecordSymbol(name: "exclamationmark.circle", size: 18)
        RecordText(errorTitle, 13, lines: 2).offset(y:scale > 1.4 ? 0 : -2.5)
        Spacer(minLength: 2)
        RecordText(isLimit ? "管理" : "重试", 13, weight: .semibold).offset(y:scale > 1.4 ? 0 : -2.5).padding(.trailing,1)
      }.padding(.horizontal, 10).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(p.selection, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }.foregroundStyle(p.accent).accessibilityIdentifier("record.editor.error")
  }
  private var isLimit: Bool { if case .limit = model.error { return true }; return false }
  private var errorTitle: String {
    guard let error = model.error else { return "" }
    if error == .unavailable { return model.status == "草稿已保存在本机" ? "记录保存失败 · 草稿已保留" : "草稿保存失败 · 修改仍在当前页面" }
    return error.localizedDescription
  }
  private var limitPanel: some View {
    VStack(alignment: .leading, spacing: 0) {
      RecordText("无法保存本次修改", 17, weight: .semibold).padding(.bottom, 13)
      RecordText("正文 \(model.draft.document.plainText.utf16.count.formatted()) / 50,000", 13).foregroundStyle(p.secondary).padding(.bottom, 9)
      let bytes = model.draft.attachments.reduce(Int64(0)) { $0 + Int64($1.bytes) }
      RecordText("附件 \(model.draft.attachments.count) / 20 · 合计 \(String(format: "%.1f", Double(bytes) / 1_048_576)) / 128 MiB", 13)
        .foregroundStyle(Color(hex: scheme == .dark ? 0xEE8E86 : 0xB74A3D)).padding(.bottom, 14)
      if let attachment = model.draft.attachments.last, model.draft.attachments.count > 20 {
        Button { model.rich.blur(); model.removalID = attachment.id; model.panel = .attachment } label: {
          RecordText("移除 1 个附件", 15).foregroundStyle(p.accent)
        }.accessibilityIdentifier("record.editor.limit.remove")
      }
    }.padding(.horizontal,16).padding(.top,14).padding(.bottom,16).frame(maxWidth: .infinity, minHeight: 151, alignment: .topLeading)
      .background(p.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(p.separator, lineWidth: 0.5) }
  }
  private func mediaAction(_ title:String) {
    if title == "添加" { model.showMedia(.add) }
    else if title == "录音" { model.showMedia(.recording) }
    else { Task { await model.camera() } }
  }
  private var mediaBar: some View {
    GeometryReader { g in
      ZStack(alignment: .topLeading) {
        Rectangle().fill(p.separator).frame(height: 0.5)
        ForEach(Array(zip(["添加", "录音", "拍照"], ["paperclip", "mic", "camera"]).enumerated()), id: \.offset) { index, pair in
          Button { mediaAction(pair.0) } label: { HStack(alignment: .top, spacing: tablet ? 9 : 9) {
            RecordSymbol(name: pair.1, size: tablet ? 21 : 20).padding(.top, 1)
            RecordText(pair.0, 15)
          }.frame(minHeight:32,alignment:.top) }.foregroundStyle(p.accent).offset(x: (tablet ? 25 : 16) + CGFloat(index) * (tablet ? 103 : index == 2 ? 101 : 103), y: tablet ? 20 : 10)
            .accessibilityIdentifier("record.media."+pair.1)
        }
        if tablet {
          Button { model.rich.undo() } label: { RecordSymbol(name: "arrow.uturn.backward", size: 21).frame(width: 44, height: 44) }
            .offset(x: g.size.width - 117.5, y: 11).accessibilityIdentifier("record.editor.undo")
          Button { model.rich.redo() } label: { RecordSymbol(name: "arrow.uturn.forward", size: 21).frame(width: 44, height: 44) }
            .offset(x: g.size.width - 66.5, y: 11).accessibilityIdentifier("record.editor.redo")
        } else {
          Button { model.rich.blur() } label: { RecordSymbol(name: "keyboard.chevron.compact.down", size: 24).frame(width: 44, height: 44) }
            .offset(x: g.size.width - 55, y: 0).accessibilityIdentifier("record.editor.keyboard.hide")
        }
      }.foregroundStyle(p.secondary)
    }.background(p.surface)
  }
}

struct NativeRecordFormatBar: View {
  @ObservedObject var model: NativeRecordEditorModel
  @ObservedObject private var rich: NativeRecordRichController
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale:CGFloat=1
  init(model:NativeRecordEditorModel) { self.model=model;_rich=ObservedObject(wrappedValue:model.rich) }
  var body: some View {
    Group {
      if scale > 1.4 { largeBar }
      else { GeometryReader { g in
      let p = NativePalette(dark: scheme == .dark)
      ZStack(alignment: .topLeading) {
        Rectangle().fill(p.separator).frame(height: 0.5)
        Button { model.presentFormat() } label: {
          ZStack(alignment: .topLeading) {
            RecordText(model.rich.currentBlock.heading == 0 ? "正文" : "标题 \(model.rich.currentBlock.heading)", 14).offset(x: 16, y: 12)
            RecordSymbol(name: "chevron.down", size: 10).offset(x: 53, y: 17)
          }.frame(width: 75, height: 44,alignment:.topLeading)
        }.accessibilityIdentifier("record.format.selector").contextMenu {
          Button("撤销") { model.rich.undo() }
          Button("重做") { model.rich.redo() }
          Button("放弃草稿", role: .destructive) { model.rich.blur(); model.panel = .discard }
        }
        let actions: [(RecordRichAction, String)] = [(.bold,"bold"),(.italic,"italic"),(.bullet,"list.bullet"),(.ordered,"list.number"),(.quote,"text.quote"),(.link,"link")]
        ForEach(actions.indices, id: \.self) { index in
          let action = actions[index]
          Button { if action.0 == .link { model.presentLink() } else { model.apply(action.0) } } label: {
            RecordSymbol(name: action.1, size: 19).frame(width: 44, height: 44)
          }.offset(x: 83 + CGFloat(index) * (g.size.width - 90) / 6 - 12.5, y: 0)
            .accessibilityIdentifier("record.format.\(action.0.rawValue)")
        }
      }.foregroundStyle(p.label)
    } }
    }.background(NativePalette(dark: scheme == .dark).surface).buttonStyle(.plain)
  }
  private var largeBar:some View {
    let p=NativePalette(dark:scheme == .dark)
    return ScrollView(.horizontal,showsIndicators:false) {
      HStack(spacing:12) {
        Button { model.presentFormat() } label: { HStack { RecordText(rich.currentBlock.heading == 0 ? "正文" : "标题 \(rich.currentBlock.heading)",14);RecordSymbol(name:"chevron.down",size:10) } }
          .accessibilityIdentifier("record.format.selector").contextMenu {
            Button("撤销") { model.rich.undo() };Button("重做") { model.rich.redo() }
            Button("放弃草稿",role:.destructive) { model.rich.blur();model.panel = .discard }
          }
        ForEach(Array(zip([RecordRichAction.bold,.italic,.bullet,.ordered,.quote,.link],["bold","italic","list.bullet","list.number","text.quote","link"])),id:\.0) { action,symbol in
          Button { model.apply(action) } label: { RecordSymbol(name:symbol,size:19).frame(width:44,height:44) }.accessibilityIdentifier("record.format.\(action.rawValue)")
        }
      }.padding(.horizontal,16).frame(minHeight:max(44,20*scale+20))
    }.foregroundStyle(p.label).overlay(alignment:.top) { Rectangle().fill(p.separator).frame(height:0.5) }
  }
}

struct NativeRecordEditorPanels: View {
  @ObservedObject var model: NativeRecordEditorModel
  @StateObject private var keyboard=NativeRecordKeyboard()
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale:CGFloat=1
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { g in
      if let panel = model.panel {
        let tablet = g.size.width >= 760
        let standardHeight:CGFloat=panel == .format ? 515 : panel == .link ? 416 : 232
        let availableHeight=panel == .link && keyboard.height > 0 ? max(200,g.size.height-keyboard.height-60) : g.size.height-88
        let h: CGFloat = scale > 1.4 ? min(availableHeight,panel == .discard || panel == .attachment ? 440 : 660) : standardHeight
        let w: CGFloat = panel == .discard || panel == .attachment ? (tablet ? 330 : 302) : tablet ? 500 : g.size.width
        let centered = tablet || panel == .discard || panel == .attachment
        let originalY = centered ? (g.size.height - h) / 2 : g.size.height - h
        let y = panel == .link && keyboard.height > 0 ? max(44,min(originalY,g.size.height-keyboard.height-h-16)) : originalY
        Color.black.opacity(scheme == .dark ? 0.44 : 0.24).ignoresSafeArea()
          .accessibilityHidden(true)
        Group {
          if scale > 1.4 { largePanel(panel) }
          else if panel == .discard || panel == .attachment { confirmation(panel) }
          else { sheet(panel, width: w, tablet: tablet) }
        }.frame(width: w, height: h, alignment: .topLeading)
          .background(p.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
          .offset(x: (g.size.width - w) / 2, y: max(0,y))
      }
    }.ignoresSafeArea().buttonStyle(.plain)
  }
  private func largePanel(_ panel:NativeRecordEditorPanel) -> some View {
    VStack(spacing:16) {
      HStack(alignment:.top,spacing:16) {
        Button { model.panel=nil } label: { RecordText("取消",16) }.foregroundStyle(p.accent).accessibilityIdentifier("record.panel.cancel")
        Spacer(minLength:0)
        RecordText(panel == .format ? "格式" : panel == .link ? "编辑链接" : panel == .discard ? "放弃这份草稿？" : "移除文中附件？",20,weight:.semibold)
      }
      ScrollView {
        VStack(alignment:.leading,spacing:20) {
          if panel == .format {
            ForEach(Array(zip([RecordRichAction.paragraph,.heading1,.heading2,.bold,.italic,.bullet,.ordered,.quote,.link,.clear],
              ["正文","标题 1","标题 2","粗体","斜体","项目列表","编号列表","引用","链接","清除格式"])),id:\.0) { action,title in
              Button { model.apply(action) } label: { RecordText(title,17).frame(maxWidth:.infinity,alignment:.leading).padding(16).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous)) }
                .accessibilityIdentifier("record.panel.\(action.rawValue)")
            }
          } else if panel == .link {
            RecordText("显示文字",14).foregroundStyle(p.secondary)
            TextField("",text:$model.linkText).font(.system(size:17*scale)).padding(16).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous)).accessibilityIdentifier("record.link.text")
            RecordText("链接地址",14).foregroundStyle(p.secondary)
            TextField("",text:$model.linkURL).font(.system(size:15*scale)).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().padding(16).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous)).accessibilityIdentifier("record.link.url")
            if !model.linkError.isEmpty { RecordText(model.linkError,12).foregroundStyle(p.accent).accessibilityIdentifier("record.link.error") }
            Button { model.applyLink() } label: { RecordText("完成",17,weight:.semibold).frame(maxWidth:.infinity).padding(16).foregroundStyle(scheme == .dark ? p.paper : p.surface).background(p.accent,in:RoundedRectangle(cornerRadius:12,style:.continuous)) }.accessibilityIdentifier("record.link.done")
            Button { model.applyLink(remove:true) } label: { RecordText("移除链接",15) }.foregroundStyle(.red).accessibilityIdentifier("record.link.remove")
          } else {
            RecordText(panel == .discard ? "本机未保存的正文与附件将被移除。" : "附件将从这份草稿中移除，原记录保持不变。",14,lines:5)
            Button { if panel == .discard { Task { await model.discard() } } else { model.removeAttachment() } } label: {
              RecordText(panel == .discard ? "放弃草稿" : "移除附件",16,weight:.semibold).frame(maxWidth:.infinity).padding(16).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))
            }.foregroundStyle(.red).accessibilityIdentifier("record.confirm.destructive")
          }
        }.padding(.bottom,16)
      }
    }.padding(24).foregroundStyle(p.label).accessibilityElement(children:.contain).accessibilityIdentifier(panel == .discard || panel == .attachment ? "record.editor.confirmation" : "record.editor.panel")
  }
  private func confirmation(_ panel: NativeRecordEditorPanel) -> some View {
    VStack(spacing: 0) {
      RecordText(panel == .discard ? "放弃这份草稿？" : "移除文中附件？", 18, weight: .semibold, height: 25, align: .center)
        .frame(maxWidth: .infinity).padding(.top, 22)
      RecordText(panel == .discard ? "本机未保存的正文与附件将被移除。" : "附件将从这份草稿中移除，原记录保持不变。", 14, height: 22, lines: 3, align: .center)
        .frame(maxWidth: .infinity).padding(.horizontal, 22).padding(.top, 18)
      Spacer(minLength: 0)
      Rectangle().fill(p.separator).frame(height: 0.5)
      HStack(spacing: 0) {
        Button { model.panel = nil } label: { RecordText("取消", 16).frame(maxWidth: .infinity, minHeight: 57) }.foregroundStyle(p.accent)
        Rectangle().fill(p.separator).frame(width: 0.5, height: 58)
        Button { if panel == .discard { Task { await model.discard() } } else { model.removeAttachment() } } label: {
          RecordText(panel == .discard ? "放弃草稿" : "移除附件", 16, weight: .semibold).frame(maxWidth: .infinity, minHeight: 57)
        }.foregroundStyle(Color(hex: scheme == .dark ? 0xEE8E86 : 0xB74A3D)).accessibilityIdentifier("record.confirm.destructive")
      }.frame(height: 58)
    }.foregroundStyle(p.label).accessibilityElement(children:.contain).accessibilityIdentifier("record.editor.confirmation")
  }
  private func sheet(_ panel: NativeRecordEditorPanel, width: CGFloat, tablet: Bool) -> some View {
    ZStack(alignment: .topLeading) {
      if !tablet { Capsule().fill(p.well).frame(width: 40, height: 5).offset(x: width/2-20,y:9) }
      Button { model.panel = nil } label: { RecordText("取消", 16).frame(minWidth: 64, minHeight: 44, alignment: .topLeading) }
        .foregroundStyle(p.accent).offset(x: 24,y:27).accessibilityIdentifier("record.panel.cancel")
      RecordText(panel == .format ? "格式" : "编辑链接", 20, weight: .semibold, align: .center)
        .frame(width: width - 192).offset(x:96,y:25).foregroundStyle(p.label)
      if panel == .format {
        let cw = (width - 58) / 3
        ForEach(Array([RecordRichAction.paragraph,.heading1,.heading2].enumerated()), id: \.offset) { index,action in
          let selected=model.rich.currentBlock.heading == index
          Button { model.apply(action) } label: {
            RecordText(["正文","标题 1","标题 2"][index], index == 0 ? 17 : 18, weight: .semibold, align: .center)
              .offset(y:index == 0 ? -2 : -1.5)
              .frame(width: cw,height: 66).background(selected ? p.selection : p.well, in: RoundedRectangle(cornerRadius:12,style:.continuous))
          }.foregroundStyle(selected ? p.accent : p.label).offset(x:24+CGFloat(index)*(cw+5),y:85)
            .accessibilityIdentifier("record.panel.\(action.rawValue)")
        }
        let choices: [(String,String,RecordRichAction)] = [("粗体","bold",.bold),("斜体","italic",.italic),("项目列表","list.bullet",.bullet),("编号列表","list.number",.ordered),("引用","text.quote",.quote),("链接","link",.link)]
        let cell = (width - 60) / 2
        ForEach(choices.indices,id:\.self) { i in
          let choice=choices[i]
          Button { model.apply(choice.2) } label: {
            HStack(spacing:13) { RecordSymbol(name:choice.1,size:21);RecordText(choice.0,15);Spacer(minLength:0) }
              .padding(.horizontal,14).frame(width:cell,height:58).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))
          }.foregroundStyle(p.label).offset(x:24+CGFloat(i%2)*(cell+12),y:175+CGFloat(i/2)*72).accessibilityIdentifier("record.panel.\(choice.2.rawValue)")
        }
        Button { model.apply(.clear) } label: {
          HStack(spacing:14) { RecordSymbol(name:"textformat",size:22).foregroundStyle(p.accent);RecordText("清除格式",16).offset(y:-2.5);Spacer() }
            .padding(.horizontal,16).frame(width:width-48,height:53).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))
        }.foregroundStyle(p.label).offset(x:24,y:405).accessibilityIdentifier("record.panel.clear")
      } else {
        RecordText("显示文字",14).foregroundStyle(p.secondary).offset(x:24,y:83)
        TextField("",text:$model.linkText).font(.system(size:17)).padding(.top,6.5).padding(.horizontal,16).frame(width:width-48,height:49)
          .background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous)).offset(x:24,y:112).accessibilityIdentifier("record.link.text")
        RecordText("链接地址",14).foregroundStyle(p.secondary).offset(x:24,y:184)
        TextField("",text:$model.linkURL).font(.system(size:15)).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          .foregroundStyle(p.accent).padding(.top,3.5).padding(.horizontal,16).frame(width:width-48,height:54).background(p.well,in:RoundedRectangle(cornerRadius:12,style:.continuous))
          .offset(x:24,y:214).accessibilityIdentifier("record.link.url")
        Button { model.applyLink() } label: {
          RecordText("完成",17,weight:.semibold).frame(width:width-48,height:48).foregroundStyle(scheme == .dark ? p.paper : p.surface)
            .background(p.accent,in:RoundedRectangle(cornerRadius:12,style:.continuous))
        }.offset(x:24,y:299).accessibilityIdentifier("record.link.done")
        Button { model.applyLink(remove:true) } label: { RecordText("移除链接",15).frame(width:width-48) }
          .foregroundStyle(Color(hex:scheme == .dark ? 0xEE8E86 : 0xB74A3D)).offset(x:24,y:365).accessibilityIdentifier("record.link.remove")
        if !model.linkError.isEmpty { RecordText(model.linkError,12).foregroundStyle(p.accent).offset(x:24,y:275).accessibilityIdentifier("record.link.error") }
      }
    }.foregroundStyle(p.label).accessibilityElement(children:.contain).accessibilityIdentifier("record.editor.panel")
  }
}

struct NativeRecordWorkspace: View {
  @ObservedObject var records: NativeRecordListModel
  @ObservedObject var workbench: NativeRecordWorkbench
  @Binding var module: NativeAppModule
  var pair: () -> Void = {}
  var illustration: ((NativeRecordAttachment) -> AnyView?)?
  var autoReload = true
  var focusEditor = true
  var body: some View {
    GeometryReader { g in
      let tablet = UIDevice.current.userInterfaceIdiom == .pad && g.size.width >= 760
      ZStack(alignment:.topLeading) {
        NativeRecordListView(model:records,module:$module,pair:pair,
          newRecord:{ Task { await workbench.open() } },continueDraft:{ Task { await workbench.open(draftID:records.snapshot.draft?.id) } },
          editRecord:{ record in Task { await workbench.open(record) } },
          suppressSelection:workbench.editor?.draft.isNew == true,
          recordsHome:{ if let editor=workbench.editor { Task { await editor.close() } } },
          illustration:illustration,mediaStore:workbench.mediaStore,mediaScope:workbench.scope,recordScopes:workbench.recordScopes,syncModel:workbench.sync,processingModel:workbench.processing,autoReload:autoReload)
        if let editor=workbench.editor {
          HStack(spacing:0) {
            if tablet { Color.clear.frame(width:workbench.detailFrame.width > 0 ? max(0,workbench.detailFrame.minX-1) : g.size.width >= 1100 ? 560 : 320).allowsHitTesting(false) }
            NativeRecordEditorPane(model:editor,tablet:tablet,initialFocus:focusEditor).id(editor.id).opacity(editor.mediaSheet == .recording ? 0 : 1)
          }
        }
        if let editor=workbench.editor {
          NativeRecordEditorPanels(model:editor)
          NativeRecordMediaPresentation(editor:editor,detailFrame:workbench.detailFrame)
        }
        NativeRecordSyncPresentation(model:workbench.sync,detailFrame:workbench.detailFrame,pair:pair)
        NativeRecordProcessingPresentation(model:workbench.processing,detailFrame:workbench.detailFrame,list:records,media:workbench.mediaStore,scope:workbench.scope)
        if let error=workbench.openError {
          NativeConfirmation(title:"无法打开记录",bodyText:error,actionTitle:"好",confirm:{workbench.openError=nil},cancel:{workbench.openError=nil})
        }
      }
    }.ignoresSafeArea(.container,edges:[.top,.bottom]).ignoresSafeArea(.keyboard)
      .onPreferenceChange(NativeRecordDetailBounds.self) {frame in if frame.width > 0,workbench.detailFrame != frame {workbench.detailFrame=frame}}
      .onChange(of:records.selectedID) { _ in
        if let editor=workbench.editor { Task { await editor.close() } }
      }
      .onDisappear { if let editor=workbench.editor { editor.rich.blur(); Task { await editor.flush() } } }
  }
}
