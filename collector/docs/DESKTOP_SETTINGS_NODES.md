# 桌面设置与工作节点

主导航包括总览、采集任务、资料库、工作节点；设置固定在侧栏底部。授权设备和客户端更新在设置内，回收站位于资料库。

显示模式支持随系统、白天、黑夜。主窗口与托盘小窗同步，由 Electron 主进程跟随系统主题。首次迁移保留旧 `worker-theme` 的明确选择，没有历史选择时使用随系统。

关闭偏好默认为收起到托盘。选择退出工作台时，仅退出界面，独立 Worker 继续采集；重新打开会连接已有进程。完成后停止并退出、更新安装与 macOS Command+Q 保持安全停止行为。最小化行为保持原样。

偏好保存于当前 `LibraryWorker` 用户配置作用域的 `desktop-settings.json`。`window.desktopSettings.get/update/onChanged` 只提供主题、关闭与开机启动偏好，只有主窗可修改，不提供文件路径、任意 URL 或凭据访问。

安装版默认开启“开机启动客户端”，可在外观与行为中关闭。登录启动时收起到托盘；Windows 使用固定安装路径与 `--startup` 参数，macOS 使用系统登录项。系统禁用或要求批准时明确提示，开发版不注册系统启动项。开机启动开关不会替用户启动或停止采集。

工作节点的运行／暂停／停止意图存于同一作用域的 `desktop-worker-state.json`。重新打开时先接管已有进程；进程已结束则恢复上次运行或暂停状态，不重复启动。明确“完成后停止”与安全退出保持停止；安装更新临时停止 Worker 后保留原意图，更新重启可恢复。关机／注销保存意图，不阻止系统退出。没有配对或恢复失败时显示中文提示，不循环重启。

节点页固定显示本机，远端列表只包括同一管理服务中未撤销且具有 Worker 权限的桌面设备。本机通过配置中的 `deviceId` 去重。远端在线状态使用服务端心跳判断，管理端读取不能刷新 Worker 心跳；连接中断后保留带时间的缓存，并显示状态待更新。设备信息缺失时显示未上报。

向节点派发任务沿用现有任务 API、目标 `deviceId` 和稳定 `submissionId`。离线节点可排队，任务等待指定节点上线且能力匹配，不会自动改派。无远程启停、项目遥测、P2P 或新增公网服务。

## 验证

运行 `npm test`、`node scripts/test-desktop-settings-nodes.cjs`、`node scripts/test-desktop-workspace.cjs`、`node scripts/test-desktop.cjs`、`node scripts/test-worker-logs-ui.cjs` 和 `node scripts/test-worker-status-start.cjs`。

`test-desktop-settings-nodes.cjs` 可传入打包后可执行文件，验证三档主题、旧偏好迁移、IPC 限定、离线任务重试、断线恢复、撤销授权、窗口退出保留 Worker 及重新接管。测试使用本机隔离服务和合成节点，不把模拟状态作为真实设备验收。

截图与结果写入被忽略的 `test-output/settings-nodes`，覆盖 1240×820、740×580 和 390×350 的深浅主题、键盘及减少动态效果。公开 CI 在 Windows 与 macOS 原生架构包上运行这些检查；Windows 沿用 NSIS。CI 构建不自动更新官网发布清单或部署生产服务。
