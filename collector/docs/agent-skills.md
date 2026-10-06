# Agent 技能盘点与私有同步

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

启动与手动刷新更新，文件监视加 60 秒轮询。扫描不占用采集任务执行名额。心跳只携带摘要、Worker 领取状态和操作 ID，完整清单走分页接口。离线保留最后清单和扫描时刻。

能力标签由发布者声明。域名 `mp.weixin.qq.com` 只生成软标签 `wechat.article.extract`，不改写任务原文。只有原生或配置可用、依赖就绪、当前版本验证通过、在线、允许领取且空闲的匹配节点优先；指定节点与 Agent 是硬约束。无匹配仍可通用尝试，待操作任务释放名额。

托管版本复制进任务目录，记录固定清单；继续任务复用快照。Codex 启动时临时禁用其它目录同名 Skill，并确认快照加载；保留无关可见性设置，不修改用户的全局配置。CodeBuddy 通过项目优先规则加载固定版本。旧 Codex 无法确认快照时任务等待环境处理，不偷偷改用全局版本。

采集默认 Codex workspace-write 配置启用网络；只迁移上一版内置参数，保留明确自定义的网络禁用策略。

## 公众号试点

基于 [Yui-cx/wechat-article-to-md-skill](https://github.com/Yui-cx/wechat-article-to-md-skill) 的 MIT 版本，固定上游提交 `41f1ed58a9c74e8c61ffbe8f3290c0d13e5ff759`，保留许可和脚本／引用完整包。灵藏示例限制 HTTPS 微信文章地址、拒绝重定向和隐式 netrc，配图只接受微信资源域名；通过 uv 临时依赖运行，不打包登录状态或虚拟环境。

实际 macOS Codex 0.160.0 验收：私有发布 → 全局 Codex／Claude 文件同步 → 原生 Codex skills/list 确认加载 → 固定快照非交互提取 → 全局回滚。公开样例来自上游测试链接 https://mp.weixin.qq.com/s/Y7dyRC7CJ09miHWU6LBzBA；独立 HTTP 提取得到 Markdown 和 5/5 配图。原生 Agent 成果经单份正文校验为 5,201 字，正文末段片段一致。验证不是安装状态推断。

证据目录：`/var/folders/yb/4wk0j0ns5c38cl5g9l107w_m0000gn/T/lingnest-skills-live-xiAUxy`；`result.json` 为原生操作链结果，`body-revalidation.json` 按最长单份正文重新校验，避免多份来源重复计数。临时全局安装已回滚，现有技能未覆盖。

## 自动化与剩余原生验收

- SQLite／隔离 MySQL：私有发布、比较、同步、验证、优先派发、通用回退、等待任务、固定快照、版本冲突、撤销和跨部署隔离；以及项目可见性、插件独立控制、依赖缺口、中断恢复保留本地修改。
- 真实 Electron／Chrome 点击：节点入口、逐文件预览、私有发布、比较、确认同步、回滚、退出；使用隔离服务与 OS home。凭据保存 fixture 不是原生 Keychain 验收。
- Android：设备入口与两页清单展示、缺口／未验证状态，单元测试、lint、APK。iOS：分页 API 与模型、已有登录／Keychain 回归、XCTest 和 Simulator 构建。
- 公共 CI 对 Windows 文件协议和安装包 UI、Linux 共享桌面 UI 加入技能回归；Mac 签名发布也须通过技能 UI。

本机没有 CodeBuddy CLI，Claude 未确认登录；这两种 Agent 的真实加载／提取及两台不同系统、三种 Agent 的完整现场验收仍需相应机器和原生授权。移动端模型／界面构建测试不代替实体手机操作；iOS 本次不提交 App Review。先部署兼容服务端，再发布客户端。
