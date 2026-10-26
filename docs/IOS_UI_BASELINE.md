# iPhone/iPad UI 基线与退役规则

## 此次旧 UI 回退的原因

已核对先前正式 IPA：1.0.4 (11) 包含 NativeLibraryRoot / NativeRecordWorkbench，没有 CaptureAssets，SHA-256 为 `e80d9d90bfb962564215caf4744425fb094b5670de802b95c30a3beeadaffcd5`。因此此次属于已发布原生 UI 的回退。

新知 Beta 1.0.7 (12) 使用公开主线的 iOS 工程构建。该工程的正式入口仍是旧 TabView，记录页由 CaptureView 加载旧 Web 资源，资料阅读由 LibraryReaderView 加载旧阅读页。已经完成的原生 UI 位于另一份尚未迁入主线的本地工作区，因此没有进入此次发布。

原有验收核对了构建、签名、学习接口和 TestFlight 分组，没有验证整套 iOS UI 的基线。构建成功和具备新知功能不能证明使用了原生新版。

## 唯一可发布实现

- 源码只在公开仓库 `apps/ios` 维护，正式入口为 NativeLibraryRoot。
- 已删除旧主壳、CaptureView、LibraryReaderView、旧扫码/草稿/附件页面，以及全部 CaptureAssets。
- 资料、登录、设备身份、Keychain/App Group、发件箱及后端协议保持原身份和版本处理方式。
- 原生源码缺失时直接构建失败；禁止加载旧页面或从旧安装包覆盖资源。
- `native-v1` 写入主应用 Info.plist。源文件检查和 Xcode 构建检查共同拦截旧 UI；安装包检查拒绝缺少该标记或包含 CaptureAssets 的归档/IPA，并核对主应用和分享扩展的 App Group、Keychain 与版本。模拟器无设备签名权限，仅检查 UI 与资源；发行包必须通过完整签名身份检查。
- 1.0.7 (12) 和其它经核实含旧壳的构建不得再作为验收包或候选发行包。已下载的离线副本无法远程删除；TestFlight 的分发状态单独核对。

## 原有本机记录

旧 IndexedDB 由不带桥接、无 UI、禁止网络的空白 WebKit 上下文只读访问。逐条保存包含原始附件的快照，再校验附件哈希并写入原生存储；不删除或改写原数据库。

同步完成的记录从现有服务器读取。未同步资料空间的记录保留原空间归属，经过原生同步页的显式重新绑定后才会上传；未绑定记录和未保存草稿保留为本机内容。导入重复执行不会覆盖新版中的编辑。读取、容量或校验失败时保留原件并提示重试。

## 检查入口

- `npm run check:ios-ui`：退役文件、唯一入口与资源生成规则。
- `python3 apps/ios/scripts/check_contract.py`：身份、扩展和持久化边界。
- Xcode PersonalLibraryTests：原生页面模型、学习、登录、发件箱、附件、草稿、记录同步及旧数据导入。
- `python3 tooling/releases/check-ios-artifact.py <artifact>`：发行包的 UI 代际与旧资源检查。

iPad 三栏使用明确的原生列布局，保留 240/320 点导航列，避免系统在竖屏时收起主导航后无法切换模块。

本次旧 1.0.7 (12) TestFlight 构建已设为过期，本机对应 IPA、归档和解包副本已删除，仅保留日志与校验记录。1.0.4 (11) 经核实为原生 UI，不列入旧壳退役范围。

桌面及 Android 不属于此次 iOS UI 迁移，不改变其发行版本。
