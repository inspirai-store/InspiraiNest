# 自托管安装

InspiraiNest 代码采用 MIT 许可证，版权主体为 Wuhan Inspirai Technology Co., Ltd.；图标沿用当前应用，见 [权利说明](RIGHTS.md)。它提供离线资料浏览器、单用户采集服务、电脑 Worker、Android/iOS 客户端和只读 CLI。服务不是公用的多租户执行平台。

## 最小安装：离线资料库

需要 Node.js 24 或更新的兼容版本。解压源码后在根目录执行：

```sh
node scripts/catalog.mjs build
node scripts/catalog.mjs check
```

双击根目录 `index.html`，可直接通过 `file://` 打开空资料库，无需服务和 CDN。新增资料写到类型目录内的 `source.json`，再执行以上两条命令。模板在 `templates/`。不要手改生成索引。

## 本机服务

在 `collector/` 执行：

```sh
npm ci --ignore-scripts
npm test
npm start
```

Windows PowerShell 如果限制 npm 脚本，使用 `npm.cmd`。默认监听 `http://127.0.0.1:4317`；默认 SQLite 和对象文件都在 `collector/data/`。首次启动生成 `data/admin-key.txt`。在本机打开上述地址，用该文件中的密钥配对第一个管理端；不要把密钥放进 URL、工单或 Git。管理端可以创建一次性 owner/worker 配对码、提交任务、撤销设备。

`.env.example` 是变量说明，服务不会自动加载 `.env`。用启动环境传入变量。数据目录和密钥要一起备份，备份也必须保密。

## 远程访问

在自己的域名上配置 HTTPS 反向代理到本机服务。设置 `COLLECTOR_PUBLIC_URL=https://library.example.com` 为真实外部 origin；TLS 在代理处终止。不要向公网开放裸 HTTP、数据库或对象存储桶。保留服务默认 loopback 监听，只有在受控容器网络中才设置 `HOST=0.0.0.0`。不得将下载目录映射为任意目录列表。

可选 `MYSQL_URL` 替换 SQLite，可选 OSS 变量替换本地对象文件，详见 `collector/.env.example`。这是可选存储适配；最小安装不需要云账号。生产迁移、证书与备份方案由部署者配置，候选源码不包含任何原生产主机、镜像仓库、数据或运维脚本。

## 电脑 Worker

先阅读 [Worker 威胁模型](../SECURITY.md)。在专用低权限系统账户或隔离虚拟机中安装并登录自己的 Agent CLI，然后在 `collector/` 执行：

```sh
node src/worker.mjs init
node src/worker.mjs doctor
```

编辑新建的 `worker.local.json`：将 `server` 设置为自己的 HTTPS origin（同机调试可用 loopback HTTP），保留 `watchLibrary: null`。默认 Codex 明确使用 workspace-write 沙箱，默认示例不启用 CodeBuddy 回退。默认未打开沙箱网络访问；需要联网采集时在隔离账户内自行选择经过检查的本机 Agent 配置。`init --capture-profile` 是单独的联网/编辑权限示例，会扩大能力，不能当成隔离保证。

在管理页面创建设备角色为 worker 的一次性配对码。用环境变量 `COLLECTOR_PAIR_KEY` 传入后运行 `node src/worker.mjs pair`，随后从当前 shell 环境删除它。不要将密钥写入命令行参数。运行 `node src/worker.mjs run --paused` 检查状态；准备好接收任务后可通过桌面管理端恢复，或者停止进程后运行 `node src/worker.mjs run`。`doctor` 只验证 CLI 启动和版本，不代表模型登录、权限或采集成功。

桌面管理端可在 `npm ci` 后通过 `npm run desktop` 启动；首次可能需要安装 Electron 二进制（`node node_modules/electron/install.js`）。连接页面手动输入服务地址。Worker 配对配置和任务日志留在本机；断线后任务仍归原电脑所有。示例路径 `worker.production.example.json` 是打包兼容文件名，内容也是本机默认值。使用 CodeBuddy 的既有自定义配置需要显式设置 `agents.codebuddy.enabled: true`；本次没有改写用户本机配置文件。

## 移动端和只读 CLI

- Android：需要 JDK 21、Android SDK 36、Build Tools 36.0.0。在 `collector/mobile/android/` 运行 `./gradlew :app:testDebugUnitTest :app:assembleDebug`（Windows 用 `gradlew.bat`）。可以加 `-PcollectorServer=https://library.example.com` 设置自托管默认值；设备配对可修改地址。更新检查及 APK 下载跟随当前配置服务器，仍验证哈希、应用 ID、版本和安装签名。未配对首次启动不自动检查更新。发布签名必须使用部署者自己的密钥。
- iOS：需要 macOS、Xcode、XcodeGen；复制 `Config/Local.xcconfig.example` 为 `Local.xcconfig`，填自己的 Team、Bundle ID、App Group 和 Keychain Group；在 `collector/mobile/ios` 运行 `xcodegen generate` 后用 Xcode 构建。配对地址初始为空。Windows 上不能验证 iOS 构建。
- CLI：需要 Go 1.23+。在 `collector/cli/` 执行 `go test ./...`、`go build -o lingnest .`。用 `lingnest --server https://library.example.com auth login` 授权只读访问；也可设置 `LINGNEST_SERVER`，显式 `--server` 优先。默认只连接 `127.0.0.1:4317`。凭据按 origin 分隔并存入系统安全存储。

## 更新与卸载

升级前停止服务和 Worker，备份服务数据目录与本机任务目录，校验新版本及数据库迁移说明。不要让两个 Worker 同时使用同一数据目录。撤销设备会阻止后续服务请求，但不能收回已下载文件或瞬间终止离线 Agent；需要在原电脑停止 Worker。卸载二进制不等于删除资料，清理数据应由用户另外决定。
