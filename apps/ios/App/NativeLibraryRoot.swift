import SwiftUI
import UIKit

struct NativeLibraryRoot: View {
  @EnvironmentObject private var app: AppModel
  @StateObject private var library = NativeLibraryModel()
  @StateObject private var reader = NativeReaderModel()
  @StateObject private var tasks = NativeTaskModel(watchConnectivity: true)
  @StateObject private var drafts = NativeDraftModel(watchConnectivity: true)
  @StateObject private var devices = NativeDevicesModel(watchConnectivity: true)
  @StateObject private var outbox = NativeOutboxModel(
    dependencies: .live(), watchConnectivity: true)
  @StateObject private var compositions = NativeCompositionModel()
  @StateObject private var records = NativeRecordListModel()
  @StateObject private var recordWorkbench = NativeRecordWorkbench()
  @StateObject private var recordResultReader=NativeReaderModel()
  @State private var legacyImportError=false
  @State private var recordRead:ReadEntry?
  @State private var editingComposition: LocalComposition?
  @State private var module: NativeAppModule = .library
  @State private var reading = false
  @State private var libraryPath: [ReadEntry] = []
  @State private var outboxPath = NavigationPath()
  @State private var pairingPresented = false
  @Environment(\.scenePhase) private var scene
  @Environment(\.colorScheme) private var scheme
  var body: some View {
    GeometryReader { geometry in
      let tablet = UIDevice.current.userInterfaceIdiom == .pad && geometry.size.width >= 760
      Group {
        if module == .devices && pairingPresented {
          NativePairingHost(
            app: app,
            module: .init(get: { module }, set: { module = $0; pairingPresented = false }),
            library: library, appearance: scheme,
            close: { pairingPresented = false })
        } else if module == .records {
          NativeRecordWorkspace(records: records, workbench: recordWorkbench, module: $module,
            pair: { module = .devices; pairingPresented = true })
        } else if module == .account {
          NativeAccountView(module: $module, records: records, origin: app.serverName,
            paired: app.paired, outboxPending: outbox.items.filter { $0.state != "submitted" }.count,
            deviceCount: app.snapshot?.devices.count ?? 0,
            pair: { module = .devices; pairingPresented = true },showSync:{module = .records;recordWorkbench.sync.show()})
        } else if module == .library {
          NativeLibraryView(
            model: library, module: $module, reading: $reading, path: $libraryPath,
            reader: { entry in
              NativeReaderView(
                model: reader, entryID: entry.id, tablet: tablet,
                favorite: library.favorites.contains(reader.detail?.id ?? entry.id),
                toggleFavorite: { library.toggleFavorite(reader.detail?.id ?? entry.id) }
              ).id(entry.id + app.sessionID.uuidString)
            }, pair: { module = .devices })
        } else if module == .outbox {
          NativeOutboxView(
            model: outbox, module: $module, library: library,
            pair: { module = .devices },
            showTask: { id in
              module = .tasks
              tasks.open(id, tablet: tablet)
            }, localDrafts: compositions.drafts, draftNotice: compositions.notice,
            newDraft: { editingComposition = LocalComposition() },
            openDraft: { editingComposition = $0 }, removeDraft: { compositions.deleting = $0 },
            refreshDrafts: { compositions.reload() })
        } else if module == .tasks {
          NativeTaskView(
            model: tasks, module: $module, library: library,
            pair: { module = .devices },recordTask:{task in openRecordTask(task,tablet:tablet)}
          ) { id in
            NativeDraftView(
              model: drafts, taskID: id, tablet: tablet,
              pair: { module = .devices },
              archived: {
                Task {
                  await tasks.reload()
                  await library.reload()
                }
              }
            ).id(app.sessionID)
          }
        } else {
          NativeDevicesView(model: devices, module: $module, library: library,
            pair: { pairingPresented = true },advanced: {device in AnyView(Group {
              if device.canDispatch && app.plugins?.supports("ai-assistant") == true { VStack(spacing:16) {
                NavigationLink("采集与写作能力") {NodeCapabilitiesView(device:device)}
                NavigationLink("Agent") {NodeAgentsView(device:device)}
                NavigationLink("节点技能") {NodeSkillsView(device:device)}
              } }
            }.environmentObject(app)) })
        }
      }
      .background(NativePalette(dark: scheme == .dark).paper.ignoresSafeArea())
      .overlay {
        if let draft = editingComposition {
          NativeCompositionHost(draft: draft, close: {
            editingComposition = nil
            compositions.reload()
            outbox.reload()
          }, destination: { target in
            editingComposition = nil
            compositions.reload()
            outbox.reload()
            module = target == "tasks" ? .tasks : .outbox
          }).id(draft.id).zIndex(2)
        } else if let draft = compositions.deleting {
          NativeConfirmation(title: "删除草稿", bodyText: draft.title,
            actionTitle: "删除", destructive: true,
            confirm: { compositions.deleteConfirmed() }, cancel: { compositions.deleting = nil })
        }
        if module == .tasks { NativeDraftConfirmation(model: drafts) }
        if module == .library {
          NativeReaderPanels(model: reader)
            .allowsHitTesting(
              reader.panel != nil || reader.exportData != nil || reader.notice != nil
            )
            .accessibilityHidden(
              reader.panel == nil && reader.exportData == nil && reader.notice == nil)
        }
      }
    }.statusBarHidden(UIDevice.current.userInterfaceIdiom == .pad)
    .modifier(NativeReaderExportPresentation(model: reader)).onOpenURL { url in
      guard url.scheme == "lingnest" else { return }
      if url.host == "tasks" { module = .tasks }
      if url.host == "outbox" { module = .outbox }
      if url.host == "records" { module = .records }
      if url.host == "account" { module = .account }
    }
    .alert("原有本机记录尚未完成导入",isPresented:$legacyImportError) {
      Button("稍后",role:.cancel) {}
    } message: {Text("原件和旧数据库已保留，将在下次打开时重试。")}
    .fullScreenCover(item:$recordRead){entry in
      NavigationStack {NativeReaderView(model:recordResultReader,entryID:entry.id,tablet:UIDevice.current.userInterfaceIdiom == .pad,favorite:library.favorites.contains(entry.id),toggleFavorite:{library.toggleFavorite(entry.id)},modalReturn:"加工结果")
        .overlay {NativeReaderPanels(model:recordResultReader)}
        .modifier(NativeReaderExportPresentation(model:recordResultReader))}
    }
    .task(id: app.sessionID) {
      let session=app.sessionID
      library.configure(
        service: try? app.client(), origin: app.serverName, expired: app.authorizationExpired)
      reader.configure(service: try? app.client())
      recordResultReader.configure(service:try? app.client())
      tasks.configure(service: try? app.client(), expired: app.authorizationExpired)
      drafts.configure(service: try? app.client(), expired: app.authorizationExpired)
      outbox.invalidateSession(expired: app.authorizationExpired)
      devices.configure(service: try? app.client(), origin: app.serverName,
        expired: app.authorizationExpired,
        localDevice: UUID(uuidString: app.deviceID) == nil ? nil : Device(id: app.deviceID,
          name: app.deviceName, role: "owner", revokedAt: nil, online: nil, agents: nil),
        forget: { try app.forget().get() })
      async let recordLoad: Void = records.configure(service: try? app.client(), storage: try? NativeRecordListStore.live(),
        origin: app.serverName, deviceID: app.deviceID, expired: app.authorizationExpired, persistentCacheRequired: true,loadRemote:false)
      compositions.reload()
      await recordLoad
      guard !Task.isCancelled,session==app.sessionID else{return}
      let recordStore=try? NativeRecordLocalStore.live()
      let recordMedia=try? NativeRecordMediaStore.live()
      if let recordStore,let recordMedia {
        do {try await NativeLegacyRecordImport().run(store:recordStore,media:recordMedia,directory:SharedConfiguration.container().appendingPathComponent("LegacyRecordImport",isDirectory:true))}
        catch {legacyImportError=true}
      }
      recordWorkbench.mediaStore=recordMedia
      await recordWorkbench.configure(store: recordStore,
        scope: app.paired ? NativeRecordListStore.scope(origin: app.serverName, deviceID: app.deviceID) : NativeRecordLocalStore.unbound,
        list: records)
      guard !Task.isCancelled,session==app.sessionID else{return}
      recordWorkbench.sync.prepareAdoption={ [weak recordWorkbench] scope in await recordWorkbench?.prepareAdoption(scope) ?? false }
      recordWorkbench.sync.changed={ [weak recordWorkbench] in await recordWorkbench?.refresh() }
      await recordWorkbench.sync.configure(store:recordStore,media:recordMedia,service:try? app.client(),scope:recordWorkbench.scope,origin:app.serverName,expired:app.authorizationExpired)
      await recordWorkbench.processing.configure(store:recordStore,service:app.authorizationExpired ? nil : try? app.client(),scope:recordWorkbench.scope,sync:recordWorkbench.sync)
      recordWorkbench.processing.updated={ [weak recordWorkbench] in recordWorkbench?.sync.start() }
      recordWorkbench.processing.connect={app.expireAuthorization()}
      recordWorkbench.processing.openLibrary={archive in
        recordRead=ReadEntry(id:archive.entryId,title:archive.meta.title,summary:nil,type:nil,status:nil,collectedAt:nil,tags:nil,matches:nil)
        Task {await library.reload()}
      }
      await library.reload()
    }
    .task(id:scene) {
      guard scene == .active else{return}
      while !Task.isCancelled {recordWorkbench.sync.start();do {try await Task.sleep(nanoseconds:30_000_000_000)}catch{break}}
    }
    .onReceive(recordWorkbench.sync.$phase) {records.setSyncPhase($0)}
    .onReceive(recordWorkbench.sync.$expired) {if $0 {app.expireAuthorization()}}
    .onChange(of:app.sessionID) {_ in recordRead=nil;recordResultReader.configure(service:nil);NativeRecordBackgroundUploads.shared.cancelAll();recordWorkbench.sync.disconnect();recordWorkbench.suspendForSessionChange();records.clearForSessionChange()}
    .onChange(of: app.paired) { paired in
      if !paired {
        library.configure(service: nil, origin: "", expired: app.authorizationExpired)
        reader.configure(service: nil)
        tasks.configure(service: nil, expired: app.authorizationExpired)
        drafts.configure(service: nil, expired: app.authorizationExpired)
        devices.configure(service: nil, expired: app.authorizationExpired)
        Task { await records.configure(service: nil, storage: nil, origin: "", deviceID: "", expired: app.authorizationExpired) }
      }
    }
    .onChange(of: outbox.expired) { expired in
      if expired { app.expireAuthorization() }
    }
    .onChange(of: reader.phase) { phase in
      if phase == .expired { app.expireAuthorization() }
    }
    .onChange(of: module) { _ in
      compositions.reload()
      if module != .devices { pairingPresented = false }
      reader.panel = nil
      outbox.menu = false
      outbox.binding = nil
      tasks.menu = false
      tasks.cancellationID = nil
      drafts.confirmation = false
      drafts.filesPanel = false
      devices.confirmation = nil
    }
    .onChange(of: library.phase) { phase in
      if phase == .expired { app.expireAuthorization() }
    }
    .onChange(of: tasks.phase) { phase in
      if phase == .expired { app.expireAuthorization() }
    }
    .onChange(of: drafts.phase) { phase in
      if phase == .expired { app.expireAuthorization() }
    }
    .onChange(of: devices.phase) { phase in
      if phase == .expired { app.expireAuthorization() }
    }
    .onChange(of: records.phase) { phase in
      if phase == .expired { app.expireAuthorization() }
    }
  }
  private func openRecordTask(_ task:LibraryTask,tablet:Bool) {
    guard let id=task.recordId,let service=try? app.client() else{return}
    let session=app.sessionID
    Task {
      do {
        let record=try await service.record(id);guard session==app.sessionID else{return}
        let store=try NativeRecordLocalStore.live();try await store.mergeRemote([record],scope:recordWorkbench.scope);guard session==app.sessionID else{return}
        await recordWorkbench.refresh();records.selectedID=id;if !tablet {records.path=[id]};module = .records
        await recordWorkbench.processing.open(records.selected ?? record,history:true)
        await recordWorkbench.processing.openJob(recordWorkbench.processing.jobs.first {$0.id==task.id} ?? task)
      }catch {recordWorkbench.openError="关联记录暂时无法读取";module = .records}
    }
  }
}
