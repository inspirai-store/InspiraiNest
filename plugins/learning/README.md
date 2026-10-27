# 新知

学习目标与人的掌握进度由新知持有；原文、附件、归档和执行作业沿用现有核心与 Worker。插件默认关闭，依赖 AI 助手，按资料空间启用。写作是可选交接，由宿主注入，不依赖写作插件内部代码。

## 使用

启用新知后，从导航进入。已有资料需要选取后提取；启用时建立旧资料基线，此后新增来源按版本增量提取。AI 候选经确认后创建目标或加入已有目标。路径、概念讲解与前沿更新均先保存为待审结果。

学习节点可编辑、调整顺序、设置先修关系和移除；移除的笔记与进度保留在历史节点中。掌握状态由用户选择，复述反馈、阅读和视频播放均不会代替用户确认。练习记录固定内容版本。并发修改使用目标 revision；跨资料空间的迟到请求与结果被客户端隔离。

## 个人学习

首页使用目标卡片，路径按阶段组织。进入节点直接阅读完整学习内容，包含原理、具体算例、动手步骤和适用边界。7 阶段、15 节点的内置课程从张量与 Attention 展开，覆盖推理、单卡、编译、分布式、后训练和适配。内容维护与技术核验见 CONTENT.md，不在阅读页面展示来源快照、引用目录、教学成果或制作/博客交接。

节点只有“内容、练习、笔记”三个面板。回答和笔记主动点击才展开；保存回答不启动 AI 作业，按需选择“AI 帮我看看”。学习状态由用户自己选择，进入下一节不需要做题或标记掌握。原生端复用原生 Markdown 解析器显示标题、列表和代码。

添加材料继续支持资料卡片、文件和粘贴；名称复用已有信息。来源版本内部保留，候选卡片直接展示学习目标与内容。旧版导入的内置概述在首次打开时补全为课程正文，只替换精确匹配的未修改文本，旧正文保留在修订记录；路径、笔记和进度不变。不新增集合，不删除历史来源或附件。历史教学/写作接口仅保留协议兼容，不再出现在新知 UI。

## 动态图解

内置课程有一张整体全貌图和 15 个节点图解，共 64 步。用 token、缓存块、矩阵、依赖图和时间线解释过程；支持逐步查看、自动播放/暂停、重看，以及按钮切换参数。KV Cache 的重算/复用/历史读取/容量计算相互对应，其他课程也各自对应具体原理与算例。完整讲解仍可展开，图解不改变掌握状态。

桌面/Web 在节点内容中加载隔离 iframe。Web 使用独立脚本与样式，遵循宿主原有的 CSP；桌面 file 协议加载自包含离线页面。原生端将相同的离线图解放入 native-v1 节点页；没有应用桥接、凭据或外部请求。原生容器只把自身高度传给 CSS，处理内嵌 WebView 的视口尺寸。

接口只为精确匹配的内置正文计算可选 visualLessonId，不新增业务集合。用户改写的内容保留文字阅读，不关联不匹配的图解；不含内置课程的目标没有全景图入口。

```sh
npm run build:all
npm run build:native-assets
node tooling/learning/stage-visuals.mjs --check
node tooling/learning/preview-visuals.mjs
```

预览仅监听本机，支持离线保存；不会读取真实资料空间。生成的 iOS LearningVisuals 与 Android learning-visuals 资源由构建脚本维护，不回退到旧工作台。服务/图解测试检查数值语义、版本匹配和资源隔离；原生测试实际加载 Web 内容、断言画布尺寸并切换 KV 容量。GUI 与分发分别记录。

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
| POST | `/api/learning/goals/:id/attempts` | 保存复述/练习；新客户端使用 feedback:false，不排队反馈 |
| POST | `/api/learning/goals/:id/feedback` | 用户按需请求已有回答的 AI 反馈 |
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

卡片交互的独立验收服务：`node tooling/learning/cards-review-server.mjs`。它创建临时空间、15 节点路径、两份示例快照和 234 条来源卡片，不连接生产；临时登录信息只保存在忽略的 `artifacts/learning/cards/review-connection.json`。iOS `LearningTests` 检查来源兼容、默认无空编辑器和手机/平板布局；Android `NativeComposeFlowTest#learningCardsKeepWritingOptionalAndPreserveSnapshots` 验证正文阅读、隐藏来源与成果、按需笔记、取消和用户确认掌握。签名发行包、真机和 Beta 分发仍需单独验收。
