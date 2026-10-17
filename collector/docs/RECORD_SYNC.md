# 记录同步 v1

实现范围：记录的新增、编辑、删除和恢复。现有任务、写作、媒体上传、设备凭据与队列协议保持兼容。服务端已先行部署，电脑客户端 0.2.13 与 Android 1.4.1 / versionCode 22 已发布。正式文件、生产核验和设备验收边界见 [发布记录](../../docs/releases/2026-10-17-record-sync-0.2.13.md)。

## 数据与界面

页面从本机数据库读取。保存先落盘，后台同步不阻塞离开编辑页。单条记录的 `synced` 显示为“已上传”；资料空间最近检查时间独立保存。正常列表排除墓碑，墓碑不会被普通缓存清理删除。

收到远端删除时，本机尚未上传的正文、富文本、附件和当前编辑内容存入关联原 ID 的 `recoveryDrafts`。原不可变 payload/requestId 留在 `cancelledPayload`，加工请求留在 `cancelledProcess`，停止自动发送。恢复原记录只采用云端恢复的正文；旧修改继续留在恢复草稿，不能隐式覆盖恢复后的记录。

只有明确选择“另存记录”才分配新 ID。新记录、下一草稿、对应恢复草稿的消费在同一本机事务中完成。多份恢复版本只消费选中的内容，其他版本继续保留。

## HTTP 协议

- `GET /api/records/capabilities` 可选增加 `recordSyncProtocol: 1`。
- `GET /api/records/changes?cursor=<opaque>&wait=25&limit=200`；wait 为 0–25 秒，limit 为 1–200。
- 游标为空、格式错误、所属 epoch 不符或超出当前序号时，返回完整一致快照。
- 旧的读取、写入和回收站接口不变。`baseVersion`、`trashVersion`、不可变 `requestId` 沿用原规则。

快照：

```json
{"protocol":1,"mode":"snapshot","records":[],"deleted":[],"cursor":"<epoch>:42","hasMore":false,"checkedAt":"<ISO8601>"}
```

增量：

```json
{"protocol":1,"mode":"delta","changes":[{"id":"0000000000000043","seq":43,"record":{"id":"<record UUID>","version":2,"trashVersion":1,"deletedAt":"<ISO8601>"}}],"cursor":"<epoch>:43","hasMore":false,"checkedAt":"<ISO8601>"}
```

增量 record 是该次事务的冻结完整记录；快照 deleted 只包含 ID、内容版本和删除状态版本。任务投影按读取时的现有任务规则补齐，不另定义任务同步协议。客户端每 30 秒再取一致快照补漏，同时刷新任务投影。

服务实例现有的一套个人资料空间对应一个序列；鉴权边界与原记录 API 相同。未来若服务增加独立租户，序列、日志与所有记录键必须同时增加租户维度，不能仅在页面筛选。

## 事务与排序

`record-sync-state` 持久保存 epoch/seq。每次记录修改或删除、恢复，先锁状态行，再锁记录；内容、历史、幂等回执和 `record-change` 日志在同一事务提交。状态行初始化使用幂等插入。SQLite 用现有事务串行锁，MySQL 用 InnoDB 行锁。

快照在同一状态锁下读取记录并确定起始游标。长轮询不持锁等待，最长每秒检查一次持久日志，并在返回前重新验证授权；撤销设备不会取得等待期间的正文。日志及墓碑本轮不自动清理。

客户端同事务应用一页变化及游标；失败则全部回滚。相同页面可重放，游标不得回退。内容版本与删除状态版本分别比较：更高 version 不能推翻更高 trashVersion；只有明确恢复产生的新 trashVersion 可以重新显示。晚到上传回执也必须核对当前删除版本。

## 调度与组件

- 桌面 `records/data/coordinator.ts` 管理前台、联网、焦点、重试；`RecordsService` 合并数据和上传队列；`AccountRecordStore` 隔离服务器与授权设备。
- Android `RecordSyncClient` 负责协议、分页和 Room 事务；`AndroidNestRepository` 复用同一记录合并锁与上传锁。保存信号触发前台同步，QueueJob 保留后台调度。删除/恢复请求先写 migration journal，确认丢失后重放原请求。
- Web 和主线现有 iOS 记录页共用 `capture/record-sync.js`；共享资源通过 `stage-capture.mjs` 打包。宿主保持凭据，桥接只增加受限的变化读取和回收站路由。
- 主线 iOS 仍是 Capture WebView，未包含用户 Mac 上的新版 SwiftUI 原生记录存储。新版原生 iOS 需要对应源提交后接入，不能把共享资源更新当作新版原生端完成。

一轮为拉取→核对并上传→补拉确认；每个本机资料空间合并串行，网络等待不占用本机编辑事务。前台使用长轮询，30 秒快照补漏；旧服务端降级为 15 秒完整同步，每 5 分钟重新探测增量能力。401 停止前台自动请求，普通网络错误退避上限 30 秒。后台按平台调度，回到前台立即追平；3 秒目标只适用于双方前台在线。

