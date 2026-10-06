# WeChat Article To MD Skill

English | [中文](#中文)

Convert WeChat Official Account articles into clean local Markdown archives, with article images downloaded into the same folder.

This repository contains a Codex Skill and a self-contained Python pipeline. It is useful when you want to save, archive, or reuse WeChat public articles as GitHub-flavored Markdown.

## Features

- Fetch WeChat article pages from `mp.weixin.qq.com` or `weixin.qq.com`.
- Extract article title, author, account name, and main content.
- Download article images locally and rewrite Markdown image links.
- Convert article HTML into Markdown.
- Clean common WeChat noise such as QR prompts, preview labels, and read-original prompts.
- Fix common Markdown rendering issues, including tables, lists, blockquotes, code fences, and missing images.
- Optionally save cleaned source HTML for inspection.

## Skill Structure

```text
wechat-article-to-md-skill/
├── SKILL.md
├── README.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── formatting-edge-cases.md
│   ├── 搜索公众号文章链接.md
│   └── 用户环境配置.md
└── scripts/
    └── wechat_article_pipeline.py
```

## Requirements

- Python 3.9+
- `requests`

Install the Python dependency:

```bash
pip install requests
```

## Usage

Run the pipeline from the skill directory:

```bash
python scripts/wechat_article_pipeline.py "<wechat_article_url>" --output-dir "./articles"
```

Save cleaned HTML as well:

```bash
python scripts/wechat_article_pipeline.py "<wechat_article_url>" --output-dir "./articles" --save-html
```

Use `python3` instead of `python` if that is the Python command in your environment.

## Arguments

| Argument | Description | Default |
|---|---|---|
| `<url>` | WeChat article URL | Required |
| `--output-dir` | Output root directory | `{workspace}/articles` |
| `--workspace-dir` | Workspace directory for default output resolution | Auto-detected |
| `--save-html` | Save cleaned `source.html` | Disabled |
| `--timeout` | HTTP timeout in seconds | `30` |

Workspace auto-detection order:

1. `--workspace-dir`
2. `WORKSPACE_DIR`, `PROJECT_ROOT`, or `CLAUDE_WORKSPACE`
3. Current working directory

## Output

The script creates a numbered article folder:

```text
articles/
├── 01_Article_Title/
│   ├── Article_Title.md
│   ├── source.html
│   ├── image_01.jpg
│   └── ...
```

The generated folder is the final archive structure. Do not move images unless you also update the Markdown image paths.

## Using As A Codex Skill

Copy the whole `wechat-article-to-md-skill` folder into your Codex skills directory:

```text
~/.codex/skills/wechat-article-to-md-skill
```

On Windows, this is usually:

```text
C:\Users\<YourName>\.codex\skills\wechat-article-to-md-skill
```

Restart Codex after installing the skill.

Example prompts:

- `Use $wechat-article-to-md-skill to save this WeChat article as Markdown: <url>`
- `Download this WeChat Official Account article and keep the images locally: <url>`
- `Convert this mp.weixin.qq.com article into a Markdown archive: <url>`

## Notes

- This tool targets WeChat Official Account article pages. Generic web pages are not guaranteed to work.
- Articles that require login, are deleted, or are blocked by access restrictions may fail.
- If the output title is `未命名文章`, treat the URL as invalid or inaccessible.
- If you need to search for WeChat article links first, read `references/搜索公众号文章链接.md`.

## 中文

# 微信公众号文章转 Markdown

将微信公众号文章转换为干净的本地 Markdown 归档，并把文章图片下载到同一目录中。

本仓库包含一个 Codex Skill 和一个自包含 Python 处理脚本。适合用于保存、归档、整理或复用微信公众号文章内容。

## 功能特性

- 抓取 `mp.weixin.qq.com` 或 `weixin.qq.com` 微信文章页面。
- 提取文章标题、作者、公众号名称和正文内容。
- 下载正文图片到本地，并重写 Markdown 图片引用。
- 将文章 HTML 转换为 Markdown。
- 清理常见微信噪音，例如二维码提示、预览标签、阅读原文提示等。
- 修复常见 Markdown 渲染问题，包括表格、列表、引用、代码块和缺失图片。
- 可选保存清洗后的 HTML，方便检查。

## Skill 目录结构

```text
wechat-article-to-md-skill/
├── SKILL.md
├── README.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── formatting-edge-cases.md
│   ├── 搜索公众号文章链接.md
│   └── 用户环境配置.md
└── scripts/
    └── wechat_article_pipeline.py
```

## 环境依赖

- Python 3.9+
- `requests`

安装依赖：

```bash
pip install requests
```

## 使用方法

在 skill 目录下运行：

```bash
python scripts/wechat_article_pipeline.py "<微信文章链接>" --output-dir "./articles"
```

同时保存清洗后的 HTML：

```bash
python scripts/wechat_article_pipeline.py "<微信文章链接>" --output-dir "./articles" --save-html
```

如果你的环境使用 `python3` 命令，请将示例中的 `python` 替换为 `python3`。

## 参数说明

| 参数 | 说明 | 默认值 |
|---|---|---|
| `<url>` | 微信文章链接 | 必填 |
| `--output-dir` | 输出根目录 | `{工作区}/articles` |
| `--workspace-dir` | 用于解析默认输出目录的工作区 | 自动检测 |
| `--save-html` | 保存清洗后的 `source.html` | 关闭 |
| `--timeout` | HTTP 请求超时时间，单位秒 | `30` |

工作区自动检测优先级：

1. `--workspace-dir`
2. `WORKSPACE_DIR`、`PROJECT_ROOT` 或 `CLAUDE_WORKSPACE`
3. 当前工作目录

## 输出结构

脚本会创建按序号递增的文章目录：

```text
articles/
├── 01_文章标题/
│   ├── 文章标题.md
│   ├── source.html
│   ├── image_01.jpg
│   └── ...
```

生成的目录就是最终归档结构。不要移动图片，除非同时修改 Markdown 中的图片路径。

## 作为 Codex Skill 使用

将整个 `wechat-article-to-md-skill` 文件夹复制到 Codex skills 目录：

```text
~/.codex/skills/wechat-article-to-md-skill
```

Windows 通常是：

```text
C:\Users\<YourName>\.codex\skills\wechat-article-to-md-skill
```

安装后重启 Codex。

示例提示词：

- `Use $wechat-article-to-md-skill to save this WeChat article as Markdown: <url>`
- `帮我把这篇微信公众号文章保存为 Markdown，并下载图片：<url>`
- `把这个 mp.weixin.qq.com 文章转成本地 Markdown 归档：<url>`

## 注意事项

- 本工具主要面向微信公众号文章页面，不保证适配普通网页。
- 需要登录、已删除或访问受限的文章可能抓取失败。
- 如果输出标题是 `未命名文章`，通常说明链接无效或无法访问。
- 如果需要先搜索微信公众号文章链接，请阅读 `references/搜索公众号文章链接.md`。
