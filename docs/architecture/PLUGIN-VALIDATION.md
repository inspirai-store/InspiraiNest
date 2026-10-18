# 插件化验证记录

基线：公开仓库 main `4a71e538b124406910aaf4d019b90689405da9d8`。开发位于独立分支 `codex/plugin-architecture`，未修改原有工作区和用户资料。

## 已完成的本地验证

- `npm run build:all`：桌面及 Web 生产构建通过。
- `npm run typecheck`、插件清单生成一致性、核心依赖及插件存储边界检查通过。
- `npm test`：插件宿主 6 项、服务 316 项、React 197 项通过；服务另有 20 项依赖外部环境的测试跳过。
- 插件测试覆盖新旧空间默认值、依赖及执行中作业阻止停用、修订冲突、服务端拒绝停用插件的新作业、全部扩展停用后的链接与原始附件收集和导出、历史数据保留、Worker 注册分发及命名空间隔离。
- 隔离 MySQL 授权、技能及插件并发回归 127 项通过。
- `collector/scripts/qa-writing.mjs` 验证桌面与移动嵌入包的完整讨论、附件、历史恢复、图片、离线导出和确认归档流程，已加入共享 CI。
- `tooling/plugins/browser-qa.mjs` 使用真实浏览器和 Cookie 登录，验证插件启停、依赖提示、关闭全部扩展、核心记录保存与同步和窄屏布局。
- `collector/scripts/test-desktop-writing.cjs` 使用打包后的真实 Electron 客户端通过写作及 Owner IPC 回归；`test-record-conflict.cjs` 通过明暗及两种宽度下的冲突比较、手动合并、条件保存和重启读取。
- macOS arm64/x64 ZIP、DMG 构建通过，使用临时签名；这些本地制品没有公证或作为正式更新发布。
- Android 单元测试 67 项、Debug APK 和 lint 通过。
- iOS 应用及分享扩展 Simulator 编译通过，Python 契约检查 7 项通过。本地 XCTest 卡在模拟器安装启动阶段，未取得运行通过证据；干净 runner 的全部 33 项 XCTest（含原生 WebKit 渲染）已在提交 `05e6d28` 的 CI 中通过。
- Go CLI 单元测试通过；需要真实系统钥匙串的集成测试未启用。
- 从不包含本机依赖及构建制品的 Docker 上下文重新安装根锁文件，生产 Web 和镜像构建通过。
- 离线阅读器索引 build/check 通过，保持 file:// 入口。

## 跨平台 CI 补充

产品源码验收基于 `ae7e4aa` 及其未改动对应平台源码的前序提交。共享 CI、Windows 打包及全部真实客户端回归、macOS 主构建与回归、Android、Docker、CLI 三平台检查已分别通过。iOS 全部 33 项 XCTest 已通过；Intel Mac 更新及外部 Agent 安装的继承检查仍以 PR 中对应任务的最终状态为准。

新增浏览器回归同时验证：节点及插件详情路由选择正确的节点，关闭 AI 后节点不残留失效操作，后台配置刷新保留同一写作编辑器及输入。

## 合并前并发复核

原 PR 提交 `5fdc3f2` 的 19 项 CI 全部通过。进一步复核发现 MySQL 的普通快照读取可能晚于锁定读取却仍返回旧配置，导致停用后继续入队。已改为直接使用锁定读取返回的配置；新增普通加工、Agent 操作、Skills 操作三个真实 MySQL 并发回归，修复前全部复现，修复后隔离 MySQL 全部 127 项通过。这些回归纳入现有 `service-tests` CI。

## 可复核入口

- PR：<https://github.com/inspirai-store/InspiraiNest/pull/10>。
- `Plugin workspace` CI 运行共享构建和测试、Android 编译测试及 iOS XCTest。
- `Collector builds` 运行实际 Electron、Windows/macOS 打包及历史 GUI 回归。
- 本地证据位于忽略提交的 `artifacts/plugin-qa/` 和 `collector/test-output/`；临时隔离资料不写入现有用户库。

## 验收边界

源码迁移及本地验证不等同于各端真机、商店或生产发布验收。完整 CI 状态以 PR 当前提交的检查结果为准。项目管理、专项采集、自动化和语义知识探索仍属后续插件；本轮未新增其业务模型。