## 验证入口

```text
npm --prefix collector test
npm --prefix collector/desktop/frontend run test:records
npm --prefix collector/desktop/frontend run build
node collector/desktop/frontend/scripts/check-record-sync-ui.mjs
cd collector/mobile/android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest
```

桌面 UI 验收脚本只创建临时 Electron profile 和本地服务；证据位于 `.runtime/record-sync-qa`。Android `NativeRecordSyncFlowTest` 验证真实 Compose 编辑器与 Room 合并边界，必须在独立模拟器运行，不使用手机资料。协议测试覆盖事务回滚、重复页、乱序响应、删除/恢复、未确认上传、授权撤销与跨账号迟到响应。

MySQL 跨实例锁行为需要 `CAPTURE_MYSQL_TEST=1` 和专用测试库；无测试库时不能把 SQLite 通过等同于 MySQL 实测。Swift 编译、真机后台行为、生产网络传播时延与正式升级仍须单独验收。

## 已有富文本写入与冲突约束（继续有效）

### 协议与写入约束

- 写入排版前，先通过已授权的 `GET /api/records/capabilities` 确认 `protocol: 1` 和 `documentVersions: [1]`。404/405 或不支持的能力表示服务端待升级；断网、服务不可用和授权失败分别保留原错误类型。
- `PUT /api/records/:id` 保留 `baseVersion` 和 `requestId`。完整请求先写入当前账号的本机队列，响应丢失或重启后使用相同请求重试。不得只替换请求编号或基准版本来绕过冲突。
- 服务端校验并保存 `text`、`document` 和已授权的附件引用，成功回执返回实际保存内容。相同请求返回原成功回执；复用编号提交不同内容会拒绝。
- 旧客户端更新已有排版的记录却未提交文档时，服务端拒绝写入，避免静默删除排版。
- 主进程限定记录接口并持有授权；渲染页不取得令牌，也不获得任意 URL 请求能力。比较、队列及恢复副本均按服务地址和账号设备隔离。

| 错误码 | 含义 |
|---|---|
| `record_version_conflict` | 写入基准版本已经变化，需要比较内容 |
| `record_request_reused` | 相同请求编号对应不同内容 |
| `record_document_required` | 已有排版，旧客户端未提供完整文档 |
| `record_media_missing` / `record_media_type_mismatch` | 附件引用缺失或类型不符 |
| `record_protocol_incompatible` | 客户端确认服务端尚不支持排版协议 |
| `record_network_error` / `record_service_unavailable` | 网络不可达或服务暂不可用 |
| `record_ack_mismatch` | 成功回执的版本、内容或排版与提交不一致 |

只有明确的内容冲突进入比较界面。兼容旧版无错误码的 409 时，客户端还会读取云端记录，核实版本确实不同。

### 自动比较与人工确认

以编辑前快照为基线进行三方比较：双方相同则直接确认；只有云端变化则保存本机恢复副本后采用云端；只有本机变化则保存副本并更新基线后条件写入。缺少可靠基线或双方均有不同修改时，保留本机内容，交由用户确认。

比较窗口提供本机与云端正文、附件、版本和修改时间，以及“合并编辑”“使用云端”“使用本机”“另存副本”。确认前重新读取云端；若云端再次变化，旧确认失效并要求重新比较。手工合并保留相同记录 ID，并保护已有未保存草稿。

任何替换前，把本机内容、原请求和已看到的云端快照持久化到该记录的 `backups`。这些恢复副本没有独立历史浏览界面；不能将其描述为已提供完整恢复管理功能。

### 旧成功回执缺失排版

服务器升级不会重写已经成功的请求回执。客户端必须先重放原请求并核对回执，再读取最新云端记录。仅当云端仍是该回执版本，正文和附件与原提交一致且排版缺失时，才保存恢复副本，持久化一个新的修复请求，向同一记录补交完整排版。

一次同步最多尝试两次记录写入；修复标记随队列持久化，避免失败时无限生成新请求。若云端已有不同内容则进入比较；本机缺失排版时不能从纯文本推测恢复。

### 发布与核验

先部署支持排版的服务端，再发布同批 Windows、macOS 客户端。客户端发布失败时保留兼容服务端；撤回下载清单时优先回滚到仍支持排版的服务端镜像。回滚到更早服务端会使新客户端停止富文本写入并显示升级提示。

验收需覆盖：新旧服务端、旧客户端修改富文本、响应丢失与重启、旧回执修复、同内容不同版本、单端与双端修改、确认期间再次修改、附件和账号隔离。真实记录恢复还要比较正文和文档哈希、原历史回执、记录 ID、重启后的版本，不能只根据 HTTP 成功判断完成。
