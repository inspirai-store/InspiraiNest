# Agent 技能盘点与私有同步

## 技能市场与安装位置（0.1.26）

网页与桌面的“技能市场”提供 SkillHub、灵藏技能库和已安装三个入口。灵藏技能库复用当前服务端的私有版本和对象存储，只有已授权客户端能读取、预览和安装，不额外创建公网服务。节点技能中的“预览发布版本”继续用于将完整本机技能发布到远端；市场导入的版本也能在其他节点复用。

| Agent | 新安装方案 | 其他盘点位置 | 加载确认 |
| --- | --- | --- | --- |
| Codex | 当前用户 `~/.agents/skills/<name>` | 项目 `.agents/skills`、`CODEX_HOME/skills` 兼容目录、插件、系统目录 | 原生 `skills/list`；目录存在不等于已加载 |
| CodeBuddy | 当前用户 `~/.codebuddy/skills/<name>` | 项目 `.codebuddy/skills`、插件 | 目录与配置已确认；新会话实际加载需单独核对 |
| Claude Code | 当前用户 `~/.claude/skills/<name>` | 项目 `.claude/skills`、插件、企业配置 | 目录与配置已确认；新会话实际加载需单独核对 |

用户先选择节点及 Agent，再预览完整文件、目标绝对路径、共享目录和同名文件差异。确认后沿用原子同步、备份和回滚机制；节点须在线且空闲才能执行。旧节点未上报实际安装路径时提示升级，不能凭方案路径假装已确认安装位置。安装不执行包内脚本，也不自动重启其他 Agent 会话。

“已安装”支持技能名称或路径、节点和 Agent 筛选，按 40 个安装位置分页。每行分别展示逻辑目录、符号链接指向的实际目录、作用域、市场来源、固定版本、安装状态、加载状态及依赖状态；离线节点明确显示最后盘点时间。相同名称在不同 Agent、目录、项目或插件中保留独立记录。整个客户端撤销授权后不再展示其清单或允许安装。

新增限定接口：`GET /api/skills/market?provider=skillhub|lingnest&kind=search|categories|detail`、`POST /api/skills/market/import`、`GET /api/skills/installed`。导入必须固定 SkillHub 版本及幂等 requestId；只从核对过的官方 API 和分发域名下载，库授权不会发给 SkillHub。导入预览返回文件哈希和技能 Markdown；同一 requestId 超时重试不会重复下载或创建版本。安装继续使用 compare/sync 操作，响应丢失时重试复用同一操作标识。

下载 ZIP 在内存逐项读取并验证 CRC、大小、文件类型和路径，然后通过现有完整包及 SHA-256 校验；拒绝越界、符号链接、重复文件、疑似凭据、缺失引用和不支持的文件。第三方技能未声明依赖时保持“依赖待确认”；市场下载安装不等于验证了 Agent 适配或实际提取能力。

