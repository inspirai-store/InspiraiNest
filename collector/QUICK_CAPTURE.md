# 快速记录与远端收件箱

Android、iOS 与 Windows/macOS 桌面端新增默认记录入口。正文、照片和录音可组合；发送先提交远端收件箱，不会创建 Agent 任务。已有文字/链接采集、工作节点、资料库及待审核流程保留。

## 使用与保存

- 文字和附件写入本机 IndexedDB 后再发送；草稿和待提交记录可在重启后恢复。存储不可用时显示保存失败，不把内容称为已保存。
- 每条记录最多 20 个附件、合计 128 MiB，单附件最多 32 MiB，正文最多 50000 字符。支持 JPG/PNG/WebP/GIF 和 M4A/AAC/MP3/WAV/WebM/Ogg/FLAC；首版不自动转写。
- 记录保留发送时的目标服务器。更换资料空间不会把原队列改投；未曾连接的记录在第一次有效连接时绑定目标。授权凭据只由原生层持有。
- 手机录音每 10 秒落一份完成的原始 AAC 片段，停止后按顺序加入记录；强制关闭后可恢复已完成片段。正在写入、尚未完成的尾段不保证可恢复。拒绝权限不妨碍文字和文件导入。
- 上传附件后，服务端核对大小与 SHA-256，再提交正文和附件清单。重复请求沿用原请求 ID；并发编辑得到 409，客户端保留本机内容，用户可明确基于最新版本重发。
- 客户端运行时后台重试，恢复到前台时再次重试；首版不承诺应用被系统终止后继续网络上传。

## 加工与归档

收件箱详情提供转写/识字、整理摘要、行动项、自定义，以及电脑和 Agent 选择。加工请求固定记录版本（包括已保存的历史版本），修改记录不改变任务输入。只有报告 `recordProtocol: 1` 的新版 Worker 能领取任务。

Worker 从只对当前任务授权的接口下载并校验原始媒体，放进任务目录 `.record-input/`；Agent 完成加工后使用既有校验和轻量包上传流程。结果必须先预览，再明确确认归档。Worker 将原始文字及创建时间加入成果 metadata，保留原收件箱记录与媒体；重新加工生成独立任务与历史结果。

原始音频留在远端收件箱和本机任务目录，不扩展现有轻量归档包的音频许可范围。需要在收件箱详情播放音频。ASR/OCR 是否可用取决于执行节点工具，缺少工具时进入待操作流程，不生成虚构转写。

## 接口

所有管理接口要求用户授权；Worker 执行凭据不能管理收件箱。原 `/api/tasks` 接口保持兼容。

| 方法 / 路径 | 输入或作用 |
|---|---|
| `GET /api/records` | 返回记录列表和加工状态 |
| `GET /api/records/:id` | 返回记录与历次加工任务 |
| `PUT /api/records/:id` | `requestId`、`baseVersion`、`text`、`createdAt`、按顺序的 `attachments: [{id,name,sha256}]` |
| `PUT /api/records/media/:sha256` | 原始二进制文件，Content-Type 为实际媒体类型 |
| `GET /api/records/media/:sha256` | 授权读取原始媒体 |
| `POST /api/records/:id/process` | `requestId`、`baseVersion`、`preset: summary/extract/actions/custom`、`instructions`、可选 `deviceId`、`agent` |
| `GET /api/tasks/:id/record-media/:sha256` | 仅当前已分配 Worker 可读取该任务快照包含的媒体；沿用 assignment fence |

记录元数据使用既有 SQLite/MySQL record store，媒体使用既有 LocalStorage/OSS 抽象；新增数据种类自动建立，无单独数据库 migration。媒体与版本不删除，未提交的上传对象也暂不回收。

## 开发与验证

共享界面源位于 `public/capture/`。运行 `npm run stage:capture` 同步 Android/iOS 内置资源；`node scripts/stage-capture.mjs --check` 和自动化测试检查副本一致。Android 常用构建脚本会先同步资源；iOS 执行 XcodeGen 前也需同步。

- `node --test test/records.test.mjs test/capture-assets.test.mjs`：真实 HTTP、权限、媒体、版本/幂等、节点隔离与子进程 fixture 加工/审核闭环。
- `node scripts/test-capture.cjs`：Chrome + 本地真实服务，验证混合草稿重载、离线重试、媒体读取、冲突恢复、目标服务器绑定、响应式布局。
- `node scripts/test-desktop-capture.cjs`：真实 Windows Electron，验证未登录即记录、用户授权同步以及保留工作节点入口。
- Android：`:app:assembleDebug :app:lintDebug :app:testDebugUnitTest`；新增入口测试保留既有登录测试。
- iOS：便携合同检查仅验证配置及旧队列合同，不能代替 Swift 编译、WKWebView 存储、相机和麦克风的真机检查。

照片原文件保持不变，浏览器在导入时生成最长边 480px 的 JPEG 缩略图，按独立校验值上传并作为衍生附件关联。无法解码时保留原图。

运行时截图/检查结果保存在忽略目录 `test-output/capture/`。发布验证分阶段进行：服务端先通过候选镜像的隔离测试，再更新线上；Windows/macOS 0.1.28、Android 1.3.8、iOS 1.0.3（8）对应同一套记录协议。实际部署及设备验收情况以发布记录为准。
