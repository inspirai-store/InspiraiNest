# 桌面工作台下载记录

## 后续发布约定（2026-10-09）

每次桌面客户端发布必须同时交付 Windows 和 macOS 全部现有架构，使用公开仓库同一个源码提交及同一个桌面版本号，作为同一批次发布。

| 平台 | 必交付文件 |
|---|---|
| Windows x64 | `InspiraiNest-v<版本>-Windows-x64.exe`（NSIS） |
| macOS Apple Silicon（arm64） | `InspiraiNest-v<版本>-macOS-arm64.dmg`、`InspiraiNest-v<版本>-macOS-arm64.zip` |
| macOS Intel（x64） | `InspiraiNest-v<版本>-macOS-x64.dmg`、`InspiraiNest-v<版本>-macOS-x64.zip` |

- Windows 复用公开仓库 `collector-build.yml` 的已验证产物；macOS 使用同一提交的 `collector-release.yml` 签名发布流程，开启 `include_macos`，完成 Developer ID 签名、Apple 公证及两种架构验证。普通 CI 的未签名 Mac 包不能作为正式交付。
- 所有平台产物验证完成后，再更新 GitHub Release、官网发布清单、下载页及各平台自动更新文件（包括 blockmap）。核对源码提交、版本、文件大小、SHA-256、更新清单校验值与包内资源；完整下载每个平台的正式链接验证。
- macOS 必须同时更新 `worker-release.json` 与私有 `macos-update.json`，两者版本一致。候选镜像预检实际请求 `/updates/macos/latest-mac.yml`、两种架构的 ZIP 与 blockmap，并核对其大小及哈希；仅测试模拟清单不能证明新镜像的更新入口可用。
- 发布记录逐项列出 Windows、Mac arm64、Mac x64 的构建与验收结果。任一必交付平台未完成时，整批发布标记为未完成，不能仅以 Windows 上线宣告客户端发布完成；保留上一批可用产物作为回滚目标。
- Android、iOS 沿用各自的版本号、签名身份与现有分发渠道；涉及移动端改动时也须列入对应发布及验收记录，明确尚未交付的平台。

## 问答驱动写作体系 0.2.3（2026-10-16）

服务端、Windows x64 与 macOS Apple Silicon/Intel 已同批发布，四台在线电脑的客户端及 Worker 均确认升级至 0.2.3。Android 1.3.10 / versionCode 17 已发布并验证模拟器覆盖升级；iOS 1.0.4 / build 9 保留待签名。问答、写作计划、风格及稿件保留历史，明确开始后才成文，先预览再归档。构建、正式文件哈希、实际安装、原记录保留及验收边界见 [完整发布记录](../../docs/releases/2026-10-16-writing-0.2.3.md)。

## 桌面客户端 0.2.2（2026-10-16）

Windows x64 的 NSIS 安装包与 macOS Apple Silicon、Intel 的签名公证 ZIP/DMG 已同批发布。修复完整排版同步、错误分类、三方比较和旧成功回执恢复；真实原记录已保留 ID 恢复同步，本机已安全升级。安装包、CI、钥匙串会话修复、生产回滚和验收边界见 [完整发布记录](../../docs/releases/2026-10-16-desktop-0.2.2-record-sync.md)。

## 桌面客户端 0.1.27（2026-10-09）

Windows x64 与 Mac Apple Silicon、Intel 的正式包已从同一提交同批发布，官网下载页及自动更新入口均为 0.1.27。此版本加入日志一键复制与 `.agent/skills` 单一源链接安装。构建、文件哈希、部署和验收边界见 [完整发布记录](../../docs/releases/2026-10-09-desktop-0.1.27.md)。

## macOS 0.1.11 与 Web 更新（2026-10-05）

Apple Silicon 和 Intel 的签名、公证 DMG/ZIP 已由公开仓库 CI 构建并保存到 OSS。官网下载页和 macOS 自动更新地址均已切换到 0.1.11，Windows 0.1.11、Android 1.3.4、只读 CLI 0.1.1 的文件与清单保持一致。

本次同时发布当前 Web 源码，包含配对弹窗及登录、浏览器会话相关更新。构建来源、文件校验值、部署记录和验收范围见 [本次发布记录](releases/2026-10-05-macos-011-web.md)。

## Windows 0.1.11

- 安装包：`InspiraiNest-v0.1.11-Windows-x64.exe`，沿用 NSIS。
- 构建来源：公开仓库提交 `c88e41ae0a6dd044f3b330548a69f318fdfee2cb`，[CI 37228104237](https://github.com/inspirai-store/InspiraiNest/actions/runs/37228104237)。
- 大小：115,914,691 字节。
- SHA-256：`460bb6f91a8c558d8da66047daecd9deddb89708956820659a510f9f3a766d23`。

此版本包含设置栏目、随系统／白天／黑夜主题、可关闭的开机自启动、运行状态恢复、工作节点查看及定向派发，并修复配对弹窗中的关闭和复制图标布局。保留采集任务、资料阅读、中文分类日志和后台 Worker 行为。

官网下载页按平台显示版本、文件大小、保存文件名及 SHA-256。Windows 下载更新为上述已验证产物；Android 1.3.4、macOS 0.1.7 及只读 CLI 0.1.1 沿用原正式文件与校验值。macOS 普通 CI 包不替换签名发布包。

此次网站发布范围仅为下载页资源、Windows 安装包和桌面发布清单，复用现有服务与网络入口。代码提交和线上部署分别记录；源码中的其他修改不随下载页更新自动部署。

验证包括平台版本区分、文件名与校验展示、手机及窄屏布局、获取失败和无可用版本的提示；下载服务继续校验大小和 SHA-256，并仅允许发布清单中的当前文件及其品牌兼容路径。