目录规则核对于 2026-10-08：[Codex](https://developers.openai.com/codex/skills)、[CodeBuddy](https://www.codebuddy.ai/docs/cli/skills)、[Claude Code](https://code.claude.com/docs/en/skills)。SkillHub 当前下载与私有库安装均有独立测试；真实账户的 CodeBuddy/Claude 原生执行验收继续遵守下文边界。

## 协议与边界

所有接口沿用当前资料库设备授权。管理端发起操作和读取清单；Worker 只上传自己的清单和回执。旧客户端的 `agents`、`capabilities` 保留，未上报环境时显示“未上报”。Claude 只盘点与同步，不加入采集执行候选。

| 接口 | 用途 |
| --- | --- |
| `POST /api/skills/environment` | schemaVersion=1；按 snapshotId 顺序提交最多 40 条一页，末页原子提交 |
| `GET /api/skills/devices/:id/environment` | offset、snapshotId 分页读取；变化返回 409 |
| `GET /api/skills/versions` | 私有版本摘要 |
| `GET /api/skills/versions/:hash[/package]` | 版本详情及完整校验包 |
| `POST /api/skills/operations` | requestId 幂等创建限定操作 |
| `GET /api/skills/operations[/:id]` | 管理端历史／状态，Worker 自身待执行操作 |
| `POST /api/skills/operations/:id/result` | 当前设备回执；重复终态回执返回原结果 |

操作只有 refresh、configure-projects、prepare-publish、publish、compare、sync、verify、rollback。服务端不接收或发送任意 Shell 指令。发布必须引用成功预览；同步必须引用兼容比较及目标哈希；回滚必须引用成功同步。凭据撤销后的回执不能提交。

私有版本以完整文件清单哈希及明确策略形成版本 ID，包存入现有 OSS／本地存储适配器的 `private/skills/`，不暴露为公开下载链接。包最多 16 MiB，拒绝越界／缺失引用、内部符号链接、不支持的文件和疑似凭据；排除缓存、会话、虚拟环境与凭据路径。排除清单也必须预览。

Worker 的清单、操作回执、托管记录及项目目录按部署地址、设备和凭据命名空间隔离。安装是同卷 staging、预期哈希复查、旧目录备份和重命名；恢复保留期间产生的本地修改到 `.lingnest-preserved-*`。Windows 用本机 sidecar 保留可移植 Unix 可执行位，不把 sidecar 放进技能包。其它 Agent 会话不主动重启。

## 执行环境

Codex 的版本、配置覆盖和任务 cwd 同时用于原生查询。配置查询只留下可见性、MCP 是否配置和配置摘要，不上报凭据。项目、本机用户、插件和系统来源分别保留；同名来源和共享链接不合并。CodeBuddy 的项目／本地设置覆盖用户设置，项目 Skill 优先；Claude 的个人 Skill 优先于项目 Skill、企业来源优先，插件独立命名。两者只有目录／配置证据时显示“已配置”，不能显示已加载。无法读取的内置清单显示未确认。

启动与手动刷新更新，有效技能包目录的文件监视加 60 秒轮询。监视不递归进入缓存或虚拟环境，总量上限 2,048 个目录，超出部分由轮询覆盖。盘点在同用户、配置和任务目录的独立线程进行，保持 Worker 的领取、暂停和退出响应；退出时取消尚未完成的只读盘点，不再接收同步操作。心跳只携带摘要、Worker 领取状态和操作 ID，完整清单走分页接口。离线保留最后清单和扫描时刻。

能力标签由发布者声明。域名 `mp.weixin.qq.com` 只生成软标签 `wechat.article.extract`，不改写任务原文。只有原生或配置可用、依赖就绪、当前版本验证通过、在线、允许领取且空闲的匹配节点优先；指定节点与 Agent 是硬约束。无匹配仍可通用尝试，待操作任务释放名额。

托管版本复制进任务目录，记录固定清单；继续任务复用快照。Codex 启动时临时禁用其它目录同名 Skill，并确认快照加载；保留无关可见性设置，不修改用户的全局配置。CodeBuddy 通过项目优先规则加载固定版本。旧 Codex 无法确认快照时任务等待环境处理，不偷偷改用全局版本。

采集默认 Codex workspace-write 配置启用网络；只迁移上一版内置参数，保留明确自定义的网络禁用策略。

## 公众号试点

基于 [Yui-cx/wechat-article-to-md-skill](https://github.com/Yui-cx/wechat-article-to-md-skill) 的 MIT 版本，固定上游提交 `41f1ed58a9c74e8c61ffbe8f3290c0d13e5ff759`，保留许可和脚本／引用完整包。灵藏示例限制 HTTPS 微信文章地址、拒绝重定向和隐式 netrc，配图只接受微信资源域名；通过 uv 临时依赖运行，不打包登录状态或虚拟环境。

实际 macOS Codex 0.160.0 验收：私有发布 → 全局 Codex／Claude 文件同步 → 原生 Codex skills/list 确认加载 → 固定快照非交互提取 → 全局回滚。公开样例来自上游测试链接 https://mp.weixin.qq.com/s/Y7dyRC7CJ09miHWU6LBzBA；独立 HTTP 提取得到 Markdown 和 5/5 配图。原生 Agent 成果经单份正文校验为 5,201 字，正文末段片段一致。验证不是安装状态推断。

证据目录：`/var/folders/yb/4wk0j0ns5c38cl5g9l107w_m0000gn/T/lingnest-skills-live-xiAUxy`；`result.json` 为原生操作链结果，`body-revalidation.json` 按最长单份正文重新校验，避免多份来源重复计数。临时全局安装已回滚，现有技能未覆盖。

按用户选择重新执行 Codex 单 Agent 闭环：独立线程盘点、私有发布、全局同步、原生加载、固定快照非交互提取和回滚均通过。证据为 `/var/folders/yb/4wk0j0ns5c38cl5g9l107w_m0000gn/T/lingnest-skills-live-qu0IU0/result.json`，正文 5,201 字，SHA-256 为 `b83ec28521f751b0a6e413ad7465eebb485c1fbf12f64b2198438dcad745de8a`。SQLite 与隔离 MySQL 的最终完整回归为 171 项通过、0 项跳过。

## 自动化与剩余原生验收

- SQLite／隔离 MySQL：私有发布、比较、同步、验证、优先派发、通用回退、等待任务、固定快照、版本冲突、撤销和跨部署隔离；以及项目可见性、插件独立控制、依赖缺口、中断恢复保留本地修改。
- 真实 Electron／Chrome 点击：节点入口、逐文件预览、私有发布、比较、确认同步、回滚、退出；使用隔离服务与 OS home。凭据保存 fixture 不是原生 Keychain 验收。
- Android：设备入口与两页清单展示、缺口／未验证状态，单元测试、lint、APK。iOS：分页 API 与模型、已有登录／Keychain 回归、XCTest 和 Simulator 构建。
- 公共 CI 对 Windows 文件协议和安装包 UI、Linux 共享桌面 UI 加入技能回归；Mac 签名发布也须通过技能 UI。

本机已补齐 CodeBuddy CLI 2.161.4；CodeBuddy 和 Claude Code 尚未登录，按用户“只用 Codex 先”的选择暂缓这两种 Agent 的原生账户验收。三种 Agent 的盘点与同步入口保留。两台不同系统、三种 Agent 的完整现场验收仍需相应机器和原生授权。移动端模型／界面构建测试不代替实体手机操作；iOS 本次不提交 App Review。先部署兼容服务端，再发布客户端。
