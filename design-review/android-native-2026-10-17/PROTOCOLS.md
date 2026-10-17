# 协议与状态对照

跨端共享数据契约，SwiftUI 与 Compose 各自实现原生组件。以下样本只用于说明，不包含连接凭据。

## 记录正文

`document.version=1` 与服务端 `record-document.mjs` 一致。支持 paragraph、heading（1/2）、bulletList、orderedList、listItem、blockquote、hardBreak、attachment，以及 bold、italic、underline、strike、code、link。附件引用必须对应 attachments 中的标识；链接限 HTTP/HTTPS。未知格式只读，保留原始 JSON。

```json
{
  "version": 1,
  "doc": {
    "type": "doc",
    "content": [
      {"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"记录标题"}]},
      {"type":"paragraph","content":[{"type":"text","text":"保留原始内容","marks":[{"type":"bold"}]}]}
    ]
  }
}
```

富文本不经过 Markdown 往返。未改动时返回原始文档；编辑时保留嵌套列表、引用、段落与换行结构。Markdown 独立使用 commonmark 解析，代码与表格可横向滚动。

## 本机可靠状态

| 字段 | 语义 | 重试规则 |
| --- | --- | --- |
| id、server | 记录身份与所属资料空间 | 原样保留，按服务器隔离 |
| remoteVersion | 已确认远端版本 | 旧响应不能回退版本 |
| payload | 未确认 PUT 的完整请求 | 保留 requestId、baseVersion、正文与附件，不修改原请求 |
| nextEdit | 冻结请求之后的新编辑 | 原请求确认后，以新版本生成下一个请求 |
| editingDraft | 尚未提交的编辑草稿 | 不替换待确认正文，不由远端刷新覆盖 |
| pendingProcess | 加工请求和明确的记录版本 | 继续使用原 requestId，不能因确认丢失重新建任务 |
| processError | 加工提交的错误 | 与正文 sync 状态分开；已同步正文仍可阅读和编辑 |

新记录、附件索引和草稿先写 Room；媒体复制至本机私有目录并核对大小与 SHA-256。同步网络请求不占用本机编辑锁。记录上传确认必须匹配原 ID 和 baseVersion+1；加工确认后保存返回任务标识，原始正文与加工结果分别展示。

## 原生与既有能力

| 操作 | 复用协议 / 适配器 |
| --- | --- |
| 记录列表、版本冲突、加工 | `/api/records`、`/api/records/:id`、`/api/records/:id/process` |
| 原件上传、下载 | `/api/records/media/:sha256`；二进制传输、原哈希去重 |
| 采集待提交 | 原 Java Outbox，稳定 submissionId，原队列不迁移 |
| 阅读 | read/v1 entries、search、entry、content、file；完整分页兼容旧服务 |
| 阅读扩展 | GET read/v1/categories；sort=collected_desc/collected_asc/title；ids 为最多 1000 项的 JSON 数组 |
| 审核 | POST tasks/:id/approve 可传 draftId；服务端事务核对当前待审核摘要，旧空请求仍兼容 |
| 异步处理、实测报告 | 原 processing-center、tasks、trial-report、archives；保留源任务、源记录版本与 sourceArchiveId |
| 系统能力 | 原凭据安全存储、扫码、升级校验、系统安装器；页面脚本无法读取 token |

单文件 32 MiB、合计 128 MiB、最多 20 个。记录路径允许既有记录媒体协议；Agent 路径沿用文档、图片和音频解析范围，不把视频或通用文件当作支持解析的采集输入。

## 迁移边界

受限页面在原 `https://capture.local` 读取 IndexedDB；按原服务器 origin 读取收藏。只导出存储，不启动旧同步。Blob 分块传输，迁移日志按记录事务提交；中断可继续，原 WebView 数据保留。导入数量、大小和 SHA-256 核对完成后才允许原生同步。重新连接历史服务器时补做该 origin 的收藏导入。

测试样本位于 `NativeDataTest`、`NativeMigrationTest`、`NativeSyncTest` 和 `NativeUpgradeMigrationTest`，覆盖文档往返、服务器隔离、哈希失败、中断恢复、旧草稿标识、冻结请求与覆盖安装。报告跳转的 Android 交互验收使用专用 API 夹具；它验证原生页面关系，不代表新发起过一次真实 Codex 模型实测。
