# 技能市场部署与验收

功能与 Agent 目录规则见 [Agent 技能说明](../collector/docs/agent-skills.md)。0.1.26 的网页服务与 Windows 客户端已发布；远端节点需要新版客户端，才能上报安装目录及执行市场安装。

## 私有对象存储权限

技能包使用既有对象存储的 `private/skills/<完整包哈希>.json`。生产服务的 RAM 身份需要在此目录拥有 `oss:GetObject` 与 `oss:PutObject`。只有 `archives/*` 权限的旧部署会在技能导入时返回 403；本地存储或隔离测试通过不能证明生产 OSS 已授权。

可为原服务账号附加一条独立策略，保留原归档权限。替换以下账号与 Bucket 占位符：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:GetObject", "oss:PutObject"],
      "Resource": ["acs:oss:*:ACCOUNT_ID:BUCKET_NAME/private/skills/*"]
    }
  ]
}
```

技能包保持私有，由已授权的服务端接口提供预览和安装。生产修复采用 `LibraryCollectorProdSkills` 策略，仅附加到原服务账号；Bucket ACL、归档策略和既有网络入口保持原状。回退功能时可单独解除这条策略，保留已保存的版本和对象。

## 0.1.26 发布证据

- 安装包来源：提交 `9303c2784f184611c094df92227796528008e822`，公开 [CI 37793669048](https://github.com/inspirai-store/InspiraiNest/actions/runs/37793669048)，10/10 检查通过。
- Windows NSIS：`InspiraiNest-v0.1.26-Windows-x64.exe`，116033357 字节，SHA-256 `3f5e6948d7acda4e31818e722d5ca63509b2d57be9cc63d3af547a8a8bcc4d3f`。
- 生产镜像标签：`prod-skill-market-026-20261008-r1`，摘要 `sha256:8a5a308a28c98822fb47e4a16074f00e164659ae37b8ce9ff59007afbadce5c4`。以切换前的 `prod-macos-025-20261008-c970f8c` 镜像摘要 `sha256:f6a9fa0a6d25a272b0c4a18995c8ad86b38b28877018983a163f4ccd8832287c` 为回滚目标。
- 生产预检核对 126 个文件哈希；五 Agent 安装、盘点和回滚采用隔离目录。当前下载及兼容链接均完整下载校验；下载页桌面、最小与手机尺寸通过。macOS、Android、阅读器清单保留发布前内容。
- 真机验证：原有官网授权继续有效，Windows 客户端与 Worker 均为 0.1.26，Worker 恢复在线运行。本机盘点 176 条 Agent / 目录记录，包含兼容读取；此数值不代表 176 个独立技能。
- 通过真实服务下载、校验并保存 `wechat-article-spider` 1.0.0 的完整 6 文件包，远端私有库可再次提供相同版本。ZIP SHA-256 为 `37b04ca10ac7e1a8f93ae44f3598fd07f4e388739ab39385b4a60252e6d6c0e2`。验收没有把该包安装到用户的真实 Agent 目录，也没有执行其脚本。
- 发布前已有的 46 个任务与 93 份归档全部保留。第三方技能的实际 Agent 执行、未声明依赖与尚未升级的远端节点分别保留未验证状态。
