# 电商公开数据功能：参考资料索引

整理日期：2026-10-18；以下源码/供应商文档的阅读核验日期主要为 2026-10-11。未刷新候选项目或服务当前状态。

[综合报告](../ecommerce-public-data-feasibility.md)；[历史实测公开字段证据](evidence.json)。

## Catbus 固定提交源码与文档

基线 `e637cb43078cbe776313ac3500cf0646c2a7b843`。以下索引来自原本地快照，SHA-256 针对当时保存的 UTF-8 文本，便于与原资料核对；本次提交不复制第三方完整源码。

| 文件/来源 | 原快照文本 SHA-256 |
| --- | --- |
| [docs/platforms/taobao.md](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/docs/platforms/taobao.md) | `dbaf198b34bd5d73d85475887f37a7699e2cf97becff36a6577140951eea04fa` |
| [docs/platforms/jd.md](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/docs/platforms/jd.md) | `2c6335ad25698861bd4e38cde2d0ae0ec0f0e05e87953ac6efa0eaf5a4aec1e1` |
| [docs/platforms/xianyu.md](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/docs/platforms/xianyu.md) | `7f2e9dacdb17d6c4e861d655057731bff1ed3e1caa407e1fc597fbc78fb91647` |
| [docs/platforms/douyin.md](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/docs/platforms/douyin.md) | `f90c94d5ea84a2c6b1ca9fec0f9afffb6ff733d594bc7d743546fa6a7268c555` |
| [docs/guide/output.md](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/docs/guide/output.md) | `7c1f86fcfd1942f7e97b1f5a821667737135182e4673237b892ffa72de93db8d` |
| [src/core/normalize.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/core/normalize.ts) | `8806814f7b079d86d4b7e2e626fd693e49f3a2f2665f5ee36b7a9294f1d5a773` |
| [src/core/schemas.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/core/schemas.ts) | `ef0c290f869c4bf191a563e5c3f18248acb776247e5a3c1143eada01ae9871b8` |
| [src/platforms/index.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/index.ts) | `c645d6d9f3e3a3ddc6f9f26779cad337d1cef82c5f66cf9bff40b1d1820b75b1` |
| [src/platforms/taobao/web/commands.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/taobao/web/commands.ts) | `ea95f3b8c7109d39a429a49576d800428b4a224603877ce0d82db5b17b70b979` |
| [src/platforms/taobao/web/api.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/taobao/web/api.ts) | `15edd6b78d9c134f6e7d203d7552aba8d9dbdf8d52e32d6c58b47ddf480d2a00` |
| [src/platforms/taobao/web/normalize.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/taobao/web/normalize.ts) | `82e7f09d52964e96ec589666ce8e3960ee1f62e5de15825e124385f1f514ed4d` |
| [src/platforms/jd/web/commands.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/jd/web/commands.ts) | `480f931551f444cc094f3256ef69df89fac5680d39850ff9d1bdf36c9076090f` |
| [src/platforms/jd/web/api.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/jd/web/api.ts) | `d136bd949a8222fcd8752478113565f0595d0f534f1e349284798fcf2c27deac` |
| [src/platforms/jd/web/normalize.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/jd/web/normalize.ts) | `6aecf7858922ab401709a75fac8e54ae05ea6d1b8875b57dfe914ba68379ae83` |
| [src/platforms/xianyu/web/commands.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/xianyu/web/commands.ts) | `3aca093bf10d1e205b5ecf8cfefcd44a249c72ba57919168e38f9c17e5af1ee1` |
| [src/platforms/xianyu/web/api.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/xianyu/web/api.ts) | `facc36021fe46f54e83187172ec849ed45a4a39c373056214e358fca28b3afb8` |
| [src/platforms/xianyu/web/normalize.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/xianyu/web/normalize.ts) | `23032468686d1389372805cc4d7617473cae2abecbaef426b4d3a29bc438395e` |
| [src/platforms/douyin/web/commands.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/douyin/web/commands.ts) | `d1da9d73f5cdcd32d01bf0295c5a66039d5bb99c20ebdf30f0072737399bcd35` |
| [src/platforms/douyin/web/api.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/douyin/web/api.ts) | `98f000889c415a3e1ec92fcc1c2bec79a5d9439b1b3cabbbbbd872f4099eae76` |
| [src/platforms/douyin/web/normalize.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/douyin/web/normalize.ts) | `c57815483d907f2d4d2339a050a138339934621fa854a03d3e614a50b51b9d45` |
| [src/platforms/taobao/web/resolve.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/taobao/web/resolve.ts) | `378256f3ce101e9230e556079a10051b65fb0fcc1fbe565a3a4c9c0d481c0420` |
| [src/platforms/xianyu/web/resolve.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/xianyu/web/resolve.ts) | `55ac33863db1bfc826320deff0060b3711d028882559900198ac3d3840e13064` |
| [src/platforms/douyin/web/resolve.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/douyin/web/resolve.ts) | `bddfd1fd548043e97924f8f3067ba569c0237354485504f0d1cd6229205eb5a7` |
| [src/platforms/jd/web/util.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/jd/web/util.ts) | `8461c734ee96a9a475b903760444c3fb8519b1d9a76f043eeecf4d05a2b9d63d` |
| [src/platforms/jd/index.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/jd/index.ts) | `2e29dfd853c02074eae34b75b72824014a3422d95ba86fd485a7e3dece518b30` |
| [src/platforms/xianyu/index.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/xianyu/index.ts) | `9e3d12702b2c70252b375e2065158b1c3e0e363ca8e40595fd23041dc646061d` |
| [src/platforms/taobao/index.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/taobao/index.ts) | `bed801966cc981d89618fa99691c8f569a5c0a57fd75fba73ebdeed3acc97739` |
| [src/platforms/douyin/index.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/platforms/douyin/index.ts) | `9ef31c1bc888fc9dc1956a5a4db253f4c86b63e760a257a1f03f5d16ded2786a` |
| [src/cli/dispatch.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/cli/dispatch.ts) | `95204a6143a5b9273cde7a60599d84bc934b32ee7e5d23e5c937ee9fabceafac` |
| [src/cli/output.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/cli/output.ts) | `32c8e8b18d284c9d6ffde79a8fe62a7ff7a712a664ddcb2cb676286460b5cda1` |
| [src/core/registry.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/core/registry.ts) | `eeeabe7be16271b685197771c025fcd39b86803bca35f780b49fb5d4cc5f9630` |
| [tests/e2e/live.e2e.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/e2e/live.e2e.ts) | `efb6a95fd42631eddb1ade3df792b8b0f706f020bebac05906938beae1276115` |
| [.github/TESTING.md](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/.github/TESTING.md) | `4cf044d82800e269e6138fc40e587df8e48a74a99f79a88befb055b0abe97b6c` |
| [tests/jd.test.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/jd.test.ts) | `540ff6117f276ac38e68678ee44eb305bb3546e0833940bff7df02769fc726c1` |
| [tests/douyin.test.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/douyin.test.ts) | `23b62952055aa9b00df343d9ebf629c85ec580ec959f6e87f3720d2ae18eb70c` |
| [tests/taobao.test.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/taobao.test.ts) | `e3dd97a7f63b7bf4bb89e82c7c3e20dce83ee6156cd144d8ed91f499ac143aed` |
| [tests/xianyu.test.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/xianyu.test.ts) | `a08b4eac7effba2981c20a989e8c25e0f0590215bb8cf1d2c6e9aeab199a8bdc` |
| [CHANGELOG.md](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/CHANGELOG.md) | `c01b696d65af6bb3a9ebc199c66138352dbe51fb34f987ce68100c0a4fecf485` |
| [docs/guide/login.md](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/docs/guide/login.md) | `efd9aa7b1937cb8ad3fa9dad58757147cc50cf51bdbc2025b6589af9872ec92f` |
| [src/core/vocab.ts](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/src/core/vocab.ts) | `d6ac39d47bbed85e1c412e14d70f85d0094c2d559cd878bb4061bec09bbbe079` |
| [docs/examples/node-api.mjs](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/docs/examples/node-api.mjs) | `ef3f8027e87dde44c79a99245af3e1029f2e06ef4c4b373e3df1189af7ef46e0` |
| [docs/examples/user-items-backup.sh](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/docs/examples/user-items-backup.sh) | `41f5f4ef23b6a32893e5d2f221cacb1dba061bd103c274058edf224d966d9710` |
| [README.md](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/README.md) | `07f7d380c67d2085cb601eaa012228491d639bb25dba270c5ebeedc08f001f6f` |
| [package.json](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/package.json) | `5be1ec0f912bc389c63d9d25d38596870aca348462427b35c063e00b67ff1fb7` |
| [LICENSE](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/LICENSE) | `c9e49466458d708b961a48cba008694c531b7bd438a9c5bcf14b107927913d54` |

