# Collector

See [installation and configuration](../docs/SELF_HOSTING.md), [security boundaries](../SECURITY.md), [rights decisions](../docs/RIGHTS.md) and [third-party notices](../docs/THIRD_PARTY.md).

Owner credential changes and authenticator binding are available at `/security`.
See [account security](docs/ACCOUNT_SECURITY.md) for persistence, recovery codes,
MFA-compatible pairing and deployment requirements.

With Node.js 24+, run `npm ci --ignore-scripts`, `npm test`, then `npm start` here. The service listens on loopback and initializes local storage; it does not connect to any preconfigured production infrastructure. Worker execution is separate and requires explicit pairing and local Agent configuration.

macOS Worker: click the menu-bar icon to toggle its status panel. Closing the manager hides the Dock icon while the Worker stays available; quit waits for active work and synchronization to finish.

Offline nodes: use “删除节点” in the desktop node detail or Web node panel. `POST /api/devices/:id/remove-node` rechecks the heartbeat and rejects online nodes, the current client's own node, and nodes with queued, running, waiting or failed work. Removal revokes the node's authorization while retaining its record and historical tasks/archives. Uploaded results awaiting review remain reviewable.

## Agent 技能管理

在 Web 的工作节点卡片或桌面的工作节点详情中打开“节点技能”。移动端在设备详情中查看清单与依赖缺口。

- 盘点 Codex、CodeBuddy、Claude Code 的当前用户、明确指定的项目和已配置插件。Codex 使用原生 `skills/list`；目录回退及无法确认的内置来源显示未确认。扫描不执行 Skill 脚本、Hooks 或模型任务。
- 选源技能并预览全部可发布文件，填写能力标签、依赖、系统和 Agent 范围后发布私有不可变版本。插件、MCP、程序和登录状态不随包迁移。
- 选择私有版本和目标 Agent，比较后确认，再同步到全局目录。共享目录须包含并确认全部受影响 Agent。操作在 Worker 空闲时执行；本地修改、链接变化或不兼容均阻止覆盖。同步有备份和中断恢复，可从成功同步记录回滚。
- 安装后仍显示未验证。填写公开公众号样例及正文末段片段，选择实际执行 Agent 验证。只有版本、执行配置和验证证据一致且依赖就绪的节点才参与专用能力优先派发；没有匹配时继续通用采集。已执行任务保留原机器、Agent 和固定技能快照。

[接口、实现与验收记录](docs/agent-skills.md)。[可移植公众号示例 Skill](examples/skills/lingnest-wechat-archive/SKILL.md)。

## 技能市场

桌面客户端及 Web 管理端的“技能市场”接入 [腾讯 SkillHub 官方 API](https://github.com/Tencent/skillhub/blob/main/docs/api/README.md)，支持关键词、动态分类、来源、排序、分页及技能详情。桌面检索不要求连接资料库；Web 接口 `GET /api/skillhub` 需要管理端授权。搜索不执行 Skill。

桌面主进程直接读取 `https://api.skillhub.cn` 的公开元数据，Web 通过服务端代理读取。可选的 `SKILLHUB_API_KEY` 只在服务端配置。资料库密码、设备令牌、Cookie、清单与本地文件不发送给 SkillHub。请求限制为官方搜索、分类及详情接口，禁止凭据重定向，设置超时、响应大小上限及有界短期缓存。

运行 `node --test test/skillhub.test.mjs`、`node scripts/test-skill-market.cjs` 和 `node scripts/test-skill-market.cjs --web` 验证接口及共享界面。
