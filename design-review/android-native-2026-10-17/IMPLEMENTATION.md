# Android 原生改造

## 基准

参考 `/Users/alexxiong/Documents/lingnest` 的未合并 iOS 实现。固定下表文件，不合并该工作目录的其他改动。Android 保留系统字体测量，不采用 SwiftUI 的逐字坐标补偿。根导航按最新记录方案采用「记录 / 资料库 / 任务 / 我的」，默认资料库。

| iOS 文件（相对参考仓库） | SHA-256 |
| --- | --- |
| collector/mobile/ios/App/NativeDesignSystem.swift | 531472f9727fa33498b8e31904e3a54fb1f7046d6bfdfb814528beaa1a59c8c9 |
| collector/mobile/ios/App/NativeComponents.swift | 4093c3db50ba598c83150ba9f96ad900be2f09dbfb7f31f1e11873f3860b65a4 |
| collector/mobile/ios/App/NativeAppNavigation.swift | d5e16a81fee9ebe88b3d5d8c40aacb4327ebb0a007ac6658724508d44ab15d7c |
| collector/mobile/ios/App/NativeLibraryRoot.swift | fec9c850b1e65e661c97bc0ca86ed084ae06987fc0983f8850ca16a00e39e93e |
| collector/mobile/ios/App/NativeMarkdownDocument.swift | af4e16fdbfbd37c46af60f21fce48c52a3ab507dff7cdac751465f5e60fb1d23 |
| collector/mobile/ios/App/NativeRecordRichText.swift | ee3bbd65c896db4565e19cd6adcb7c5e76d52fc99962f310a7e2e696280180fc |
| design-review/ios-native-2026-10-10/DESIGN.md | 20780fdc031f31adc8e7549513383ec10672301bc879f9372e9d19cd7eb26684 |
| design-review/ios-records-2026-10-16/complete-design/FUNCTION-MAP.md | 59b23e5d4410b2526c90950359cb03f350927745d6755e8720d7d682a89508a3 |

## 包与组件边界

一个 Gradle app 模块，`store.inspirai.library.nativeui` 下按职责组织：

| 包 | 组件 / 职责 |
| --- | --- |
| design | NestTheme、NestSpace、EmptyState、ErrorState；日夜颜色、字号角色、12/16dp 圆角 |
| content | MarkdownContent、MarkdownBlock、RecordDocument、RecordCodec；Markdown 与文档 JSON 分开解析 |
| data | NestRepository、AndroidNestRepository、NestDependencies、Room DAO、LegacyMigration；安全请求、同步、迁移、收藏 |
| feature | LibraryModel、ReaderModel、RecordsModel、TaskModel、AccountModel 与业务页面 |
| 宿主 / 平台 | NativeActivity、NativeShareActivity、NativePreviewActivity；系统选择器、录音、扫码、外部打开、安装升级 |

组件输入为数据和回调。Repository 接口与统一依赖工厂允许注入夹具。Room 数据库在 noBackup 目录，不复制或迁移 Keystore 凭据。旧 Java 发件箱及媒体哈希上传继续使用原实现。

## 页面映射

| 页面 | 原生实现 | 数据契约 |
| --- | --- | --- |
| 资料库 / 筛选 / 收藏 | LibraryPage | read/v1 entries/search；旧服务完整分页后本地过滤与全局排序 |
| 阅读 / 大纲 / 文件 / 归档信息 | ReaderPage | entry、content 分页、带 SHA-256 的 file |
| 记录 / 详情 / 编辑 / 同步冲突 | RecordsPage、RecordPage、RecordEditorPage | records、document.version=1；本机编辑草稿与未确认 payload 分开 |
| 分享双路径 / 附件筛选 | SharePage | 原 Java Drafts、InputFiles、Outbox；记录路径进入 Room |
| 任务四分区 / 稍后 / 报告 / 审核 | TasksPage、TaskPage、BundlePage | processing-center、tasks、trial-report、approve |
| 我的 / 发件箱 / 设备 / Agent | AccountPage 及子页 | state、agents；保留原配对与提交编号 |
| 配对 / 扫码 / 更新 | PairPage、现有扫码平台能力、UpdatePage | pair、设备标识策略、原签名验证与系统安装器 |
| 写作工作台 | CaptureActivity 的 writing 专用入口 | 原受限原生桥接 |

