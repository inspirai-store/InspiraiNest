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
- 发布记录逐项列出 Windows、Mac arm64、Mac x64 的构建与验收结果。任一必交付平台未完成时，整批发布标记为未完成，不能仅以 Windows 上线宣告客户端发布完成；保留上一批可用产物作为回滚目标。
- Android、iOS 沿用各自的版本号、签名身份与现有分发渠道；涉及移动端改动时也须列入对应发布及验收记录，明确尚未交付的平台。

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
