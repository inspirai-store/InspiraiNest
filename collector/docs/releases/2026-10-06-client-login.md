# 客户端网址与 Web 密码登录交付记录

日期：2026-10-06（Asia/Shanghai）。公开库 `inspirai-store/InspiraiNest`，分支 `main`。

## 实现

- macOS、Windows、Linux、iOS、Android 的默认入口为资料库地址与该部署现有 Web 密码；保留配对码，手机保留扫码。
- HTTPS 根地址规范化、密码原样传输、OTP/恢复码、限流和结构化登录错误；取消、进入后台、修改地址时清空输入并丢弃迟到结果。
- 新登录失败保留原连接，桌面同时切换管理端与 Worker；远端缓存和手机待提交内容按地址隔离，历史归属不改写。
- Web 登录、CLI、独立 Worker 授权入口保持原实现。客户端未内置审核地址或密码。
- 协议及回归脚本详见 [客户端登录说明](../CLIENT-LOGIN.md)。

## 已完成的测试

| 层级 | 结果 |
| --- | --- |
| SQLite/Node 完整测试 | 156 项通过 |
| MySQL 认证和双部署登录 | 37 项通过 |
| 桌面本地回归 | 登录、真实双部署切换、失败保存回滚、重启恢复、设置/节点、配对弹窗、Worker 生命周期通过 |
| Android | debug 与 release 各 28 项通过，两个变体 lint 通过，debug APK 构建通过 |
| iOS | 27 项 XCTest 通过；ARM64 Release 与 Simulator 构建成功，Simulator 实际登录入口已查看 |
| 公共 CI | [37438344989](https://github.com/inspirai-store/InspiraiNest/actions/runs/37438344989) 成功，包含 Windows、Mac/Intel、Linux、Android、服务端及 Web 镜像 |
| 下载页 | 平台版本、文件名、校验值、响应式布局及不可用版本回归通过 |

系统存储的桌面 GUI 回归显式使用隔离替身；正常应用使用 Electron safeStorage。真实 macOS 钥匙串授权弹窗尚需用户在原生会话确认。此 runner 的原生最小化仍按现有说明显式跳过，菜单栏/Worker 的其他生命周期检查通过。

iOS 的设备 Release 编译使用 `CODE_SIGNING_ALLOWED=NO`，不能视为真实设备安装或 App Store 提交；没有使用生产密码登记设备。

## 服务端先行部署

- 源码：`a93defc5cc1ed6d968f9da42747ee11b28bcbc7b`。
- 镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-client-login-api-20261006-a93defc@sha256:43151c3e0058a2e662b5345e019e3ecf6b304e0e314fcc3e918b04b2be312555`。
- Kubernetes `aliyun` / `inspirai` / `library-collector` / `api`，revision 55 已就绪。
- 本地容器核验 `/api/pair` 错误密码返回 `credential_invalid`；线上健康正常，Web 登录逐字节未改，原下载清单保持。

## 待完成的移动正式交付

Android 1.3.5（versionCode 12）代码和测试完成，但原 Android 发布证书保存在旧 Windows 构建机的 `PersonalLibrary/signing`，目前不可访问。公开和旧私有库均没有对应 Android 签名 Secrets。下载页保持可升级的旧版 1.3.4，不使用 debug APK 或新签名替换。正式 CI 及 OSS 存储流程已配置，取得同一证书后使用 `ANDROID_SIGNING_STORE` 和 `ANDROID_SIGNING_PASSWORD` 执行，并核对前版签名证书相同。

iOS 新入口与测试已完成；真实设备完整登录、签名导出与外部分发尚未验收。

## 桌面正式交付

- macOS 0.1.12：[正式 CI 37437608347](https://github.com/inspirai-store/InspiraiNest/actions/runs/37437608347) 成功，源码 `a93defc5cc1ed6d968f9da42747ee11b28bcbc7b`。
- 两种架构均通过 Developer ID 签名、Apple 公证、`codesign --verify --deep --strict`、`stapler validate` 和 `spctl --assess`。两个应用内共 112 个第一方文件与 CI 源码一致，更新 ZIP 的 SHA-512 与清单相符。
- Mac 私有 OSS 前缀：`releases/macos/v0.1.12/37437608347-1/`。4 个安装/更新包、4 个 blockmap、更新清单、SHA-256 清单及回执共 11 个对象，全部回读校验。
- Windows 0.1.12 使用上述公共 CI 的 `worker-windows` 成功产物，源码 `964bbd55b0f1eb66871a225e48da09aab6f93044`。GitHub 归档 SHA-256、EXE SHA-256 和更新清单 SHA-512 均通过核验；沿用现有 NSIS 构建方式。
- Windows 私有 OSS 前缀：`releases/windows/v0.1.12/964bbd5/`。EXE、blockmap、SHA-256 文件及更新清单共 4 个对象，使用已有 Aliyun 发布身份上传并全部回读校验；未扩大运行中应用的 OSS 权限。
- 入口：[官网下载页](https://library.inspirai.store/download)。macOS 更新源：[latest-mac.yml](https://library.inspirai.store/updates/macos/latest-mac.yml)。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| [InspiraiNest-v0.1.12-Windows-x64.exe](https://library.inspirai.store/downloads/InspiraiNest-v0.1.12-Windows-x64.exe) | 115920538 | `b9d734d3e8907c7f8e5d190bf7a1649a0e8942cbaa9fb393fac7e354e18f56b2` |
| [InspiraiNest-v0.1.12-macOS-arm64.zip](https://library.inspirai.store/downloads/InspiraiNest-v0.1.12-macOS-arm64.zip) | 133065269 | `522ff33cab63ad88044bc6ac7980f50db4de5f13379bd6ec4b2c31ec8cde2da2` |
| [InspiraiNest-v0.1.12-macOS-x64.zip](https://library.inspirai.store/downloads/InspiraiNest-v0.1.12-macOS-x64.zip) | 139855332 | `eab1252db8c24d1a480ce751de7421275540a6e0545a36b20c0b47866567500c` |
| [InspiraiNest-v0.1.12-macOS-arm64.dmg](https://library.inspirai.store/downloads/InspiraiNest-v0.1.12-macOS-arm64.dmg) | 133035432 | `34a20ff8b4f1d67c916bd089f0663150bf4e0348da0696e2f40cb029975bbe92` |
| [InspiraiNest-v0.1.12-macOS-x64.dmg](https://library.inspirai.store/downloads/InspiraiNest-v0.1.12-macOS-x64.dmg) | 139813255 | `3b53d6cbe9249b173956471c9bf9d88323cdfbb530d0db31b117ab6035ec5b9e` |

## 下载镜像与线上核验

- 镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-client-login-desktop-012-20261006-964bbd5@sha256:d45d4bdd70bf76c3426dff8652ba419fbad99aef1dfe70530b24b0cb465aeee1`。
- 部署时间：`2026-10-06T17:29:18.266695+08:00`，Kubernetes `aliyun` / `inspirai` / `library-collector` / `api`，revision `56`，1/1 就绪，实际 Pod 镜像 digest 一致、重启次数 0。
- 先上线兼容服务端，再更新安装包；使用 JSON Patch 校验旧镜像后仅替换 `api` 容器镜像。
- 线上 5 个 Mac/Windows 文件均完整下载并通过大小和 SHA-256 核验；macOS 更新清单与两种架构的 ZIP blockmap 与 CI 文件一致。
- 内置浏览器下载页已显示 Mac Apple Silicon、Mac Intel 和 Windows 0.1.12，入口分别指向对应 DMG/EXE；桌面安装步骤使用网址与 Web 密码。
- Web 登录页面逐字节保持一致；Android 1.3.4、iOS 渠道状态和只读 CLI/Skill 发布清单与发布前一致。Linux 的共享桌面实现经过 CI 验证，本次未新增 Linux 安装包渠道。

回滚镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-client-login-api-20261006-a93defc@sha256:43151c3e0058a2e662b5345e019e3ecf6b304e0e314fcc3e918b04b2be312555`（revision 55，已包含兼容的认证接口）。
