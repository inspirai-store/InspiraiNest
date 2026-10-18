# 评论采集调研、原型实现与真实验证参考

整理日期：2026-10-18（北京时间）。调研和平台实测发生于 2026-10-11 至 2026-10-12；本次整理核对了本地源码、验证报告及采集清单，没有重新登录平台或重抓评论。外部项目的能力、维护和许可观察均限定于下文固定提交，不代表当前状态。

本文供后续开发视频、公众号及视频号评论采集功能参考。原型总体状态为 **partial**：B站视频的评论、回复、导出和恢复已有真实验证；公众号仅第一篇在用户打开的微信窗口取得真实留言，独立 CLI 阅读会话尚未跑通；视频号评论尚未实现。有效内容分析仍是设计方案。

本次提交仅包含整理报告与阅读入口。真实评论、原文、昵称、截图、图片、浏览器配置、账号标识及会话值保留在本地；CatBus 原型源码不随本报告发布。

## 1. 需求与实现基线

原需求是采集视频、公众号文章等内容下的评论，保留楼中楼和图片，再筛选有价值的纠错、经验、问题与补充。开发顺序确定为：B站楼中楼及评论图片 → 公开公众号精选留言和作者回复 → 登录账号可管理的视频号作品评论。

首轮实现采用独立 CLI 和本地导出，没有接入 InspiraiNest Worker，也没有增加模型分析。后续查看源码时应区分三个版本：

