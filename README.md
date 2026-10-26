# 灵藏 · InspiraiNest

围绕灵感收集的本地优先资料库。基础收集、保存、同步、检索与阅读始终可用；AI 助手、写作工作台、新知与 Agent 实验室按资料空间启用。

[新知](plugins/learning/README.md) 将收集的材料转为待确认学习目标、先修路径与练习记录，并支持教学任务包、成果回收和博客草稿交接。

## 开发

需要 Node.js 24+；JS/TS 采用 npm workspaces 和根目录锁文件。

```sh
npm ci --ignore-scripts
npm run build:all
npm start
# 另一个终端
npm run desktop
```

首次桌面开发需运行 `node node_modules/electron/install.js`。Web 使用 API 服务的 `/workbench/`，桌面和 Web 共用工作台、组件和插件贡献。开发 Web 可运行 `npx vite --config apps/web/vite.config.ts apps/web`。

```sh
npm run build:native-assets
npm test
node scripts/catalog.mjs build
node scripts/catalog.mjs check
```

最后两条命令继续生成根 `index.html`、`assets/` 和资料索引，支持 `file://` 离线阅读。资料正文和运行数据库保持原位置，默认运行目录仍兼容 `collector/data`、`collector/worker-data`，也可使用现有环境变量配置外部路径。

## 目录

| 目录 | 职责 |
|---|---|
| `apps` | Web、Windows/macOS、Android、iOS、CLI 和离线阅读器 |
| `services` | API、存储适配与 Worker 宿主 |
| `packages/core` | 收集、内容、阅读、同步与基础业务 |
| `packages/plugin-sdk` | 清单、注册、生命周期、能力及宿主接口 |
| `packages/ui-react`、`packages/design-tokens` | 共享组件与视觉定义 |
| `packages/library-kit`、`packages/contracts` | 归档工具和跨端协议 |
| `plugins` | AI 助手、写作、Agent 实验室 |
| `resources` | 品牌、技能和资料模板 |
| `infra`、`tooling`、`tests` | 部署、构建、检查和测试 |
| `collector` | 旧命令兼容入口、既有测试与发布辅助脚本 |

插件机制、数据归属、迁移及跨端支持见 [架构说明](docs/architecture/PLUGINS.md)。项目管理为后续可选插件，本轮未创建业务实现。

[自托管](docs/SELF_HOSTING.md) · [安全模型](SECURITY.md) · [MIT License](LICENSE) · [第三方声明](docs/THIRD_PARTY.md)
