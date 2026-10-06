# 客户端登录与资料库切换

macOS、Windows、Linux 共用 Electron 登录实现；iOS、Android 使用同一 `/api/pair` 协议。Web 登录、CLI 和独立 Worker 保持原入口。

## 用户入口

- 首次安装的资料库地址为空；以后预填上次成功连接的地址。输入该部署的 Web 登录密码。
- 地址为 HTTPS 根地址，可带自定义端口；不接受账号信息、路径、查询或片段。默认端口、域名大小写及末尾斜杠统一规范化。
- 密码原样传输，包含首尾空格；密码和验证码只保留在本次验证的内存中。
- 保留配对码入口；手机另保留扫码入口。设备名称自动生成。
- 启用认证器的部署继续要求动态码或一次性恢复码。地址变化、取消、离开页面和后台切换取消本次验证并清空输入。
- “更换资料库”保留原连接到新登录成功。桌面 Worker 必须完成当前任务并停止；新凭据同时切换管理端和本机 Worker。

## 兼容协议

请求为 `POST /api/pair`，现有 `key` 字段承载密码或配对码，附带 `clientType`、安装 ID 和设备信息。第二步增加 `otp` 或 `recoveryCode`。客户端拒绝登录请求重定向。

- `desktop` 返回 Worker `token` 与管理端 `ownerToken`；`ios`、`android` 返回管理端 `token`。
- `mfa_required`、`mfa_invalid` 和 `credential_invalid` 均为登录错误，客户端不把它们误报成已登录设备授权失效。
- 密码错误在旧 `error`、HTTP 状态之外新增 `code: credential_invalid`，旧客户端继续兼容。
- 保留服务端 MFA、防重放和限流。Web 密码验证仍由现有账户安全模块执行。

## 部署隔离

凭据包含规范化地址。手机待提交记录保留原地址，首次登录前的分享保存为未绑定草稿，明确提交时才绑定。切换不会重写历史记录的归属。桌面新资料库使用独立 Worker 数据目录，远端界面缓存与收藏按地址隔离。手机重新创建资料库阅读界面并丢弃旧请求结果。

记忆地址为非敏感偏好设置；设备令牌继续使用现有系统加密存储。客户端包不内置审核部署地址或审核密码。

## 验证与交付

- `node --test test/client-login.test.mjs`：两套隔离部署、原样密码、失败切换、迟到响应、凭据保存失败、权限、MFA/恢复码、防重放、限流及配对码兼容。
- `node scripts/test-desktop-login-switch.cjs [executable]`：两个真实隔离服务、失败保留原连接、统一切换、独立数据目录及重启后恢复新凭据。系统存储使用显式测试替身。
- `node scripts/test-auth-mysql.cjs`：一次性 MySQL 实例，包含上述客户端登录用例与原认证回归。
- `node scripts/test-desktop-login.cjs [executable]`：空地址、错误密码、超时/限流、MFA、恢复码、修改地址取消、页面离开及切换。该界面测试使用隔离合成 IPC；实际授权由服务端/管理器测试覆盖；桌面设置回归使用隔离存储替身，真实 macOS 钥匙串弹窗需要用户在原生会话中授权。
- Android：`:app:testDebugUnitTest :app:assembleDebug :app:lintDebug`，正式分发必须沿用已有发布签名。
- iOS：XCTest 覆盖 API 原样密码/验证字段、结构化错误、失败与取消时保留旧 Keychain 凭据、成功切换及旧远端界面失效。签名 XCTest 可在 Simulator 执行；真实设备验收单独记录。
- CI 对 Windows/macOS 包运行新登录回归；Linux 验证共享界面，不新增安装包渠道。

先部署兼容服务端，再发布客户端安装包。审核部署与个人部署使用同一客户端，凭据通过对应部署地址输入。
