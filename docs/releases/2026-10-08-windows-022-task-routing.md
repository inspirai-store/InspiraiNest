# Windows 0.1.22：跨节点采集与未完成筛选

指定电脑无法完成采集时，任务不再只能等待原电脑修复。新版 Worker 上报 Agent、权限或工具环境问题后，同一任务自动进入队列，由其他能力及指定 Agent 匹配的授权电脑领取。每轮排除已经失败的节点，全部匹配节点均失败后停在待操作。保留原任务和 submissionId、过程记录及各电脑的文件，新节点重新采集，不迁移原始媒体。

任务详情提供“切换其他节点”。来源登录限制、成果校验及上传问题默认保留原机处理。显式“继续任务”保留原机工作目录并重置本轮失败名单。

新版执行中的任务两分钟无心跳可转交；分配编号和上传提交事务拒绝旧节点的迟到进度与结果，Worker 心跳发现分配变更时停止本次执行。旧协议客户端离线任务及上传阶段保留原机，旧客户端可通过网页手动切换。网页与桌面初始筛选均为“未完成”，包含失败、待操作和待确认，排除已完成、已取消。

## 产物与发布

- 公开 MIT 源码及二进制提交：`caa32ea6cf77b68e58ccfb24de6465b49fc226cc`。
- [公开 CI 37753627707](https://github.com/inspirai-store/InspiraiNest/actions/runs/37753627707)：全部任务成功。
- [GitHub Release v0.1.22](https://github.com/inspirai-store/InspiraiNest/releases/tag/v0.1.22)：Windows NSIS、blockmap、SHA-256 文件与 latest.yml；更新清单 SHA-512 及所有 GitHub 资产摘要已核对。
- 安装包：`InspiraiNest-v0.1.22-Windows-x64.exe`，115,987,222 字节，SHA-256 `510888da355ad9bcbca957d642b514eef69f4cba76be125d4da87647f3cacabc`。
- 官网新名称、legacyUrl 和 LingNest 兼容入口均完整下载并匹配大小、保存名与 SHA-256；无关文件仍为 404。
- 本机安装登记和资源版本为 0.1.22，配对、配置、设置和收藏哈希保留，原启动状态恢复为运行并在线。官网真实只读资料读取成功。
- Android、macOS 与只读 CLI 正式下载项保持不变，不发布未签名 macOS CI 包。

## 验证范围

覆盖跨实例同时领取、同一节点单执行槽、指定节点失败后重新匹配、穷尽停止、原机重试、旧分配拒绝、上传进行中切换、来源障碍保留、两分钟断线转交、旧客户端兼容、任务提交去重、网页手动切换及未完成筛选。两个独立本机 Worker 使用真实测试子进程验证失败后接手并完成同一任务，原机文件仍在；这是隔离模拟节点测试，不是两台物理电脑的真机验收。

SQLite 测试与 CI 中的隔离 MySQL 测试通过；在现有集群内也使用临时 MySQL 表验证三项调度与并发用例，并核对正式 154 条设备、任务和归档记录没有删除。桌面实际 Electron 交互、标准/最小/托盘窗口的深浅主题、节点与设置、控制、授权、只读 API、更新器及包内测试通过。一个不在 CI 中的历史 `test-workspace-ui.cjs` 仍使用已移除的导航选择器，本轮以现行工作台与设置/节点测试作为视觉验收。

## 生产变更与回滚

只覆盖服务器调度相关的三个源文件、两份任务页面文件、Windows 包与清单，共七个文件。109 个资源的预期哈希已在候选镜像和发布后逐项核对；Deployment 仅替换容器镜像，现有卷、数据库、对象存储及网络入口保持不变。发布前后保留 16 个设备、46 个任务和 92 份归档记录，官网当前可读资料共 89 条。

当前镜像：

`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-tasks-022-20261008-r1@sha256:2dc4130793fb158610db5145732c161944a538e4dc90b092f92a45ff329bdd14`

回滚镜像：

`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-worker-021-utf8-20261008-r1@sha256:fe163b656d51a74fb65722b25be3981a4f45c7694065fb34a999d08afa12b97c`

Deployment 就绪、健康页 200；临时检查 Job/ConfigMap 已删除。本轮未创建负载均衡或弹性公网 IP。临时读取授权所用的加密存储副本已删除。
