# 本机 Codex Agent 实测与桌面 0.2.12

构建源码：`737f56ab5b5527c872f4a6172f95695c4496baf8`。Windows/macOS 版本 0.2.12；Android 保持 1.3.13 / versionCode 20，iOS 本轮不发布。

## 行为

- 实测与普通采集共用已配置的 Codex 程序、参数和环境处理，沿用现有授权、模型、Provider、Skill 与 MCP。每项实测启动独立后台会话；不再要求专用测试账号，不复制授权文件。
- 设置改为“Codex 实测环境”，进入已有 Agent 管理。程序、配置、依赖和模型问题分别提示；实际授权失效才进入授权待办。旧待授权任务在原电脑就绪后恢复同一任务。
- 固定来源及项目提交；Skill 使用项目副本，插件使用任务专属 marketplace/cache 和临时 profile，MCP 使用进程配置。任务结束清理临时启用配置及 CLI 为该副本新增的信任登记，保留已有全局设置。
- Windows Git 在部分长路径文件创建失败后仍可能返回成功码。任务命令及项目副本启用长路径支持，首次模型调用前检查已跟踪文件；准备中断后恢复同一任务，模型已开始后的本机成果继续保留。
- 报告保留实际 Agent 版本、模型和 Provider；安装、原生目录/实际读取及候选命令输出分别核对。已有工具的输出不代替待测对象证据。原资料、报告及显式重测历史保持关联。

## 验证

- [完整 CI](https://github.com/inspirai-store/InspiraiNest/actions/runs/38944633380) 通过，覆盖服务、MySQL、共享界面、Android、Windows、Linux、Mac 两种架构及官方 Agent 安装检查。专项测试 16 项：15 通过、1 个按环境开启的原生冒烟跳过；模型夹具与真实验收分别记录。
- 长路径专项使用真实 Windows Git 重现了“返回码 0、五个文件未创建”；修复后副本完整。回归测试还覆盖部分检出时禁止模型启动，以及同一任务恢复。
- [Windows 正式产物转存](https://github.com/inspirai-store/InspiraiNest/actions/runs/38945520674) 验证相同源码的成功 CI 产物；没有另行重建正式 Windows 包。
- [Mac 签名与原生验收](https://github.com/inspirai-store/InspiraiNest/actions/runs/38944642701) 通过两种架构签名、Apple 公证、Gatekeeper、更新清单，以及签名客户端的资料、登录、冲突、规划、更新下载和关闭检查。
- 本机 Windows 正式 NSIS 覆盖安装验证成功，25 条资料、草稿、两个附件、四个配置/授权文件保持一致；原设备和 Worker 以 0.2.12 恢复。
- 原待授权任务已用现有 ChatGPT 授权继续，无单独登录。首份报告缺少直接调用证据而保留“部分验证”；后续显式重测保留历史。最终正式客户端真实执行 0.148.0 / gpt-6.1-sol / openai，安装、加载、实际调用全部核验通过。项目副本 982 个已跟踪文件全部存在，原项目 HEAD、工作区与 Git 配置未变；Codex 全局配置及原 profile 摘要保持一致。
- 待测 plugin-eval 的 analyze 与 explain-budget 真实返回成功；评分与预算只是该工具的静态启发式结果。未将其当作真实模型 token、Skill 触发质量或写作能力评分。本轮候选未声明 MCP，不将其他 MCP 调用计作该插件证据。
- 生产只保留一次原始提交及同一份归档；原资料 20 个文件摘要保持一致，已有两份报告摘要保持一致。新报告与原资料双向回看，重复获取报告不改变摘要或已读状态。另使用真实已完成任务原分配编号重复上传同一 checkpoint 两次：任务、报告摘要及模型日志均未改变，没有再次执行模型。

## 部署与公开分发

[GitHub v0.2.12](https://github.com/inspirai-store/InspiraiNest/releases/tag/v0.2.12) 的 14 个文件大小和 GitHub SHA-256 均与签名/CI 回执一致。主站下载、Windows 元数据、worker-release.json 与 macos-update.json 同步更新。公网完整下载、范围请求、Mac feed/ZIP/blockmap、私有文件 404 和健康检查通过。Android、iOS、reader 清单保持原值。

最终镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-local-agent-clients-0212-20261017-r1@sha256:7240ffd1bba9065e84f9f8c9761b3c9af9475488920995a630ead9bc57697b3e`。回滚镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-local-agent-0210-20261017-r1@sha256:9044c3317b44350fb0b7c652ce6f04c97bf004df86ed3b6057b69b90ca543f84`。候选隔离下载/API 预检及部署后文件摘要核对通过，既有数据 ID 和设备撤销状态保留；不迁移资料或凭据。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| InspiraiNest-v0.2.12-Windows-x64.exe | 118547463 | `17616699d96fc11221c1aaf480e7c6ad59f2ee9a7f9bb9c92c2cdcdb51aebf31` |
| InspiraiNest-v0.2.12-macOS-arm64.zip | 135883505 | `48dddec0e09a44023cdc07348abee4fe311b995d00a0aa0d43393c120641258a` |
| InspiraiNest-v0.2.12-macOS-arm64.dmg | 135883573 | `9aadd3296ad360bb3a449db2142e72b61ab92bab2f73287851f2a062809dc049` |
| InspiraiNest-v0.2.12-macOS-x64.zip | 142673601 | `2057efbeabaa98688ceca5c350a227173fedfae80a3d77a8ccd5442d54ebe852` |
| InspiraiNest-v0.2.12-macOS-x64.dmg | 142643267 | `c33a3192952f1a553268538bd0be0c7bcfb0684fb1f145a4be6d28318873b5bf` |

## 验证边界

真实模型调用在当前 Windows 电脑完成；Mac 的现有账号、系统钥匙串和自定义 Provider 实测仍需各电脑验收，API Key/自定义程序与参数的兼容性覆盖来自专项测试。Android 本轮没有更新或操作手机。

同一系统用户的项目副本不等同于容器或虚拟机。任务缓存与本机日志保留在本机，不作为网页附件分发；报告内置“测试证据”提供核对输出。进程被直接强制结束时，未选中的任务 profile 或任务信任登记可能残留，普通会话不会因此启用待测插件。

私有原生执行日志、会话、配置和凭据均不提交公开仓库。
