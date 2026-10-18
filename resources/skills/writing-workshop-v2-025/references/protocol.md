# 写作协议 v2

## 输入与兼容

writing-input.json 包含 sessionId、version、protocolVersion=2、brief、sources、answers、turns、rounds、workingPlan、plan、planVersion、style、styleVersion、request、mode、skill。skill 为固定版本与哈希；完整读取本任务指定材料，sources 可为空，brief 是意图而非事实。无材料时 coverage=[]，不能虚构亲历。
每份 source 含 id,kind,role,label,text,files，可有 ref,version,document,metadata,omitted；localTextPath 与 files[].localPath 是本机只读副本。document 的媒体编号对应 attachmentId，授权读取及 coverage 使用 files[].id。区分正文、摘要、加工说明，保留原有缺失及核验边界。无法读取指定的关键材料输出 {schemaVersion:2,kind:"blocked",message:"实际缺失及已尝试办法"}，不能伪造已读。
context 默认 {audience:"技术实践者",language:"zh-CN",outputs:["illustrated-article","offline-html","markdown","assets"]}，后续明确调整优先。

旧请求与任务沿用协议 v1，新 Worker 同时支持冻结的 writing-workshop-v1 与当前 v2，不能用新规则替换旧快照。心跳 writingProtocol:1，另报 writingSkills:[{version:1,hash:旧版哈希},{version:2,hash:新版哈希}]，按版本与哈希匹配派发。

## round

仅生成 writing-result.json，schemaVersion=2、kind="round"：

- understanding、changeSummary：简短理解及相对上一轮的变化。
- suggestedTitle：AI 建议标题，非空字符串不超过200字符。
- workingPlan：{thesis:字符串,outline:字符串数组,materials:字符串数组,openIssues:字符串数组}；字段必需，可以未完成。建议和未确认主张不放入已确定决定。
- coverage：[{sourceId,status:"read",files:[文件id]}]，恰好覆盖全部 sources 和其 files；无材料时为空数组。
- directions：[{id,title,thesis,readerValue,support,missing}]，首次通常3至4个实质不同方向，后续保留未采用方向。
- decisions：[{key,value}]，仅用户已选择、明确补充或上下文已约定事项；推荐、缺答和暂不确定不算确认。
- openIssues：字符串数组；ready：布尔。
- questions：[{id,key,dimension,title,reason,mode,options:[{id,label,impact}],recommendedOptionId?,exploratory?,reopenReason?}]。未就绪时2至3题，ready 时为空。mode=single/multiple/text，text 的 options=[]；其余2至5项。推荐编号必须属于选项，不自动选中。维度见 interview.md。
- plan：ready 时必需，{thesis,audience,scope,evidence,outline:[字符串],visuals,unresolvedHandling}，形成简短写作约定。workingPlan 和 plan 分开保存。
- styleCandidate：可选 {name,appliesTo,rules:[{id,instruction,sourceId,example}],sample:""}，仅从指定范文正文提炼规则与定位例证，候选仍需确认。问答不试写。

自由回答及暂不确定由客户端提供，不重复写成选项。只组织方向与提纲，不输出文章段落，不将 ready 当作开始授权。复用已回答决定的 key 时必须有新条件影响、allowReopen=true，并以 reopenReason 说明原因；不能换 key 重问同一内容。

## 轮次接口

创建 POST /api/writing/sessions：{requestId,protocolVersion:2,brief,sources?:[]}，brief 或真实材料至少一项非空。不传 brief 与 protocolVersion 的旧请求仍创建 v1。
POST /api/writing/sessions/:id/turns：{requestId,baseVersion,roundId?,answers?:[{questionId,selected,text,uncertain}],message?:字符串}。至少一个实际答案或非空补充；允许部分答案与补充一起提交，答案绑定当前 roundId。旧题在下一轮开始后标 answeredAt 或 supersededAt，缺答不等于确认。旧会话提交 turns 后升 v2，旧任务及历史不变。
同一 requestId、同内容重试返回原结果；复用编号不同内容或版本冲突返回409，客户端保留输入，刷新后重新提交。选择与自由补充均不启动正文。

## 会话与导出

schemaVersion=2 的 session.json（兼容读取 v1）包含 id,version,protocolVersion,brief,title,titleSource,createdAt,updatedAt,context,sources,answers,turns,rounds,runs,workingPlan,plan,planVersion,style,styleCandidates,ready。
answers 保留 roundId,questionId,key,title,selected,labels,text,uncertain,at，不能用 decisions 替代原话。turns 保留 id,roundId,answers,message,at。rounds 保留 id,version,createdAt,result,answeredAt?,supersededAt?。工作提纲可逐轮变化，正式写作快照固定 planVersion、styleVersion 和完整规则。
style 有 id,version,parentId,origin,name,appliesTo,rules,sample,sources,createdAt。builtin-editorial-v1 的 origin=builtin，规则无范文 sourceId；个人档案 origin=exemplar，保留来源，升级另行确认。没有范文使用内置默认规则，不妨碍写作。
history.json 包含 {items:[各版本快照]}；ZIP 含 .writing-input/ 原件、drafts/ 历史稿件。独立模式保留导入文件，以 history/<新version>.json 和新稿目录追加，先写临时文件再替换当前 session.json。每轮结束保存，不等整篇成文。processing、ready、旧稿存在均不能推断新的写作授权。

## draft / revision

仅在作者明确开始后 draft；明确局部修改执行 revision。输出 notes/writing-<sessionId>-<taskId>/ 下 source.json、article.md、summary.md、references.md、editorial-note.md、images/。正文 role=publication，摘要 summary，引用 reference，过程 source，配图 image；图片用本地相对链接和图注，只登记实际存在的文件。正文不堆会话编号、核验日志或加工过程。
如果标为局部修改的要求实际改变主旨、结构、关键证据或风格，保留原稿，输出 kind=round、ready=false、2至3题说明影响；不是环境故障，不直接改写关键计划。
source.json 沿用资料库 schema_version=1、type=note、id=note:writing-<sessionId>-<taskId>；无公开原文则 source_url/canonical_url=null,aliases=[],scenario=null,mode=general,creator=null,published_at=null。collected_at 用会话创建精确时间，organized_at 用实际整理日期。status 按内容完整度，verification_status=source_only 或有另行证据的 cross_checked，未核验 verified_at=null；tags/related 为数组，summary 简短摘要，coverage_note 写实际材料与核验边界。
结束 writing-result.json：{schemaVersion:2,kind:"draft",entry:"notes/writing-...",coverage:[...]}。Worker 独立保留原件和冻结的写作依据，校验目录后上传待审阅。HTML 由应用统一安全模板导出，不插入任意脚本；先预览后确认归档，不自动发布。

配图成品使用 PNG、JPEG、WebP、GIF 或 AVIF，正文必须引用包内实际存在的本地图片；不能用外链、SVG 或未登记文件占位。生成示意图时可用可用的绘图工具或 Python/Pillow 等方式直接输出 PNG；如使用 SVG 绘制，须渲染成上述位图并更新正文链接，SVG 生成源可另存为 `.svg.txt`、role=source 保留。不要只生成 SVG 后声称图文交付完成。无法制作已约定图示时明确报告缺失，不能默默删图；Worker 和服务端会校验打包后正文的配图引用。
