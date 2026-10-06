# Mac 名称与待操作任务调度修复

日期：2026-10-07（Asia/Shanghai）。公开仓库 `inspirai-store/InspiraiNest`，分支 `main`。

## 改动

- macOS 0.1.13 的应用包为 `灵藏.app`，`CFBundleName`、`CFBundleDisplayName`、主程序和 Electron 辅助进程统一为“灵藏”；应用菜单、关于与隐藏菜单项使用同一中文名称。
- 保留 `store.inspirai.library.worker` 的 bundle ID、原资料目录和凭据存储命名空间。下载文件名与自动更新地址继续兼容现有客户端。
- `waiting_action` 任务保留原电脑归属和本机中间成果，同时释放领取名额；Worker 继续处理其他符合能力和派发要求的任务。
- “继续任务”将原任务加入原电脑队列；有正在执行的任务时先完成该任务。其他电脑不能领取该重试任务，用户取消后迟到进度仍被拒绝。
- 待操作任务不会自动重试；用户的暂停领取、完成当前任务后停止与退出行为保持有效。

## 验证

- 本地 SQLite/Node 完整回归：157 项通过。
- SQLite 与隔离 MySQL 的调度协议回归：2 项通过，覆盖来源受阻后领取新任务、继续请求排队、原电脑归属、当前任务优先和取消后拒绝迟到进度。
- 真实 Worker 与 Agent 子进程回归：第一项返回待操作，下一项完成；明确继续第一项后复用其已保存文件并成功归档。
- 已使用签名、公证的 Intel 应用进行独立目录预览：系统识别名称、原生菜单及关于窗口均显示“灵藏”，关于窗口显示 0.1.13；预览已正常退出，原运行中的客户端和 Worker 保留。
- 本地桌面菜单和 Worker 生命周期回归通过；原生最小化按现有 runner 说明跳过，不能视为物理 Dock 点击验收。
- [公共 CI 37491815222](https://github.com/inspirai-store/InspiraiNest/actions/runs/37491815222) 全部成功，包含服务端、Windows、两种 Mac 架构、Linux、Android和 Web 镜像。

## 服务端先行上线

- 源码：`93f7d28af334716da7071c66fd6639b56cae9425`。
- 镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-task-queue-20261006-93f7d28@sha256:d2e9bf7d7b0b02be2121b8d79148cd2971c6582a1cdedc6b754afc08a4b67012`。
- Kubernetes `aliyun` / `inspirai` / `library-collector` / `api`，revision 57，1/1 就绪，Pod 镜像 digest 一致、重启次数 0。
- 实际部署的 `server.mjs` SHA-256 与已提交源码相符。候选容器完成真实配对和调度协议验收；上线后健康、旧下载清单和 Web 登录页面均验证通过。
- 本次服务端修复同样适用于已安装的旧客户端，无需等待 Mac 包升级即可继续领取任务。

## Mac 0.1.13 发布

- [签名发布 CI 37491833789](https://github.com/inspirai-store/InspiraiNest/actions/runs/37491833789) 成功，固定源码为上述提交。两种架构均通过 Developer ID 签名、Apple 公证、staple、Gatekeeper、架构和应用名称检查。
- 已签名应用的登录、配对、切换资料库、更新下载及 Worker 生命周期回归通过；制品中的 112 个本项目文件与固定源码核对一致。
- 私有 OSS 归档前缀：`releases/macos/v0.1.13/37491833789-1/`。CI 上传并回读校验 11 个包与更新文件成功。
- [公开下载页](https://library.inspirai.store/download)，以下文件提供 ZIP 与 DMG 两种方式。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| [InspiraiNest-v0.1.13-macOS-arm64.zip](https://library.inspirai.store/downloads/InspiraiNest-v0.1.13-macOS-arm64.zip) | 133023570 | `6b4df9188e249608183bc7f80317bacc1b07f5f7825c1a6baeb759c4cb839dde` |
| [InspiraiNest-v0.1.13-macOS-arm64.dmg](https://library.inspirai.store/downloads/InspiraiNest-v0.1.13-macOS-arm64.dmg) | 133036262 | `51edb3506978771e30d4e30fd5730a67747bcae646dad8bc5d7c6e5b91b4ffdc` |
| [InspiraiNest-v0.1.13-macOS-x64.zip](https://library.inspirai.store/downloads/InspiraiNest-v0.1.13-macOS-x64.zip) | 139813647 | `b85e4e0a75e311ef08d9f824b9b47dd65d2443305253d62cf6ee11b82d5d3790` |
| [InspiraiNest-v0.1.13-macOS-x64.dmg](https://library.inspirai.store/downloads/InspiraiNest-v0.1.13-macOS-x64.dmg) | 139809786 | `2ddca1c53c481ea533d2106f7a8dfd00eebbbdeeaca38b54191d034cec3223c8` |

## 线上发布验收

- 最终镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-macos-name-013-20261007-93f7d28@sha256:d228883da0f209aeecb0aaac5a5ec688b4aead827000ce9ac5444dc5a8f1bc53`。
- `aliyun` / `inspirai` / `library-collector`，revision 58，1/1 就绪、Pod 实际镜像 digest 一致、重启次数 0。线上 `server.mjs` 与固定提交逐字节一致。
- 从公网完整下载上述 4 个文件，长度与 SHA-256 全部一致；两种 ZIP 的更新入口、blockmap 和 `latest-mac.yml` 也已校验。
- 内置浏览器确认 Mac Apple Silicon 与 Intel 下载按钮均为 0.1.13。Windows 下载仍为 0.1.12，Android、iOS 与只读 CLI 下载清单及 Web 登录页保持原版本。
- 原运行中的客户端未被重启；安装或自动更新到 0.1.13 后使用新名称，任务调度修复已由服务端生效。
- 若需回滚 Mac 下载发布，恢复 revision 57 的上述 `prod-task-queue-20261006-93f7d28` 镜像；该版本仍包含任务调度修复。
