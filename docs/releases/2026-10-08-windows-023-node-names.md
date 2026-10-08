# Windows 0.1.23：节点名称与任务归属

工作节点支持在桌面与网页中编辑名称；节点 ID 只读、保持唯一，同名节点使用短 ID 区分。改名只修改服务端名称，保留凭据、安装标识、硬件身份及任务绑定；心跳不会覆盖名称。名称保存通过管理端授权和限定用途 IPC，禁止同时修改 ID 或凭据。

任务列表与详情新增醒目的节点信息：处理节点、完成节点、初始指定的目标节点，以及转交时的“等待其他节点接手”和上一节点。节点被删除后仍保留原 ID；转交后的任务不再关联到失败的初始目标。桌面本机节点名称采用服务端名称，管理端未连接时保留本机配置作为后备。

- 源码提交：`87e5784df79f9b49ed07c8cf16ba44c04a104841`。
- [公开 CI](https://github.com/inspirai-store/InspiraiNest/actions/runs/37759646468)：全部 10 项通过，包含真实 MySQL、网页、Linux 桌面、Windows NSIS、macOS ARM/Intel 打包及 Agent 安装检查。
- 本机单元测试：224 项，207 通过、17 按条件跳过、0 失败；新增 MySQL 改名、权限及并发心跳 3 项在隔离表中另行通过，正式数据记录完整。
- 桌面工作台、设置与节点、刷新时节点操作、网页节点与任务弹窗测试通过。检查名称保存/取消、编辑中刷新、托盘 IPC 权限、任务节点归属、转交与删除节点、深浅主题、740×580 窗口、390×350 托盘及网页 320/375/760/1440 宽度。
- [GitHub Release](https://github.com/inspirai-store/InspiraiNest/releases/tag/v0.1.23)：Windows 安装包、blockmap、SHA-256 文件及 latest.yml，资产摘要与更新清单 SHA-512 均已核对。
- 安装包：`InspiraiNest-v0.1.23-Windows-x64.exe`，115,991,569 字节，SHA-256 `1e98f8a89b5eb1db3216aa06fe45f069f5f4cd716627fbba173e25b16d8913a4`。
- 官网主下载入口及两份同版本兼容入口完整下载，大小、SHA-256 与保存名一致；桌面、最小窗口与手机下载页显示版本、文件名和摘要正确。
- 本机 NSIS 安装完成并启动，已安装资源与提交源码一致，配置、配对和偏好保留；Worker 恢复为运行并在线。真实官网读取成功，发布前的 16 个设备、46 项任务、93 份归档记录均保留；真实只读资料总数 90。

生产镜像使用上一镜像作为基础，只覆盖 6 个服务端/网页文件、Windows 包和 Worker 发布清单。镜像预检及上线后完整文件摘要核对通过，Deployment 就绪 1/1。临时校验 Job、ConfigMap 和本机临时安全存储密钥副本已删除；复用既有网络入口。

- 当前：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-nodes-023-20261008-r1@sha256:0252624bea75899f19410244a480247163c29d64b713e0875a1365d2d011f993`
- 回滚：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-tasks-022-20261008-r1@sha256:2dc4130793fb158610db5145732c161944a538e4dc90b092f92a45ff329bdd14`

名称写入及任务归属场景使用隔离测试服务。未修改正式设备名称或提交合成任务。官网 Android、macOS 签名包及只读 CLI 清单保持不变；macOS 0.1.23 的 CI 构建通过不代表已经签名发布。
