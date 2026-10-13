# 安卓附件分享 1.3.9 / Worker 0.1.29 发布记录

安卓现支持文字、EXTRA_STREAM 与 ClipData 混合分享、多文件选择与分类筛选，私有副本保存、原提交编号重试、二进制上传及 Agent 综合解析。默认自动归档，未解析完成的选中附件会暂停同一任务，保留原件与已有成果；原件在资料和审核页独立展示，支持保存、DOCX 外部打开、音频播放和 PDF 阅读。

单份最多 32 MiB，每次最多 20 份、合计 128 MiB。支持 TXT、Markdown、PDF、DOCX，JPG/PNG/WebP/GIF，MP3/M4A/AAC/WAV/OGG/FLAC/audio WebM。筛选只影响显示，取消勾选的文件不上传。视频、ZIP、旧版 Office 和分块续传不在本轮范围。

## 构建与分发

- 服务端、Windows 与两种 Mac 架构源码：`1847cef0da45787fa5549cbe77e8020dccbb356e`。
- 安卓最终源码：`40750530b617ac34fab19147af04a99c397907f8`，包含原件传输明确使用 identity 编码，避免网关压缩后长度缺失引起误判。
- Windows 来自[公开 CI 38360777486](https://github.com/inspirai-store/InspiraiNest/actions/runs/38360777486)的原产物；私有 OSS 转存回执在 `releases/windows/v0.1.29/38363863284-2/release.json`，GitHub 原始 artifact digest 已记录。未采用本机另建的 Windows 包作为正式分发。
- Mac 来自[签名发布 CI 38360778070](https://github.com/inspirai-store/InspiraiNest/actions/runs/38360778070)，两种架构均通过 Developer ID、codesign、spctl、stapler、ZIP/DMG 与更新 SHA-512 校验。
- 安卓 versionCode 16，原签名证书 SHA-256：`9e7cfc75562a39a1e1f832493aa610855945a449eed71d85757e686a2d069a80`。
- [官网客户端下载](https://library.inspirai.store/download)与[GitHub Release](https://github.com/inspirai-store/InspiraiNest/releases/tag/v0.1.29)已提供本批文件。Worker 电脑需要升级到 0.1.29 或更高版本才能领取带附件任务；旧节点继续处理文字任务。

| 平台 | 文件 | 字节数 | SHA-256 |
| --- | --- | --- | --- |
| windows_x64 | InspiraiNest-v0.1.29-Windows-x64.exe | 116320893 | 25941f1c6748261c18c9234aec6f7e769a4bd04152f9d6596a09d4a4aa57e202 |
| macos_arm64 | InspiraiNest-v0.1.29-macOS-arm64.zip | 133447826 | a5257d58741b51b50d67d266313709d7bc4745199a4b3553cb78c08d3fb18771 |
| macos_arm64_dmg | InspiraiNest-v0.1.29-macOS-arm64.dmg | 133440865 | c5018e975b78e5145c7519cf7d17edabe68ae1e0c317b700943becf3fd58be0b |
| macos_x64 | InspiraiNest-v0.1.29-macOS-x64.zip | 140237900 | f2c43376e471a7befec29f08ba31f892d6e8a62f2bb57471be77ba982a1ccf1e |
| macos_x64_dmg | InspiraiNest-v0.1.29-macOS-x64.dmg | 140209617 | 06f79fcb1a413e3c559bdb853bbc9edcaf4dceef3973b4489e506209290294eb |
| Android | InspiraiNest-v1.3.9-Android.apk | 2806016 | 622a36e300cffeb5a0e4b3fb57b8484bd7e33b758865dd59b0c1d48f69fa3b73 |

## 验证

- 服务端/Worker 全量本地回归：265 项，247 通过、18 因环境条件跳过、0 失败；公开 CI 另执行隔离 MySQL 授权与技能流程。安卓最终提交的 CI 38365797857 全部通过；Mac 页面等待超时在重跑后通过。
- 每阶段正式镜像的隔离检查均通过 13 项附件和旧记录加工测试，并逐文件核对原站与新产物哈希。
- 安卓 release 39 项单测、Lint 0 errors。专用 MuMu 实例完成 23 项仪器测试，包括混合分享去重、筛选不改选择、源文件移除后的草稿恢复、上传/建任务确认丢失重试，以及原件请求的 identity 传输。
- 真实 Codex Agent 处理六份二进制样本：中文 TXT、Markdown、含标题与表格 DOCX、扫描 PDF、PNG 和 11.692 秒英文合成语音 WAV。工具实际读取和校验全部原件，进行全文提取、OCR 和带时间戳 ASR；超时及覆盖校验暂停后继续原任务，最终保留六项原件、逐文件正文和一份综合资料。
- 另验证默认自动归档，缺工具后留在原节点暂停，补齐后继续同一任务；关闭自动归档时保留待审核结果，确认后归档。原件不占轻量成果包预算。
- 模拟器从真实 Agent 归档中下载六份原件并核对 SHA-256，验证原生正文、DOCX 保存/外部打开入口、图片、PDF 和音频播放入口。
- 1.3.8 原签名安装 → 1.3.9 覆盖安装，保留配对凭据、旧草稿和不可变待提交 payload。模拟器旧版还从正式 HTTPS 清单下载新版 APK，验证版本、大小、哈希和与已安装应用相同的签名。
- 五个桌面包与 APK 均完整下载官网正式链接，核对大小与 SHA-256；兼容下载路径、Mac 自动更新 YAML 与 blockmap 也通过校验。GitHub 发布的 16 项文件大小和服务器记录 digest 与本批本机记录一致。

## 发布与保留

发布顺序为服务端、Worker 下载/升级清单、安卓下载/升级清单。

- server：2026-10-13T07:16:28.968Z；镜像 `yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-attachments-server-029-20261013-r1@sha256:7ad3404f69ad635af7ff37e2964c8ca9838a1db6065b6a4fb22bc9eef579df44`；回滚镜像 `yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-capture-clients-028-20261010-r1@sha256:f93b85dd74f31f5aa3447149931c61df9ef1490f504a362c0636b3c58f9f72b7`。
- worker：2026-10-13T07:50:16.919Z；镜像 `yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-attachments-worker-029-20261013-r1@sha256:6dad8a8a9e57cdb95ac07137ea125456124cc93e6921b698ef81354bd246bacf`；回滚镜像 `yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-attachments-server-029-20261013-r1@sha256:7ad3404f69ad635af7ff37e2964c8ca9838a1db6065b6a4fb22bc9eef579df44`。
- android：2026-10-13T08:04:47.142Z；镜像 `yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-attachments-android-029-20261013-r1@sha256:abb73c5fe965b7c9e2fac8bf51041c521c587f82afaf98946fd2512bf6dd5741`；回滚镜像 `yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-attachments-worker-029-20261013-r1@sha256:6dad8a8a9e57cdb95ac07137ea125456124cc93e6921b698ef81354bd246bacf`。

所有阶段核对了既有 21 个设备的授权哈希，以及 81 个任务、129 份资料、6 条记录和 4 个技能版本的保留。未迁移资料、凭据或数据库架构。私有发布账号策略仅增加 Windows 发布目录的 GetObject/PutObject 权限，保留旧 v1 策略作为回滚点；发布仍受 main 分支、手动开关与 signed-release 环境约束。临时构建进程和集群验收资源已清理。

## 验收边界

文件管理器、WPS 与录音应用在物理手机上的分享 URI 授权仍需验收。音频样本为合成语音，实际进行了 ASR；未验证手机录音硬件。Mac 原生最小化仍沿用签名流水线既有的跳过项。本轮未增加 iOS 分享、视频、压缩包或其他 Office 格式。

