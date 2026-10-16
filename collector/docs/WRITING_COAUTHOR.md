# 计划式写作共创

新文章从一句 `brief` 开始，记录、文章与范文可选。AI 先解释理解、提出实质不同的方向和两至三题，再根据答案逐步维护标题与提纲。客户端一次显示一题，推荐项不预选；可以上一题、下一题、暂不确定，也可以将部分选择和一句补充一起提交。

`brief` 是意图，不是作者经历或事实来源。问答仅组织方向和提纲。就绪时显示简短写作约定，作者点击“开始写作”后才派发正文任务。没有范文使用 `builtin-editorial-v1` 默认编辑规则，不能将其称为作者个人风格。后加范文只产生待确认的规则候选，不改写历史规则和稿件。

## 会话和任务

- 创建 `POST /api/writing/sessions`：`{requestId, protocolVersion:2, brief, sources?:[]}`。意图或实际材料至少一项非空；旧请求仍支持材料创建 v1。
- 提交 `POST /api/writing/sessions/:id/turns`：`{requestId, baseVersion, roundId?, answers?:[{questionId,selected,text,uncertain}], message?:string}`。答案绑定当前问题，允许部分提交；未答题不视为接受。自由补充原样保留。
- `turns`、原始 `answers`、已确定 `decisions` 与 AI 建议分开保存。`workingPlan` 保存初步主旨、顺序、材料安排、缺口；正式 `plan` 在就绪时形成版本，开始时冻结计划与完整风格规则。
- 一轮 Worker 保存结果后结束，不等用户。待回答、执行故障和稿件待审阅分别处理。新增材料和关键修改重开相关问答，局部修改直接修稿；保留旧快照和稿件。
- 请求编号保障重试去重；版本冲突返回409并保留本机输入。已提交会话远端保存；未提交选择、文字和题目进度按资料空间、会话、轮次保存在本机，旧版本机问卷可迁移。
- 会话 ZIP 导出包含协议版本、意图、轮次、工作提纲、原件和稿件历史。离线 HTML、Markdown/配图继续先预览后归档。

精确字段见 [共享协议](../skills/writing-workshop/references/protocol.md)。独立 Skill 与应用使用相同约定。

## 兼容与构建

Worker 心跳继续报告 `writingProtocol:1`，另报告 `writingSkills:[{version,hash}]`。v2 仅派给版本和 Skill 哈希匹配的节点；新版 Worker 使用冻结的 `skills/writing-workshop-v1` 执行旧任务。旧版 Skill 哈希保持 `385f6d5137c0b19f5cb946322c0d6a5d117d2fd8293ad04fc2c225ce86870b4b`。Docker 和桌面包均包含两个 Skill，不能只升级页面而省略 Worker。

Windows/macOS 共用 React 页面；Android/iOS 使用同一写作组件打出的本地 WebView 包，并以用户资料授权转发管理接口。Worker 凭据不获得会话管理权限。在 `collector/` 执行：

```sh
npm run build:desktop-ui
node scripts/stage-writing.mjs
```

生成的移动资源不入库，构建流水线也必须执行 staging。iOS 保留待发行签名，模拟器签名不替代发行签名或真机验收。

## 验证

```sh
node --test test/*.test.mjs
node --experimental-strip-types --test desktop/frontend/scripts/*.test.mjs
node scripts/qa-writing.mjs
node scripts/test-desktop-writing.cjs
node scripts/qa-writing-agent.mjs
# 可选：在隔离服务中明确开始，验证真实 Agent 成稿；不归档或发表
node scripts/qa-writing-agent.mjs --draft
```

浏览器验收使用真实隔离 REST 服务和可控轮次，检查逐题恢复、推荐不预选、部分答案与补充、可展开提纲、开始门槛、原件/历史导出、离线 HTML 和手机包。另校验打包后正文的本地图片引用，防止生成的 SVG 被归档过滤后仍报告图文成功；正式配图使用 PNG/JPEG/WebP/GIF/AVIF。原生桌面验收通过实际 Electron preload/IPC 和用户授权提交。真实 Agent 验证与可控 UI 验证分开，不将模拟轮次当作模型质量证明。

本次验证：服务端278项通过、18项环境条件测试跳过；前端153项通过；Android 41项单元测试与调试构建通过；iOS 31项模拟器测试通过。真实 Agent 用零材料的“连续学习、连续思考”完成两轮：首轮四个方向、三题，第二轮形成约定；明确开始前没有正文任务。桌面原生请求和手机包交互、图文预览、离线导出也通过。随后在隔离服务中明确开始，真实 Agent 按上述约定和默认规则生成约3200字正文及两张 PNG，完整上传为待审阅；离线 HTML 两图正常加载、手机无页面横向溢出，未自动归档。

与主分支的选区写作整合后，后端284项通过、18项按环境条件跳过，前端162项通过；正式 Android 签名构建、41项 release 测试及 lint 通过，iOS 1.0.5 的31项模拟器测试和未签名归档通过。正式 Windows 包和签名、公证后的 Mac 包也完成了原生问答及 owner IPC 检查。服务部署、正式分发、实际安装和回滚证据见 [0.2.5 发布记录](../../docs/releases/2026-10-16-writing-coauthor-0.2.5.md)。Android/iOS 真机硬件验收仍待完成，iOS 继续保留待签名。
