# 原生组件规范

## 设计角色

| 角色 | 日间 | 夜间 | 使用方式 |
| --- | --- | --- | --- |
| 页面背景 | #F6F5F1 | #161615 | 一级、详情与阅读共用 |
| 表面 | #FFFFFF | #232321 | 面板、输入框和菜单 |
| 主要按钮 | #B45309 + 白字 | #F2A33A + 深色字 | 每页当前主要操作 |
| 小字强调 | #A85705 | #F2A33A | 状态与文字操作 |
| 圆角 | 12dp 控件 / 16dp 面板 | 同日间 | 由主题统一定义 |
| 正文 | 18sp / 30sp | 同日间 | 尊重系统字体缩放，阅读列宽上限 720dp |

`NestTheme` 定义完整 Material 颜色角色，包含 navigation、surface、secondaryContainer 等；页面不通过反色模拟夜间。图片、PDF 保留原始色彩。图标使用透明背景线性矢量，品牌启动图标保留。

## 可复用边界

| 组件 | 输入 | 行为归属 |
| --- | --- | --- |
| NestPageHeader | 标题、操作插槽 | 页面决定动作，组件统一字号与触控区 |
| NestSearch | 值、占位、回调 | 页面模型处理请求、去抖与过期响应 |
| DetailScaffold | 返回、操作、底部插槽 | 宿主统一返回栈与窗口 Insets |
| OptionMenu | 当前值、选项、回调 | 不直接访问 API |
| AttachmentRow | 文件元数据、打开回调 | 平台层处理下载、校验、预览与系统保存 |
| ErrorState / EmptyState | 状态、下一步回调 | 不依靠 Toast 表达持久失败 |
| MarkdownBlock | commonmark 节点 | 原生文本、代码、引用、表格和图片插槽 |
| RecordDocument / RecordCodec | document.version=1 | JSON 与 Markdown 分开解析，共用排版角色 |
| RecordMicrophone | 记录标识、附件回调 | 平台层保存录音片段和恢复侧车文件 |

页面只组织组件和事件。业务模型输出 StateFlow；Repository 接口集中管理协议和持久化，测试可注入内存 Room 与传输夹具。单个构建模块内按 design、content、feature、data 分包，平台能力由 Activity、Java 核心及适配器承担。

## 导航与更新

手机一级四栏，默认资料库；详情隐藏底栏。600–839dp 使用导航栏，840dp 起并列列表与详情。SaveableStateProvider 保留每个页面的搜索、筛选和列表位置。后台刷新只替换状态，错误响应不能将新版本退回旧版本；弹窗、菜单和编辑输入不由轮询重建。

记录先写本机，再进入同步。网络请求不持有本机编辑锁。未确认写入冻结 payload 和 requestId，后续编辑作为 nextEdit 排队；草稿独立为 editingDraft。同步状态与加工请求分别保存，审核必须对应当前 draftId。

## 测试入口

Debug「我的 → 组件」提供控件与异常状态展示，不创建正式资料。JVM 测试覆盖文档往返、服务器隔离、迁移恢复、确认丢失与导航；androidTest 使用专用夹具检查真实 Compose、WebView 存储迁移和系统分享边界。夹具数据只在测试源码中，正式包无演示开关。
