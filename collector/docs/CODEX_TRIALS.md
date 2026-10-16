# 异步处理中心与本机 Codex 实测

分享时勾选「同时交给 Codex 实测」，选择电脑和可选 Git 项目。客户端先保存完整分享与附件，后台继续采集和实测。处理中心的待处理、运行中、新结果、稍后及历史跨客户端同步。打开报告不会自动标记已读；连续处理不等待 Agent，新到待办留给下一批。

## 执行环境

0.2.10 起复用所选电脑当前配置的 Codex Agent。与普通采集共用程序解析、参数和环境过滤，保留当前账号、模型、Provider、用户 Skill、MCP 和自定义程序路径。每项任务启动独立后台会话，不复用当前桌面聊天的对话。设置「Codex 实测环境」展示状态并进入已有 Agent 管理。分享不增加账号选择。

不再创建测试账号、不复制 auth.json，不因授权文件不存在而判断不可用。ChatGPT 缓存、系统钥匙串、API Key 及自定义 Provider 继续由 Codex 自己处理。就绪表示程序与现有授权方式可启动，模型调用仍可能因过期授权、模型或工具问题暂停。只有模型执行返回授权错误才记录授权待办；该待办在本机授权/配置变化后恢复。程序缺失、模型不可用、插件格式或版本不支持归为环境待办。

Agent 子进程继续过滤采集服务、云、数据库、签名与设备凭据。复用同一系统用户的 Agent 环境不是虚拟机或独立账号隔离；待测工具与已有工具都以该用户权限运行。模型只允许修改项目副本和任务目录，不更改原项目、全局插件配置或登录状态。

## 固定版本与任务内组件

所选项目来自现有 Git 项目登记。实测复制已提交的 HEAD，未提交与未跟踪文件不进入副本。源码与项目提交固定到 pinned.json；中断后仍使用原版本。重新实测才创建新任务。

- Skill 复制到项目副本的 `.agents/skills/lingnest-trial-<task namespace>`。
- 插件源码进入任务专属 marketplace。CLI 0.148 的安装命令会写配置，因此仅在无授权的 installer 临时目录运行原生 marketplace/add。安装回执必须返回匹配的 pluginId 和实际安装路径。原生安装缓存复制到现有 Codex 缓存的唯一任务命名空间。
- CLI 0.148 的插件加载不完整支持 `-c plugins...`。因此使用临时 `lingnest-trial-<namespace>.config.toml` profile，只在该会话选择；原 profile 配置合并保留，普通 config.toml 和原 profile 不改。会话结束删除任务 profile；进程被强制结束时残留 profile 不会被普通会话自动选用。缓存与原生安装证据保留在任务命名空间。
- MCP 使用唯一服务标识和进程级 `-c mcp_servers...`，不运行全局 `mcp add`。支持单个无凭据 stdio 服务的 mcp.json/.mcp.json，参数可用 `${MCP_SERVER_ROOT}`，工作目录指向固定源码。

候选对象支持 GitHub HTTPS 仓库、仓库内目录和 Git ref。来源提示与安装说明是待测内容，不能改变执行边界。缺依赖、密钥或不支持临时加载时保留成果并暂停。

## 原生证据与报告

Skill/插件运行前通过同一 Codex 的 `debug prompt-input` 核对原生目录中实际加载的路径。安装回执记录实际组件标识与路径。加载证据还要求实际读取该路径的 SKILL.md；调用证据要求候选真实脚本的命令与原生成功事件、输出片段匹配，或者唯一候选 MCP 的真实成功调用。已有工具可辅助，但其调用不会计入候选对象的通过条件。Agent 自述不作为证据。纯提示词的行为质量仍需阅读报告判断。

报告包含安装、加载、调用三个阶段，缺任一阶段只能部分验证。记录 Agent 版本、模型和 Provider 标识；能够取得本次会话原生日志时优先使用实际会话的模型/Provider，不上传配置、会话全文或凭据。报告先写本机 checkpoint，再上传；确认丢失时只重传相同报告。原资料、实测子任务、报告和重新实测历史互相关联。

## 接口与兼容

- 分享保留 `codexTrial: {deviceId, projectId?}`，参与原 submissionId 幂等比较。
- 心跳兼容原 `trialEnvironment: {protocol:1, login, projects}`，增加可选 `executionMode: "local-agent"`。
- 旧 `trial_login` 任务在所选电脑报告 ready 后恢复同一任务，不重新采集、不生成替代任务。离线仍等待原电脑。
- 报告增加可选 `agent: {executionMode, version, model, provider}`，仅保存白名单字段。旧报告及摘要标识继续兼容。
- 领取、报告、附件和授权检查保持原分配编号、任务状态与设备撤销校验。
- 不迁移资料、草稿或凭据，不修改原资料正文。

## 验证

```powershell
node --test collector/test/*.test.mjs
$env:COLLECTOR_NATIVE_TRIAL_SMOKE='1'
node --test collector/test/processing-center.test.mjs
node collector/scripts/stage-capture.mjs --check
npm.cmd --prefix collector run build:desktop-ui
```

单测中的模型执行为明确标记的协议夹具。可选原生冒烟使用真实 Codex 安装及加载命令，模型调用仍为夹具。真实账号下的模型执行、正式客户端覆盖更新和生产资料关联须另行验收，不能由这些测试代替。历史 0.2.7 发布边界见 `docs/releases/2026-10-16-codex-trials-0.2.7.md`。