## Catbus 测试材料的证据边界

阅读 fixture 只能证明请求/归一化的测试输入与期望，不能代替用户目标的实际返回。原核验记录逐项保存 synthetic_evidence，部分空响应即使 status_code=0 也不能证明商品字段有效。

- [tests/golden/douyin/product_comments.json](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/golden/douyin/product_comments.json)：历史 fixture 摘录；用户样本连通性另看实际证据包。
- [tests/golden/douyin/product_detail.json](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/golden/douyin/product_detail.json)：历史 fixture 摘录；用户样本连通性另看实际证据包。
- [tests/golden/douyin/product_comment_counter.json](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/golden/douyin/product_comment_counter.json)：历史 fixture 摘录；用户样本连通性另看实际证据包。
- [tests/golden/douyin/live_products.json](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/golden/douyin/live_products.json)：历史 fixture 摘录；用户样本连通性另看实际证据包。
- [tests/golden/jd/product_detail.json](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/golden/jd/product_detail.json)：历史 fixture 摘录；用户样本连通性另看实际证据包。
- [tests/golden/jd/product_comments.json](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/golden/jd/product_comments.json)：历史 fixture 摘录；用户样本连通性另看实际证据包。
- [tests/golden/xianyu/item_detail.json](https://github.com/cv-cat/catbus/blob/e637cb43078cbe776313ac3500cf0646c2a7b843/tests/golden/xianyu/item_detail.json)：历史 fixture 摘录；用户样本连通性另看实际证据包。

## 其他开源候选

以下候选在本需求中未执行；初始研究通过 README、源码树和相关实现检查定位用途。

- [ecom-scraper](https://github.com/Runjeo/ecom-scraper)：适配器/规范模型与 fixture 边界。
- [Product-Crawling](https://github.com/hairconker/Product-Crawling)：关键词商品读取、Playwright、PDD 移除说明。
- [MarketSpider](https://github.com/zhangjiancong/MarketSpider)：商品发现候选。
- [ai-goofish-monitor](https://github.com/Usagi-org/ai-goofish-monitor)：闲鱼监测。
- [Goofish 卖家/评价源码](https://github.com/Usagi-org/ai-goofish-monitor/blob/master/src/scraper.py)：卖家商品与采样评价；非平台整体好评率。
- [pyxianyu](https://github.com/DoLovya/pyxianyu)：闲鱼 userId 商品列表候选。
- [pyxianyu 商品列表实现](https://github.com/DoLovya/pyxianyu/blob/main/src/pyxianyu/apis/item_api.py)：get_user_items/get_all_user_items 与 nextPage。
- [xianyu_spider](https://github.com/superboyyy/xianyu_spider)：闲鱼补充候选。
- [CommentAnalysis](https://github.com/hengshen2233/CommentAnalysis)：评论采集/处理；存在指标语义缺口。
- [CommentAnalysis PDD 源码](https://github.com/hengshen2233/CommentAnalysis/blob/main/spiders/spider/pdd.py)：店铺评价归属。
- [CommentAnalysis 淘宝源码](https://github.com/hengshen2233/CommentAnalysis/blob/main/spiders/spider/taobao.py)：用户等级与评分不可混用。
- [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)：内容评论工程；非商城全店能力证明。
- [pddSpider](https://github.com/SZFsir/pddSpider)：历史 anti_content 限制。
- [DDK_SDK 历史店铺接口](https://github.com/makelove/DDK_SDK/blob/master/测试/下线/查询店铺商品1.py)：作者将旧店铺接口标为下线，非当前官方接口验证。

## 商业服务 SDK、端点与样例

全部未凭证试调。开源 SDK、样例字段、供应商宣称与目标商品成功返回分别记录；不代表免费服务或已验收能力。

- [TikHub Python SDK](https://github.com/TikHub/TikHub-API-Python-SDK)。
- [Just One API Python SDK](https://github.com/justoneapi-labs/justoneapi-python)。
- [淘宝店铺列表 V4](https://docs.justoneapi.com/zh/api/taobao-and-tmall/shop-product-list-v4)。
- [淘宝销量 V1（研究时标为过期）](https://docs.justoneapi.com/zh/api/taobao-and-tmall/product-sales-v1)。
- [京东店铺列表 V1](https://docs.justoneapi.com/zh/api/jdcom/shop-product-list-v1)。
- [京东评价 V2 样例](https://github.com/justoneapi-labs/justoneapi-python/blob/main/docs/api-examples/getApiJdGetItemCommentsV2.json)。
- [抖音店铺列表 V1](https://docs.justoneapi.com/zh/api/douyin-e-commerce/shop-product-list-v1)。
- [抖音商品评价 V1](https://docs.justoneapi.com/zh/api/douyin-e-commerce/item-comments-v1)。
- [抖音详情 V2 样例](https://github.com/justoneapi-labs/justoneapi-python/blob/main/docs/api-examples/getApiDouyinEcGetItemDetailV2.json)。
- [Onebound 拼多多详情](https://open.onebound.cn/help/api/pinduoduo.item_get_app-3.0.0-7.0.html)。

## 原始实测的保存与整理方法

浏览器阶段公开字段原记录时间为 2026-10-11T20:54:07+08:00；Catbus 京东/抖音分页汇总记录时间为 2026-10-11T22:28:47+08:00。详情修复、商品统计、店铺 HTTP 探测及测试结果由对应工具输出的原时间恢复，未以文件修改时间冒充采集时间。

证据包 browser_stage 是早期状态；douyin_cli 与 douyin_shop 是后续增量。早期 product_good_rate=null 不会否定后续商品统计成功；两个阶段必须结合阅读。

本地原报告与原始响应仍保存于资料库，本次远程交付只包含综合分析、公开字段摘录及来源索引；不上传账号会话、整份运行日志或第三方全仓库。
