---
name: lingnest-wechat-archive
description: 下载公开的微信公众号文章正文和配图，保存 Markdown，并按灵藏资料库约定登记来源。
metadata:
  version: "2026.10.7.1"
---

# 公众号公开文章归档

先读取任务工作目录中的 AGENTS.md。读取本 Skill 的 [抓取脚本](scripts/wechat_article_pipeline.py)。

只处理用户给出的公开 https://mp.weixin.qq.com 链接。禁止读取浏览器会话、密码和其他账号授权文件，不绕过登录、验证码或访问控制。访问失败时保存 pending/partial 来源及实际错误。

用本机已有的 uv 运行脚本，不全局安装 Python 依赖。把 SCRIPT 替换为本技能目录中的 scripts/wechat_article_pipeline.py 完整路径，把 ARTICLE 替换为用户链接：

```sh
UV_CACHE_DIR="$PWD/.cache/uv" uv run --with requests python "$SCRIPT" "$ARTICLE" --output-dir "$PWD/articles"
```

此脚本会下载完整 Markdown 和支持的微信配图。检查标题和正文完整度，不能把错误页或验证码页当成文章。

成功后将正文文件登记为 source/original，图片登记为 image，中文摘要登记为 summary；source.json 标注 canonical_url、aliases 和精确的 collected_at。保留源文件和图片的相对路径，不上传 source.html。不得凭标题或摘要代替全文。按资料库模板补齐元信息并执行 catalog build/check，最后写 collector-result.json。

## 来源

本技能包含 Yui-cx/wechat-article-to-md-skill 的完整可移植包，基于提交 41f1ed58a9c74e8c61ffbe8f3290c0d13e5ff759，保留 [MIT 许可](LICENSE)。灵藏版收紧网址和图片域名检查，拒绝重定向，禁用 Requests 的隐式 netrc 授权，并适配任务资料库输出。
