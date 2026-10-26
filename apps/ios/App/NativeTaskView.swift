import SwiftUI
import UIKit

struct NativeTaskView<Draft: View>: View {
  @ObservedObject var model: NativeTaskModel
  @Binding var module: NativeAppModule
  @ObservedObject var library: NativeLibraryModel
  var pair: () -> Void = {}
  var directDraftID: String? = nil
  var recordTask:((LibraryTask)->Void)? = nil
  @ViewBuilder var draft: (String) -> Draft
  @Environment(\.colorScheme) private var scheme
  @Environment(\.scenePhase) private var scenePhase
  @ScaledMetric private var scale: CGFloat = 1
  @State private var columns: NavigationSplitViewVisibility = .all
  @State private var reviewingDraftID: String?
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { geo in
      let tablet = UIDevice.current.userInterfaceIdiom == .pad && geo.size.width >= 760
      Group {
        if tablet {
          NavigationSplitView(columnVisibility: $columns) {
            NativeLibrarySidebar(module: $module, library: library)
              .background(NativeSplitConfiguration().frame(width: 0, height: 0))
              .navigationSplitViewColumnWidth(240).toolbar(.hidden, for: .navigationBar)
          } content: {
            list(tablet: true).navigationSplitViewColumnWidth(320).toolbar(
              .hidden, for: .navigationBar)
          } detail: {
            NavigationStack {
              if let id = directDraftID ?? reviewingDraftID {
                draft(id)
              } else if let task = model.selected {
                detail(task, tablet: true)
              } else {
                emptyDetail
              }
            }.toolbar(.hidden, for: .navigationBar)
          }.navigationSplitViewStyle(.balanced)
        } else {
          NavigationStack(path: $model.path) {
            list(tablet: false).toolbar(.hidden, for: .navigationBar)
              .safeAreaInset(edge: .bottom, spacing: 0) {
                NativeBottomNavigation(module: $module, titleTracking: [.tasks: -2])
              }
              .navigationDestination(for: String.self) { id in
                if let task = model.task(id) { detail(task, tablet: false) } else { missingDetail }
              }
          }
        }
      }.frame(width: geo.size.width, height: geo.size.height)
        .overlay {
          if let id = model.cancellationID, let task = model.task(id) {
            cancellation(task)
          } else if model.menu, let task = model.path.last.flatMap(model.task) ?? model.selected {
            NativePanel(title: "任务", height: 550, dismiss: { model.menu = false }) {
              VStack(alignment: .leading, spacing: 0) {
                NativeText("来源内容", size: 14).foregroundStyle(p.secondary)
                NativeText(
                  task.content ?? task.url ?? task.nativeTaskTitle, size: 16, lineHeight: 25
                )
                .textSelection(.enabled).padding(.top, 12).accessibilityIdentifier("tasks.source")
                if let url = task.url, url != task.content {
                  NativeText(url, size: 15).textSelection(.enabled).padding(.top, 12)
                }
                if task.canCancel {
                  action(
                    "取消任务", kind: .destructive, enabled: model.phase == .content && !model.busy
                  ) {
                    model.requestCancellation(task.id)
                  }.padding(.top, 24).accessibilityIdentifier("tasks.cancel")
                }
                action("刷新", kind: .secondary) {
                  model.menu = false
                  Task { await model.reload() }
                }
                .padding(.top, 16).accessibilityIdentifier("tasks.panel.refresh")
              }
            }
          }
        }
    }.background(p.paper.ignoresSafeArea()).foregroundStyle(p.label).tint(p.accent).buttonStyle(
      .plain
    )
    .onChange(of: model.selectedID) { _ in reviewingDraftID = nil }
    .onChange(of: model.filter) { _ in
      if !model.visibleTasks.contains(where: { $0.id == model.selectedID }) {
        model.selectedID = model.visibleTasks.first?.id
      }
    }
    .task(id: scenePhase) {
      guard scenePhase == .active else { return }
      while !Task.isCancelled {
        await model.reload()
        do { try await Task.sleep(nanoseconds: 5_000_000_000) } catch { return }
      }
    }
  }
  @ViewBuilder private func cancellation(_ task: LibraryTask) -> some View {
    if scale > 1.3 {
      GeometryReader { geo in
        ZStack {
          Color.black.opacity(p.dark ? 0.44 : 0.25).ignoresSafeArea().accessibilityHidden(true)
          VStack(spacing: 24) {
            Text("取消任务？").font(.system(size: 18 * scale, weight: .bold))
              .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            Text(task.nativeTaskTitle).font(.system(size: 14 * scale)).foregroundStyle(p.secondary)
              .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            action("继续处理", kind: .secondary) { model.cancellationID = nil }
              .accessibilityIdentifier("component.confirm.cancel")
            action("取消任务", kind: .destructive) { Task { await model.confirmCancellation() } }
              .accessibilityIdentifier("component.confirm.accept")
          }.padding(24).frame(width: min(460, geo.size.width - 40))
            .background(p.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityElement(children: .contain).accessibilityAddTraits(.isModal)
            .accessibilityAction(.escape) { model.cancellationID = nil }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      }.ignoresSafeArea()
    } else {
      NativeConfirmation(
        title: "取消任务？", bodyText: task.nativeTaskTitle,
        actionTitle: "取消任务", cancelTitle: "继续处理", destructive: true,
        confirm: { Task { await model.confirmCancellation() } },
        cancel: { model.cancellationID = nil })
    }
  }
  private func list(tablet: Bool) -> some View {
    VStack(spacing: 0) {
      GeometryReader { geo in
        NativeText("任务", size: tablet ? 24 : 34, bold: true).padding(.leading, 20)
          .padding(.top, tablet ? 24 : 72).accessibilityIdentifier("tasks.title")
        Button {
          Task { await model.reload() }
        } label: {
          NativeGlyph(name: "refresh").frame(width: 44, height: 44).contentShape(Rectangle())
        }.position(x: geo.size.width - (tablet ? 30 : 32), y: tablet ? 39 : 89)
          .foregroundStyle(p.accent).accessibilityLabel("刷新").accessibilityIdentifier(
            "tasks.refresh")
      }.frame(height: (tablet ? 75 : 126) + max(0, scale - 1) * 34 * 1.42)
      segments
        .padding(.horizontal, tablet ? 16 : 20)
      ScrollView {
        VStack(spacing: 0) {
          if let notice = model.notice, !model.tasks.isEmpty {
            NativeText(model.phase == .offline ? "离线" : notice, size: 14).foregroundStyle(
              p.destructive
            )
            .padding(16).accessibilityIdentifier("tasks.error")
          }
          if !model.tasks.isEmpty {
            rows(tablet: tablet)
          } else if model.phase == .content {
            if !tablet { emptyContent.padding(.top, 148) }
          } else {
            stateContent.padding(.top, 100)
          }
        }.frame(maxWidth: .infinity)
      }.padding(.top, tablet ? 18 : 19).refreshable { await model.reload() }
    }.background(tablet ? p.surface : p.paper).ignoresSafeArea(.container, edges: .top)
  }
  @ViewBuilder private var segments: some View {
    if scale > 1.3 {
      HStack(spacing: 0) {
        ForEach(["进行中", "待确认", "全部"].indices, id: \.self) { index in
          Button {
            model.filter = index
          } label: {
            Text(["进行中", "待确认", "全部"][index])
              .font(.system(size: 13 * scale, weight: model.filter == index ? .bold : .regular))
              .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.vertical, 7)
              .foregroundStyle(model.filter == index ? p.label : p.secondary)
              .background(
                model.filter == index ? p.surface : .clear,
                in: RoundedRectangle(cornerRadius: 7, style: .continuous)
              )
              .padding(.horizontal, 2).contentShape(Rectangle())
          }.accessibilityIdentifier("component.segment.\(index)")
            .accessibilityAddTraits(model.filter == index ? .isSelected : [])
        }
      }.padding(.vertical, 2).background(
        p.well, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    } else {
      NativeSegmentedControl(labels: ["进行中", "待确认", "全部"], selection: $model.filter)
    }
  }
  private func rows(tablet: Bool) -> some View {
    VStack(spacing: 0) {
      ForEach(model.visibleTasks) { task in
        Button {
          model.open(task.id, tablet: tablet)
          if task.recordId != nil,let recordTask {recordTask(task)}
        } label: {
          NativeStatusRow(
            title: task.nativeTaskTitle, status: task.stateLabel,
            date: NativeTaskDate.display(task.createdAt), tone: task.nativeTaskTone,
            selected: tablet && model.selected?.id == task.id
          )
          .lineLimit(2)
        }.accessibilityIdentifier("tasks.item.\(task.id)")
      }
      if model.visibleTasks.isEmpty && !tablet { emptyContent.padding(.top, 148) }
    }
  }
  private var emptyContent: some View {
    VStack(spacing: 0) {
      NativeGlyph(name: "tasks", size: 48, scalesLineWidths: false).foregroundStyle(p.secondary)
      NativeText("暂无任务", size: 20, bold: true).fixedSize(horizontal: true, vertical: true)
        .padding(.top, 28).accessibilityIdentifier("tasks.empty")
      action("刷新") { Task { await model.reload() } }.frame(width: 220)
        .padding(.top, 54 - 20 * 1.42).accessibilityIdentifier("tasks.empty.refresh")
    }.frame(maxWidth: .infinity)
  }
  private var emptyDetail: some View {
    VStack(alignment: .leading, spacing: 0) {
      NativeText("任务", size: 24, bold: true).padding(.leading, 24).padding(.top, 25)
      if model.phase == .content {
        emptyContent.padding(.top, 240 - 25 - 24 * 1.42)
      } else {
        stateContent.padding(.top, 140)
      }
      Spacer(minLength: 0)
    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(p.surface).ignoresSafeArea()
  }
  private var stateContent: some View {
    VStack(spacing: 24) {
      if model.phase == .loading {
        ProgressView().accessibilityIdentifier("tasks.loading")
      } else {
        NativeText(
          model.phase == .expired
            ? "授权已失效"
            : model.phase == .unpaired ? "尚未配对" : model.phase == .offline ? "离线" : "任务暂时无法读取",
          size: 20, bold: true
        )
        .accessibilityIdentifier("tasks.state")
        action(model.phase == .expired ? "重新配对" : model.phase == .unpaired ? "连接资料库" : "重试") {
          if [.expired, .unpaired].contains(model.phase) {
            pair()
          } else {
            Task { await model.reload() }
          }
        }.frame(maxWidth: 300).accessibilityIdentifier("tasks.state.action")
      }
    }.padding(.horizontal, 20).frame(maxWidth: .infinity)
  }
  private var missingDetail: some View {
    VStack(spacing: 24) {
      NativeText(model.phase == .expired ? "授权已失效" : "任务暂不可用", size: 20, bold: true)
      action("返回任务") { model.path = [] }
    }.padding(20).toolbar(.hidden, for: .navigationBar)
  }
  private func detail(_ task: LibraryTask, tablet: Bool) -> some View {
    GeometryReader { geo in
      VStack(spacing: 0) {
        if !tablet { p.paper.frame(height: 44) }
        navigation(tablet: tablet)
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            NativeText(
              task.nativeTaskTitle, size: 24, bold: true, lineHeight: 32,
              trackingCorrection: task.nativeTaskTitle == "长文阅读与信息结构" ? 1.7 : 0
            )
            .padding(.horizontal, 24).padding(.top, 25).accessibilityIdentifier(
              "tasks.detail.title")
            NativeStatusLabel(task.stateLabel, tone: task.nativeTaskTone, badge: true)
              .padding(.leading, 24).padding(.top, 16).accessibilityIdentifier("tasks.status")
            NavigationLink("执行记录与证据") {TaskDiagnosticsView(taskID:task.id)}.padding(.horizontal,24).padding(.top,16)
            NativeText("处理进度", size: 15).foregroundStyle(p.secondary)
              .padding(.leading, 24).padding(.top, 33).accessibilityIdentifier("tasks.progress")
            VStack(spacing: 0) {
              ForEach(Array((task.events ?? []).enumerated()), id: \.offset) { index, event in
                eventRow(event, index: index, last: index == (task.events ?? []).count - 1)
              }
            }.padding(.top, 38 - 15 * 1.42)
            if let notice = model.notice {
              NativeText(notice, size: 14).foregroundStyle(p.destructive).padding(24)
              action("刷新", kind: .secondary) { Task { await model.reload() } }.padding(
                .horizontal, 20)
            }
          }.frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 24)
        }.accessibilityIdentifier("tasks.detail.scroll").refreshable { await model.reload() }
        if task.canRetry || task.state == "awaiting_review" {
          VStack(spacing: 21) {
            if task.canRetry {
              action("继续 / 重试", enabled: model.phase == .content && !model.busy, busy: model.busy) {
                Task { await model.retry(task.id) }
              }.accessibilityIdentifier("tasks.retry")
            } else {
              Group {
                if task.recordId != nil,let recordTask {
                  Button {recordTask(task)} label:{draftLabel}
                }else if tablet {
                  Button {
                    reviewingDraftID = task.id
                  } label: {
                    draftLabel
                  }
                } else {
                  NavigationLink {
                    draft(task.id)
                  } label: {
                    draftLabel
                  }
                }
              }.disabled(model.busy || model.phase != .content)
                .accessibilityIdentifier("tasks.draft")
            }
            if task.canCancel {
              Button {
                model.requestCancellation(task.id)
              } label: {
                NativeText("取消任务", size: 16).fixedSize(horizontal: true, vertical: true)
                  .frame(maxWidth: .infinity, minHeight: 23).contentShape(Rectangle())
              }.foregroundStyle(p.destructive).disabled(model.busy || model.phase != .content)
                .accessibilityIdentifier("tasks.cancel.footer")
            }
          }.padding(.horizontal, 20).padding(.bottom, 34).padding(.top, 10)
        }
        if !tablet { p.paper.frame(height: 35) }
      }.frame(width: geo.size.width, height: geo.size.height)
        .background(tablet ? p.surface : p.paper)
    }.ignoresSafeArea(.container, edges: [.top, .bottom]).toolbar(.hidden, for: .navigationBar)
  }
  private var draftLabel: some View {
    Group {
      if scale > 1.3 {
        Text("查看草稿并确认归档").font(.system(size: 17 * scale, weight: .bold))
          .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(14)
      } else {
        NativeText("查看草稿并确认归档", size: 17, bold: true).fixedSize()
          .frame(maxWidth: .infinity).padding(.top, 14).padding(.bottom, 8)
          .frame(minHeight: 48, alignment: .top)
      }
    }.foregroundStyle(p.dark ? p.paper : p.surface)
      .background(p.accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .contentShape(Rectangle())
  }
  private func eventRow(_ event: TaskEvent, index: Int, last: Bool) -> some View {
    HStack(alignment: .top, spacing: 19) {
      ZStack(alignment: .top) {
        if !last {
          Rectangle().fill(p.separator).frame(width: 2).padding(.top, 13).padding(.bottom, -7)
        }
        Circle().fill(event.state == "failed" ? p.destructive : p.accent).frame(
          width: 12, height: 12
        ).padding(.top, 7)
      }.frame(width: 12)
      VStack(alignment: .leading, spacing: 0) {
        NativeText(
          event.message, size: 17, bold: last,
          trackingCorrection: event.message.contains(" · ") ? 1.5 : 0
        ).foregroundStyle(event.state == "failed" ? p.destructive : p.label)
          .padding(.top, 3).accessibilityIdentifier("tasks.event.\(index)")
        NativeText(NativeTaskDate.display(event.at, timeOnly: true), size: 14).foregroundStyle(
          p.secondary
        )
        .padding(.top, 34 - 3 - 17 * 1.42).accessibilityIdentifier("tasks.event.time.\(index)")
      }.padding(.bottom, 89 - 34 - 14 * 1.42)
    }.padding(.leading, 31).padding(.trailing, 25)
      .frame(minHeight: 89, alignment: .topLeading)
  }
  @ViewBuilder private func navigation(tablet: Bool) -> some View {
    if scale > 1.3 {
      VStack(spacing: 8) {
        HStack {
          if !tablet {
            Button {
              model.path = []
            } label: {
              HStack(spacing: 1) {
                NativeGlyph(name: "back")
                Text("任务").font(.system(size: 16 * scale))
              }
              .frame(minHeight: 44)
            }.accessibilityIdentifier("tasks.back")
          }
          Spacer()
          more
        }.foregroundStyle(p.accent)
        Text("任务详情").font(.system(size: 17 * scale, weight: .bold)).frame(maxWidth: .infinity)
          .accessibilityIdentifier("tasks.nav.title")
      }.padding(.horizontal, 14).padding(.vertical, 12).background(p.paper)
        .overlay(alignment: .bottom) { Rectangle().fill(p.separator).frame(height: 1) }
    } else {
      ZStack(alignment: .top) {
        p.paper
        NativeText("任务详情", size: 17, bold: true).fixedSize().padding(.top, 13).frame(
          maxWidth: .infinity
        )
        .accessibilityIdentifier("tasks.nav.title")
        HStack(spacing: 0) {
          if !tablet {
            Button {
              model.path = []
            } label: {
              HStack(alignment: .top, spacing: 0) {
                NativeGlyph(name: "back").padding(.top, 10)
                NativeText("任务", size: 16).padding(.top, 13)
              }.frame(minWidth: 80, minHeight: 44, alignment: .topLeading).contentShape(Rectangle())
            }.accessibilityIdentifier("tasks.back")
          }
          Spacer(minLength: 0)
          more
        }.padding(.leading, 14).padding(.trailing, 4).foregroundStyle(p.accent)
      }.frame(height: 44).overlay(alignment: .bottom) {
        Rectangle().fill(p.separator).frame(height: 1).offset(y: 1)
      }
    }
  }
  private var more: some View {
    Button {
      model.menu = true
    } label: {
      NativeGlyph(name: "more").frame(width: 44, height: 44).contentShape(Rectangle())
    }.accessibilityLabel("更多").accessibilityIdentifier("tasks.more")
  }
  private func action(
    _ title: String, kind: NativeButton.Kind = .primary, enabled: Bool = true, busy: Bool = false,
    action: @escaping () -> Void
  ) -> some View {
    Group {
      if scale > 1.3 {
        Button(action: action) {
          HStack {
            if busy { ProgressView() }
            Text(title).font(.system(size: 17 * scale, weight: .bold))
          }
          .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(14)
          .foregroundStyle(
            kind == .primary
              ? (p.dark ? p.paper : p.surface) : kind == .destructive ? p.destructive : p.accent
          )
          .background(
            kind == .primary ? p.accent : p.well,
            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }.disabled(!enabled || busy)
      } else {
        NativeButton(title: title, kind: kind, enabled: enabled, busy: busy, action: action)
      }
    }
  }
}
