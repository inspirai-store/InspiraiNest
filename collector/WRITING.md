# 问答驱动写作

客户端导航“写作”创建会话，也可以从已同步记录的“写文章”进入。先选记录或粘贴材料；图像、录音随记录版本读取。范文由用户粘贴或从资料库指定。每次新轮次均冻结材料、完整答案、计划、确认的风格与 Skill 哈希。

Worker 生成一轮方向和两至三题后完成任务并释放执行槽。会话单独显示“待回答”；这不属于 Worker 环境故障或归档审核。准备充分后出现写作约定，用户确认范文规则并点击“开始写作”才派发成文任务。局部修订沿用冻结约定；关键调整、新材料和风格更新回到问答。旧答案、计划、原件、风格和稿件均保留。

## 接口与权限

用户授权访问 `/api/writing/sessions`（GET/POST）、`/sessions/:id`（GET）以及 POST `answers/materials/discuss/style/start/revise`。每次写入携带稳定 UUID `requestId`，修改携带 `baseVersion`。返回 409 时保留输入、刷新后重交；网络确认不明时重用原请求和版本。`start` 还核对 `planVersion/styleVersion`。

`GET /api/writing/styles` 为已确认的不可变风格档案，`GET /entries` 为可指定范文的资料目录；均为用户权限。`GET /sessions/:id/drafts/:taskId` 返回独立正文及引用；`.../files/:hash` 下载稿件附件。`/sessions/:id/files/:uuid` 读取材料原件，`/history` 读取会话版本历史。

Worker 心跳声明 `writingProtocol:1`。只能使用该次任务派发凭据读取 `/api/writing/tasks/:taskId/files/:fileId` 和提交 `/result`，不能管理会话。派发改变、任务取消、设备撤销或快照过期均拒绝提交。轮次结果执行结构和阅读清单校验；是否真的理解材料仍需实际 Agent 验证，清单不是语义证明。

成文产物采用 `source.json`、独立 publication 正文、summary、reference、加工记录和图片，Worker 强制保存材料原话及计划风格关联，并执行 catalog build/check。完整媒体原件保留在写作会话与 Worker 的 `.writing-input`，不受现有 40 MiB 轻量归档包大小限制。沿用待审核草稿与用户确认归档接口。文章预览和导出不执行原始 HTML。文章包包含 Markdown、离线 HTML、引用、加工记录与图片；单独 HTML 内嵌图片，支持 file://。会话导出另包含材料原件和完整历史，用同一 Skill 在指定目录继续。

## 构建

桌面：`npm --prefix collector run build:desktop-ui`。Worker 包和服务 Docker 镜像均包含 `collector/skills/writing-workshop`。

手机复用同一套 React 写作界面，凭据和网络仍由原生桥接持有；Android 通过原生分享、iOS 通过系统分享导出文章。构建前安装 `collector/desktop/frontend` 依赖，再执行 `node collector/scripts/stage-writing.mjs` 和 `node collector/scripts/stage-capture.mjs`；生成的写作静态资源不入库。Android PowerShell 构建入口及 CI 已包含该步骤，iOS 构建检查资源存在。发布签名和真机交互验收单独执行。

## 验证

- `node --test collector/test/writing.test.mjs`：真实服务与存储、权限、冲突、幂等、任务冻结、单轮 Worker、预览归档。
- 在 frontend 目录执行 `node --experimental-strip-types --test scripts/writing.test.mjs`：丢失确认、重载重试、账户切换、附件校验、离线导出。
- 构建桌面和手机资源后，在 collector 目录执行 `node scripts/qa-writing.mjs`：浏览器真实界面全流程，桌面/手机尺寸、重载恢复、显式开始、图片、ZIP、file://、归档。使用测试 Agent 结果，不能证明模型写作质量。
- `node scripts/qa-writing-agent.mjs <原始材料.txt>`：独立测试库真实调用本机 Agent，验证材料理解和提问，不向正式资料空间写入。输出留在忽略的 test-output 中。

需在 Android/iOS 真机及 macOS 上验证原生桥接与导出。范文尚未由用户实际指定前，测试范文和测试风格只用于验证机制，不代表用户正式行文档案。

### 2026-10-16 开发验证

- 服务端完整测试：284 项，266 通过，18 项需外部环境的测试跳过；写作专项 10 项通过。
- 前端相关回归：35 项通过，TypeScript 与桌面/手机资源构建通过。浏览器流程覆盖真实服务、断点恢复、明确开始、图文预览、会话原件导出、离线 HTML 和确认归档；成文结果使用测试 Agent。
- 使用 1253 字真实个人记录调用真实本机 Agent，输出四个不同方向及三题，继续沿用技术实践者读者约定，未生成文章或归档。只验证此轮材料理解与提问，不能代替用户确认范文后的成稿质量验收。
- Android Debug 构建、41 项单元测试与 lint 通过。iOS 模拟器临时签名构建和 31 项测试通过，包含本地 WKWebView 实际渲染；不使用发行私钥。写作资源采用经典 IIFE 脚本，避免 file:// WKWebView 的模块加载问题。
- 此开发分支尚未部署服务端或替换安装版。iOS 发行签名、Android/iOS 真机及 macOS 原生交互与导出验收仍待进行。MySQL 并发场景需配置专用测试环境再验。
