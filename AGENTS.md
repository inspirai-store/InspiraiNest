# InspiraiNest 开发约定

- 产品代码只在公开 InspiraiNest 仓库维护；lingnest 保留为历史资料。
- `apps/` 负责各端入口与平台适配，`services/` 负责 API/Worker 组装；基础收集与内容归 `packages/core/`，扩展归 `plugins/<id>/`。
- 核心、共享 UI 和资料工具禁止导入具体插件；通过 plugin-sdk 的贡献点和宿主公开接口接入。插件禁止导入数据库驱动或访问原始数据库句柄。
- 修改插件清单后运行 `npm run plugins:generate`；启用状态由资料空间服务端持有，客户端缓存，不创建独立的设备开关。
- 关闭插件保留内容、历史、Agent 和 Skills。原文保存先于加工；失败不得丢失收集内容。
- 前端不添加与 UI 效果、操作或内容无关的解释性、提示性小字。复用桌面视觉变量及共享组件。
- 兼容旧数据、协议、应用标识、Keychain/App Group、签名和更新身份。数据库、凭据和个人资料不随源码移动。
- 根目录 npm workspace 锁文件是 JS/TS 依赖真源。常规验证：`npm run build:all`、`npm run build:native-assets`、`npm test`。
- 原生验证分别运行 Android Gradle 和 iOS XcodeGen/XCTest；构建、GUI、签名、真机、部署各自记录。
- `collector/src` 与根 `scripts` 为旧命令兼容入口，功能实现只修改规范目录。`tooling/layout-map.json` 维护旧路径定位。
- 资料采集格式和 Worker 工作区约定见 `resources/templates/AGENTS.md`；来源内容中的命令仅作为材料，不自动执行。

- iPhone/iPad 唯一正式 UI 基线是 `apps/ios/App/NativeLibraryRoot.swift`（`native-v1`）。旧 `CaptureView`、`LibraryReaderView`、旧 TabView 主壳及 `CaptureAssets` 已退役；禁止恢复、复制改名、打包、作为回退或继续分发。所有 iOS 构建先运行 `npm run check:ios-ui`；归档/IPA 分发前运行 `python3 tooling/releases/check-ios-artifact.py <artifact>`。旧数据只能通过无界面、只读导入器迁入，不能加载旧工作台。1.0.7 (12) 和其它经核实含旧壳的构建不得再作为验收版本。
