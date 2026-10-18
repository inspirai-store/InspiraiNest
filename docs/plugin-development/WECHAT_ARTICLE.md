# 微信正文采集接入参考

## 范围与证据

2026-10-18 重新读取本机 CodeBuddy 原生入口中的 `wechat-article-spider`，当前 `SKILL.md` 声明版本 **1.0.1**。源码及测试文件 SHA-256 见 [sources.json](sources.json)。这是本地安装包，不是当前仓库内的依赖，也没有因本次整理而复制进仓库。

| 时间与对象 | 已确认 | 不能据此确认 |
| --- | --- | --- |
| 2026-10-07，旧版 1.0.0 的公开文章探针 | 指定文章获得正文及 4 张可读取图片，正文引用 3 张；当时存在段落压平、发表时间未提取问题 | 不是 1.0.1 的当前实测，也不是评论采集 |
| 2026-10-11，1.0.1 正文比较记录 | 两篇普通文章分别取得 18 张、2 张正文配图；本地引用完整；留言请求均返回业务错误 `ret=-3, no session` | 普通文章成功不扩大为图文卡片真实验收，更不等于留言可读 |
| 2026-10-18，本轮离线复核 | 当前安装包 9 项 unittest 全部通过；确认实现包含段落、链接、公开时间、图文卡片及失败状态处理 | 本轮未重新获取上述公开文章，未验证目标 Mac、Agent 原生调用或生产上传 |

早期探针地址为 `https://mp.weixin.qq.com/s/xjOk53p1F2gMPxYZF05Ixw`。这里只保留公开来源定位与获取边界，不复制其正文或配图，不核验文章内技术主张。

## 调用和结果约定

调用时由适配器提供实际 Python 入口、技能路径和本任务独立输出目录，不硬编码用户名或系统盘路径：

```text
<python> <skill-root>/scripts/main.py <article-url> <task-entry>/original --json
```

依赖为 `requests`、`beautifulsoup4`、`lxml`。本轮测试环境为 Python 3.14.7、requests 2.34.2、beautifulsoup4 4.15.0、lxml 6.1.3；这是验证环境，不是建议锁定的最低版本。Windows/macOS 的 Python 入口需要分别检测实际可执行性和同一解释器内的模块，不能只检查 PATH 名称。

| 退出码 | 本地结果 | 适配器处理 |
| --- | --- | --- |
| `0` | `article.json.status=ready` | 正文与脚本识别的配图取得；仍须阅读、归档、校验及上传 |
| `1` | 获取或解析失败；stderr 输出失败 JSON | 核对 `code` 和实际文件；不假定已生成 `article.json` 或成功文件 |
| `2` | 正文已保存；`status=partial`、`missing_images` 非空 | 保留成果、展示缺图，重试或按明确范围做部分归档，不能自动标为完整 |

目录中包含正文 Markdown、`images/`、`article.json` 和原始 `page.html`。`article.json` 的主要字段为 `schema_version`、`status`、`source_url`、`title`、`author`、`publisher`、`published_at`、`collected_at`、`page_type`、`markdown`、`body_characters`、`images`、`missing_images`、`raw_html`、`raw_html_sha256`。

这些是脚本当前输出，不是灵藏正式附件或任务协议：

- `article.json.status=ready` 不等于 `collector-result.json` 已就绪，更不等于远端归档完成。
- 作者与公众号分开记录；公开发表时间可能缺失，`#publish_time` 回退可能只有文字日期，适配器必须保留精度与未知值。
- `collected_at` 使用运行主机时区并精确到秒；入库时核对偏移，界面统一按北京时间显示，不修改历史采集时间。
- `body_characters` 是转换后的文本统计，不是全文完整度证明；纯图片图文需实际查看关键配图。
- 图片文件头校验能拒绝 HTML 错误页，但不能替代图片完整解码检查。

## 实现可借鉴处

正文优先 `#js_content` / `.rich_media_content`，图片优先 `data-src`；图文卡片读取 `content_noencode` 与 `picture_page_info_list`，只取根级配图而非水印。页面脚本仅作为文本解析，不执行 JavaScript。转换保留段落、标题、链接、列表、引用和代码；这比旧版改善，但不能推断任意复杂表格和混排都已高保真。

验证页、空正文和仅有标题/简介会被拒绝；`SOURCE_UNAVAILABLE`、`EMPTY_CONTENT` 等业务失败与网络异常区分。正文截图中出现历史留言，不表示获得当前留言列表。

## 产品接入前的缺口

1. **来源与许可**：本地安装包根目录未见 LICENSE，版本号和哈希只用于定位，不能把它视为已获 MIT 再分发授权。先补来源和权利确认；本次不搬入代码。
2. **网络边界**：当前本地脚本直接 `requests.get`，没有产品级 URL/重定向及图片域名限制，也未禁用隐式 netrc。不能未经处理接收任意远端任务 URL；接入前限制 HTTPS、来源及资源域名，拒绝未经验证的跳转和隐式凭据。
3. **运行预算**：现有请求有单次超时，但没有统一下载字节预算、图片数量预算、取消及断点合同；同标题可能覆盖同目录文件。采用独立任务输出目录、总预算、取消和不覆盖快照的策略后再集成。
4. **依赖与复现**：只给出了宽范围 requirements；后续固定分发版本及测试环境，明确缺依赖和失败恢复，不在系统 Python 中静默安装。
5. **归档闭环**：提取成功后补 `source.json`、摘要、文件登记与 catalog build/check，转换为现有任务结果。不要向平台或模型发送本机会话。

现有仓库另有 [lingnest-wechat-archive](../../collector/examples/skills/lingnest-wechat-archive/SKILL.md)，来自 Yui-cx 的固定 MIT 提交，已收紧网络边界并适配技能任务。它与本地 `wechat-article-spider` 是不同实现、不同参数和结果合同，不能混用版本号或把一方的验证算给另一方。优先比较其可复用部分，避免增加同名平行工具。

## 轻量包和验收

远端登记提取后 Markdown、报告和正文图片。`page.html`、`article.json` 只作本机诊断，不登记为远端附件；公开需要的作者、来源和时间转写到 Markdown。当前轻量附件白名单不接受 HTML/JSON/JSONL，不能在报告中留下仅存在本机的诊断链接。

| 层次 | 最低测试 |
| --- | --- |
| 解析夹具 | 普通文章、图文卡片、缺元信息、中文转义、嵌套水印、空页、验证页、缺图、伪图片 |
| 网络与文件 | URL 与跳转限制、资源预算、超时/取消、Windows 长路径、相对图片路径、重复任务不覆盖历史 |
| Agent 与工作节点 | 固定技能快照、实际脚本调用、待操作恢复、原文与摘要分离、有效任务分配与结果校验 |
| 远端与离线 | 轻量包链接完整、图片真实解码、远端阅读、下载回本地后仍可 `file://` 阅读 |

本地 skill 的测试入口为 `python -B -m unittest discover -s <skill-root>/tests -v`。本轮 9 项测试不在仓库中；新适配器需另提交可在干净检出运行的合成测试，不能依赖这台机器的已安装技能。
