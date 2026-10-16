# AI 主导计划式写作：0.2.5

构建源码：`e8fc172a0d182e373ca74d92296e2948b7c5994d`。整合计划式共创与主分支既有的选区改写、右键操作，保留两种写作方式。桌面版本 0.2.5；Android 1.3.11 / versionCode 18；iOS 1.0.5 / build 10 保留待签名。

## 行为与兼容

- 从一句写作意图开始，标题由 AI 暂拟，记录、资料和范文可选。AI 先理解主题、提出不同方向及问题，不将意图编造成作者经历。
- 一次显示一题，支持前后切换、单选、多选、暂不确定和自由回答；推荐不预选。部分选择可以和一句纠正共同提交，本机恢复未提交内容，已提交轮次跨设备保存。
- 标题和工作提纲随问答维护。明确点击“开始写作”才创建正文任务；没有范文时使用 `builtin-editorial-v1`，默认规则不冒充作者个人风格。
- 材料、答案、计划、风格和稿件分别保留历史；正文、引用及加工说明分开，支持图文预览和离线导出，仍先预览后确认归档。
- v2 按精确 Skill 版本和摘要分配，新 Worker 同时支持冻结的 v1。当前摘要为 `418919847d23a626c63deb4e092e7305941e8ccd8ce49d81a90a0e5ea47ba4d9`，冻结 v1 摘要为 `385f6d5137c0b19f5cb946322c0d6a5d117d2fd8293ad04fc2c225ce86870b4b`。用户管理授权与 Worker 执行凭据保持分离。

## 验证

