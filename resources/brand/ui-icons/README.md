# InspiraiNest UI 图标

生成方式：内置 image_gen。以 ../inspiration-nook-source.png 为风格参考，六次独立生成；完整提示词见 prompts.json。原 App 图标保持原样。

- library：资料库；collect：采集与新建采集；person：我的。
- bookmark：收藏切换、阅读收藏和列表收藏标记。
- scan：扫码连接；update：应用更新与安装入口。

*-source.png 是原始生成结果；export/ 提供 24、32、48、64、96、128、192px 透明 PNG。Lanczos3 缩放，裁去多余透明留白并统一可视尺寸；不重绘图标。APK 仅携带 128px 成品，按 24–36dp 使用。夜间图标直接使用透明背景，不绘制外围衬片（包括选中状态）；图标原色不变。

运行 node collector/scripts/build-mobile-icons.mjs 可重新导出。manifest.json 记录每档尺寸与字节数；本轮六枚 32px 文件均为真实 RGBA，角像素 alpha=0，主体 alpha=255。

预览：../../mobile/icon-preview.html
