#if DEBUG
  import SwiftUI
  import UIKit

  /// Component fixtures have no service, credential, outbox, camera or share-extension dependencies.
  struct NativeComponentReview: View {
    let configuration: NativeReviewConfiguration
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var panelVisible = false
    @State private var confirmationVisible = true
    @State private var requirements = "提炼导航与阅读的设计要点，保留代码片段。"
    @State private var tags = "SwiftUI、阅读"
    @State private var autoArchive = false
    @State private var choices = [0, 0, 0, 0]
    @State private var formCompleted = false
    @State private var advancedVisible = false
    @State private var computer = 0
    @State private var agent = 0
    @State private var server = "https://library.inspirai.store"
    @State private var device =
      UIDevice.current.userInterfaceIdiom == .pad ? "我的 iPad" : "我的 iPhone"
    @State private var code = "12345678"
    @ScaledMetric private var scale: CGFloat = 1
    @FocusState private var editingRequirements: Bool
    @State private var editingRequirementsMode = false
    private var palette: NativePalette { .init(dark: scheme == .dark) }

    init(configuration: NativeReviewConfiguration) {
      self.configuration = configuration
      _panelVisible = State(initialValue: configuration.page == "P05")
    }

    var body: some View {
      Group {
        switch configuration.page {
        case "P14": formFixture
        case "C01": controlFixture
        case "P20", "P23", "P26", "P33", "P34":
          NativeSkeletonShell(page: "P18", components: true)
            .overlay { if confirmationVisible { confirmation } }
        case "P05":
          NativeSkeletonShell(
            page: "P01", components: true, componentFilterAction: { panelVisible = true }
          )
          .overlay {
            if panelVisible {
              NativePanel(title: "筛选与排序", height: 610, dismiss: { panelVisible = false }) {
                filterFixture
              }
            }
          }
        default:
          NativeSkeletonShell(
            page: configuration.page, components: true,
            componentFilterAction: { panelVisible = true }
          )
          .overlay {
            if panelVisible {
              NativePanel(title: "筛选与排序", height: 610, dismiss: { panelVisible = false }) {
                filterFixture
              }
            }
          }
        }
      }.foregroundStyle(palette.label).tint(palette.accent).buttonStyle(.plain)
    }

    private var formFixture: some View {
      GeometryReader { geometry in
        let tablet = geometry.size.width >= 760
        let width: CGFloat = tablet ? 660 : geometry.size.width
        let height: CGFloat = tablet ? 730 : geometry.size.height - 44
        ZStack(alignment: .topLeading) {
          palette.paper.ignoresSafeArea()
          if tablet {
            NativeText("SwiftUI 原生界面实践", size: 28, bold: true).offset(x: 72, y: 60)
            NativeText("https://example.com/swiftui", size: 17).foregroundStyle(palette.secondary)
              .offset(x: 72, y: 110)
            Color.black.opacity(palette.dark ? 0.44 : 0.25).ignoresSafeArea()
          }
          VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
              NativeText("收集到资料库", size: 17, bold: true).accessibilityIdentifier(
                "component.form.title"
              )
              .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true)
              .frame(maxWidth: .infinity).padding(
                .horizontal, typeSize.isAccessibilitySize ? 20 : 0
              )
              .padding(.top, typeSize.isAccessibilitySize ? 16 + 17 * 1.42 * scale + 18 : 16)
              HStack(alignment: .top) {
                Button {
                  editingRequirements = false
                  editingRequirementsMode = false
                } label: {
                  NativeText("取消", size: 17).fixedSize().frame(
                    minWidth: 44, minHeight: 44, alignment: .topLeading
                  ).contentShape(Rectangle())
                }
                .accessibilityIdentifier("component.form.cancel")
                Spacer()
                Button {
                  formCompleted = true
                  editingRequirements = false
                  editingRequirementsMode = false
                } label: {
                  NativeText("保存", size: 17).fixedSize().frame(
                    minWidth: 44, minHeight: 44, alignment: .topTrailing
                  ).contentShape(Rectangle())
                }
                .accessibilityIdentifier("component.form.save")
              }.foregroundStyle(palette.accent).padding(.horizontal, 20).padding(.top, 16)
            }.frame(
              height: typeSize.isAccessibilitySize ? 50 + 17 * 1.42 * scale * 2 : 57,
              alignment: .top)
            Rectangle().fill(palette.separator).frame(height: 1)
            ScrollView {
              VStack(alignment: .leading, spacing: 0) {
                NativeText("原文", size: 14).foregroundStyle(palette.secondary)
                NativeFormGroup {
                  NativeText("SwiftUI 原生界面实践", size: 17, bold: true).padding(.horizontal, 16)
                    .padding(.top, 20)
                  NativeText("https://example.com/swiftui", size: 15).foregroundStyle(
                    palette.accent
                  )
                  .padding(.horizontal, 16).padding(.top, 65 - 20 - 17 * 1.42)
                  Spacer(minLength: 0)
                }.frame(minHeight: 112 * scale).padding(.top, 29 - 14 * 1.42)
                NativeText("附加要求", size: 14).foregroundStyle(palette.secondary).padding(.top, 28)
                NativeFormGroup {
                  if editingRequirementsMode {
                    TextEditor(text: $requirements).font(.system(size: 16 * scale))
                      .scrollContentBackground(.hidden).focused($editingRequirements)
                      .padding(.horizontal, 12).padding(.top, 10)
                      .onAppear { editingRequirements = true }
                  } else {
                    Button {
                      editingRequirementsMode = true
                    } label: {
                      NativeText(
                        requirements, size: 16, lineHeight: 25, explicitLineWidth: width - 72
                      )
                      .padding(.horizontal, 16).padding(.top, 18)
                      .frame(maxWidth: .infinity, alignment: .leading)
                    }.accessibilityIdentifier("component.form.requirements")
                  }
                  Spacer(minLength: 0)
                }.frame(minHeight: max(90, scale * 90)).padding(.top, 29 - 14 * 1.42)
                NativeFormGroup {
                  NativeFormRow(label: "标签") {
                    NativeInlineInput(label: "标签", text: $tags).padding(.top, 20.5)
                  }
                  NativeFormRow(label: "自动归档") {
                    NativeToggle(isOn: $autoArchive, label: "自动归档")
                      .padding(.top, 4).padding(.trailing, -1).accessibilityIdentifier(
                        "component.form.auto")
                  }
                  Button {
                    advancedVisible = true
                  } label: {
                    NativeFormRow(label: "高级派发选项", disclosure: true)
                  }.accessibilityIdentifier("component.form.advanced")
                }.frame(minHeight: 164, alignment: .top).padding(.top, 32)
              }.padding(.horizontal, 20).padding(.top, 30).padding(.bottom, 36)
            }.scrollDismissesKeyboard(.interactively)
          }.frame(width: width, height: height)
            .background(
              palette.surface,
              in: RoundedRectangle(cornerRadius: tablet ? 16 : 0, style: .continuous)
            )
            .offset(x: (geometry.size.width - width) / 2, y: tablet ? 52 : 44)
            .accessibilityElement(children: .contain).accessibilityIdentifier("component.form")
        }
      }.ignoresSafeArea()
        .overlay {
          if advancedVisible {
            NativePanel(title: "高级派发选项", height: 510, dismiss: { advancedVisible = false }) {
              VStack(alignment: .leading, spacing: 20) {
                NativeText("采集电脑", size: 14).foregroundStyle(palette.secondary)
                NativeFormGroup {
                  ForEach(Array(["自动", "我的 Mac", "工作电脑 · 离线"].enumerated()), id: \.offset) {
                    index, label in
                    NativeSelectableRow(title: label, selected: computer == index) {
                      computer = index
                    }
                  }
                }
                NativeText("Agent", size: 14).foregroundStyle(palette.secondary)
                NativeFormGroup {
                  ForEach(Array(["自动", "Codex", "CodeBuddy"].enumerated()), id: \.offset) {
                    index, label in
                    NativeSelectableRow(title: label, selected: agent == index) { agent = index }
                  }
                }
              }
            }
          }
          if formCompleted {
            NativeConfirmation(
              title: "已保存", bodyText: "SwiftUI 原生界面实践", actionTitle: "完成",
              confirm: { formCompleted = false }, cancel: { formCompleted = false })
          }
        }
    }

    private var filterFixture: some View {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(0..<4, id: \.self) { index in
          let groups = [
            ["全部", "视频", "文章", "网页", "文档", "代码仓库", "音频", "图片", "笔记", "其他"],
            ["全部", "SwiftUI", "资料整理", "阅读"],
            ["全部", "已归档", "待补齐", "待处理"], ["最近收集", "最早收集", "标题"],
          ]
          let labels = groups[index]
          let columns = labels.count > 4 ? 3 : labels.count
          NativeText(["类型", "主题", "完整度", "排序"][index], size: 14).foregroundStyle(palette.secondary)
            .padding(.bottom, 29 - 14 * 1.42)
          LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: columns), spacing: 8
          ) {
            ForEach(labels.indices, id: \.self) { choice in
              NativeChoice(title: labels[choice], selected: choices[index] == choice) {
                choices[index] = choice
              }
              .accessibilityIdentifier("component.filter.\(index).\(choice)")
            }
          }.padding(.bottom, 23)
        }
        Button {
          choices = [0, 0, 0, 0]
        } label: {
          NativeText("重置", size: 16).fixedSize().frame(maxWidth: .infinity)
        }.foregroundStyle(palette.accent).offset(y: -2).accessibilityIdentifier(
          "component.filter.reset")
      }
    }

    private var confirmation: some View {
      let page = configuration.page
      let title =
        page == "P23"
        ? "取消任务？"
        : page == "P26"
          ? "确认归档？" : page == "P33" ? "撤销我的 Mac？" : page == "P34" ? "移除本机登录？" : "绑定服务器"
      let action =
        page == "P23"
        ? "取消任务"
        : page == "P26" ? "确认归档" : page == "P33" ? "撤销设备" : page == "P34" ? "移除登录" : "绑定并提交"
      let body =
        page == "P33"
        ? "采集电脑"
        : page == "P34"
          ? "本机分享原文保留" : page == "P20" ? "SwiftUI 原生界面实践\nlibrary.inspirai.store" : "SwiftUI 原生界面实践"
      return NativeConfirmation(
        title: title, bodyText: body, actionTitle: action,
        cancelTitle: page == "P23" ? "继续处理" : "取消",
        destructive: ["P23", "P33", "P34"].contains(page),
        confirm: { confirmationVisible = false }, cancel: { confirmationVisible = false })
    }

    // A component bench: all examples are local UI state, with no pairing operation.
    private var controlFixture: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          ViewThatFits {
            HStack(spacing: 16) { badges }
            VStack(alignment: .leading, spacing: 16) { badges }
          }.padding(.top, 20)
          NativeButton(title: "配对并登录") {}
          NativeButton(title: "复制文本", kind: .secondary) {}
          NativeButton(title: "移除本机登录", kind: .destructive) {}
          NativeButton(title: "确认归档", enabled: false) {}
          NativeTextInput(
            label: "服务器地址", text: $server, paper: UIDevice.current.userInterfaceIdiom == .pad)
          NativeTextInput(
            label: "设备名称", text: $device, paper: UIDevice.current.userInterfaceIdiom == .pad)
          NativeTextInput(
            label: "配对码", text: $code, secure: true,
            paper: UIDevice.current.userInterfaceIdiom == .pad)
        }.padding(.horizontal, 20).padding(.bottom, 30)
          .frame(maxWidth: 633, alignment: .leading).frame(maxWidth: .infinity)
      }.background(UIDevice.current.userInterfaceIdiom == .pad ? palette.surface : palette.paper)
        .accessibilityElement(children: .contain).accessibilityIdentifier("component.bench")
    }
    private var badges: some View {
      Group {
        NativeStatusLabel("处理中", badge: true)
        NativeStatusLabel("失败", tone: .destructive, badge: true)
        NativeStatusLabel("待提交", badge: true)
      }
    }
  }
#endif
