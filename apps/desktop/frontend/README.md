# 桌面 React 前端

当前为阶段 2 骨架，基于已经通过用户验收的 Pencil v1 黑灰原型。数据来自 `src/workspace/mock.ts`，使用与原型相同的标题、日期和数量。

## 运行

依赖：Node.js 24 以上；先安装 collector 的 Electron / sharp 依赖，再安装本目录依赖。

```sh
npm ci --prefix collector
npm ci --prefix collector/desktop/frontend
npm --prefix collector/desktop/frontend run dev
npm --prefix collector/desktop/frontend run desktop
```

开发预览：`http://127.0.0.1:5176/#/records/new`。深色：`#/records/new?theme=dark`。其他页面：`#/records/demo`、`#/library`、`#/library/demo`、`#/records`。

桌面预览使用独立临时 profile；沙箱与上下文隔离开启，无 preload、Worker、授权、用户资料或业务接口。生产 `main.mjs`、托盘和安装包入口保持现有版本，待后续各阶段验收后切换。

## 验证

```sh
npm --prefix collector/desktop/frontend run capture
npm --prefix collector/desktop/frontend run compare
```

capture 在隔离 Electron 窗口渲染生产构建，按原型 12 个产品画板捕获，再归一为 1 倍 PNG。macOS Retina 的原始光栅按实际 DPR 记录；截图输出尺寸为 CSS 视口尺寸。它同时采集 DOM 区域与 Pencil 实测布局逐项比较，并记录渲染错误和网络请求。compare 输出 50% 叠加图、4 倍差异图及像素统计。Pencil 布局参考由 MCP 读取，前端运行时不加载设计文件或原型图片。

验收资料位于 `design-review/desktop-refactor/stage-02-skeleton-v1/`。区域几何 1px 容差是骨架检查，字形抗锯齿单独判断，不能用像素差异百分比代替人工验收。

## 本阶段范围

实现顶栏、导航、标题栏、列表和内容区，以及 1240 / 900 / 740 布局。导航、新建演示页、详情与窄屏返回用于检查页面结构；正文和条目区域可独立滚动。其他按钮、筛选和输入是固定外观，控件行为在阶段 3 验收。真实保存、同步、加工、附件和搜索在阶段 5 接入。

中文保留 PingFang SC；拉丁字符采用 Arial fallback 对应 Pencil 的数字、空格和项目符号度量。行高取 Pencil 实测的整数值，字体墨迹基线补偿独立于布局盒。Windows 使用 Segoe UI / Microsoft YaHei UI 的字体适配与原生验收将在阶段 7 完成。
