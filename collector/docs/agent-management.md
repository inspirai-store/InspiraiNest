# 节点 Agent 管理

Web、桌面和移动端：工作节点（移动端为授权设备）→ 节点详情 → Agent。
列表只显示名称、版本、状态和操作。支持 Codex、CodeBuddy、Claude Code、Gemini CLI、OpenCode。
采集调度仍仅使用已配置的 Codex / CodeBuddy，不因安装改变采集开关或技能验证结果。

## 安装边界

托管安装目录位于当前系统用户目录：

- macOS：`~/Library/Application Support/LingNest/agents`
- Windows：`~/AppData/Local/LingNest/agents`
- Linux：`~/.local/share/LingNest/agents`

托管目录中保存独立 Node.js 24 LTS / npm、各 Agent 的不可变版本目录和原子切换指针。
下载校验 Node 官方 SHA256 与 npm 包 SHA512，npm 使用严格 engines 检查；版本探测成功且原安装指纹未变化才切换。
失败或取消保留上一版本与用户原有安装，不修改终端 PATH、登录资料或技能目录。
配置了自定义可执行命令的 Agent 仍使用自定义命令，不允许远程覆盖。

原有安装仅开放已识别的 npm、Homebrew 和官方用户原生安装。
更新前检测外部会话，使用包管理器或官方原生更新流程；不请求管理员权限。
Codex 原生更新使用其官方 GitHub Release 中固定平台资产及 SHA256；不可验证时返回错误。
原有安装的中断日志在重启后先核验结果，无法确认时返回错误，不重复运行更新器。
账户登录须在目标电脑完成。

## 协议

- `GET /api/agents/catalog`：固定目录与当前正式版本。
- `POST /api/agents/environment`：Worker 上报独立清单；可执行路径不会上传。
- `GET /api/agents/devices/:id/environment`：管理端读取。
- `GET/POST /api/agents/operations`：操作查询或创建；可按 `deviceId` 过滤。
- `GET /api/agents/operations/:id`、`POST .../cancel`、`POST .../result`。

创建只允许管理端；操作绑定部署命名空间、设备、Agent、方式、目标版本和预期安装指纹。
`requestId` 幂等，Worker 回执幂等。只允许 `install/update/refresh`，不接受任意命令和下载地址。
未开始的离线操作 24 小时过期。取消、撤销和节点删除会关闭未执行操作。
心跳保留原字段，新增 `agentRuntime` 和操作通知；旧 Worker 不接收操作。

安装与技能修改使用当前用户的同一文件锁。采集任务结束后执行，执行期间不领取新任务。
子进程 15 分钟上限，取消终止进程树并清理临时文件。托管指针和成功回执用于重启核验。
回执与本地操作记录按服务地址和授权设备隔离；切换资料库后不消费旧操作。

## 验证

- `node --test test/agent-management.test.mjs`：授权、生命周期、冲突、完整性、取消、原子切换、原有安装中断恢复。
- `node scripts/test-auth-mysql.cjs`：隔离 MySQL，包含同一接口生命周期。
- `node scripts/test-agents-ui.cjs --web`、`node scripts/test-agents-ui.cjs [桌面程序]`：真实入口与点击，轮询焦点，取消、错误、旧客户端、浅色主题。
- `node scripts/test-agent-installation.mjs`：临时用户目录中的五种官方包真实安装、更新核验，不执行登录或模型任务。
- Android `AgentManagementTest`、iOS `APITests`：列表操作与绑定请求。

CI 在 macOS / Windows / Linux 运行目录事务和官方安装核验，并在打包程序中验证 Agent 列表。
移动端测试和构建、签名分发、真实设备登录验收分别记录。