| 对象 | 版本或位置 | 含义 |
| --- | --- | --- |
| CatBus 上游基线 | [e637cb43078cbe776313ac3500cf0646c2a7b843](https://github.com/cv-cat/catbus/tree/e637cb43078cbe776313ac3500cf0646c2a7b843) | 已读取的公开源码基线 |
| 用户 fork | [alexxxiong/catbus](https://github.com/alexxxiong/catbus) | 不能以 fork 地址推断其已包含下述本地扩展 |
| 本地原型 | 分支 `codex/comments-wechat`，提交 `11860ec7612f49fc41a17974f49443b475da8563` | 本次核对时尚未推送；本文命令和实现说明均针对这个原型，不是 npm 发布版能力 |
| 本报告所在项目 | InspiraiNest，整理起点 `5ef1cab50f2aa6f155a10f8b34e4b3b5c50f9589` | 仅沉淀开发依据，不表示产品已接入评论采集 |

平台能力必须分别验收：内容可读、身份有效、评论可读、回复翻页结束、附件可用、目标范围完整。前一项成功不能替代后一项。

## 2. 能力与证据总览

| 平台或路径 | 已实现、已观察到的结果 | 未完成或不能外推的范围 |
| --- | --- | --- |
| B站视频 | 标准 CLI 楼中楼、评论图片、本地导出、页内停止及恢复通过真实样本 | 整个视频仍有未采集一级评论；带图楼中楼没有真实样本；其他内容类型未据此验收 |
| 公众号普通浏览器 / HTTP | 两篇正文和 DOM 可得；评论响应实际为 `base_resp.ret=-3`、`no session` | 0 条真实留言，不能算评论成功；独立 CLI 会话仍未通过 |
| 用户手动打开的微信窗口 | 第一篇取得 145 条可见留言／回复，27 条有作者标记；折叠回复已展开 | 缺平台评论 ID、精确父回复 ID、评论图片地址；第二篇未完成；不等于 CLI 自动化成功 |
| 自有视频号后台 | 专用浏览器扫码登录和真实身份核验通过；作品列表成功返回但为空 | 没有可验证的作品评论；内容列表及评论命令保持 planned / `NOT_IMPLEMENTED` |
| 他人视频号公开分享预览 | 可读说明、时间及互动计数 | 评论按钮要求转到微信，未取得评论正文；计数不等于采集数量 |
| 评论有效内容分析 | 已形成线程、证据与人工验收方案 | 没有实现模型评分、没有真实质量指标，不作为交付能力 |

原有抖音、小红书等适配器不属于本轮真实验收。公众号文章、公众号视频消息、文章内嵌视频和视频号也是不同来源，不能合并标记为“微信视频已支持”。

## 3. GitHub 项目能借鉴什么

以下结论来自 2026-10-11 的固定版本阅读。除 CatBus 本地扩展外，没有把其他项目运行结果当作本次真实验收，也没有引入其源码或二进制依赖。许可说明仅记录所见文件与采用前的核对事项。

| 项目与固定版本 | 有用的实现或设计 | 当时发现的限制 |
| --- | --- | --- |
| [CatBus · e637cb4](https://github.com/cv-cat/catbus/tree/e637cb43078cbe776313ac3500cf0646c2a7b843) | 多平台 CLI、统一模型、会话、分页和输出框架，适合先做一个来源的闭环 | LICENSE / package 标为 MIT，README 同时有非商业学习声明；采用前澄清适用范围。不能把本地新增能力归给上游 |
| [MediaCrawler · 156c602](https://github.com/NanmiCoder/MediaCrawler/tree/156c602c8d689266e6c5e9130b36f0b70495f5f0) | B站评论游标、置顶去重、子回复分页、父 ID 存储 | 非商业学习使用许可 1.1；默认一级上限 10、子回复关闭，不宜照搬为商用依赖或称默认全量 |
| [Moore · dea919b](https://github.com/Moore-developers/moore-wechat-article-downloader/tree/dea919bdd6397e56ad8ec31654fa12b7113db0db) | 评论 `scope/source/fetched_at/complete`、按文章与范围去重、精选评论导出 | MIT；该版 README 称依赖接口关闭并暂停维护。DOM 路径显式 `complete=false`，参考数据模型比依赖旧链路更合适 |
| [CreatorHub · 037f8b3](https://github.com/3441293738/creatorhub/tree/037f8b39387a715ef7ef7a28a22a66770e22fd67) | 自有账号响应监听、监控队列、评论 ID 去重 | 限本账号作品；代码注明评论页地址需实机校准；固定文件树未见根 LICENSE |
| [wx_video_sdk · 8e9f2f7](https://github.com/dsxksss/wx_video_sdk/tree/8e9f2f77fca17600d2272bd78e2e5c04455b18df) | 自有作品与评论读取结构 | 作品固定第一页，评论固定空 `lastBuff`；不能据此证明翻页。未见根 LICENSE，且含回复、私信及修改操作，未运行其运营程序 |
| [wechatDownload · 4e3ee7c](https://github.com/qiye45/wechatDownload/tree/4e3ee7cbbdc88816ee8d682253d38df81ae607ae) | 作者描述的文章评论／回复下载及本地 MCP / Skill 接口 | 本次取得的是说明与 Skill，未运行下载器核心；未见根 LICENSE。文档存在远端回退，不能默认转发用户资料 |
| [bilibili-api · 3798d3b](https://github.com/Nemo2011/bilibili-api/tree/3798d3b3bd3c3a93678d5a0367637a19262303ef) | 历史检索线索 | 该固定提交只保留停维说明，不作为新方案核心依赖 |
| [BERTopic · 9036123](https://github.com/MaartenGr/BERTopic/tree/9036123c97aaa9a6cc4bec4a6db1a7caf9209df6) | 后续规模增大时的主题聚类和代表文本 | MIT；主题聚类不等于评论价值判断或事实核验，中文短文本需另行评估 |

可直接复查的源码定位：

- MediaCrawler：[默认评论配置](https://github.com/NanmiCoder/MediaCrawler/blob/156c602c8d689266e6c5e9130b36f0b70495f5f0/config/base_config.py#L114-L121)、[B站分页](https://github.com/NanmiCoder/MediaCrawler/blob/156c602c8d689266e6c5e9130b36f0b70495f5f0/media_platform/bilibili/client.py#L257-L397)、[关系字段](https://github.com/NanmiCoder/MediaCrawler/blob/156c602c8d689266e6c5e9130b36f0b70495f5f0/store/bilibili/__init__.py#L95-L113)、[许可](https://github.com/NanmiCoder/MediaCrawler/blob/156c602c8d689266e6c5e9130b36f0b70495f5f0/LICENSE#L31-L48)。
- Moore：[停维声明](https://github.com/Moore-developers/moore-wechat-article-downloader/blob/dea919bdd6397e56ad8ec31654fa12b7113db0db/README.md#L1-L4)、[DOM 范围](https://github.com/Moore-developers/moore-wechat-article-downloader/blob/dea919bdd6397e56ad8ec31654fa12b7113db0db/scripts/wechat_downloader.py#L4710-L4720)、[存储范围字段](https://github.com/Moore-developers/moore-wechat-article-downloader/blob/dea919bdd6397e56ad8ec31654fa12b7113db0db/scripts/wechat_exporter.py#L1272-L1323)。
- CreatorHub：[本账号范围](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/README.md#L15-L30)、[评论响应处理](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/browser/channels_fetcher.py#L251-L312)。
- wx_video_sdk：[固定页与缓冲参数](https://github.com/dsxksss/wx_video_sdk/blob/8e9f2f77fca17600d2272bd78e2e5c04455b18df/wx_video_sdk/client.py#L277-L288)。
- wechatDownload：[能力描述](https://github.com/qiye45/wechatDownload/blob/4e3ee7cbbdc88816ee8d682253d38df81ae607ae/README.md#L1-L25)、[Skill 调用说明](https://github.com/qiye45/wechatDownload/blob/4e3ee7cbbdc88816ee8d682253d38df81ae607ae/skills/wechat-article-downloader/SKILL.md#L8-L30)。

“README 宣称支持”“源码存在函数”“本地可构建”“真实路径采集通过”“持续可运行”是不同证据等级。后续选型保留固定 SHA、许可原文和真实命令，先验证最小路径，再决定复用代码还是只借鉴结构。

## 4. 本地原型的数据和可靠性设计

### 4.1 先保存事实，再派生分析

```text
来源正文 / 字幕 / 配图
  -> 平台适配器：同次请求的原始页或实际 DOM
  -> 标准评论：平台、内容、ID、关系、文本、媒体
  -> 去重、线程组织、图片下载、覆盖范围与断点
  -> 本地 JSONL + Markdown + manifest
  -> 后续：基于上下文的分析、人工复核、产品归档
```

通用 `Comment` 已新增 `root_id: string | null` 和 `media: Media[]`，保留原字段，其他平台缺失时返回 null / 空数组。B站一级与回复均从 `content.pictures` 标准化图片地址和尺寸，楼中楼读取已通过探针的 `/x/v2/reply/reply`，按页保留根和父 ID。

关键规则：

- 所有平台 ID 用字符串，长整数在解析原始 JSON 时就避免精度损失。
- 去重键为“平台 + 内容 ID + 评论 ID”；根楼层、精确父回复、实际回复对象分别表达，未知关系不从昵称或顺序补造。
- 平台响应与规范化结果来自同一次请求，不能为了保存 raw 再请求一次并假定内容没变。
- 作者标记、来源、可见范围和合成 ID 依据需保留在原始记录或采集元数据中；本轮没有把所有这些字段都扩为通用 `Comment` 正式字段。
- 原生窗口合成 ID 仅保证本次采集内唯一；相对时间和显示文本可能变化，不能充当跨天增量主键。
- 图片、表情或无可读文字的记录仍保留。未取得正文不能直接判定评论无效。

### 4.2 导出与部分完成

新增 `comment export <item> --dir <目录>`；原有 `comment list`、新增 `comment replies` 继续支持 JSON / JSONL 输出。导出默认最多 200 条一级评论、每根 200 条回复，总评论请求页预算 200，可用 `--limit`、`--reply-limit`、`--max-pages` 调整。

预算按导出器的分页调用计数，不能解释为浏览器全部网络请求的上限；一次微信页面采集可触发多次底层留言请求，图片请求也应单独统计。

| 导出对象 | 保存内容 |
| --- | --- |
| `raw/page-*.json` | 同次请求的原始数据、时间及请求游标；微信另有实际 DOM 快照 |
| `comments.jsonl` | 去重后的标准化记录及关系、媒体引用 |
| `comments.md` | 人可读评论、来源定位及所属评论下的本地图片链接 |
| `images/` | 与评论 ID 和图片序号绑定的已下载文件 |
| `manifest.json` | 数量、范围、上限、结束原因、剩余游标、未消费记录和附件状态 |
| `state.json` | 一级／回复任务、当前页未消费数据和后续游标 |

默认下载评论图片。下载后验证能实际解码，记录尺寸、SHA-256、来源地址和本地路径；单张失败保留引用和错误，继续其他记录，恢复时可重试失败附件。仅有扩展名、HTTP 成功或非空文件不能证明它是有效图片。

达到上限、预算耗尽、访问受限、分页停滞、回复未展开完或图片失败都应标记 `partial`。只有已确认范围内页结束且附件成功，才能标记该范围 complete；这里的范围不包含不可见、未审核或其他账号才可见的内容。没有显示评论时也不能直接认定平台确实为零。

### 4.3 恢复时保留当前页

标准 CLI 在 `--limit` 截断一页时，保存完整已取得页及消费偏移，再返回缓存游标。导出保存 pending 页后才逐条消费；`--resume` 使用原状态继续，不能只保存下一页游标而丢掉本页剩余数据。

缓存绑定平台、endpoint、账号、内容和影响请求的选项；限制数量等纯消费选项可调整。恢复必须检查身份和输入一致。请求预算在发请求前计数，失败请求同样消耗预算。对重复页、重复游标、失效缓存和零新增记录显式记录原因。

重新请求旧页再跳过 N 条可能遇到排序变动或服务端有状态游标，造成重复或跳页；因此保存“当前页未消费数据 + 下一游标”是本轮最值得复用的实现。

### 4.4 本地源码导航

下列路径属于前述 CatBus 本地提交，供持有该工作区的开发者定位；不是 InspiraiNest 已有文件或远端依赖。

| 责任 | CatBus 内路径 |
| --- | --- |
| 标准模型与默认值 | `src/core/schemas.ts`、`src/core/normalize.ts` |
| 页缓存和导出状态 | `src/core/comment-cursor.ts`、`src/core/comment-export.ts` |
| B站请求、命令与图片 | `src/platforms/bilibili/web/api.ts`、`src/platforms/bilibili/web/commands.ts`、`src/platforms/bilibili/web/normalize.ts` |
| 微信浏览器和采集证据 | `src/platforms/_shared/wechat-browser.ts`、`src/platforms/_shared/wechat-capture.ts` |
| 公众号 | `src/platforms/wechat_mp/` 下的 `index.ts`、`commands.ts`、`parse.ts`、`dom.ts` |
| 视频号登录和公开信息 | `src/platforms/wechat_channels/` 下的 `index.ts`、`commands.ts`、`public.ts` |
| 专项测试 | `tests/bilibili-comments.test.ts`、`tests/comment-export.test.ts`、`tests/comment-cursor.test.ts`、`tests/wechat-comments.test.ts`、`tests/wechat-capture.test.ts` |
| 使用与能力边界 | `docs/comment-collection.md`、仓库 `AGENTS.md` 及能力矩阵 |

正式迁入产品前应先核对该提交、许可和源码目录，不以本文表格代替代码审查。

## 5. B站真实验证：成功项与剩余范围

公开样本：[BV1KjoxBoEQJ](https://www.bilibili.com/video/BV1KjoxBoEQJ/)。原始页时间为 2026-10-11 22:40:30—22:41:47 +08:00；目标楼中楼的 13 页在 22:40:52—22:41:06 取得。独立导出审计时间为 23:08:42 +08:00。

| 检查 | 历史真实结果 |
| --- | --- |
| 一个多页楼中楼完整读取 | 244 条不同回复 ID，`has_more=false` |
| 停止后恢复 | 7 + 237 = 244，ID 集合与完整读取一致，无重复 |
| 导出第一阶段 | 12 条一级、0 回复、1 次评论页请求、11 张图片 |
| 提高上限后恢复导出 | 60 条一级 + 1,178 条回复 = 1,238 条不同记录，94 次评论页请求 |
| 目标根楼层导出 | 13 页、244 条，回复页耗尽，无剩余缓存 |
| 图片 | 56 / 56 下载并独立解码；尺寸、哈希、所属评论和 Markdown 本地链接均核对通过 |
| 关系 | 与原始 root / parent 字段一致；5 个 parent ID 没有对应到已取得快照，照存缺口 |
| 总体完整度 | `partial`：一级达到 60 条上限，仍有后续游标 |

56 张图片全部属于一级评论。带图楼中楼只有离线解析测试，没有真实验收。缺失父 ID 不能被解释为父评论已删除，也没有为它们制造占位原文。视频验证不扩展到图片动态；原有动态仅支持纯文字和转发的边界保留。

以下是原型命令模板，`ROOT_COMMENT_ID` 和 `RETURNED_CURSOR` 为占位值；历史具体 ID、缓存值及账号证据保留在本地，不作为报告的公开附件。

```powershell
node dist/cli/main.js bilibili auth login --method qrcode -a validation
node dist/cli/main.js bilibili comment replies BV1KjoxBoEQJ ROOT_COMMENT_ID --all -a validation -o json
node dist/cli/main.js bilibili comment replies BV1KjoxBoEQJ ROOT_COMMENT_ID --limit 7 -a validation -o json
node dist/cli/main.js bilibili comment replies BV1KjoxBoEQJ ROOT_COMMENT_ID --cursor RETURNED_CURSOR --all -a validation -o json
node dist/cli/main.js bilibili comment export BV1KjoxBoEQJ --dir .comment-exports/bili --limit 12 --reply-limit 0 --max-pages 2 -a validation
node dist/cli/main.js bilibili comment export BV1KjoxBoEQJ --dir .comment-exports/bili --resume --limit 60 --reply-limit 300 --max-pages 200 -a validation
```

恢复需使用原 `CATBUS_HOME` 和同一导出目录。上述模板不是在本次整理时重新执行的采集命令。

## 6. 公众号：为何正文可以取，留言仍失败

### 6.1 两篇普通浏览器 / HTTP 实测

用户提供的公开文章为：

| 样本 | CLI 评论采集时间（+08:00） | 实际结果 |
| --- | --- | --- |
| [AzY-H8-WBu9FGu8L6pXnqA](https://mp.weixin.qq.com/s/AzY-H8-WBu9FGu8L6pXnqA) | 2026-10-11 23:08:44—23:08:55 | 正文与 DOM 成功，每篇 5 次评论相关请求，评论 0、回复 0，`ret=-3` |
| [oN5iDaKqu4tDpG1U_zvBLw](https://mp.weixin.qq.com/s/oN5iDaKqu4tDpG1U_zvBLw) | 2026-10-11 23:09:36—23:09:47 | 同上；两篇均保留部分成果并标记 partial |

这里请求可以返回 HTTP 200，但业务响应为 `no session`。应保存业务码和实际响应，不能仅用 HTTP 状态、文章标题或正文长度判断评论成功。

用户要求参考的本地 `wechat-article-spider` 使用普通 HTTP、BeautifulSoup 等解析文章正文容器（如 `#js_content`）并下载正文配图，不提供公众号留言登录或评论采集链路。历史执行两篇共下载并解码 20 张正文图片（18 + 2）；使用类似请求头和 Referer 再测留言，仍为 `ret=-3`。

第一篇正文中存在类似评论的图片，它是作者放进文章的插图，不是这次文章下方的实时留言。正文 Skill 成功解释了“为什么文章和图片能获取”，没有证明评论会话可用。

### 6.2 用户打开微信窗口后的真实结果

用户随后在已登录的 Windows 微信中手动打开第一篇。2026-10-12 01:15:43—01:21:58 +08:00，通过原生窗口可访问性结构和截图读取可见内容，并实际展开回复：

| 检查 | 实际结果 |
| --- | --- |
| 可见记录 | 初始 132 条，5 处折叠入口新增 13 条，最终 145 个采集内唯一 ID |
| 作者标记 | 27 条记录有界面明确显示的“作者”标记 |
| 页面范围 | 页面显示“留言 145”，与采集数一致；出现末尾标记，没有剩余展开控件 |
| 根楼层关系 | 11 个经界面核对的楼层，共 41 条记录确认 root 归属 |
| 未知关系 | 平台评论 ID 未取得，全部精确 parent ID 保持未知，其余根归属不猜测 |
| 非文本和媒体 | 保留 2 条无可读文字记录；未取得评论图片地址 |
| 本地证据 | JSONL、可读 Markdown、可访问性快照、7 张可解码截图及 18 个文件的哈希清单 |

“页面数量一致且可见范围展开完”仅描述本次窗口的文本覆盖。原型仍为 partial，不能由此宣称取得全平台评论、精确回复链、评论图片或独立 CLI 自动采集能力。第二篇尚未完成原生窗口采集。

### 6.3 会话问题的结论与处理顺序

当时微信已登录，无需重新扫码。微信原生阅读路径带有客户端阅读上下文并能显示实际留言，普通浏览器路径没有取得有效留言会话。**已证实的是两条访问路径结果不同；尚未证明差异只由 Cookie、User-Agent 或某一个 URL 参数决定，也没有验证阅读会话能移交 Chrome 及其有效期。**

视频号后台扫码、公众号管理后台登录和文章读者会话分别验证，不能互相代替。后续若提供扫码流程，必须用实际留言响应证明会话适用于目标文章，不能只凭登录头像或 Cookie 存在判定成功。

原型使用专用 Chrome，会话目录按平台、endpoint 和账号隔离；Chrome 不可用时用 Edge。公众号优先解析页面实际结构化响应，缺失时解析实际评论 DOM，尝试加载更多及展开回复，保存真实可见范围。平台 ID 缺失时标记合成来源，不能把 DOM 退路写成全量承诺。

历史操作中，独立浏览器工具直接访问公众号被站点安全策略拒绝，后续采用的是用户手动打开页面后的可见窗口读取，没有绕过限制。后续开发应优先复现获授权的读取路径，不提取常用浏览器凭据、不要求用户粘贴会话值，也不将原生成功伪装为标准 CLI 验收。

## 7. 视频号：身份、公开计数与评论正文的区别

专用浏览器通过扫码，并从真实 `/auth/auth_data` 响应确认登录身份，随后 `auth status` 返回已登录。但后台 `/post/post_list` 实际为 `errCode=0`、空列表、总数 0，没有可用自有作品样本。

因此没有观察到非空自有视频 ID、评论分页缓冲或回复关系字段。`user items me`、`comment list`、`comment replies` 和 `comment export` 保持 planned，执行返回 `NOT_IMPLEMENTED`（退出码 4）。没有用猜测的页面地址和请求参数补成虚假实现。

用户补充的公开分享样本为 [A5lzbQIz8N](https://weixin.qq.com/sph/A5lzbQIz8N)，采集于 2026-10-11 23:02:52 +08:00。实际跳转到公开预览页，观察到 `/finder-preview/api/feed/get_feed_info` 元信息响应：

- 可读取说明、时间和互动计数；当时评论计数为 61，取得的评论正文仍为 0。
- 点击实际评论控件后，页面提示扫码前往微信，没有取得评论正文响应。
- 返回的 `dynamicExportId` 不能当作自有后台视频 ID；响应缺作者账号 ID 和播放地址，对应标准字段保留 null / 空数组。
- 另外两个公开入口也只证明元信息路径，不能替代自有作品评论验收，亦不能证明客户端中评论不可获取。

可借鉴其他项目的响应监听与去重方式，但在首个有评论、回复的自有作品上确认实际字段和分页之后，才能实现评论读取。其他账号的公开评论属于另一条能力路径，不能从自有后台能力外推。

## 8. 测试记录与证据保管

以下为 2026-10-11 原型历史测试，不是本次文档提交重跑的结果：

| 检查 | 历史结果与解释 |
| --- | --- |
| 类型检查、构建 | 通过 |
| 新增评论专项 | 5 个文件、23 项通过；涵盖多页、长 ID、关系、跨页重复、断点、预算、空评论、坏图、微信响应及 DOM / 范围解析 |
| 首次完整离线套件 | 5 项因既有模型文件缺失失败；不是新增评论测试失败 |
| 最终有限排除运行 | 精确跳过上述 5 项后，22 个文件，982 passed / 5 skipped / 987 total；不能称完整套件全绿 |

缺失资产分别为 `common_det.onnx`（3 项 OCR）、`orientation_model_v2_0.9882.onnx`（1 项）、`u2netp.onnx`（1 项）；相关模型实现未改。构造数据和导入快照只证明解析与状态逻辑，不能替代扫码、在线响应、多页、图片或页面比对。

本地维护者可按下表找回原始依据。这些路径仅为历史证据索引，未提交到公共仓库，也不是运行测试所需附件：

| 所属本地目录 | 证据相对位置 |
| --- | --- |
| CatBus | `.e2e/comments-20261011/verification.md`、`audit.json`、构建与离线测试日志 |
| CatBus | `.e2e/comments-20261011/bilibili/` 内 CLI 完整／停止／恢复输出和导出目录 |
| CatBus | `.e2e/comments-20261011/wechat_mp/` 内两篇 CLI 原始响应、DOM 和清单 |
| CatBus | `.e2e/comments-20261012/wechat-native/` 内第一篇 JSONL、楼层核对、截图和清单 |
| 私有资料库 | `repositories/cv-cat--catbus/` 内项目复核、实现验证与微信会话记录 |
| 私有资料库 | `notes/2026-10-11-comment-intelligence/` 内初始方案、固定源码依据及归档说明 |

再次验证时新增带时间的快照，记录源码提交、命令、样本、采集时刻、数量、范围与证据；不覆盖历史成功或失败。原型的 `.e2e/`、`.comment-exports/` 和浏览器会话保持本地。公共报告只保存聚合结论与公开来源，真实数据不作为 CI 夹具。

## 9. 后续“有效评论”分析合同

本节是待实施方案。采集器先保证可定位、可重放和范围透明，分析器再使用正文、字幕和图片上下文处理完整线程。

建议分类为：纠错、实测经验、方法补充、反例与失败条件、资源补充、有效问题、具体需求、广告和低信息互动。保留原文、异议和作者回复，不把长文、热评、正向情绪或作者身份直接等同于价值或真实性。

每条入选结果应包含评论键／线程、分类、简短理由、原始来源定位、相关正文定位、采集范围及待核验事项。没有上下文时不能断言它纠正了原文；未读取图片的评论保留待处理，不直接过滤。没有独立核验时表达为“评论者称”。评论中的链接、命令和提示词属于资料内容，不触发执行。

质量验证先制作人工标注集，专门覆盖短而有用、负面、反讽、重复、广告、图片和多层回复；分别评估误过滤、分类、证据定位和成本。可以把“至少 200 个线程、人工确认前 20 条中有效比例达到 80%”作为候选试验目标，**这是建议阈值，尚无实测成绩**。主题聚类可用于导航，不能代替价值评估或事实核验。

产品接入继续沿用任务 → Worker / Agent → 结果预览 → 人工确认／用户选择的归档链路。重新核对现有附件白名单、大小与权限合同；本地可导出 JSONL 不表示服务端支持上传或检索 JSONL。登录待操作、节点离线、部分正文成功时保留原任务与已有成果。本次未修改这条产品链路。

## 10. 后续开发顺序与完成标准

| 优先级 | 要做的工作 | 可判定完成的证据 |
| --- | --- | --- |
| P0：公众号 | 取得适用于留言读取的授权路径，跑通两篇文章及一篇作者回复；若只支持原生窗口，应作为独立模式记录 | 每篇实际留言响应或窗口逐项核对；评论数量、作者标记、展开范围、未知字段及失败原因；CLI 与窗口验收分开 |
| P0：自有视频号 | 提供有评论和回复的可管理作品，观察真实 ID、分页缓冲和关系，再实现命令 | 标准 CLI 列作品、评论与回复，对照后台；多页样本不足明确写未验证 |
| P1：B站补齐 | 真实带图楼中楼、不同排序与恢复、其他内容类型分别测试 | 回复图片所属关系、文件解码和链接；重复和缺父关系报告；不扩大既有样本范围 |
| P1：稳定性 | 覆盖失效游标、分页停滞、请求失败、附件重试、取消与跨运行差异 | 合成测试加真实中断恢复；无静默跳页，旧快照保留，剩余范围可见 |
| P2：分析与集成 | 线程分析、人工标注、结果上传与阅读，之后再考虑增量和定时 | 分析引用可追溯；真实质量与成本报告；本机与远端附件一致，授权与任务归属通过验证 |

对任何新平台复用同一验收表：空评论、关闭评论、精选范围、一级多页、回复多页、置顶重复、长 ID、缺父关系、带图回复、预算截断、页内停止恢复、登录墙和单附件失败。未满足的项目写为未验证，不用 mock 或正文成功补齐。
