# 记录同步 v1 验收记录

日期：2026-10-17。参考主线：`inspirai-store/InspiraiNest`，提交 `db48c97a51b5067e8b24c1c42a4b42158c6e31e3`。本次进入发布验证：电脑客户端 0.2.13、Android 1.4.1 / versionCode 22；正式产物、生产核验及验收边界将在发布记录中补充。

## 实现范围

- 服务端：兼容能力接口、持久化变化日志、游标分页、25 秒长轮询、一致快照，记录修改/删除/恢复与日志同事务提交。
- 桌面：统一前台同步协调器、30 秒快照补漏、旧服务 15 秒降级、版本保护、恢复草稿、记录同步入口。
- Android：Room 合并与游标同事务落盘，前台长轮询与保存信号，删除/恢复请求持久化，原生编辑器和回收站接入。
- Web 与主线现有 iOS Capture 记录页：共用同步引擎与恢复草稿，宿主继续保管凭据。

原记录 ID、不可变请求 payload/requestId、富文本和附件保留。远端删除不会分配新记录 ID；只有用户选择“另存记录”才建立副本。不同删除轮次的恢复草稿分别保留。迟到上传确认不能覆盖删除或明确恢复后的正文。

## 自动测试与构建

| 检查 | 结果与边界 |
|---|---|
| 服务端完整 Node 测试 | 333 项：314 通过，19 跳过，0 失败。包含变化日志事务回滚、分页、并发序号、撤销授权期间的长轮询。 |
| 桌面记录与共享引擎 | 31/31 通过；同一契约样本覆盖桌面、Web 和 Android。包含编辑/删除相遇、旧确认、账号切换、游标回滚与重复页、重复删除后的恢复草稿。 |
| 桌面前端 | TypeScript 与生产构建通过；构建仍有现有 PostCSS 与大包体积提示。 |
| Android 原生定向单测 | 22/22 通过，其中同步 9 项。 |
| Android 完整单测 | 66 项：65 通过，1 项既有失败，不能标记全绿：`MobileTest.codexTrialIsOptInAndItsSelectionIsFrozenInDurableSubmission`，第 49 行 `persisted.has("trialEnabled")`。 |
| 既有失败对照 | 从相同 HEAD 的 `git archive` 创建独立 Android 源目录，只补齐打包所需的现有 writing 资源；同一测试在同一断言失败。未修改或跳过该测试。证据：`.runtime/record-sync-qa/android-baseline.json`。 |
| Android 构建与 Lint | Debug APK、测试 APK 与 Lint 通过（0 错误、13 警告）；APK 内同步资源 SHA-256 与共享源文件一致；不代表正式签名覆盖安装已验收。 |
| 现有 iOS 脚本契约检查 | 7 项中 5 通过，2 项在 HEAD 即不满足：旧文本接口源码断言及已有 `UIApplication.shared` 检查。对照证据：`ios-contract-baseline.json`。 |

服务端日志：`.runtime/record-sync-qa/server-tests.log`。桌面日志：`desktop-tests.log`、`desktop-build.log`。Android 日志：`android-native-validation.log`、`android-final-validation.log`、`android-baseline-test.log`。

## 实际界面验证

桌面和共享页面使用临时 Electron profile、临时本地 REST 服务和测试身份；没有读取已安装客户端身份，没有修改生产记录。

- 桌面：实际前台 watcher 接收远端删除，测得约 0.93 秒。搜索内容、列表滚动位置、焦点保持不变。编辑器文字保留；明确另存后只出现一条新记录，原 ID 保持删除。
- Web/现有 iOS 共享页面：测得约 0.85 秒。正文、选区和焦点保持；删除后继续输入仍落盘，先前删除留下的恢复草稿仍可用，另存只创建一份副本。
- Android：独立只读模拟器 `emulator-5588`，实际 Compose 编辑器与 Room。验证输入中收到删除后正文保留，原记录从列表隐藏，明确另存后新建一条并进入新记录详情。最终实跑 `OK (1 test)`，没有操作连接的手机。

以上延迟只代表本机服务上的前台验收，不代表生产网络或手机后台时效。证据保存在 `.runtime/record-sync-qa/desktop.json`、`capture.json` 与对应 `*-recovery.png`。

## 尚未覆盖

- 最新原生 SwiftUI iOS 记录存储不在当前 `origin/main` 中。当前接入的是主线已有 Capture 页面，不能据此声称新版原生 iOS 完成；Windows 未编译 Swift。
- 无专用 MySQL 测试库，未验证真实 InnoDB 跨服务实例的锁和提交行为。相关测试跳过，不以 SQLite 结果代替。
- 手机后台调度、长时间离线真机、正式同签名升级与生产传播时延仍需验收。

完整协议及兼容规则见 [RECORD_SYNC.md](RECORD_SYNC.md)。

临时基线目录 `.runtime/record-sync-qa/android-baseline` 的清理被执行策略拒绝（只返回 `blocked by policy`），已保留。测试日志与对照 JSON 不依赖删除该目录。