二级页面隐藏手机底栏；600dp 起使用导航栏，840dp 起列表与详情并列。列表及正文使用独立 LazyListState 和 SaveableStateProvider。选中项与编辑输入不依赖刷新重建整页。

## 迁移与协议

受限迁移页面只在原 origin 读取 IndexedDB 和 localStorage；不加载 capture.js、不携带凭据、不执行旧同步。Blob 分块导出，原生落盘后核对大小和 SHA-256。每条记录事务写入迁移日志，核对总数量后才启用原生同步。源 IndexedDB 不删除。

本机记录原样保留原 ID、server、版本、payload.requestId 和 pendingProcess。未确认请求不随编辑改写，新编辑独立排队。收藏按服务器隔离，主题复用原 appearance 偏好。

服务端阅读扩展兼容旧调用：categories、sort=collected_desc/collected_asc/title、ids JSON 数组（最多 1000）。搜索未显式排序时保留相关性。审核可传 draftId，服务端在事务中核对当前待审核摘要，旧调用仍可用。

## 验证记录

- 服务端完整测试：328 项，309 通过、19 跳过、0 失败；包含阅读接口 28 项。覆盖分类去重计数、删除可见性、ID 集合、排序、旧搜索相关性和审核摘要检查。
- Android 发布版单测：60 项通过、0 跳过；包括既有 Java 核心、Room、富文本、文档和图片路径、确认丢失重试、并发编辑、加工状态分离、迁移中断恢复及导航。汇总见 [unit-results.json](unit-results.json)。
- Release Lint：0 错误、13 警告，未关闭检查。明细见 [lint-release.txt](lint-release.txt)。
- 独立 AVD：LingNest_Attachment_QA / emulator-5580，API 36。使用 AEHD 与 SwiftShader；没有操作已连接的手机和电视。
- 1.3.13 原签名覆盖安装至 1.4.0 已通过。旧版重新写入测试样本，清除该样本的原生导入标记后再升级，验证本次实际触发迁移；原 WebView 数据继续保留。检查记录 ID、版本、未确认写入和加工编号、原件大小与 SHA-256、服务器收藏，以及既有凭据、草稿和原生待提交队列。见 [migration-audit.json](migration-audit.json)、[upgrade-seed.txt](upgrade-seed.txt)、[upgrade-verify.txt](upgrade-verify.txt)。
- 真实 Compose 运行检查：六项场景全部通过，包括原生四栏、日夜切换、检索与阅读返回、富文本编辑及完整键盘下保存、系统分享存为独立记录、报告与原资料/原记录双向跳转、归档原件下载与预览，以及 1001 条资料滚动到第 700 项后阅读返回的位置保留。大列表记录见 [large-library.json](large-library.json)，此次未测量逐帧耗时。混合系统分享的旧 Java 筛选和副本恢复回归也通过。报告内容来自专用 API 夹具。
- 最终 APK 的七组布局检查全部通过：360/393/412dp 手机、1.3/2.0 字号、640dp 横屏及 960dp 平板。每组检查日夜主题、阅读与返回；840dp 以上展示列表/详情并排。已复查原生正文、代码、表格及平板键盘收起。结果见 [layout-results.json](layout-results.json)，原始截图及日志位于 `emulator/`。

## 交付

- Android 候选包：`collector/mobile/dist/InspiraiNest-v1.4.0-Android.apk`，versionCode 21，14,245,580 字节。
- APK SHA-256：`5c3b112769ea5b0a069382ed86b7a75a9a7eb34b580aecb2a0354bf14b5e31a0`。已核对模拟器实际安装的 base.apk 与该文件一致。
- 原发布证书 SHA-256：`9e7cfc75562a39a1e1f832493aa610855945a449eed71d85757e686a2d069a80`。
- [四栏日夜运行对照](android-native-day-night.png)、[阅读、富文本与分享运行对照](android-native-reading-sharing.png)。图中使用验收夹具；不是静态设计图或正式用户资料。
- [组件规范](COMPONENTS.md)、[页面与协议](PROTOCOLS.md)、[手机及正式服务验收清单](DEVICE-ACCEPTANCE.md)。

Android 1.4.0 已以原签名发布至正式主站，下载与升级清单已核验。部署和回滚信息见 [正式发布记录](../../docs/releases/2026-10-17-android-native-1.4.0.md)。实际手机硬件/权限、TalkBack、真实跨端冲突及真实 Agent 全流程仍按验收清单检查；模拟器通过不代表这些边界已经通过。
