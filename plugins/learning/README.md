# 新知

学习目标与人的掌握进度由新知持有；原文、附件、归档和执行作业沿用现有核心与 Worker。插件默认关闭，依赖 AI 助手，按资料空间启用。写作是可选交接，由宿主注入，不依赖写作插件内部代码。

## 使用

启用新知后，从导航进入。已有资料需要选取后提取；启用时建立旧资料基线，此后新增来源按版本增量提取。AI 候选经确认后创建目标或加入已有目标。路径、概念讲解与前沿更新均先保存为待审结果。

学习节点可编辑、调整顺序、设置先修关系和移除；移除的笔记与进度保留在历史节点中。掌握状态由用户选择，复述反馈、阅读和视频播放均不会代替用户确认。练习记录固定内容版本。并发修改使用目标 revision；跨资料空间的迟到请求与结果被客户端隔离。

教学任务包为 ZIP，含 TASK.md、learning-handoff.json 和选定来源快照。视频与 Web 演示使用同一交接协议，首版由用户交给 Claude Code 或其他工具执行。导入文件先保存为核心媒体，再关联 handoffId、nodeId 和冻结版本。HTML 演示使用不带应用桥接的隔离页面；临时预览票据绑定授权设备，5 分钟到期，撤销设备后不可用。服务端与 iframe 同时施加 sandbox；演示不能访问应用数据或联网。

博客交接只使用选定节点的讲解与引用；个人笔记、教学附件由用户选择包含。原始 JD 与聊天不会自动进入稿件。重复交接固定内容返回同一草稿任务，不发布文章。

iOS 与 Android 提供目标收集、候选确认、阶段阅读、练习、笔记、掌握状态和视频/HTML 成果预览。桌面与 Web 管理完整路径和教学交接。

### 卡片与按需输入

首页展示目标卡片、进度和下一节点；通过“添加材料”选择资料、文件或粘贴内容，来源支持搜索、多选和分批显示。标题沿用来源或文件名称，补充说明按需展开。候选默认只读，建立目标、加入已有目标和忽略都通过按钮完成，主动修改才打开编辑器。

路径按阶段组织节点卡片，节点分为概念、练习、笔记和成果。复述与笔记在点击“开始回答”“记下理解”后编辑；取消不改写已保存内容。四种掌握状态由用户主动选择。管理操作收进“更多”；桌面/Web 的视频、Web 演示和博客交接采用动作卡片。原生端继续使用现有原生入口，直接读取已冻结的来源正文。

## API

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/learning` | 目标及候选 |
| GET | `/api/learning/sources` | 当前可选来源及版本 |
| POST | `/api/learning/intake` | 保存原始输入并提取候选，或处理选定 sourceKeys |
| POST | `/api/learning/candidates/:id` | confirm、ignore；可携带 goalId 加入已有目标 |
| POST | `/api/learning/goals` | 创建目标 |
| GET | `/api/learning/goals/:id` | 路径、进度、练习、待审结果、成果与作业 |
| POST | `/api/learning/goals/:id/edit` | 目标及路径编辑 |
| POST | `/api/learning/goals/:id/progress` | 节点掌握状态或笔记 |
| POST | `/api/learning/goals/:id/attempts` | 保存复述/练习并排队反馈 |
| POST | `/api/learning/goals/:id/assist` | path、lesson、frontier |
| POST | `/api/learning/goals/:id/apply` | 审阅结果的应用或拒绝 |
| POST | `/api/learning/goals/:id/teaching` | 冻结教学包 |
| POST | `/api/learning/goals/:id/artifacts` | 关联已上传核心媒体 |
| GET | `/api/learning/artifacts/:id` | 校验成果及临时演示地址 |
| POST | `/api/learning/goals/:id/writing` | 创建或取得同一版本的博客草稿任务 |
| POST | `/api/learning/runs/:taskId/result` | Worker 使用当前分配令牌提交结果 |

目标修改必须携带当前 revision。Worker 心跳声明 learningProtocol:1；旧 Worker 不领取学习作业。原始文件或链接需要先由现有采集流水线读取，部分来源保留 partial，不根据文件名或摘要伪造全文理解。

## 本地验收与首次导入

```sh
npm run build:all
node tooling/learning/review-server.mjs --handbook /absolute/path/handbook.md --jd /absolute/path/jd.txt
```

验收服务仅监听本机，数据与连接凭据保存于忽略的 artifacts/learning/local-review，不接入生产。打开命令返回的 workbench URL，在本地登录页使用 connection.json 中的临时 key。手册与 JD 作为核心记录保存快照，再关联 AI 基础软件架构师路径；重复导入保留已有进度。个人材料不打包进源码。

向已明确选择的资料空间导入时，可提供含 origin/token 的本地连接文件：

```sh
node tooling/learning/import-starter.mjs --connection /absolute/path/connection.json --handbook /absolute/path/handbook.md
```

验证命令：`npm test`、`npm run build:all`、`npm run build:native-assets`，以及现有 Android Gradle 与 iOS XcodeGen/XCTest 流程。构建、GUI、签名、真机和发布分别验收。

卡片交互的独立验收服务：`node tooling/learning/cards-review-server.mjs`。它创建临时空间、15 节点路径、两份示例快照和 234 条来源卡片，不连接生产；临时登录信息只保存在忽略的 `artifacts/learning/cards/review-connection.json`。iOS `LearningTests` 检查来源兼容、默认无空编辑器和手机/平板布局；Android `NativeComposeFlowTest#learningCardsKeepWritingOptionalAndPreserveSnapshots` 验证来源阅读、按需笔记、取消和用户确认掌握。签名发行包、真机和 Beta 分发仍需单独验收。
