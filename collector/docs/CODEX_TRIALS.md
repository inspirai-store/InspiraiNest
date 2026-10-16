# 异步处理中心与 Codex 实测

分享或新建采集时可以勾选「同时交给 Codex 实测」，选择电脑及可选项目。默认关闭。安卓先把完整不可变载荷和附件写入原有 Outbox，随即显示本机回执；服务器确认后才显示已交给后台。上传和采集不占用用户的当前页面。

## 处理流程

- 安卓采集入口及主网站任务入口使用同一个处理中心：待处理、运行中、新结果、稍后。已读结果留在历史。
- 资料库/记录入口只显示待办与新结果数量，不弹系统通知。
- 连续处理固定开始时的待办清单。每次选择或归档成功后立即下一项，不等待 Agent。新到待办留给下一批；可随时结束。
- 稍后与已读保存在服务端，安卓与网站共用。打开报告不会自动已读；任务变化后旧的稍后标记不会隐藏新问题。共享测试登录按电脑合并。
- 采集完成或进入待审核后，幂等地产生独立的 `codex-trial` 子任务。唯一候选自动继续；多个候选或未识别到仓库时选择对象/补充仓库。原资料、子任务、报告、重测历史互相关联。
- 测试账号未登录时暂停原任务。Worker 后续检测到测试账号就绪，自动恢复该电脑的全部登录待办。离线等待原电脑，不转移到其他节点。缺失依赖保留工作目录，修复后继续。

## 电脑准备

更新服务端和 Worker 后，在电脑客户端「设置 → 通用 → Codex 测试账号」打开专用登录终端。登录码只显示在该电脑的终端，不上传、不写入任务日志。也可在配置好 `COLLECTOR_CONFIG` 的本机终端运行：

```powershell
node collector/src/worker.mjs trial-login
```

可选项目来自现有节点技能项目登记；仅显示 Git 项目。实测复制所选电脑当前已提交的 HEAD，记录完整提交号；原目录的未提交和未跟踪文件不进入副本。重试沿用已固定的版本；重新实测生成新任务。

## 临时环境与结果证据

专用登录保存在 Worker 数据目录的 `codex-trials/<server-and-device>/login`。每次测试使用新的临时 CODEX_HOME，仅复制专用登录，不复制日常 Codex 配置、技能和凭据，也不继承 OPENAI_API_KEY、服务端密钥等环境变量。每次执行结束删除任务内的登录副本；保留固定源码、项目副本、安装回执、原生执行日志与报告。它是同一系统用户下的临时工作区和 Codex workspace-write 环境，不是虚拟机或容器级隔离；插件安装/依赖程序仍以该用户运行。

当前对象格式：GitHub HTTPS 仓库，类型 `skill` / `plugin` / `mcp`，可选仓库内目录与 Git ref。Worker 固定实际提交后再安装。Skill 要有 SKILL.md；原生插件要有 .codex-plugin/plugin.json，使用真实 Codex marketplace/add CLI；MCP 要有仅一个无凭据 stdio 服务的 mcp.json/.mcp.json，参数可使用 `${MCP_SERVER_ROOT}`。不执行来源网页中的安装命令。需要凭据、缺构建条件或格式不支持时暂停并指出原因。

安装成功不等于测试通过。报告分开记录安装、原生加载、实际调用证据。Skill 脚本命令须与 Codex 原生 command_execution 事件及输出吻合；MCP 须有真实 mcp_tool_call 返回。缺少任一阶段时只标为「部分验证」。纯提示词 Skill 的行为质量仍需人工阅读报告判断。Agent 自述或文件名不能作为调用证据。

## 接口兼容

- `POST /api/tasks` 新增可选 `codexTrial: {deviceId, projectId?}`，进入原 submissionId 幂等比较。
- `GET /api/processing-center`、`POST /api/processing-center/items/:id` 共用稍后/已读状态，并以 revision 拒绝过期决定。
- `trial-targets` 仅已领取父任务的 Worker 可写；`trial-choice` / `trial-rerun` 仅 owner 可写。
- `trial-report` 写入校验 Worker、分配编号、任务状态及设备撤销，读取仅 owner。重复回执不新增报告。
- Worker 心跳可选 `trialEnvironment: {protocol:1, login, projects}`。旧 Worker 保留文字/附件采集能力，不会领取实测任务。
- 不迁移已有资料、草稿或凭据。不更改原资料正文或 source.json。

## 验证命令与范围

```powershell
node --test collector/test/*.test.mjs
node collector/scripts/test-processing-center.cjs
node collector/scripts/stage-capture.mjs --check
npm.cmd --prefix collector/desktop/frontend run build
node collector/scripts/stage-writing.mjs
# collector/mobile/android 下运行 testDebugUnitTest lintDebug assembleDebug
```

可选本机原生插件安装冒烟：设置 `COLLECTOR_NATIVE_TRIAL_SMOKE=1`，运行 `processing-center.test.mjs`。此检查使用临时本地 marketplace，实际调用 Codex 安装和列表命令；不会调用真实模型。Worker 的项目保护、文件复制、工具执行和报告重传测试使用明确标记的协议夹具。

本轮本地验证（2026-10-16）：

- 服务端/Worker 全量测试 316 项：297 通过、19 跳过、0 失败；另开启原生 Codex 安装冒烟后的专项测试 9 项全部通过。
- 安卓 44 项单测通过，Lint 无错误，debug APK 构建成功。专门覆盖实测选项进入持久队列、离线恢复电脑/项目选择和夜间 HTML 首次呈现。
- 桌面 TypeScript/Vite 构建与 6 项相关界面模型测试通过。
- 使用真实隔离服务进行浏览器联调：固定批次、后台执行、输入保留、稍后/已读、跨客户端共享、可选项目提交，以及 320/360/393/412/736 宽度、日夜模式通过。打包页面另以模拟原生传输层连接真实服务检查导航、图标及大字号；这不等于 Android WebView 实机验收。
- 独立 Android SDK 模拟器缺少 Windows 加速驱动，软件模拟启动未能就绪，已停止该实例；未操作其他已连接设备。

真实测试账号登录后的 Codex 模型运行、安卓模拟器/物理分享、macOS 登录终端及正式升级仍待相应环境验收。当前仅生成本地 debug APK，未发布或部署生产。验证日志与页面截图保存在忽略目录 `collector/test-output/processing-center/`。
