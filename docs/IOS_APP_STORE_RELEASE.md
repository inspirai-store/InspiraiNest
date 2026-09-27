# InspiraiNest iOS 首发准备

此文档记录可复核的首发配置和 App Store Connect 待办。**归档、导出 IPA、上传构建、TestFlight 和提交审核是不同步骤**；只有在 App Store Connect 中看到构建处理完成及审核状态后，才能报告对应步骤已完成。

## 构建范围

- 工程：`collector/mobile/ios/project.yml`，XcodeGen 生成 `PersonalLibrary.xcodeproj`。
- 首发版本：iOS `1.0.0 (1)`，iPhone、iOS 16.0 或更新系统。包含主应用和分享扩展。
- 发布 Bundle ID 使用构建者注册的 `COLLECTOR_BUNDLE_ID`；主应用与分享扩展必须共用 App Group 和 Keychain access group。`Config/Local.xcconfig` 只存本机配置，不提交到仓库。
- 首发功能：扫码或手动配对用户选择的 HTTPS 资料库；从其他应用收集文字、标题和链接；本机发件箱保留原文；查看任务进度、阅读资料库、管理授权设备。图片和视频附件暂不能直接收集。
- 应用图标是 1024×1024、无 alpha 通道的 PNG。主应用和扩展的版本号应一致。

## 本地验证

在 `collector/mobile/ios` 中执行：

```sh
xcodegen generate --spec project.yml
python3 scripts/check_contract.py
xcodebuild -project PersonalLibrary.xcodeproj -scheme PersonalLibrary \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' test CODE_SIGNING_ALLOWED=NO
xcodebuild -project PersonalLibrary.xcodeproj -scheme PersonalLibrary \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath build/InspiraiNest-1.0.0.xcarchive archive -allowProvisioningUpdates
```

归档后检查主应用和 `PlugIns/CollectorShare.appex` 的 Bundle ID、版本、签名证书、描述文件、App Group、Keychain access group，并运行 `codesign --verify --strict --deep`。使用 Xcode Organizer 或 `xcodebuild -exportArchive` 的 `app-store-connect` 方法导出，检查 IPA 内相同信息及 dSYM。上传前先在 App Store Connect 建立与 IPA Bundle ID 一致的 iOS App 记录；上传后等待 Apple 处理完成。

## App Store 页面草稿（简体中文）

- 副标题：分享链接与文字到个人资料库
- 关键词：资料库,网页收藏,链接收集,知识整理,自托管,分享扩展
- 描述：

  > InspiraiNest 帮你把 iPhone 上看到的网页链接和文字收集到自己的资料库。先在管理端生成配对二维码，扫码连接你的 HTTPS 资料库。随后从其他应用的分享菜单选择 InspiraiNest，即可保存原文并尝试提交。离线时内容留在本机发件箱，联网后可查看状态并手动重试。你还可以查看采集任务、阅读已归档资料、管理授权设备。使用前需要自行准备并保持 InspiraiNest 资料库服务在线。本版本收集文字、标题和链接，暂不接收图片或视频附件。

- 类别建议：效率。版权归属及联系信息应以 App Store Connect 的实际开发者主体为准。

此草稿不能替代真实截图、可访问的支持与隐私政策网址、准确的 App Privacy 回答及审核说明。

## 提交前必须核对

1. **审核可访问性**：提供持续在线的演示资料库、有效的 owner 配对二维码或手动配对凭据，以及可展示任务、发件箱和资料库的非私人示例内容。将操作步骤写入 App Review 备注；不得提供会过期的单次二维码而不给更新方式。
2. **隐私与支持**：发布可访问的公司隐私政策与支持页面，支持页面应有实际联系方式。根据最终运营方式逐项填写 App Privacy；核对分享原文、设备名称与安装 ID、所选服务器、阅读会话和任何服务端/Agent 处理。不要把“客户端没有广告 SDK”误填成“整个服务不收集数据”。
3. **地区合规**：按实际首发地区完成必要信息。中国大陆可用性、备案资料和欧盟交易商状态由 App Store Connect/相应主体资料核对，不根据代码推断已经完成。
4. **商品页**：上传真实 iPhone 截图，核对名称、描述、关键词、年龄分级、版权、支持 URL、隐私政策 URL、定价与上架地区。截图须来自最终候选包，不展示真实用户的私密资料。
5. **最终验收**：用与待上传 IPA 同一源码版本，在真机复测扫码配对、分享链接/文字、离线重试、任务列表、资料库阅读和设备撤销。确认 App Store Connect 中构建处理成功后才关联版本并提交审核。
