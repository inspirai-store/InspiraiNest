# InspiraiNest

品牌名称为 **InspiraiNest**，版权主体为 **Wuhan Inspirai Technology Co., Ltd.**。

沿用用户当前应用的书本、星光与嫩芽图标。网页、桌面、Android 文件与原工作区的当前应用逐字节一致；iOS 图标为同一画面的无 alpha PNG，以符合 App Store 图标要求。

| 用途 | 文件 |
| --- | --- |
| 原始应用图标 | `collector/brand/inspiration-nook-source.png` |
| 网页 | `assets/brand-icon.png`、`collector/public/brand-icon.png` |
| 桌面 | `collector/desktop/icon.png`、`icon.ico`、`tray.png` |
| Android | `collector/mobile/android/app/src/main/res/drawable-nodpi/ic_inspiration_nook.png` |
| iOS | `collector/mobile/ios/Assets.xcassets/AppIcon.appiconset/icon-1024.png` |

界面标题、应用显示名、新 Android/Worker 安装包使用 InspiraiNest。既有六枚功能图标原样保留。代码许可及图像范围见 [RIGHTS.md](RIGHTS.md)。

兼容性标识保留：`store.inspirai.*` 应用标识、Keychain/App Group 配置、CLI 的 `lingnest` 命令及 `LINGNEST_SERVER`、`lingnest-library` skill 路径、CLI 凭据服务名 `LingNest CLI`。这些是既有接口或存储名称，不是新产品显示名。

下载服务接受 InspiraiNest 与历史 LingNest 清单文件名，并保留同版本的两套品牌入口及 `personal-library-*` 更新入口。每个入口都只映射到受清单与哈希校验约束的同一版本文件，不开放任意目录。
