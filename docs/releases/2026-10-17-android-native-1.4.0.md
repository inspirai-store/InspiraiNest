# Android 1.4.0 原生改版发布

源码提交：`cd4b74cf7227be3d8f722ea57311d61e618b5075`。Android 1.4.0 / versionCode 21，沿用原发布证书。Windows/macOS 保持 0.2.12，iOS 与 Reader 清单保持原值。

## 本次变化

原生 Compose 四栏「记录 / 资料库 / 任务 / 我的」，默认资料库；统一暖白、暖炭灰与琥珀色主题。原生阅读提供正文、大纲、文件及归档信息；记录支持富文本、草稿、媒体、录音、同步冲突和加工审核。系统分享先保存完整内容，再选择存为记录或交给 Agent。任务保留四分区及 Codex 报告与原资料、原记录的返回关系。

原 capture.local 数据通过受限迁移页面导入 Room，保留 ID、远端版本、原件和未确认请求编号；源 IndexedDB 保留。发件箱、凭据、收藏和主题继续沿用。写作工作台仍使用受限 WebView。组件和协议细节见 [实现记录](../../design-review/android-native-2026-10-17/IMPLEMENTATION.md)。

服务端兼容增加阅读分类、排序和 ID 集合，并在审核事务中核对当前草稿。基于当时生产镜像，仅替换两份服务源码、Android APK 和清单；未改数据库结构、存储、凭据、网络或其他客户端产物。

## 验证

- [主分支 CI](https://github.com/inspirai-store/InspiraiNest/actions/runs/39021893158) 全部通过，包含 Android 构建、单测与 Lint，服务端、共享界面、MySQL 和各桌面构建。
- 本机发布版 60 项单测通过；Release Lint 0 错误、13 警告；专用模拟器六项交互、七组布局及大列表返回检查通过。
- 原签名 1.3.13 覆盖至 1.4.0：验证实际迁移触发，保留记录、原件、收藏、凭据、草稿、队列及原请求编号。
- 候选镜像隔离预检运行阅读、客户端分发与服务测试，52 通过、1 个需 MySQL 的测试按环境跳过；完整 CI 另行覆盖 MySQL。初次预检缺少仅供 Worker 测试的项目模板，补齐隔离 ConfigMap 后重跑通过，未改生产镜像。
- 部署后 325 个文件哈希符合预期；部署前已有的 device 22 条、task 114 条、archive 152 条、capture 13 条、skill-version 4 条、record 0 条、writing-session 2 条标识全部保留，设备撤销状态一致。
- 公网正式与品牌下载地址完整下载，字节数、SHA-256 和原签名核对通过；范围下载、私有文件拒绝和升级清单通过。主站 /healthz 与 /download 返回 200，部署就绪 1/1。

## 分发与回滚

[下载页面](https://library.inspirai.store/download) · [Android 1.4.0 安装包](https://library.inspirai.store/downloads/InspiraiNest-v1.4.0-Android.apk)。手机现有版本可在「我的 → 应用更新」检查并覆盖安装。

APK：14,245,580 字节；SHA-256：`5c3b112769ea5b0a069382ed86b7a75a9a7eb34b580aecb2a0354bf14b5e31a0`。

证书 SHA-256：`9e7cfc75562a39a1e1f832493aa610855945a449eed71d85757e686a2d069a80`。

部署镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-android-native-140-20261017-r1@sha256:48d1d4709f647a3480e2e24b577bbe464e565441ca018f6911fafcbc34685fcd`。

回滚镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-local-agent-clients-0212-20261017-r1@sha256:7240ffd1bba9065e84f9f8c9761b3c9af9475488920995a630ead9bc57697b3e`。回滚镜像也会恢复旧 Android 更新清单，不回退或清空用户数据。

核验时间：2026-10-17T09:48:06.982Z。签名包构建时工作区尚未提交，原始构建记录保留该事实；发布源码对应上述提交。

## 待手机验收

真实手机分享、权限、相机/扫码、录音/锁屏、系统安装器、TalkBack、实际跨端冲突和真实 Agent 全流程仍需验收，不能由模拟器夹具代替。见 [手机验收清单](../../design-review/android-native-2026-10-17/DEVICE-ACCEPTANCE.md)。未操作已连接的实体手机或电视。
