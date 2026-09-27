# CLI 参考

所有命令支持 `--server https://library.example.com`；不同地址的授权独立保存。`--json` 用于机器读取，stdout 为结构化结果、stderr 为诊断。终端普通输出适合直接查阅。

```sh
lingnest auth login
lingnest auth status --json
lingnest list --type article --limit 20 --offset 0 --json
lingnest search "角色卡 世界书" --json
lingnest show "video:BVexample" --json
lingnest read "video:BVexample" --file transcript.txt --start-line 1 --max-lines 200 --json
lingnest read "video:BVexample" --file transcript.txt --start-line 201 --json
lingnest download "video:BVexample" --file source/article.pdf --output article.pdf
lingnest open "video:BVexample"
lingnest auth logout
```

示例 ID、文件名需要替换为实际返回值。`read` 省略 `--file` 优先摘要。文本响应含实际起止行、`next_line`、`next_column`；若 `next_column` 非零，下一次带 `--start-column`，避免长行遗漏。优先按响应位置续读，不自己估算。

`list` 和 `search` 支持 `--type`、`--tag`、`--status`、`--from`、`--to`、`--limit`、`--offset`。日期筛选是采集日期。默认每页 20 条，最多 100 条。正文默认 200 行，最多 1,000 行，单次最多 64 KiB。

搜索响应的 `items` 为条目及命中片段，`index` 表明全文索引覆盖情况；`show` 返回文件清单、`archive_id`、关联资料和遗漏说明。附件下载校验 SHA-256，默认拒绝覆盖已有文件。

浏览器打开资料使用浏览器自己的登录，CLI 不把令牌塞进 URL。Linux 需要可用的 Secret Service；无安全存储时 CLI 明确报错，不能通过写明文 token 绕过。

系统安全存储绑定执行账户／会话。某些 Windows AI 沙箱使用另一账户，可能返回 `not_logged_in` 或 `keyring_write_failed`。使用工具提供的、用户允许的同账户执行方式；没有该方式时说明环境限制并停止，不复制主账户令牌、不调整全局沙箱权限。终端调用权限由 AI 工具管理，skill 本身不授予执行权限。
