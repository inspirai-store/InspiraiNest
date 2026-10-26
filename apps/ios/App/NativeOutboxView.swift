import SwiftUI
import UIKit

struct NativeOutboxView: View {
  @ObservedObject var model: NativeOutboxModel
  @Binding var module: NativeAppModule
  @ObservedObject var library: NativeLibraryModel
  var pair: () -> Void = {}
  var showTask: (String) -> Void = { _ in }
  var localDrafts: [LocalComposition] = []
  var draftNotice: String?
  var newDraft: (() -> Void)?
  var openDraft: ((LocalComposition) -> Void)?
  var removeDraft: ((LocalComposition) -> Void)?
  var refreshDrafts: (() -> Void)?
  @Environment(\.colorScheme) private var scheme
  @Environment(\.scenePhase) private var scenePhase
  @ScaledMetric private var scale: CGFloat = 1
  @State private var columns: NavigationSplitViewVisibility = .all
  private var p: NativePalette { .init(dark: scheme == .dark) }
  var body: some View {
    GeometryReader { geometry in
      let tablet = UIDevice.current.userInterfaceIdiom == .pad && geometry.size.width >= 760
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
            if let item = model.selected ?? model.items.first {
              detail(item, tablet: true).toolbar(.hidden, for: .navigationBar)
            } else {
              emptyDetail.toolbar(.hidden, for: .navigationBar)
            }
          }.navigationSplitViewStyle(.balanced)
        } else {
          NavigationStack(path: $model.path) {
            list(tablet: false).toolbar(.hidden, for: .navigationBar)
              .safeAreaInset(edge: .bottom, spacing: 0) { NativeBottomNavigation(module: $module) }
              .navigationDestination(for: String.self) { id in
                if let item = model.item(id) { detail(item, tablet: false) } else { missingDetail }
              }
          }
        }
      }.frame(width: geometry.size.width, height: geometry.size.height)
        .overlay {
          if let item = model.removal {
            NativeConfirmation(
              title: "移除本机记录？",
              bodyText: item.nativeTitle + "\n"
                + (item.leased ? "正在发送的请求仍可能完成。\n" : "")
                + "仅移除本机记录，不取消服务器任务。",
              actionTitle: "移除", destructive: true, scrollBodyWhenLarge: true,
              confirm: { model.confirmRemoval() }, cancel: { model.cancelRemoval() })
          } else if let pending = model.binding, let item = model.item(pending.itemID) {
            NativeConfirmation(
              title: "绑定服务器",
              bodyText: item.nativeTitle + "\n"
                + (URL(string: pending.origin)?.host ?? pending.origin), actionTitle: "绑定并提交",
              confirm: { Task { await model.confirmBinding() } }, cancel: { model.binding = nil })
          } else if model.menu,
            let item = model.selected ?? model.path.last.flatMap({ model.item($0) })
          {
            metadata(item)
          }
        }
    }.background(p.paper.ignoresSafeArea()).foregroundStyle(p.label).tint(p.accent).buttonStyle(
      .plain
    )
    .task(id: scenePhase) {
      guard scenePhase == .active else { return }
      while !Task.isCancelled {
        model.reload()
        refreshDrafts?()
        do { try await Task.sleep(nanoseconds: 2_000_000_000) } catch { return }
      }
    }
  }
  private func list(tablet: Bool) -> some View {
    VStack(spacing: 0) {
      GeometryReader { geo in
        NativeText("发件箱", size: tablet ? 24 : 34, bold: true)
          .padding(.leading, 20).padding(.top, tablet ? 24 : 72).accessibilityIdentifier(
            "outbox.title")
        if let newDraft {
          Button(action: newDraft) {
            Image(systemName: "plus").font(.system(size: 22, weight: .regular))
              .frame(width: 44, height: 44).contentShape(Rectangle())
          }.position(x: geo.size.width - (tablet ? 74 : 76), y: tablet ? 39 : 89)
            .foregroundStyle(p.accent).accessibilityLabel("新建采集")
            .accessibilityIdentifier("composition.new")
        }
        Button {
          model.refresh()
        } label: {
          NativeGlyph(name: "refresh").frame(width: 44, height: 44).contentShape(Rectangle())
        }.position(x: geo.size.width - (tablet ? 30 : 32), y: tablet ? 39 : 89)
          .foregroundStyle(p.accent).accessibilityLabel("刷新").accessibilityIdentifier(
            "outbox.refresh"
          )
          .contextMenu {
            Button("刷新") { model.refresh() }
            Button("重试待提交") { Task { await model.retryQueued() } }
              .disabled(model.busy || !model.paired || model.offline || model.expired)
          }
      }.frame(height: (tablet ? 70 : 126) + max(0, scale - 1) * 34 * 1.42)
      ScrollView {
        VStack(spacing: 0) {
          if let notice = draftNotice {
            NativeText(notice, size: 14).foregroundStyle(p.destructive).padding(20)
          }
          if !localDrafts.isEmpty {
            NativeText("本机草稿", size: 14).foregroundStyle(p.secondary)
              .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20)
              .padding(.top, 12).padding(.bottom, 8)
            ForEach(localDrafts) { draft in
              Button { openDraft?(draft) } label: { NativeCompositionRow(draft: draft) }
                .accessibilityIdentifier("composition.draft.\(draft.id)")
                .contextMenu {
                  Button("继续填写") { openDraft?(draft) }
                  Button("删除草稿", role: .destructive) { removeDraft?(draft) }
                }
            }
            if !model.items.isEmpty {
              NativeText("发件箱", size: 14).foregroundStyle(p.secondary)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20)
                .padding(.top, 24).padding(.bottom, 8)
            }
          }
          if model.offline && !model.items.isEmpty {
            NativeText("离线 · 已保存待提交", size: 14).foregroundStyle(p.accent)
              .padding(.horizontal, 16).padding(.top, tablet ? 12 : 13)
              .frame(maxWidth: .infinity, minHeight: tablet ? 38 : 40, alignment: .topLeading)
              .background(p.selection, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
              .padding(.horizontal, tablet ? 20 : 20).padding(.top, tablet ? 5 : 0)
              .padding(.bottom, tablet ? 22 : 31).accessibilityIdentifier("outbox.offline")
          }
          if let notice = model.notice, !model.items.isEmpty {
            NativeText(notice, size: 14).foregroundStyle(p.destructive).padding(.horizontal, 20)
              .padding(.vertical, 12)
          }
          if model.loading {
            ProgressView().padding(.top, 145).accessibilityIdentifier("outbox.loading")
          } else if model.items.isEmpty && localDrafts.isEmpty {
            if let notice = model.notice {
              NativeText(notice, size: 17).foregroundStyle(p.secondary).padding(24)
              actionButton(title: "重试") { model.refresh() }.padding(.horizontal, 20)
            } else if !tablet {
              emptyContent.padding(.top, 145)
            }
          } else {
            VStack(spacing: 0) {
              ForEach(model.items) { item in
                Button {
                  model.selectedID = item.id
                  if !tablet { model.path.append(item.id) }
                } label: {
                  NativeOutboxRow(
                    item: item, status: model.status(item),
                    selected: tablet && (model.selected ?? model.items.first)?.id == item.id)
                }.accessibilityIdentifier("outbox.item.\(item.id)")
                  .contextMenu {
                    Button("移除本机记录", role: .destructive) { model.requestRemoval(item.id) }
                  }
              }
            }.padding(.top, model.offline ? 0 : 12)
          }
        }
      }.refreshable { model.refresh() }
    }.background(tablet ? p.surface : p.paper).ignoresSafeArea(.container, edges: .top)
  }
  private var emptyContent: some View {
    VStack(spacing: 0) {
      NativeGlyph(name: "outbox", size: 48, scalesLineWidths: false).foregroundStyle(p.secondary)
      NativeText("暂无分享", size: 20, bold: true).fixedSize(horizontal: true, vertical: true)
        .padding(.top, 28).accessibilityIdentifier(
          "outbox.empty")
    }.frame(maxWidth: .infinity)
  }
  private var emptyDetail: some View {
    VStack(alignment: .leading, spacing: 0) {
      NativeText("发件箱", size: 24, bold: true).padding(.leading, 24).padding(.top, 25)
      emptyContent.padding(.top, 240 - 25 - 24 * 1.42)
      Spacer(minLength: 0)
    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(p.surface).ignoresSafeArea()
  }
  private var missingDetail: some View {
    VStack(spacing: 24) {
      NativeText("记录暂不可用", size: 20, bold: true)
      actionButton(title: "返回发件箱") { model.path = [] }
    }.padding(20).toolbar(.hidden, for: .navigationBar)
  }
  private func detail(_ item: OutboxItem, tablet: Bool) -> some View {
    GeometryReader { geo in
      VStack(spacing: 0) {
        if !tablet { p.paper.frame(height: 44) }
        VStack(spacing: 0) {
          navigation(tablet: tablet)
          ScrollView {
            detailContent(item, tablet: tablet, width: geo.size.width)
          }
          footer(item).frame(minHeight: scale > 1.3 ? 0 : 74, alignment: .top).background(p.paper)
        }.background(tablet ? p.surface : p.paper)
        if !tablet { p.paper.frame(height: 35) }
      }.frame(width: geo.size.width, height: geo.size.height)
    }.ignoresSafeArea(.container, edges: [.top, .bottom]).toolbar(.hidden, for: .navigationBar)
  }
  @ViewBuilder private func navigation(tablet: Bool) -> some View {
    if scale > 1.3 {
      VStack(spacing: 8) {
        HStack {
          if !tablet {
            Button {
              model.path = []
              model.menu = false
            } label: {
              HStack(spacing: 1) {
                NativeGlyph(name: "back")
                Text("发件箱").font(.system(size: 16 * scale))
              }.frame(minHeight: 44)
            }.accessibilityIdentifier("outbox.back")
          }
          Spacer(minLength: 0)
          Button {
            model.menu = true
          } label: {
            NativeGlyph(name: "more").frame(width: 44, height: 44)
          }
          .accessibilityLabel("更多").accessibilityIdentifier("outbox.more")
        }.foregroundStyle(p.accent)
        Text("已保存的分享").font(.system(size: 17 * scale, weight: .bold))
          .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: .infinity).accessibilityIdentifier("outbox.nav.title")
      }.padding(.horizontal, 20).padding(.vertical, 12).background(p.paper)
        .overlay(alignment: .bottom) { Rectangle().fill(p.separator).frame(height: 1) }
    } else {
      GeometryReader { geo in
        ZStack(alignment: .top) {
          p.paper
          NativeText("已保存的分享", size: 17, bold: true).fixedSize(
            horizontal: scale <= 1.001, vertical: true
          ).padding(.top, 13)
            .frame(maxWidth: .infinity).accessibilityIdentifier("outbox.nav.title")
          HStack(spacing: 0) {
            if !tablet {
              Button {
                model.path = []
                model.menu = false
              } label: {
                HStack(alignment: .top, spacing: 0) {
                  NativeGlyph(name: "back").padding(.top, 10)
                  NativeText("发件箱", size: 16).padding(.top, 13)
                }.frame(minWidth: 80, minHeight: 44, alignment: .topLeading).contentShape(
                  Rectangle())
              }.accessibilityIdentifier("outbox.back")
            }
            Spacer(minLength: 0)
            Button {
              model.menu = true
            } label: {
              NativeGlyph(name: "more").frame(width: 38, height: 44).contentShape(Rectangle())
            }.accessibilityLabel("更多").accessibilityIdentifier("outbox.more")
          }.padding(.leading, 14).padding(.trailing, 7).foregroundStyle(p.accent)
        }.overlay(alignment: .bottom) { Rectangle().fill(p.separator).frame(height: 1) }
      }.frame(height: max(44, 44 * scale))
    }
  }
  private func detailContent(_ item: OutboxItem, tablet: Bool, width: CGFloat) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      NativeStatusLabel(model.status(item), badge: true).frame(
        height: max(24, 24 * scale), alignment: .topLeading
      )
      .padding(.bottom, 21).accessibilityIdentifier("outbox.status")
      if model.mismatch(item) && scale > 1.3 { mismatchCard(item).padding(.bottom, 20) }
      VStack(spacing: 0) {
        NativeOutboxInfoRow(label: "服务器", value: item.nativeHost)
        NativeOutboxInfoRow(label: "采集电脑", value: item.share.submission.deviceId ?? "自动")
        NativeOutboxInfoRow(
          label: "Agent",
          value: item.share.submission.agent.map {
            $0 == "codex" ? "Codex" : $0 == "codebuddy" ? "CodeBuddy" : $0
          } ?? "自动")
      }.frame(minHeight: 154 * scale, alignment: .top)
        .background(
          tablet ? p.paper : p.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .padding(.bottom, 23)
      label("完整原文").padding(.bottom, 29 - 14 * 1.42)
      VStack(alignment: .leading, spacing: 17) {
        ForEach(
          Array(SharedPart.uniqueValues(in: item.share.originalParts).enumerated()), id: \.offset
        ) { index, part in
          let link =
            part.kind.contains("url") || part.value.hasPrefix("https://")
            || part.value.hasPrefix("http://")
          NativeText(
            part.value, size: index == 0 ? 17 : link ? 14 : 16, bold: index == 0,
            trackingCorrection: link ? -1 : 0, baselineAdjustment: link ? 0.5 : 0
          )
          .foregroundStyle(link ? p.accent : p.label).textSelection(.enabled)
          .accessibilityIdentifier("outbox.original.\(index)")
        }
      }.padding(.horizontal, 16).padding(.top, 17).padding(.bottom, 17)
        .frame(maxWidth: .infinity, minHeight: 106 * scale, alignment: .topLeading)
        .background(
          tablet ? p.paper : p.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .padding(.bottom, 26)
      label("附加要求").padding(.bottom, 28 - 14 * 1.42)
      NativeText(
        item.share.additionalRequirements.isEmpty ? "无" : item.share.additionalRequirements,
        size: 16, lineHeight: 25, explicitLineWidth: width - 40
      )
      .textSelection(.enabled).accessibilityIdentifier("outbox.requirements")
      .padding(.bottom, max(16, 68 - 25))
      VStack(spacing: 0) {
        NativeOutboxInfoRow(
          label: "标签",
          value: item.share.submission.tags.isEmpty
            ? "未设置" : item.share.submission.tags.joined(separator: "、"))
        NativeOutboxInfoRow(
          label: "归档方式", value: item.share.submission.autoArchive ? "自动归档" : "审核后归档")
      }.padding(.horizontal, -16)
      if let message = item.message {
        NativeText(message, size: 14).foregroundStyle(p.destructive).padding(.top, 16)
      }
      if let notice = model.notice {
        NativeText(notice, size: 14).foregroundStyle(p.destructive).padding(.top, 16)
      }
    }.padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 24)
      .overlay(alignment: .top) {
        if model.mismatch(item) && scale <= 1.3 {
          mismatchCard(item).padding(.horizontal, 20).padding(.top, 44 * scale)
            .accessibilityIdentifier("outbox.mismatch")
        }
      }
  }
  private func mismatchCard(_ item: OutboxItem) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      NativeText("服务器不匹配", size: 17, bold: true).foregroundStyle(p.destructive).padding(
        .bottom, 37 - 17 * 1.42)
      NativeText("原服务器  " + item.nativeHost, size: 14, trackingCorrection: -2.5)
        .foregroundStyle(p.secondary).padding(
          .bottom, 30 - 14 * 1.42)
      NativeText("当前服务器  " + (URL(string: model.origin)?.host ?? model.origin), size: 14)
        .foregroundStyle(p.secondary)
    }.padding(.horizontal, 16).padding(.top, 17).frame(
      maxWidth: .infinity, minHeight: max(137, 137 * scale), alignment: .topLeading
    )
    .background(p.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

    .accessibilityIdentifier("outbox.mismatch")
  }
  @ViewBuilder private func actionButton(
    title: String, kind: NativeButton.Kind = .primary,
    enabled: Bool = true, busy: Bool = false, action: @escaping () -> Void
  ) -> some View {
    if scale > 1.3 {
      Button(action: action) {
        HStack(spacing: 10) {
          if busy { ProgressView() }
          Text(title).font(.system(size: 17 * scale, weight: .bold)).multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }.padding(.horizontal, 12).padding(.vertical, 11).frame(maxWidth: .infinity)
          .frame(minHeight: max(48, 17 * scale * 1.42 + 22))
          .foregroundStyle(
            !enabled
              ? p.secondary
              : kind == .primary
                ? (p.dark ? p.paper : p.surface) : kind == .destructive ? p.destructive : p.accent
          )
          .background(
            enabled && kind == .primary ? p.accent : p.well,
            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      }.disabled(!enabled || busy).accessibilityLabel(title)
    } else {
      NativeButton(title: title, kind: kind, enabled: enabled, busy: busy, action: action)
    }
  }
  private func label(_ value: String) -> some View {
    NativeText(value, size: 14).foregroundStyle(p.secondary)
  }
  private func footer(_ item: OutboxItem) -> some View {
    VStack(spacing: 21) {
      if model.mismatch(item) {
        actionButton(title: "复制原文", kind: .secondary) { model.copyOriginal(item) }
          .accessibilityIdentifier("outbox.copy")
      }
      actionButton(
        title: item.state == "submitted" ? "查看任务" : !model.paired ? "连接资料库" : "重试提交",
        enabled: item.state == "submitted"
          ? model.canOpenTask(item) : !model.paired || model.canSend(item), busy: model.busy
      ) {
        if item.state == "submitted", let id = item.taskID {
          showTask(id)
        } else if !model.paired {
          pair()
        } else if item.origin == nil {
          model.requestBinding(item.id)
        } else {
          Task { await model.retry(item.id) }
        }
      }.accessibilityIdentifier("outbox.submit")
    }.padding(.horizontal, 20).padding(.top, 11).padding(.bottom, 15)
  }
  private func metadata(_ item: OutboxItem) -> some View {
    NativePanel(title: "分享详情", height: 610, dismiss: { model.menu = false }) {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          ForEach(
            [
              ("提交 ID", item.id), ("已尝试", "\(item.attempts) 次"), ("保存时间", item.nativeDate),
              ("任务 ID", item.taskID ?? "未提交"),
            ], id: \.0
          ) { row in
            NativeText(row.0, size: 14).foregroundStyle(p.secondary)
            NativeText(row.1, size: 15).textSelection(.enabled)
          }
          label("提交内容预览")
          NativeText(item.share.submission.content, size: 16, lineHeight: 25).textSelection(
            .enabled)
          actionButton(title: "复制原文", kind: .secondary) { model.copyOriginal(item) }
            .accessibilityIdentifier("outbox.copy")
          if model.expired {
            actionButton(title: "重新连接") {
              model.menu = false
              pair()
            }
          }
          actionButton(title: "移除本机记录", kind: .destructive) { model.requestRemoval(item.id) }
            .accessibilityIdentifier("outbox.remove")
        }
      }
    }
  }
}
private struct NativeCompositionRow: View {
  let draft: LocalComposition
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  private var date: String {
    let f = DateFormatter()
    f.timeZone = TimeZone(identifier: "Asia/Shanghai")
    f.dateFormat = "yyyy-MM-dd  HH:mm"
    return f.string(from: draft.modifiedAt)
  }
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    HStack(alignment: .top, spacing: 12) {
      NativeGlyph(name: "file").foregroundStyle(p.accent).padding(.top, 3)
      VStack(alignment: .leading, spacing: 0) {
        NativeText(draft.title, size: 17, bold: true).lineLimit(2)
        NativeText("草稿 · 尚未提交", size: 14).foregroundStyle(p.accent).padding(.top, 13)
        Group {
          if scale > 1.3 {
            VStack(alignment: .leading, spacing: 8) {
              NativeText(date, size: 11)
              NativeText(draft.origin.flatMap { URL(string: $0)?.host } ?? "未绑定", size: 11)
            }
          } else {
            HStack(alignment: .top, spacing: 8) {
              NativeText(date, size: 11).lineLimit(1).fixedSize(horizontal: true, vertical: true)
              Spacer(minLength: 8)
              NativeText(draft.origin.flatMap { URL(string: $0)?.host } ?? "未绑定", size: 11)
                .lineLimit(1).fixedSize(horizontal: true, vertical: true)
            }
          }
        }.foregroundStyle(p.secondary).padding(.top, 14)
      }.frame(maxWidth: .infinity, alignment: .leading)
      NativeGlyph(name: "chevron", size: 18).foregroundStyle(p.secondary).padding(.top, 8)
    }.padding(.horizontal, 20).padding(.vertical, 19).frame(
      maxWidth: .infinity, minHeight: 118 * scale, alignment: .topLeading)
      .overlay(alignment: .bottom) { Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 56) }
      .contentShape(Rectangle())
  }
}
private struct NativeOutboxInfoRow: View {
  let label: String
  let value: String
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    Group {
      if scale > 1.3 {
        VStack(alignment: .leading, spacing: 12) {
          Text(label).font(.system(size: 16 * scale))
          Text(value).font(.system(size: 15 * scale)).foregroundStyle(p.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }.padding(.horizontal, 16).padding(.vertical, 12).frame(
          maxWidth: .infinity, alignment: .leading
        )
        .overlay(alignment: .bottom) {
          Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 16)
        }
      } else {
        HStack(alignment: .top, spacing: 10) {
          NativeText(label, size: 16, trackingCorrection: label == "Agent" ? 1.5 : 0).padding(
            .top, 17)
          Spacer(minLength: 10)
          NativeText(value, size: 15).foregroundStyle(p.secondary).multilineTextAlignment(.trailing)
            .fixedSize(horizontal: scale <= 1.001, vertical: true)
            .padding(.top, 17.5)
        }.padding(.horizontal, 16).frame(minHeight: max(50, 50 * scale), alignment: .topLeading)
          .overlay(alignment: .bottom) {
            Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 16).offset(y: 1)
          }
      }
    }
  }
}
private struct NativeOutboxRow: View {
  let item: OutboxItem
  let status: String
  let selected: Bool
  @Environment(\.colorScheme) private var scheme
  @ScaledMetric private var scale: CGFloat = 1
  private var dateTracking: CGFloat { UIDevice.current.userInterfaceIdiom == .pad ? -1.5 : -0.5 }
  var body: some View {
    let p = NativePalette(dark: scheme == .dark)
    Group {
      if scale > 1.3 {
        HStack(alignment: .top, spacing: 12) {
          NativeGlyph(name: "outbox").foregroundStyle(p.accent)
          VStack(alignment: .leading, spacing: 12) {
            NativeText(item.nativeTitle, size: 17, bold: true).lineLimit(2)
            NativeText(status, size: 14).foregroundStyle(
              status == "需要处理" ? p.destructive : p.accent)
            NativeText(item.nativeDate, size: 11, trackingCorrection: dateTracking).foregroundStyle(
              p.secondary)
            NativeText(item.nativeHost, size: 11).foregroundStyle(p.secondary)
          }
          Spacer(minLength: 0)
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
          .background(
            selected ? p.selection : .clear,
            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      } else {
        GeometryReader { geo in
          ZStack(alignment: .topLeading) {
            if selected {
              RoundedRectangle(cornerRadius: 12, style: .continuous).fill(p.selection).frame(
                height: 109 * scale
              ).padding(.horizontal, 8)
            }
            NativeGlyph(name: "outbox").foregroundStyle(p.accent).padding(.leading, 16).padding(
              .top, 17)
            NativeText(item.nativeTitle, size: 17, bold: true, lineHeight: 23).lineLimit(2).frame(
              width: max(1, geo.size.width - 80), alignment: .leading
            )
            .padding(.leading, 52).padding(.top, 17)
            NativeText(status, size: 14).foregroundStyle(
              status == "需要处理" ? p.destructive : p.accent
            ).padding(.leading, 52).padding(.top, 63 * scale)
            NativeText(item.nativeDate, size: 11, trackingCorrection: dateTracking).foregroundStyle(
              p.secondary
            ).padding(.leading, 52)
              .padding(.top, 88 * scale)
            NativeText(item.nativeHost, size: 11).foregroundStyle(p.secondary).fixedSize(
              horizontal: true, vertical: true
            ).frame(
              width: max(1, geo.size.width - 190), alignment: .trailing
            )
            .padding(.leading, 174).padding(.top, 88 * scale)
          }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).contentShape(
            Rectangle()
          )
          .overlay(alignment: .bottom) {
            Rectangle().fill(p.separator).frame(height: 1).padding(.leading, 52).padding(
              .trailing, 16
            ).offset(y: 1)
          }
        }.frame(height: 114 * scale)
      }
    }
  }
}