- 整合后本地后端 284 项通过、18 项环境条件测试跳过，前端 162 项通过；[完整公共 CI](https://github.com/inspirai-store/InspiraiNest/actions/runs/38863089567) 全部通过，包括 MySQL、Android、Windows、两个 Mac 架构及打包 UI。
- 桌面/手机共享页面、实际 Windows Electron owner IPC、逐题恢复、自由补充、明确开始门槛、历史导出和离线图文预览通过。真实 Codex Agent 在隔离服务中从“连续学习、连续思考”完成两轮，并在显式开始后生成约 3200 字及两张 PNG，保存为待审核，未自动归档。
- [Windows 原 CI 文件转存](https://github.com/inspirai-store/InspiraiNest/actions/runs/38863772723) 核对源码、成功构建和资产摘要，未重新构建 Windows 正式文件。
- Android 41 项 release 单元测试与 lint 通过，签名证书与上一正式 APK 一致；MuMu 模拟器从 1.3.10 覆盖升级至 1.3.11。
- iOS 31 项模拟器测试通过；未签名设备归档已保存。归档使用示例发行配置，正式签名时须恢复实际 Team/Bundle 配置并重新归档；没有 IPA，公开 iOS 分发保持为空。
- Android/iOS 真机拍照、录音，Intel Mac 硬件 GUI 以及真实中文输入法候选态仍未验收。构建和模拟器结果不代替这些硬件验证。

## 服务与回滚

服务代码先行部署，镜像为 `yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-writing-025-20261016-r1@sha256:d6b0a1f47b04daa82faa5082e73dca74581f19d21f03dad24b1e566dd2e60037`。18 项隔离 API/兼容检查及实际部署后的文件摘要、健康检查、原有授权和数据 ID 保留检查通过；该阶段不改变客户端发布清单。

服务上线前回滚目标为 `yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-writing-clients-023-20261016-r1@sha256:231296890ad87da104fc0aef52fb9076932d2ab6c3de509f186b4eeb9ea723e6`。复用现有 Deployment、数据库、存储及网络入口。私有授权、本机记录快照与运行证据不提交公开仓库。

## 正式发布与实际安装

- [macOS 签名发布](https://github.com/inspirai-store/InspiraiNest/actions/runs/38863130776) 全部通过，包括两个架构 Developer ID 签名、公证、Gatekeeper 与签名包内记录、问答、用户授权、冲突及更新退出检查。
- [GitHub v0.2.5](https://github.com/inspirai-store/InspiraiNest/releases/tag/v0.2.5) 的17个文件与构建/OSS回执逐项核对大小和 SHA-256。最终镜像候选预检核对234个文件，并实际访问所有桌面包、Android包、Mac feed、两个 ZIP 及 blockmap。上线后另完成11次完整 HTTP 下载、桌面范围请求、私有文件404和三个尺寸下载页验收。
- 最终镜像：`yunizeni-registry-vpc.cn-shenzhen.cr.aliyuncs.com/yunizeni/library-collector:prod-writing-clients-025-20261016-r1@sha256:57339f8502c749157dc86b8e4b36894f77c0609ef7a7b0c26c5cd164ab228450`。客户端清单回滚到上文服务先行镜像，保留 v2 服务并恢复上一批分发文件。设备授权、任务、资料及原有记录 ID 保留检查通过。
- 四台登记电脑均经正式更新流程升级至0.2.5并返回成功回执。三台在线 Windows Worker 上报 v1/v2 精确能力；Mac 原本未运行 Worker，升级后保持停止，已核实实际安装包内 Worker/Skill 为0.2.5/v2。服务中的旧 Worker 心跳为历史值，不作为正在执行的版本。
- 本机 Windows 实际安装程序和卸载程序均为0.2.5。实际安装版通过隔离 REST 的逐题问答、补充纠正、本机恢复，以及生产只读的用户授权和新文章入口检查。未创建生产测试文章或启动生产测试任务。
- 本机原有21条记录 ID 全部保留：20条摘要一致，1条从本机v3恢复至服务端早已保存的v4，两版正文均核对历史保留。另同步增加1条记录，升级后共22条；草稿、资料管理授权、原配置与设置保留。私有备份留在本机运行目录。
- 本机卸载列表再次残留旧版显示字段。已核实唯一登记路径、程序及卸载程序版本，备份注册项后仅修正本机显示名称和版本；未将其宣称为已修复的通用 NSIS 行为。
- Android 正式包已发布且完成模拟器覆盖升级；iOS 1.0.5/build10保留未签名归档，不重试发行私钥。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| [InspiraiNest-v0.2.5-Windows-x64.exe](https://library.inspirai.store/downloads/InspiraiNest-v0.2.5-Windows-x64.exe) | 118393282 | `2203f72c2b2fc568f7fb8743f827de40977aeb7fb004caac06b2e226f0eef93a` |
| [InspiraiNest-v0.2.5-macOS-x64.zip](https://library.inspirai.store/downloads/InspiraiNest-v0.2.5-macOS-x64.zip) | 142500786 | `2b7c2b934a946a0e8c5e0e061f82991fa4df59e12833bff7b5481958a896ead2` |
| [InspiraiNest-v0.2.5-macOS-arm64.zip](https://library.inspirai.store/downloads/InspiraiNest-v0.2.5-macOS-arm64.zip) | 135710667 | `2415581df055ee76e43572ce42e42d69598307bcb023bfa661ec284b1d865ac7` |
| [InspiraiNest-v0.2.5-macOS-x64.dmg](https://library.inspirai.store/downloads/InspiraiNest-v0.2.5-macOS-x64.dmg) | 142493781 | `fc3abf2d119add9da1c7f09a3756171c0c7a451a9d67d29976bdcd8f76aedde8` |
| [InspiraiNest-v0.2.5-macOS-arm64.dmg](https://library.inspirai.store/downloads/InspiraiNest-v0.2.5-macOS-arm64.dmg) | 135735682 | `ffdcba1fd86e5520f91205740aa2961f9fe07a25a78c8715432d44167095fb96` |
| [InspiraiNest-v1.3.11-Android.apk](https://library.inspirai.store/downloads/InspiraiNest-v1.3.11-Android.apk) | 3291096 | `a56b8b890fcbe4be35766776bbec48e469b22328567b5f432cda50ede40b9930` |
