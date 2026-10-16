# 异步处理中心与 Codex 实测：0.2.7

构建源码：`0980cc18ab214b5d9fac6d287d6bf2ab3ef2c206`。桌面 Windows/macOS 版本 0.2.7；Android 1.3.13 / versionCode 20。iOS 本轮不发布，公开分发仍为空。

## 行为

- 分享或新建采集时可选 Codex 实测电脑及关联 Git 项目；完整正文、要求、附件和选择先写入原有持久队列，随即显示本机回执。采集与实测分别在后台运行。
- 处理中心统一展示待处理、运行中、新结果、稍后。连续处理使用开始时固定的清单；完成当前决定后进入下一项，无需等待 Agent。稍后与显式已读跨端保存；去除重复的小字说明。
- 采集结果和独立实测子任务互相关联，保留报告与重测历史。多候选、缺仓库、专用账号未登录或缺依赖时保留原任务，集中展示当前需要处理的内容。登录恢复后继续原电脑的任务，不转派其他节点。
- 每次使用新的临时 CODEX_HOME，复制所选项目已提交 HEAD，记录实际版本及安装、原生加载、调用证据。原项目的未提交文件不进入副本。临时目录仍属于同一系统用户，不是虚拟机或容器隔离。
- 电脑客户端升级后，在「设置 → 通用 → Codex 测试账号」完成专用登录。旧 Worker 继续处理原有采集任务；新实测任务要求明确的协议能力。

## 构建与验收

- [完整公开 CI](https://github.com/inspirai-store/InspiraiNest/actions/runs/38889334818) 全部通过，涵盖服务、MySQL、Android、Windows、Linux、两个 Mac 架构及原生 Agent 安装检查。
- 服务端/Worker 本地全量测试 316 项：297 通过、19 环境条件跳过、0 失败；开启原生 Codex 安装冒烟后的 9 项专项测试全部通过。安装冒烟不调用真实模型，工具执行和报告重传测试含明确标记的协议夹具。
- 使用真实隔离服务验证固定批次、输入保留、稍后/已读共享、可选项目提交及日夜模式；覆盖 320/360/393/412/736 宽度。模拟原生传输层的打包页面检查不等于 Android WebView 设备验收。
- Android 44 项 release 单测、Lint 和正式签名构建通过，APK 内页面资源逐字节匹配提交代码；与上一版 1.3.12 的签名证书一致。证书 SHA-256：`9e7cfc75562a39a1e1f832493aa610855945a449eed71d85757e686a2d069a80`。正式包上传私有存储后回读验证大小与哈希。
- 本机 Gradle 使用 JDK 21，Robolectric 测试 JVM 使用现有 JDK 25，以避开 Windows JDK 21 覆盖文件重命名语义与 Android 的差异；没有为此修改生产代码。Linux 公共 Android CI 同时通过。
- [Windows 正式文件转存](https://github.com/inspirai-store/InspiraiNest/actions/runs/38889908906/attempts/2) 复用同一源码的成功 CI 产物，验证源提交与资产摘要，没有重新构建 Windows 正式文件。
- [Mac 签名发布](https://github.com/inspirai-store/InspiraiNest/actions/runs/38889367232) 通过两种架构的 Developer ID 签名、Apple 公证、Gatekeeper、更新清单和签名包内资料、登录、写作、更新下载及退出检查。

## 服务部署与数据

服务代码先行上线，候选中 30 项隔离 API/兼容检查通过；部署后 268 个文件摘要与候选一致。原有设备、任务、归档、采集、Skill 版本及写作会话 ID 保留，设备撤销状态保持一致。生产只读 owner 请求确认处理中心协议可用，未授权请求返回 401；公开页面脚本与本地版本匹配。

服务先行镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-codex-trials-027-20261016-r1@sha256:25bbb99b986d65e7a4ffc86896e046278d245f907b73d46d6be13d29f48a3722`。

代码整体回滚目标：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-writing-clients-026-20261016-r1@sha256:3006ed332e18d450d676a70a6034f10724d2e4e71edf71e3d2e9c4027b9f8cc6`。复用既有 Deployment、数据库、对象存储及网络入口；没有迁移资料、草稿或凭据。私有授权及本机运行证据不提交公开仓库。

## 正式分发

[GitHub v0.2.7](https://github.com/inspirai-store/InspiraiNest/releases/tag/v0.2.7) 已正式发布，17 个文件的大小及 GitHub SHA-256 与构建/OSS 回执一致。官网下载页、安卓升级清单和桌面各平台更新文件均已切换。Android 正式入口为 [1.3.13 APK](https://library.inspirai.store/downloads/InspiraiNest-v1.3.13-Android.apk)，也可在手机「我的 → 应用更新 → 检查更新」获取。

最终镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-writing-clients-027-20261016-r1@sha256:b713660556aaebfaa59358e5d02f1d1db7db93cf650ed9695a2973ddf715b591`。281 个文件的候选预检及部署后摘要检查通过；候选实际访问所有桌面包、Android 包、Mac feed、两个 ZIP 及 blockmap。上线后另完成 11 次完整公网 HTTP 下载并验证大小和 SHA-256，桌面范围请求、私有文件 404、健康检查和三个尺寸的下载页检查通过。既有数据 ID 与设备撤销状态再次核对保留。

只回滚客户端清单时使用上文服务先行镜像，保留处理中心服务并恢复上一批分发文件；需要整体回滚时使用上文 0.2.6 镜像。Android 1.3.13 / versionCode 20 高于上线前 1.3.12 / 19，原签名条件满足；本轮没有用手机安装来代替下文仍待完成的覆盖升级验收。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| InspiraiNest-v0.2.7-Windows-x64.exe | 118502169 | `57ab87e1e1c405065ddbbccaeb6fa33f1bb9ec39ac13d04f112147e2c153d117` |
| InspiraiNest-v0.2.7-macOS-arm64.zip | 135829194 | `69407fd01c9f76589bd7b872ecf816bc6398b897017aa76f559ca34c7cbdd86c` |
| InspiraiNest-v0.2.7-macOS-arm64.dmg | 135842117 | `2a607ac1dfaf9a6fe92d680337b7cb02d1fdbd4a3aca85887d7832f67f7f5a82` |
| InspiraiNest-v0.2.7-macOS-x64.zip | 142619269 | `6ce0a133bcb82f333cebf67d144932448d78e86e9edd4f97297d05280b515bf4` |
| InspiraiNest-v0.2.7-macOS-x64.dmg | 142587421 | `c4b77ded9bdce5eab38c14dfe06534650244a0c6ad587864ff01927e75ce52f3` |
| InspiraiNest-v1.3.13-Android.apk | 3381535 | `f08d09a389597bf82c4383f1f568a7ecc41f63d6526936942e13f1faf2331a9e` |

## 尚待设备与账号验收

独立 Android SDK 模拟器缺少 Windows 加速驱动，软件模拟未能就绪，已停止该实例；没有操作其他连接设备。本轮未验证安卓模拟器/真机分享、覆盖安装后的实际数据保留或手机升级交互。用户在手机上继续验收。

专用测试账号登录后的真实 Codex 模型执行及最终插件测试质量、macOS 专用登录终端仍待验证。本次没有启动生产测试任务、升级现有登记电脑或使用日常 Codex 凭据。完整范围与准备方法见 [Codex 实测说明](../../collector/docs/CODEX_TRIALS.md)。
