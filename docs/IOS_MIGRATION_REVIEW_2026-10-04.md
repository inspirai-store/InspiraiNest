# iOS 改动迁入公开库复核 — 2026-10-04

维护目标为 `inspirai-store/InspiraiNest` 的 `main`。本次读取旧工作区的 13 项 iOS 改动，与公开基线 `1a59953d90a1e3553f2a175716f53e9738250893` 逐项比较；后续修改、提交和推送均在公开库进行。

## 合理性分析

1. **阅读首页与 Cookie 清理**：保留 `percentEncodedPath` 的结尾斜杠，允许真实 `/library/` 首页，并继续拒绝 `/library`、其他来源和 API 路径；取消阅读会话时等待 Cookie 删除。两项修复解决实际可用性及会话清理问题。
2. **扫码配对**：二维码格式、角色、HTTPS 根地址、密钥格式和过期时间在发送前校验；服务器由二维码或用户输入确定。相机与相册入口、确认服务器步骤及相机用途声明相互配套。
3. **分享内容兼容**：读取 Link Presentation 标题与原始 URL；链接附带预览图时保存文字与链接，反馈未收录附件；只有二进制附件时拒绝生成空任务。原文保存及本机发件箱机制继续使用现有实现。
4. **工程与测试**：主应用编译 `ShareCapture.swift`，使 XCTest 能直接验证真实读取实现；二维码、分享、阅读策略及 WebKit 规则测试覆盖相应边界。

以上 10 项代码和测试文件的功能改动已在公开提交 `e15dec6`（Fix iOS pairing, reader, and shared links）合入。`2936a8d` 与 `1a59953` 随后更新了发布配置、品牌和设备授权。直接用旧文件覆盖当前实现会引入版本退回，因此本次按功能核对并保留这些后续更新。

## 逐项处理

文件路径以下均相对于 `collector/mobile/ios/`。

| 旧工作区文件 | 公开库处理 | 依据 |
| --- | --- | --- |
| `App/LibraryReaderView.swift` | 已合入，保留 | 与旧修订逐字一致 |
| `App/PersonalLibraryApp.swift` | 已合入，保留当前更新 | 标签页选择与扫码表单均存在；当前的灵藏品牌、用户输入服务器、分类授权和帮助入口继续保留 |
| `Config/App-Info.plist` | 已合入，保留当前更新 | 相机用途与方向配置已存在；当前名称及加密声明保留 |
| `README.md` | 迁入并更新 | 补齐客户端说明，按当前版本、设备授权和验证方式修订 |
| `ShareExtension/ShareCapture.swift` | 已合入，保留 | 与旧修订逐字一致 |
| `ShareExtension/ShareViewController.swift` | 已合入，保留当前更新 | 未收录附件反馈已存在；保留统一的 `canDispatch` 派发判断，避免遗漏已授权的桌面设备 |
| `Tests/SubmissionTests.swift` | 已合入，保留当前测试 | 阅读边界与 WebKit 编译测试已存在；使用合成测试域名，避免绑定生产服务 |
| `project.yml` | 已合入，保留当前发布配置 | 主应用已包含分享读取源码；保留 iPhone、1.0.0（3）和许可证资源配置 |
| `App/PairingScannerView.swift` | 已合入，保留当前文案 | 相机、相册与二维码校验已存在；当前文案适配统一设备授权 |
| `MAC-BUILD-2026-09-26.md` | 迁入历史记录 | 明确原产物为 0.1.0（1），不作为当前版本验证 |
| `SIGNING-2026-09-26.md` | 迁入历史记录 | 明确旧签名及产物范围，不作为当前版本签名或 Apple 提交证明 |
| `Tests/PairingQRCodeTests.swift` | 已合入，保留 | 与旧修订逐字一致 |
| `Tests/ShareCaptureTests.swift` | 已合入，保留 | 与旧修订逐字一致 |

当前 iOS 发布说明中的构建号同步为 `1.0.0（3）`。本次没有迁入旧仓库 Git 历史、运行数据、本地签名配置、证书或构建产物，也没有新增应用界面说明文字。

## 当前公开库验证

2026-10-04 在公开基线 `1a59953` 上实际执行，使用 Xcode 26.6（17F113）、XcodeGen 2.46.0 与 iPhone 17 Pro Max / iOS 26.5 模拟器。

| 检查 | 结果 |
| --- | --- |
| `python3 collector/mobile/ios/scripts/check_contract.py` | 7 项通过 |
| `node --check collector/mobile/ios/ShareExtension/Preprocess.js` | 通过 |
| XcodeGen 生成工程 | 通过 |
| 主应用与嵌入 Share Extension 编译 | 通过 |
| 模拟器完整 XCTest | 22 项通过，0 失败 |
| 文档本地链接与 `git diff --check` | 通过 |

首次使用 `CODE_SIGNING_ALLOWED=NO` 时，设备标识测试无法读取 Keychain，其他 21 项通过。改用模拟器 ad-hoc 签名后，同一项测试及完整 22 项测试均通过。README 和发布说明据此修正了测试命令；未修改设备身份实现，也未将测试绕过或跳过。

完整测试的可复现命令（在 `collector/mobile/ios/` 内，替换模拟器 UUID 与新的结果路径）：

```sh
xcodebuild -project PersonalLibrary.xcodeproj -scheme PersonalLibrary \
  -configuration Debug -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UDID' \
  -derivedDataPath DerivedData -resultBundlePath Tests.xcresult \
  -parallel-testing-enabled NO -jobs 2 \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test
```

本次模拟器签名不代表真机开发签名或 App Store 发行签名。历史构建、公司签名、真机交互与 Apple 外部审核均按各自记录的版本和时间理解。
