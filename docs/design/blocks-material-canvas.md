# 积木资料画布

仅改积木内资料。采用研究工作台布局：资料卡、部件卡、目标卡和有方向的关系，点选后在侧栏读完整条件与证据。工作区让出主画布，全部积木入口返回选择列表；保留列表模式及既有计划、加入、暂停、评价和交接流程。

视觉沿用产品设计变量：深色 #0f1114 / #161a1f / #e6e8eb，浅色 #f2f5f8 / #ffffff / #24313d，关系使用少量绿、橙、红。复用现有 Arial、PingFang SC、Segoe UI 字体链作为既有设计系统约束，不引入在线字体。仅显示真实资料摘要、状态、数量、引用和操作，不加入说明性小字。

采用 @xyflow/react 12.12.0，React >=17，MIT。官方资料：https://reactflow.dev/learn/customization/custom-nodes 、https://reactflow.dev/examples/interaction/save-and-restore 、https://xyflow.com/open-source 。自定义卡片与工具栏使用现有 Lucide 与控件；保留依赖许可证，关闭库的宣传链接。Excalidraw 偏向自由绘图；tldraw 当前生产 SDK 需要许可密钥，故选择更贴近资料节点及多对多关系的 React Flow。

通用组件位于 packages/ui-react/src/canvas，不依赖积木插件。插件模型负责按 kind/sourceId/version 合并卡片，保留独立关系、历史版本与部件依赖。拖动/缩放布局仅保存到按资料空间和积木划分的 localStorage，不写积木 revision 或证据。后台刷新保留已有位置；首次新资料到来时，在用户尚未调整视角的情况下适应全图。搜索变更定位当前结果。只允许资料连到部件，复用既有 join API，结果仍待语义判断。

验收涵盖卡片合并、历史/排除过滤、拖拽及缩放刷新恢复、搜索后位置保留、证据侧栏、真实连线只产生 lead、列表切换与窄屏。最终还要在签名客户端打开现有 REA 积木，确认全部旧条件和材料不变。
