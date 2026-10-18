# 条目模板

新条目使用 [通用摘要](summary.md)；有用户场景时补充 [场景分析](scenario.md)。模板中的占位内容需替换，不适用的小节直接删除。

复制 [source.template.json](source.template.json) 到资料目录并命名 `source.json`，填入真实信息。JSON 使用 UTF-8，未知字段保持 null，不使用虚构值补齐。

`type` 可取 `video`、`article`、`webpage`、`document`、`repository`、`audio`、`image`、`note`、`other`；各自对应根目录规则见 [AGENTS.md](../AGENTS.md)。`id` 是全库唯一且稳定的字符串，`related` 使用这些 ID。

`files` 按实际已保存内容填写，例如：

```json
[
  {"role": "summary", "path": "summary.md"},
  {"role": "source", "path": "source/article.md"},
  {"role": "image", "path": "source/images"},
  {"role": "scenario", "path": "scenarios/2026-09-16-local-workflow.md"}
]
```

新条目的 `collected_at` 必须填写实际采集时刻，精确到秒且带时区，例如 `2026-09-20T14:35:27+08:00`；可在采集当时运行 `node scripts/catalog.mjs now` 取得。后续补充分析、刷新索引不改写原采集时间。仅历史条目允许保留已有的 `YYYY-MM-DD`；没有可靠日志就不补造时分秒。其他日期字段可用 `YYYY-MM-DD` 或带时区的 ISO 时间；未知为 null。`archived` 条目至少登记一个 `summary` 或 `analysis` 角色的报告。`partial`、`pending` 条目必须说明缺失内容。

元数据中的 `summary` 是索引预览；详细摘要写在 Markdown 文件中。`source_url` 保留用户提供的链接，`canonical_url` 只填已确认的规范链接，`aliases` 保存其他已确认同源链接。
