# 写作结果协议 v1

输入 writing-input.json 包含 sessionId、version、sources、answers、rounds、plan、style、request、mode、skill。sources 的完整文件通过 localPath 指向本机副本，包含材料与范文身份。全部读完后开始；无法读取则 kind=blocked。
记录的 document 保留图文顺序；媒体节点的原始附件编号对应 files[].attachmentId，files[].id 则用于本次授权下载和阅读清单，不要混淆两者。
资料库材料附 metadata 和 omitted。保留原条目的缺失与核验边界：只读过整理摘要不等于读过原文；缺失原始材料不得声称已核验。非关键缺口列入 openIssues 并讨论如何处理，无法理解的关键材料仍用 blocked。

## 共用会话文件

独立模式与应用导出共用 schemaVersion=1 的 session.json：id、version、title、createdAt、updatedAt；context、sources、answers、rounds、runs、plan、planVersion、style、styleCandidates、ready。context 默认为 {audience:"技术实践者",language:"zh-CN",outputs:["illustrated-article","offline-html","markdown","assets"]}，后续作者明确调整优先。sources 每项为 {id,kind,role,label,text,files}，可含 ref、version、document、metadata、omitted；本机文本和原件分别以 localTextPath、files[].localPath 定位，文件保留 id/path/sha256/bytes 及附件身份。导入后不更改稳定编号。

answers 保留 {roundId,questionId,key,title,selected,labels,text,uncertain,at}，不以整理后的 decisions 替代用户原话。rounds 每项为 {id,version,createdAt,result,answeredAt?}，result 使用下面的 round 协议。planVersion 仅在确认新约定时递增；style 有稳定 id、version、parentId、name、appliesTo、rules、sample、sources、createdAt，升级须明确确认，旧版本从历史可追溯。runs 保留稿件 taskId、mode、planVersion、styleVersion 与历史文件位置。

history.json 包含 {items:[各版本会话快照]}。独立续写时保留导入文件，以 history/<新version>.json 和新的稿件目录追加版本；先完整写临时文件，再替换当前 session.json。每轮结束都保存，不等待写完文章。status 是执行状态，不能用 ready、远端 processing 或旧稿存在来推断用户已授权新稿；开始或修订请求须有本轮用户明确指令。

## round

输出 writing-result.json，schemaVersion=1、kind="round"，包含：

- understanding：材料理解，字符串；changeSummary：相对前轮变化。
- coverage：[{sourceId,status:"read",files:[已完整读取的文件id]}]，恰好覆盖全部 sources，每份 files 恰好覆盖该源的所有文件；不能将只读摘要算作完整读取。
- directions：[{id,title,thesis,readerValue,support,missing}]，保留既有未采用方向。
- decisions：[{key,value}]，记录推导的写作决定，原始用户答案仍独立保留。
- openIssues：字符串数组；ready：布尔。
- questions：[{id,key,dimension,title,reason,mode,options:[{id,label,impact}],exploratory}]。通常2至3题，ready 时为空；text 的 options=[]。
- plan：准备完成时必需，{thesis,audience,scope,evidence,outline:[字符串],visuals,unresolvedHandling}。
- styleCandidate：按需，{name,appliesTo,rules:[{id,instruction,sourceId,example}],sample}，仅从指定范文提炼。已有确认 style 时不无故重新提炼。

自由回答和暂不确定由应用统一提供。不要把它们重复放进选项。不生成整篇正文。不要把“ready”误当成开始写作。
条件发生变化时仅重开受影响的决定；复用已回答的 key 必须填写 reopenReason，说明哪条新材料或要求使原决定需要重审。未受影响的决定继续沿用。

## draft / revision

用户已明确开始或提出局部修改。输出 notes/writing-<sessionId>-<taskId>/ 下的 source.json、article.md、summary.md、references.md、editorial-note.md 和 images/。正文 role=publication，摘要 summary，引用 reference，过程 source，配图 image；所有文件登记 files，图片用相对链接和可读图注。仅登记真实存在的文件。
revision 必须先判断修改影响。如果用户归类为局部修改，但实际要求改变主旨、结构、关键证据或风格，暂停改稿，改为输出 kind=round、ready=false 和两至三题。说明受影响的决定和原因，保留原稿；此轮作为待回答会话完成，不报环境故障。直接 draft 轮仍只允许生成已获授权的文章。

source.json 沿用资料库 schema_version=1，type=note，id=note:writing-<sessionId>-<taskId>；原文无公开链接则 source_url、canonical_url=null，aliases=[]，scenario=null，mode=general，creator=null，published_at=null。collected_at 使用会话创建的精确时间，organized_at 实际整理日期；status 按实际完整度选择 archived/partial/pending，verification_status 按实际核验选择 source_only/cross_checked；verified_at 未核验为 null。tags、related 为数组，summary 为简短摘要，coverage_note 说明材料和核验覆盖，不将任务上传状态写入正文。

结束时 writing-result.json 为 {"schemaVersion":1,"kind":"draft","entry":"notes/writing-...","coverage":[...]}，coverage 与问答轮相同。原始材料和范文由 Worker 独立保留，不能用摘要替代。HTML 由应用统一模板从正文和本地配图导出，不将任意脚本加入成果包。不得自动归档或对外发布。
