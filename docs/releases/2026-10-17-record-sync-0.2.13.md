# 记录同步 v1 与客户端更新

主站核验时间：2026-10-17 20:55:49（北京时间）。电脑客户端 0.2.13（Windows x64、macOS arm64 / x64）；Android 1.4.1 / versionCode 22。主站接口先部署，正式文件验证完成后切换下载与更新清单。

电脑源码：`bba99c8aeaeafe891d9c4ab948326f002fe778da`。Android 源码：`2bed765da5fd220a270769a462e0aff2e3ac8f2c`；电脑源码提交仅比安卓构建提交多了两份桌面打包测试的“已上传”断言调整，没有更改安卓源码。Android 发布包使用本机原发布密钥，签名证书 SHA-256：`9e7cfc75562a39a1e1f832493aa610855945a449eed71d85757e686a2d069a80`。

## 用户可见变化

打开先读本机内容，保存后后台上传；前台持续接收记录变更，返回前台与重新联网立即追平。服务端记录新增、编辑、删除、恢复与持久化变更日志同事务提交，长轮询最长 25 秒。旧服务端保留完整快照降级路径。

其他设备删除的记录从正常列表移除。尚未上传的修改及当前编辑内容保存为恢复草稿；只有用户明确“另存记录”才建立新 ID。迟到响应不能复活已删除记录，也不能覆盖新的恢复状态。本机保存、单条“已上传”和资料空间“最近同步”分别表达；同步入口集中展示待上传和冲突。Android 任务元信息同时修复 JSON null 显示。

## 验收

| 检查 | 结果 |
|---|---|
| [主分支完整 CI](https://github.com/inspirai-store/InspiraiNest/actions/runs/39031828648) | 全部通过；服务端 333 项（315 通过、18 环境跳过），独立 MySQL 124/124；桌面前端 197/197；Android 构建、单测、Lint；Windows / Mac 打包及更新回归。 |
| 候选服务镜像真实 MySQL | 独立临时表 8/8：新增幂等、条件写入、能力协商、分页及恢复、前台删除、事务回滚、授权撤销、并发连续序号；未使用生产记录表保存夹具。 |
| 本机 Android 正式构建 | 66/66 单测；Release Lint 0 错误、13 既有警告。使用现有 Android Studio JBR 运行测试，早期 Microsoft JDK 环境的基线失败在本轮正式检查中未再出现。 |
| Android 正式包覆盖安装 | 独立只读模拟器 1.4.0 / 21 → 1.4.1 / 22，实际已安装 APK 哈希与发布文件一致；记录 ID、版本、原件 SHA-256、收藏、配对、草稿、队列及写入/加工请求编号保留。 |
| Android 实际 Compose 与 Room | 正式签名包实跑通过：输入中接收删除，保留文字与恢复草稿；明确另存后只生成一个新记录。 |
| 桌面 / 共享记录页 | 桌面本机实测删除约 0.93 秒；最终共享页约 0.86 秒，搜索、滚动、焦点/选区、编辑内容和历史恢复草稿保持；共享混合记录流程 12 项通过。延迟只代表本机验收。 |
| [Mac 正式发布](https://github.com/inspirai-store/InspiraiNest/actions/runs/39031834443) | 同一源码的两种架构 Developer ID 签名、Apple 公证、stapler 与 Gatekeeper 检查通过；Apple Silicon 正式包的记录、登录、冲突、写作、更新回归通过。Intel 普通 CI 运行回归通过；未在物理 Intel Mac 安装此次签名包。 |
| 公网分发与生产 | 所有安装包完整下载核对大小与 SHA-256；范围下载、Mac 更新 YAML / ZIP / blockmap 与私有清单拒绝检查通过。现有授权设备 22、任务 115、归档条目 152、记录 13、技能版本 4、写作会话 2 条标识全部保留，设备撤销状态一致。记录在数据库中的类型名为 `capture`。 |

## 正式文件

[下载与升级入口](https://library.inspirai.store/download) · [GitHub Release](https://github.com/inspirai-store/InspiraiNest/releases/tag/v0.2.13)。客户端可使用现有检查更新入口覆盖安装，参与测试的设备需连接同一资料空间。

| 平台 | 版本 | 字节数 | SHA-256 |
|---|---|---:|---|
| android | 1.4.1 | 14,265,571 | `3168cf951b96de03eab97628af03313834db294ba544dcb5078c751d32e48d3d` |
| windows_x64 | 0.2.13 | 118,554,805 | `ba623d60f33371ceb958764193ae48ffa201d4ed032b32ffe47c2fd839f5dbc4` |
| macos_x64 | 0.2.13 | 142,681,862 | `c4dc27706138c52a3e8f43adbbd6e6ccefc740fe9d5caaf0e1e45bf0deac6138` |
| macos_arm64 | 0.2.13 | 135,891,792 | `4d501a5f37c138097c42264279d9ac37673515af85fb3823e3b38c7feb1a5e58` |
| macos_x64_dmg | 0.2.13 | 142,658,236 | `d9c4fe10bd6c3d2d1c0a6991f8011148703d88f38d8323a129b961ec2bc7cedb` |
| macos_arm64_dmg | 0.2.13 | 135,900,800 | `4b0630a78093a9a79035c0f0f8c0f064f56b8cb756594412b12816a90e3c963e` |

Windows 使用完整 CI 的未重建产物，OSS 转存工作流为 [39032267629](https://github.com/inspirai-store/InspiraiNest/actions/runs/39032267629)。Mac 更新必须同时存在 worker-release.json 与 macos-update.json；本次实际 HTTPS 更新入口已核验，不能用私有根路径的 404 判断更新不可用。

## 部署与回滚

最终镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-record-sync-clients-0213-20261017-r1@sha256:fc4ddbe099c5a2db9f9d99484dbd45af75ec06756bf0b0c819891fc7bda92e4a`。

客户端下载清单回滚：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-record-sync-0213-20261017-r1@sha256:64bc9ed2c678e9270388bed1c3b18237cfd8d7a521f033faac599d8ef788bd37`（新同步接口、上一批客户端）。整批改动前的镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-android-native-140-20261017-r1@sha256:48d1d4709f647a3480e2e24b577bbe464e565441ca018f6911fafcbc34685fcd`。两者均不清空数据库或对象存储。

本次为增量覆盖服务源码、共享页面资源及版本化安装包。既有资料、凭据、任务、存储和其他 Reader 分发保留；未修改 Kubernetes 密钥或存储配置。

## 验收边界

手机真实网络中的多端延迟、后台调度、锁屏、长时间离线及系统更新安装界面仍需用户真机验收。本轮没有更新用户已安装的电脑客户端或操作实体手机。此次模拟器覆盖安装与正式包运行不代表物理设备已验证。

本轮未发布新版 iOS；主线已有 Capture 资源和桥接已兼容，缺少新版原生 SwiftUI 记录存储的代码，不能据此声称原生 iOS 的同步接入完成。完整同步协议见 [RECORD_SYNC.md](../../collector/docs/RECORD_SYNC.md)。
